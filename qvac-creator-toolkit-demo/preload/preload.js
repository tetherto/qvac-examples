// The only bridge between the UI and the main process. The renderer never sees ipcRenderer or the SDK.
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("ctk", {
  meta: () => ipcRenderer.invoke("meta"),
  script: (args) => ipcRenderer.invoke("script:run", args),
  voice: (args) => ipcRenderer.invoke("voice:run", args),
  voiceSample: (args) => ipcRenderer.invoke("voice:sample", args),
  subtitles: (args) => ipcRenderer.invoke("subs:run", args),
  musicStatus: () => ipcRenderer.invoke("music:status"),
  unload: (tool) => ipcRenderer.invoke("unload", tool),
  unloadAll: () => ipcRenderer.invoke("unload-all"),
  scanModels: (dir) => ipcRenderer.invoke("scan-models", dir),
  detectSpeakers: (text) => ipcRenderer.invoke("detect-speakers", text),
  setModelsFolder: (dir) => ipcRenderer.invoke("set-models-folder", dir),
  setOutputFolder: (dir) => ipcRenderer.invoke("set-output-folder", dir),
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  saveText: (args) => ipcRenderer.invoke("save-text", args),
  pickMedia: () => ipcRenderer.invoke("pick-media"),
  reveal: (p) => ipcRenderer.invoke("reveal", p),
  openOut: () => ipcRenderer.invoke("open-out"),
  readBytes: (p) => ipcRenderer.invoke("read-bytes", p),
  readText: (p) => ipcRenderer.invoke("read-text", p),
  // Electron 30+ removed File.path; webUtils.getPathForFile (called in preload) resolves a dropped file.
  droppedPath: (file) => { try { return webUtils.getPathForFile(file); } catch { return ""; } },
  onProgress: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on("progress", h); return () => ipcRenderer.removeListener("progress", h); },
});
