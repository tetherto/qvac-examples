// The only bridge between the renderer and the main process. Context-isolated, no Node in the
// renderer, and an explicit allow-list of channels: the UI can ask for exactly these things and
// nothing else.
"use strict";
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("ledger", {
  // The renderer must parse a typed-in amount with the SAME rules as the extraction path. Two
  // implementations drifted once already: the renderer's `replace(",", ".")` turned a hand-typed
  // "2.690,00" into 0 while clearing the review flag, which is worse than the value it was meant to
  // correct.
  //
  // This goes over IPC rather than `require("./lib/schema")` here, because a preload runs sandboxed
  // and cannot require app files: doing so throws and takes the ENTIRE bridge down with it, so
  // `window.ledger` is undefined and the whole UI is dead. (Caught by test-ui.cjs, which is exactly
  // what it is for.) Disabling the sandbox would fix the require and weaken the renderer; a round
  // trip on a keystroke-committed edit costs nothing.
  parseAmount: (raw) => ipcRenderer.invoke("parse-amount", raw),

  // queries + commands
  state: () => ipcRenderer.invoke("state"),
  pickFiles: () => ipcRenderer.invoke("pick-files"),
  pickFolders: () => ipcRenderer.invoke("pick-folders"),
  // Expands a mixed selection of files and folders into the actual document list, recursively.
  scan: (paths) => ipcRenderer.invoke("scan", paths),

  // settings: which model reads text, which one looks at pictures
  models: () => ipcRenderer.invoke("models"),
  setModels: (sel) => ipcRenderer.invoke("set-models", sel),
  downloadModel: (kind, key) => ipcRenderer.invoke("download-model", { kind, key }),
  setTemplate: (id) => ipcRenderer.invoke("set-template", id),
  saveTemplate: (t) => ipcRenderer.invoke("save-template", t),
  deleteTemplate: (id) => ipcRenderer.invoke("delete-template", id),
  extract: (files, templateId) => ipcRenderer.invoke("extract", { files, templateId }),
  cancel: () => ipcRenderer.invoke("cancel"),
  updateCell: (rowId, key, value) => ipcRenderer.invoke("update-cell", { rowId, key, value }),
  deleteRow: (id) => ipcRenderer.invoke("delete-row", id),
  clearRows: (id) => ipcRenderer.invoke("clear-rows", id),
  exportCsv: (opts) => ipcRenderer.invoke("export-csv", opts),
  reveal: (p) => ipcRenderer.invoke("reveal", p),
  unloadModels: () => ipcRenderer.invoke("unload-models"),

  // A dropped File object has no usable path in a modern Electron renderer; this is the supported
  // way to recover the real filesystem path so main can read it.
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return null; } },

  // events, main -> renderer
  on: (channel, cb) => {
    const allowed = ["busy", "download-progress", "file-start", "file-done", "file-error", "models-changed"];
    if (!allowed.includes(channel)) return () => {};
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
