// QVAC Desk Tidy: Electron main process. Owns the SDK/models, all filesystem writes, the tray, the
// scheduler and the watcher. The renderer is UI only, over IPC (preload.js).
"use strict";
const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, Notification, nativeImage, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { Classifier } = require("./lib/classifier");
const { Store } = require("./lib/store");
const { Journal } = require("./lib/journal");
const { Automation } = require("./lib/automation");
const { DEFAULT_CATEGORIES, buildPlan, applyPlan, undoRun } = require("./lib/engine");

const USER = app.getPath("userData");
const store = new Store(path.join(USER, "desk-tidy-config.json"));
const journal = new Journal(path.join(USER, "desk-tidy-journal.json"));
const classifier = new Classifier();

let win = null;
let tray = null;
let categoriesReady = false;
let lastRun = null;        // { dir, count, runId, ts }
let idleTimer = null;
const scans = new Map();   // scanId -> AbortController

// ---- model access is serialized (single GPU worker): one classify run at a time ----
// NEVER call serialize() from inside a serialized task: the inner call is queued behind the outer one
// which is awaiting it, which deadlocks. `inTask` makes that mistake a loud error instead of a hang.
let chain = Promise.resolve();
let inTask = false;
function serialize(fn) {
  if (inTask) return Promise.reject(new Error("serialize() called re-entrantly (would deadlock)"));
  const run = async () => { inTask = true; try { return await fn(); } finally { inTask = false; } };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

async function ensureCategories() {
  if (categoriesReady) return;
  await classifier.setCategories(DEFAULT_CATEGORIES, store.settings.defaultThreshold || 0.45);
  categoriesReady = true;
}
function armIdleUnload() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => serialize(async () => { await classifier.unload(); categoriesReady = false; }), 10 * 60 * 1000);
}

// ---- one place that classifies a folder into a plan (streams rows if onRow given) ----
async function classifyFolder(dir, threshold, onRow, abortSignal) {
  return serialize(async () => {
    await ensureCategories();
    classifier.setThreshold(threshold || store.settings.defaultThreshold || 0.45);
    const plan = await buildPlan(dir, classifier, DEFAULT_CATEGORIES, { onRow, abortSignal });
    armIdleUnload();
    return plan;
  });
}

// ---- automation: interval + watch fire this, honouring the folder's posture ----
const automation = new Automation(async (rule) => {
  const plan = await classifyFolder(rule.path, rule.threshold);
  const willMove = plan.filter((r) => r.willMove);
  const notSure = plan.filter((r) => !r.willMove);
  if (rule.posture === "auto") {
    if (!willMove.length) return;
    const res = applyPlan(rule.path, plan, DEFAULT_CATEGORIES, journal);
    lastRun = { dir: rule.path, count: res.summary.count, runId: res.runId, ts: Date.now() };
    refreshTray();
    notify(`Tidied ${res.summary.count} file${res.summary.count === 1 ? "" : "s"}`,
      `${path.basename(rule.path)}${notSure.length ? ` (${notSure.length} left for review)` : ""}. Click to review or undo.`,
      () => openWithResult({ dir: rule.path, applied: true, runId: res.runId, summary: res.summary, plan }));
  } else { // notify-first: nothing moves until the user clicks
    if (!willMove.length) return;
    notify(`${willMove.length} file${willMove.length === 1 ? "" : "s"} ready to sort`,
      `in ${path.basename(rule.path)}. Click to review the plan.`,
      () => openWithResult({ dir: rule.path, applied: false, plan }));
  }
});

function notify(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: false });
  if (onClick) n.on("click", onClick);
  n.show();
}

// ---- windows ----
function createWindow() {
  win = new BrowserWindow({
    width: 940, height: 720, minWidth: 720, minHeight: 520,
    title: "QVAC Desk Tidy Demo", backgroundColor: "#060607", show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  // Surface renderer errors (JS exceptions, CSP violations) in the main log. Without this a broken
  // renderer just shows a blank panel and the terminal says nothing.
  win.webContents.on("console-message", (e, level, message, line, source) => {
    if (level >= 2) console.error(`[renderer] ${message} (${String(source).split("/").pop()}:${line})`);
  });
  win.once("ready-to-show", () => win.show());
  // Dev aid: DESK_TIDY_SHOT=/path/shot.png captures the window once it has painted, then exits.
  if (process.env.DESK_TIDY_SHOT) {
    win.webContents.once("did-finish-load", () => setTimeout(async () => {
      try {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(process.env.DESK_TIDY_SHOT, img.toPNG());
        console.log("[shot] wrote " + process.env.DESK_TIDY_SHOT);
      } catch (err) { console.error("[shot] failed", (err && err.message) || err); }
      app.exit(0);
    }, 1200));
  }
  win.on("closed", () => { win = null; });
}
function showWindow() { if (!win) createWindow(); else { win.show(); win.focus(); } }

// open the window and push a folder result (review or applied) into it
function openWithResult(payload) {
  showWindow();
  const send = () => win && win.webContents.send("load-result", payload);
  if (win.webContents.isLoading()) win.webContents.once("did-finish-load", send); else send();
}

// ---- tray / menu bar ----
function trayIcon() {
  // simple template dot; falls back to empty image if asset missing
  const p = path.join(__dirname, "renderer", "trayTemplate.png");
  try { if (fs.existsSync(p)) return nativeImage.createFromPath(p); } catch { /* */ }
  return nativeImage.createEmpty();
}
function refreshTray() {
  if (!tray) return;
  const paused = automation.isPaused();
  const items = [
    { label: lastRun ? `Last: tidied ${lastRun.count} in ${path.basename(lastRun.dir)}` : "Desk Tidy: idle", enabled: false },
    { type: "separator" },
    { label: "Open Desk Tidy", click: () => showWindow() },
    { label: "Undo last tidy", enabled: !!(lastRun && journal.entriesForRun(lastRun.runId).length), click: () => doUndo(lastRun && lastRun.runId) },
    { type: "separator" },
    paused
      ? { label: "Resume automation", click: () => { automation.resume(); refreshTray(); } }
      : { label: "Pause automation for 1 hour", click: () => { automation.pauseFor(60 * 60 * 1000); refreshTray(); } },
    { type: "separator" },
    { label: "Quit", click: () => { automation.stopAll(); app.quit(); } },
  ];
  tray.setToolTip(paused ? "Desk Tidy (paused)" : "Desk Tidy");
  tray.setContextMenu(Menu.buildFromTemplate(items));
}
function createTray() {
  try { tray = new Tray(trayIcon()); } catch { tray = null; return; }
  try { tray.setTitle(" Tidy"); } catch { /* */ } // visible in the menu bar even without an icon asset
  tray.on("click", () => showWindow());
  refreshTray();
}

function doUndo(runId) {
  const id = runId || journal.lastRunId();
  if (!id) return { restored: 0 };
  const r = undoRun(journal, id);
  if (lastRun && lastRun.runId === id) lastRun = null;
  refreshTray();
  if (win) win.webContents.send("undone", { runId: id, restored: r.restored });
  return r;
}

// ---- IPC (renderer -> main) ----
ipcMain.handle("pick-folder", async () => {
  const r = await dialog.showOpenDialog(win || undefined, { properties: ["openDirectory"], title: "Choose a folder to tidy" });
  if (r.canceled || !r.filePaths[0]) return null;
  const dir = r.filePaths[0];
  let count = 0; try { count = fs.readdirSync(dir).filter((n) => !n.startsWith(".")).length; } catch { /* */ }
  return { dir, count };
});

ipcMain.handle("scan", async (e, { dir, threshold, scanId }) => {
  const ac = new AbortController();
  if (scanId) scans.set(scanId, ac);
  const warm = classifier.embedId != null;
  if (win) win.webContents.send("scan:status", { scanId, text: warm ? "Reading files…" : "Preparing the model (first run downloads it, up to a minute)…" });
  try {
    const plan = await classifyFolder(dir, threshold, (row) => { if (win) win.webContents.send("scan:row", { scanId, row }); }, ac.signal);
    return { ok: true, plan };
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
  finally { if (scanId) scans.delete(scanId); }
});
ipcMain.handle("scan:cancel", (e, { scanId }) => { const ac = scans.get(scanId); if (ac) ac.abort(); return true; });

ipcMain.handle("apply", async (e, { dir, plan, excluded }) => {
  const ex = new Set(excluded || []);
  const res = applyPlan(dir, plan, DEFAULT_CATEGORIES, journal, { excluded: ex });
  lastRun = { dir, count: res.summary.count, runId: res.runId, ts: Date.now() };
  refreshTray();
  return res;
});

ipcMain.handle("undo", (e, { runId } = {}) => doUndo(runId));
ipcMain.handle("reveal", (e, { p }) => { try { shell.showItemInFolder(p); } catch { /* */ } });

ipcMain.handle("folders:list", () => store.folders());
ipcMain.handle("folders:save", (e, rule) => { const r = store.upsertFolder(rule); automation.sync(store.folders()); refreshTray(); return r; });
ipcMain.handle("folders:remove", (e, { p }) => { store.removeFolder(p); automation.sync(store.folders()); return store.folders(); });
ipcMain.handle("settings:get", () => store.settings);
ipcMain.handle("settings:set", (e, patch) => { store.setSettings(patch); return store.settings; });
ipcMain.handle("categories:get", () => DEFAULT_CATEGORIES
  .filter((c) => !c.id.startsWith("_"))   // `_other` is the internal null category, never a user choice
  .map((c) => ({ id: c.id, label: c.label, folder: c.folder })));
ipcMain.handle("automation:status", () => ({ paused: automation.isPaused(), lastRun }));

// ---- lifecycle ----
// Single-instance lock: two copies of this app would fight over the same on-device QVAC worker and
// corestore lock (~/.qvac) and both would hang. Refuse the second instance and focus the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());
  app.whenReady().then(() => {
    createWindow();
    createTray();
    automation.sync(store.folders());
    console.log("[desk-tidy] ready. window + tray up, " + store.folders().length + " managed folders.");
    if (process.env.DESK_TIDY_SELFTEST) {
      const d = process.env.DESK_TIDY_SELFTEST;
      const secs = parseInt(process.env.DESK_TIDY_SELFTEST_TIMEOUT || "120", 10);
      const wd = setTimeout(() => { console.error(`[selftest] TIMEOUT after ${secs}s (model load or worker lock is stuck)`); app.exit(2); }, secs * 1000);
      // NOT wrapped in serialize(): classifyFolder serializes internally (nesting would deadlock).
      (async () => {
        try {
          console.log("[selftest] loading embedder…");
          const plan = await classifyFolder(d, 0.45);
          clearTimeout(wd);
          console.log("[selftest] classified", plan.length, "files:", plan.map((r) => `${r.name}=${r.willMove ? r.category : "leave"}(${r.signal})`).join(" "));
          const res = applyPlan(d, plan, DEFAULT_CATEGORIES, journal);
          console.log("[selftest] moved", res.summary.count, JSON.stringify(res.summary.byCategory));
          const u = undoRun(journal, res.runId);
          console.log("[selftest] undo restored", u.restored, u.restored === res.summary.count ? "OK" : "MISMATCH");
        } catch (e) { console.error("[selftest] FAIL", (e && e.stack) || e); }
        finally { setTimeout(() => app.exit(0), 300); }
      })();
    }

    // End-to-end automation test through the REAL callback + Automation instance: a file dropped into a
    // watched folder must be classified and (posture "auto") moved on its own, journalled, and undoable.
    if (process.env.DESK_TIDY_AUTOTEST) {
      const dir = process.env.DESK_TIDY_AUTOTEST;
      const wd = setTimeout(() => { console.error("[autotest] TIMEOUT"); app.exit(2); }, 240000);
      (async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const list = () => fs.readdirSync(dir).filter((n) => !n.startsWith("."));
        let bad = 0;
        const check = (c, m) => { console.log((c ? "  OK  " : "  XX  ") + m); if (!c) bad++; };
        try {
          // 1. posture "notify": automation must classify but move NOTHING
          store.upsertFolder({ path: dir, trigger: "watch", posture: "notify", threshold: 0.45 });
          automation.sync(store.folders());
          await sleep(700);
          fs.writeFileSync(path.join(dir, "invoice-notify.txt"), "INVOICE 2026-500 line items 3 x 250 EUR total due 750 EUR VAT 20% payment terms 30 days");
          await sleep(12000);
          check(list().includes("invoice-notify.txt"), 'notify posture: file still in place (nothing moved without a click)');

          // 2. posture "auto": the same drop must be filed on its own
          store.upsertFolder({ path: dir, trigger: "watch", posture: "auto", threshold: 0.45 });
          automation.sync(store.folders());
          await sleep(700);
          fs.writeFileSync(path.join(dir, "invoice-auto.txt"), "INVOICE 2026-501 line items 2 x 400 EUR total amount due 800 EUR VAT 20% payment within 30 days bank transfer");
          const deadline = Date.now() + 90000;
          while (Date.now() < deadline && list().includes("invoice-auto.txt")) await sleep(1500);
          const filed = fs.existsSync(path.join(dir, "Invoices & Receipts", "invoice-auto.txt"));
          check(!list().includes("invoice-auto.txt"), "auto posture: file left the folder root");
          check(filed, "auto posture: filed into 'Invoices & Receipts'");
          check(!!lastRun && lastRun.count >= 1, `auto posture: run recorded for undo (count=${lastRun && lastRun.count})`);

          // 3. undo an AUTOMATED run
          const u = doUndo(lastRun && lastRun.runId);
          check(u.restored >= 1, `undo of an automated run restored ${u.restored} file(s)`);
          check(list().includes("invoice-auto.txt"), "undo put the auto-filed file back at the root");

          automation.stopAll();
          store.removeFolder(dir);
          console.log(`[autotest] RESULT: ${bad === 0 ? "PASS" : "FAIL"} (${bad} failed)`);
        } catch (e) { console.error("[autotest] FAIL", (e && e.stack) || e); }
        finally { setTimeout(() => app.exit(0), 300); }
      })();
    }
  });
  process.on("uncaughtException", (e) => console.error("[desk-tidy] uncaught:", (e && e.stack) || e));
  app.on("window-all-closed", () => { /* stay alive in the menu bar */ });
  app.on("activate", () => showWindow());
  app.on("before-quit", () => automation.stopAll());
}
