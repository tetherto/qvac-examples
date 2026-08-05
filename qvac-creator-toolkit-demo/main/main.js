// Electron main process. Owns the window and is the ONLY side that talks to the SDK (via ./sdk.js).
const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const sdk = require("./sdk.js");

// Two instances of a QVAC app DEADLOCK on the shared ~/.qvac worker (no error, hangs forever).
// Hold a single-instance lock; a second launch just focuses the existing window.
if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

let win = null;
function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 880, minWidth: 1000, minHeight: 660,
    backgroundColor: "#060607", title: "QVAC Creator Toolkit Demo",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: { preload: path.join(__dirname, "..", "preload", "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  return win;
}
function progressFor(sender, tool) { return (ev) => { try { sender.send("progress", { tool, ...ev }); } catch { /* window gone */ } }; }

function wireIpc() {
  ipcMain.handle("meta", () => sdk.meta());
  ipcMain.handle("script:run", (e, a) => sdk.writeScript(a, progressFor(e.sender, "script")));
  ipcMain.handle("voice:run", (e, a) => sdk.voiceOver(a, progressFor(e.sender, "voice")));
  ipcMain.handle("voice:sample", async (e, a) => { const buf = await sdk.voiceSample(a); return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); });
  ipcMain.handle("subs:run", (e, a) => sdk.subtitles(a, progressFor(e.sender, "subs")));
  ipcMain.handle("music:status", () => sdk.musicStatus());
  ipcMain.handle("unload", (e, tool) => sdk.unloadTool(tool));
  ipcMain.handle("unload-all", () => sdk.unloadAll());
  // local models: scan a folder for loadable GGUFs (defaults to the QVAC cache)
  ipcMain.handle("scan-models", (e, dir) => sdk.scanModelsFolder(dir || sdk.modelsFolder()));
  ipcMain.handle("detect-speakers", (e, text) => [...new Set(sdk.parseScript(text).map((t) => t.speaker))]);
  ipcMain.handle("set-models-folder", (e, dir) => sdk.setModelsFolder(dir));
  ipcMain.handle("set-output-folder", (e, dir) => sdk.setOutputFolder(dir));
  // folder picker (output folder, models folder)
  ipcMain.handle("pick-folder", async () => { const r = await dialog.showOpenDialog(win, { title: "Choose a folder", properties: ["openDirectory", "createDirectory"] }); return r.canceled ? null : r.filePaths[0]; });
  // save a text file (SRT/VTT export) to a chosen location
  ipcMain.handle("save-text", async (e, { content, defaultName, filters }) => {
    const r = await dialog.showSaveDialog(win, { title: "Export", defaultPath: path.join(sdk.outputFolder(), defaultName || "export.txt"), filters: filters || [{ name: "Text", extensions: ["txt"] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, content, "utf8"); return r.filePath;
  });
  ipcMain.handle("reveal", (e, p) => { if (p && fs.existsSync(p)) shell.showItemInFolder(p); });
  ipcMain.handle("open-out", () => { const d = sdk.ensureDir(sdk.outputFolder()); shell.openPath(d); });
  ipcMain.handle("read-bytes", (e, p) => { if (!p || !fs.existsSync(p)) return null; const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
  ipcMain.handle("read-text", (e, p) => { if (!p || !fs.existsSync(p)) return null; return fs.readFileSync(p, "utf8"); });
  ipcMain.handle("pick-media", async () => {
    const r = await dialog.showOpenDialog(win, { title: "Choose a video or audio file", properties: ["openFile"], filters: [{ name: "Audio / Video", extensions: ["mp4", "mov", "m4v", "mkv", "webm", "avi", "mp3", "m4a", "wav", "aac", "flac", "ogg", "aiff", "aif"] }, { name: "All files", extensions: ["*"] }] });
    return r.canceled ? null : r.filePaths[0];
  });
}

app.whenReady().then(async () => {
  wireIpc();
  if (process.env.CTK_SELFTEST === "1") {
    try { let toks = 0; const r = await sdk.writeScript({ idea: "prove the SDK runs inside Electron", length: "15 seconds", tone: "plain", model: "llama-1b" }, (ev) => { if (ev.phase === "token") toks++; }); process.stdout.write(`[selftest] OK: ${r.text.length} chars, ${toks} tokens.\n`); await sdk.unloadAll(); app.exit(0); }
    catch (e) { process.stderr.write("[selftest] FAIL: " + (e && e.stack || e) + "\n"); app.exit(1); }
    return;
  }
  createWindow();
  if (process.env.CTK_UITEST === "1") {
    win.webContents.on("did-finish-load", async () => {
      try {
        const meta = await win.webContents.executeJavaScript("window.ctk.meta()");
        process.stdout.write(`[uitest] meta: LLM=${Object.keys(meta.LLM_MODELS)} voices=${meta.TTS_VOICES} music=${meta.music.available} out=${!!meta.outputFolder}\n`);
        const r = await win.webContents.executeJavaScript("window.ctk.script({idea:'ipc smoke test',length:'15 seconds',tone:'plain',model:'llama-1b'})");
        process.stdout.write(`[uitest] script via IPC: ${r.text.length} chars\n`);
        const errs = await win.webContents.executeJavaScript("window.__ctkErrors||[]");
        process.stdout.write(`[uitest] renderer errors: ${JSON.stringify(errs)}\n`);
        app.exit(0);
      } catch (e) { process.stderr.write("[uitest] FAIL " + (e && e.stack || e) + "\n"); app.exit(1); }
    });
  }
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", async () => { try { await sdk.unloadAll(); } catch { /* */ } if (process.platform !== "darwin") app.quit(); });
