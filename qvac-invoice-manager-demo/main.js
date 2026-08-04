// QVAC Invoice Manager Demo - Electron main process.
//
// Owns the SDK and the filesystem; the renderer is UI only and talks over IPC. That split is not
// stylistic: a renderer context blocks `fetch` on CORS grounds (proven in the QVAC Obsidian plugin
// work), and keeping every model call in one process means one model registry and no duplicated
// memory.
"use strict";
const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { inspect } = require("./lib/reader");
const { Extractor } = require("./lib/extractor");
const { Store } = require("./lib/store");
const { toCsv } = require("./lib/csv");
const { collectDocuments, SUPPORTED } = require("./lib/walk");
const { schemaForTemplate, FIELD_TYPES, parseAmount } = require("./lib/schema");

// Own the userData directory explicitly. Unpackaged Electron apps otherwise fall back to a generic
// shared folder, and the rows here are extracted invoice contents: supplier names, VAT IDs, amounts
// and absolute paths. They do not belong in a directory every other dev app on the machine uses.
app.setName("QVAC Invoice Manager Demo");

// TWO instances of a QVAC app deadlock on the shared ~/.qvac worker with no error at all: it just
// hangs forever. The single-instance lock is the cheapest possible cure and it is mandatory.
if (!app.requestSingleInstanceLock()) app.exit(0);

let win = null;
let store = null;
const extractor = new Extractor();
let busy = false;                 // one extraction at a time; the worker is single-flight
let cancelRequested = false;

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

extractor.onProgress = (p) => send("download-progress", p);

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 980, minHeight: 640,
    backgroundColor: "#060607",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));

  // Without these, dropping a file anywhere outside the drop zone navigates the window to that
  // file. The preload runs on EVERY document in this webContents, so an HTML or SVG "invoice"
  // dropped on the table would become the renderer and inherit the whole `ledger` bridge: it could
  // read every extracted supplier, VAT ID and amount and post them out. Even with a harmless PDF
  // the app is simply gone, with no way back. The renderer also blocks stray drops (see app.js);
  // this is the half that cannot be bypassed from the page.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });
  win.webContents.on("will-attach-webview", (e) => e.preventDefault());
}

// ---------------------------------------------------------------- PDF rasterising
// A scanned PDF has no text to extract, so it has to be looked at. Electron already ships
// Chromium's PDF viewer, so we render the first page in an offscreen window and capture it. That
// keeps the app cross-platform with no poppler, no ImageMagick, no native module: the one heavy
// dependency we would otherwise need is already in the runtime.
const RENDER_TIMEOUT_MS = 25000;

async function renderPdfFirstPage(pdfPath) {
  const off = new BrowserWindow({
    show: false, width: 1240, height: 1754,          // A4 at ~150 DPI
    webPreferences: {
      offscreen: true,
      plugins: true,        // enables the built-in PDF viewer, and is what feeds PDFium the file
      // Spelled out rather than left to defaults. This window renders a document a stranger sent
      // us, and the next person to copy this block is the threat.
      sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
    },
  });
  try {
    // A link annotation or an embedded action must not be able to make this window go anywhere.
    off.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    off.webContents.on("will-navigate", (e) => e.preventDefault());

    // `encodeURI` does NOT escape `#` or `?`, so a file called "Invoice #1234.pdf" (an entirely
    // normal name) produced a URL that Chromium truncated at the `#`: it then opened a DIFFERENT
    // path than the one just validated, or failed with ERR_FILE_NOT_FOUND. Windows was worse, since
    // `file://C:\...` makes `C:` the URL authority. pathToFileURL is the only correct construction.
    const url = pathToFileURL(pdfPath).toString() + "#toolbar=0&view=FitH";

    // An unbounded loadURL on a malformed PDF hangs the whole batch forever: `busy` stays true, the
    // finally never runs, and Cancel is only read between files, so the app is bricked until a
    // force quit. Bound it and let the file fail on its own.
    await Promise.race([
      off.loadURL(url),
      new Promise((_r, rej) => setTimeout(() => rej(new Error("PDF took too long to render")), RENDER_TIMEOUT_MS)),
    ]);
    // The viewer paints asynchronously after load; without a beat the capture is blank.
    await new Promise((r) => setTimeout(r, 1400));
    const image = await off.webContents.capturePage();
    if (image.isEmpty()) throw new Error("PDF rendered to an empty image");

    // One private directory per render, mode 0700, and the file itself 0600 with the `wx` flag.
    // The previous version wrote `qvac-ledger-<Date.now()>.png` straight into a shared /tmp at mode
    // 0644: a full-page render of someone's invoice readable by every account on the box, under a
    // name an attacker can predict to the millisecond and pre-plant as a symlink.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qvac-ledger-"));
    fs.chmodSync(dir, 0o700);
    const out = path.join(dir, "page1.png");
    fs.writeFileSync(out, image.toPNG(), { mode: 0o600, flag: "wx" });
    return { imagePath: out, tempDir: dir };
  } finally {
    if (!off.isDestroyed()) off.destroy();
  }
}

// Turn any accepted file into something the extractor can consume.
async function toSource(filePath) {
  const r = await inspect(filePath);
  if (r.kind === "pdf-needs-render") {
    const { imagePath, tempDir } = await renderPdfFirstPage(r.filePath);
    return { kind: "image", imagePath, signal: "pdf-render", tempDir, note: r.reason };
  }
  return r;
}

// ---------------------------------------------------------------- IPC
ipcMain.handle("state", () => ({
  templates: store.templates(),
  activeTemplateId: store.activeTemplate() ? store.activeTemplate().id : null,
  rows: store.data.rows,
  fieldTypes: Object.keys(FIELD_TYPES),
  busy,
}));

ipcMain.handle("pick-files", async () => {
  const res = await dialog.showOpenDialog(win, {
    title: "Choose invoices or receipts",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Invoices", extensions: [...SUPPORTED].map((e) => e.slice(1)) }],
  });
  return res.canceled ? [] : res.filePaths;
});

// A separate dialog rather than one combined picker: macOS will happily show openFile and
// openDirectory together, Windows will not, and a folder picker that silently behaves differently
// per platform is worse than two obvious buttons.
ipcMain.handle("pick-folders", async () => {
  const res = await dialog.showOpenDialog(win, {
    title: "Choose folders of invoices (subfolders are included)",
    properties: ["openDirectory", "multiSelections", "createDirectory"],
  });
  return res.canceled ? [] : res.filePaths;
});

// Expand a selection into the actual documents, so the renderer never has to know the difference
// between a file, a folder, or five folders.
ipcMain.handle("scan", (_e, paths) => {
  const r = collectDocuments(paths);
  return { files: r.files, folders: r.folders, skipped: r.skipped.length, truncated: r.truncated };
});

// Changing the templates while a batch is running corrupts the batch: `extract` holds one template
// for its whole run, so a delete purges the rows written so far and every later row lands under an
// id that no longer exists (invisible in the table, not exportable, not clearable, still on disk).
// The UI also disables these, but the guard belongs where the damage happens.
function refuseWhileBusy(what) {
  if (busy) throw new Error(`cannot ${what} while documents are being read`);
}
ipcMain.handle("set-template", (_e, id) => { refuseWhileBusy("switch table"); return store.setActiveTemplate(id); });
ipcMain.handle("save-template", (_e, t) => { refuseWhileBusy("edit a table"); return store.saveTemplate(t); });
ipcMain.handle("delete-template", (_e, id) => { refuseWhileBusy("delete a table"); return store.deleteTemplate(id); });
ipcMain.handle("update-cell", (_e, { rowId, key, value }) => store.updateCell(rowId, key, value));
ipcMain.handle("delete-row", (_e, id) => store.deleteRow(id));
ipcMain.handle("clear-rows", (_e, id) => { store.clearRows(id); return true; });
ipcMain.handle("cancel", () => { cancelRequested = true; return true; });
ipcMain.handle("parse-amount", (_e, raw) => parseAmount(raw));
ipcMain.handle("reveal", (_e, p) => { if (p && fs.existsSync(p)) shell.showItemInFolder(p); return true; });

// Extract a batch. Streams one event per file so the table fills in as it goes rather than
// freezing for a minute and then dumping everything at once.
ipcMain.handle("extract", async (_e, { files, templateId }) => {
  if (busy) return { error: "already running" };
  if (!Array.isArray(files) || !files.length) return { error: "no files given" };
  // Whatever arrived (files, folders, or a mix from a drop) becomes a flat, deduped, sorted list.
  const scan = collectDocuments(files);
  files = scan.files;
  if (!files.length) return { error: "no PDFs or images found in that selection" };
  // Deliberately NOT `|| store.activeTemplate()`. Falling back would file the rows under a table the
  // user is not looking at while reporting success: a wrong-destination write, which in an
  // accounting app has to be an error.
  const stored = store.template(templateId);
  if (!stored) return { error: "that table no longer exists" };
  // Snapshot it: an edit landing mid-batch must not change the columns half way through.
  const template = JSON.parse(JSON.stringify(stored));
  busy = true; cancelRequested = false;
  send("busy", true);
  let done = 0, failed = 0;
  try {
    for (let i = 0; i < files.length; i++) {
      if (cancelRequested) break;
      const filePath = files[i];
      const name = path.basename(filePath);
      send("file-start", { index: i, total: files.length, name });
      let source = null;
      try {
        source = await toSource(filePath);
        if (source.kind === "unsupported") throw new Error(source.reason);
        const res = await extractor.extract(source, template);
        const row = store.addRow({
          id: `${Date.now()}-${i}`,
          templateId: template.id,
          file: filePath,
          name,
          values: res.values,
          missing: res.missing,
          issues: res.issues,
          model: res.model,
          warning: res.warning,
          signal: source.signal,
          ms: res.ms,
          at: new Date().toISOString(),
        });
        done++;
        send("file-done", { index: i, total: files.length, row });
      } catch (err) {
        failed++;
        send("file-error", { index: i, total: files.length, name, error: String(err.message || err) });
      } finally {
        // A rendered page is a temp file; do not leave copies of someone's invoices in /tmp.
        if (source && source.tempDir) {
          try { fs.rmSync(source.tempDir, { recursive: true, force: true }); } catch { /* */ }
        }
      }
    }
    return { done, failed, cancelled: cancelRequested };
  } finally {
    busy = false; cancelRequested = false;
    send("busy", false);
  }
});

ipcMain.handle("export-csv", async (_e, { templateId, delimiter, decimalComma }) => {
  const template = store.template(templateId);
  if (!template) return { error: "unknown template" };
  const { fields } = schemaForTemplate(template);
  const rows = store.rowsFor(template.id);
  if (!rows.length) return { error: "nothing to export yet" };
  const suggested = `${template.name.replace(/[^\w-]+/g, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
  const res = await dialog.showSaveDialog(win, { title: "Export CSV", defaultPath: suggested, filters: [{ name: "CSV", extensions: ["csv"] }] });
  if (res.canceled) return { cancelled: true };
  // A read-only volume, a full disk, or the file already open in Excel on Windows all throw here.
  // Left unhandled this rejects the invoke and the renderer shows nothing at all, so the user
  // cannot tell whether their export was written.
  try {
    fs.writeFileSync(res.filePath, toCsv(fields, rows, { delimiter, decimalComma }), { mode: 0o600 });
  } catch (e) {
    return { error: `could not write the file: ${String((e && e.message) || e)}` };
  }
  const needsReview = rows.filter((r) => Array.isArray(r.missing) && r.missing.length).length;
  return { path: res.filePath, count: rows.length, needsReview };
});

ipcMain.handle("unload-models", async () => { await extractor.unload(); return true; });

// ---------------------------------------------------------------- lifecycle
app.whenReady().then(() => {
  sweepOldRenders();
  store = new Store(path.join(app.getPath("userData")));
  createWindow();
  // If the store had to move a corrupt file aside, say so. Silently starting fresh would look like
  // the app had eaten every extracted row.
  if (store.recovered) {
    win.webContents.once("did-finish-load", () => {
      dialog.showMessageBox(win, {
        type: "warning",
        message: "Your saved tables could not be read",
        detail: `The file was not valid JSON (${store.recovered.reason}).\n\nIt has been kept at:\n${store.recovered.backup}\n\nThe app has started with the built-in tables. Nothing was deleted.`,
      });
    });
  }
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch((e) => {
  // An unhandled rejection here means no window and no error: a dead dock icon.
  dialog.showErrorBox("QVAC Invoice Manager Demo could not start", String((e && e.stack) || e));
  app.exit(1);
});

app.on("second-instance", () => { if (win) { win.show(); win.focus(); } });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

// Releasing the models on the way out is not just tidiness. A QVAC app that lingers holds the shared
// worker in ~/.qvac, and the NEXT QVAC app to start then blocks on loadModel with no error at all.
// On macOS this process deliberately survives its window, so without this the app becomes exactly
// the deadlock its own watchdog exists to explain.
let unloading = null;
app.on("before-quit", (e) => {
  if (unloading) return;
  e.preventDefault();
  unloading = extractor.unload()
    .catch(() => { /* quitting anyway */ })
    .finally(() => app.quit());
});

// A crash or a force quit mid-batch leaves a rendered invoice page in the temp dir. Sweep ours on
// the way in, since nothing else ever will.
function sweepOldRenders() {
  try {
    for (const name of fs.readdirSync(os.tmpdir())) {
      if (!name.startsWith("qvac-ledger-")) continue;
      try { fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true }); } catch { /* */ }
    }
  } catch { /* not worth failing a launch over */ }
}
