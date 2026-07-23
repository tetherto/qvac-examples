// ============================================================
// QVAC Gym Training — preload bridge
// Exposes only what the renderer needs:
//   - analyzeFrames: sends the sampled JPEG frames (ArrayBuffers) to the
//     main process (QVAC SDK) and returns { exercise, strengths, improvements }.
//   - onModelProgress: subscribe to model loading / download events.
//   - getModelStatus: request the current model status.
// The video file is never sent across this bridge — only the frames the
// renderer draws on a <canvas>. Nothing here talks to the network.
// ============================================================
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("QVAC_BRIDGE", {
  analyzeFrames: (frames) => ipcRenderer.invoke("analyze-frames", frames),
  onModelProgress: (cb) => ipcRenderer.on("model-progress", (_event, status) => cb(status)),
  getModelStatus: () => ipcRenderer.invoke("get-model-status"),
  isElectron: true,
  platform: process.platform,
});
