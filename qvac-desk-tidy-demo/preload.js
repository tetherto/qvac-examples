// The only bridge between the renderer (UI) and the main process. No Node in the renderer.
"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tidy", {
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  scan: (args) => ipcRenderer.invoke("scan", args),
  cancelScan: (scanId) => ipcRenderer.invoke("scan:cancel", { scanId }),
  apply: (args) => ipcRenderer.invoke("apply", args),
  undo: (runId) => ipcRenderer.invoke("undo", { runId }),
  reveal: (p) => ipcRenderer.invoke("reveal", { p }),

  listFolders: () => ipcRenderer.invoke("folders:list"),
  saveFolder: (rule) => ipcRenderer.invoke("folders:save", rule),
  removeFolder: (p) => ipcRenderer.invoke("folders:remove", { p }),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (patch) => ipcRenderer.invoke("settings:set", patch),
  getCategories: () => ipcRenderer.invoke("categories:get"),
  automationStatus: () => ipcRenderer.invoke("automation:status"),

  onScanRow: (cb) => ipcRenderer.on("scan:row", (e, d) => cb(d)),
  onScanStatus: (cb) => ipcRenderer.on("scan:status", (e, d) => cb(d)),
  onLoadResult: (cb) => ipcRenderer.on("load-result", (e, d) => cb(d)),
  onUndone: (cb) => ipcRenderer.on("undone", (e, d) => cb(d)),
});
