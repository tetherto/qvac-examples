// ============================================================
// QVAC Story Image Generator — preload bridge
// Exposes only what the renderer needs:
//   - generateCaptions: sends the chosen story + character to the
//     main process (QVAC SDK) and returns the five caption strings.
//   - onModelProgress: subscribe to model loading/download events.
//   - getModelStatus: request current status.
// The photo is NEVER sent across this bridge — it stays in the
// renderer and is composited into the artwork there. Nothing here
// talks to the network.
// ============================================================
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("QVAC_BRIDGE", {
  // Local QVAC model via IPC to main process. Photo is intentionally absent.
  generateCaptions: (story, character) =>
    ipcRenderer.invoke("generate-captions", { story, character }),
  onModelProgress: (cb) => {
    ipcRenderer.on("model-progress", (_event, status) => cb(status));
  },
  getModelStatus: () => ipcRenderer.invoke("get-model-status"),

  isElectron: true,
  platform: process.platform,
});
