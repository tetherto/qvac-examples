// ============================================================
// QVAC Natural Language to SQL, preload bridge
// Exposes only what the renderer needs:
//   - generateSQL: sends a prompt to the main process (QVAC SDK)
//     and returns the raw model text.
//   - onModelProgress: subscribe to model loading/download events.
//   - getModelStatus: request current status synchronously.
// Everything runs on-device; nothing here talks to the network.
// ============================================================
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("QVAC_BRIDGE", {
  // Primary: local QVAC model via IPC to main process
  generateSQL: (prompt) => ipcRenderer.invoke("generate-sql", prompt),
  onModelProgress: (cb) => {
    ipcRenderer.on("model-progress", (_event, status) => cb(status));
  },
  getModelStatus: () => ipcRenderer.invoke("get-model-status"),

  isElectron: true,
  platform: process.platform,
});
