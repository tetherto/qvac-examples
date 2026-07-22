// ============================================================
// QVAC Natural Language to SQL, Electron main process
// Opens a single desktop window. No browser, no menu clutter.
//
// The renderer is served from a tiny localhost static server (not
// file://) so the in-app React/Babel pipeline behaves exactly like
// a normal page. The server binds to 127.0.0.1 only, not reachable
// from the network. The bank database lives in the renderer's memory.
//
// The local AI model (Qwen3 4B Q4_K_M) runs here in the main process
// via @qvac/sdk, and is exposed to the renderer through IPC.
//
// @qvac/sdk is an ES module, it must be loaded with dynamic import(),
// not require(). We do this before the window opens.
// ============================================================
const { app, BrowserWindow, Menu, shell, ipcMain } = require("electron");
const path = require("path");
const http = require("http");
const fs = require("fs");

// Keep a minimal menu (NOT null): the Edit role provides the clipboard keyboard
// shortcuts (Cmd/Ctrl+C/V/X/A, undo/redo). Removing the menu entirely breaks paste
// into text fields on macOS. autoHideMenuBar keeps it out of the way on Win/Linux.
Menu.setApplicationMenu(
  Menu.buildFromTemplate([
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    { role: "editMenu" },
    { role: "windowMenu" },
  ])
);

const RENDERER_DIR = path.join(__dirname, "renderer");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jsx": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".json": "application/json",
};

// ---- QVAC SDK -------------------------------------------------------
// @qvac/sdk is an ES module: use dynamic import(), never require().
let loadModel, completion, unloadModel, QWEN3_4B_INST_Q4_K_M;
let sdkLoadError = null;

async function loadSDK() {
  try {
    const sdk = await import("@qvac/sdk");
    loadModel = sdk.loadModel;
    completion = sdk.completion;
    unloadModel = sdk.unloadModel;
    QWEN3_4B_INST_Q4_K_M = sdk.QWEN3_4B_INST_Q4_K_M;
    console.log("[QVAC] SDK loaded. Model:", QWEN3_4B_INST_Q4_K_M?.name);
  } catch (e) {
    sdkLoadError = e.message;
    console.error("[QVAC] Failed to import @qvac/sdk:", e.message);
  }
}

let modelId = null;
let modelStatus = { state: "loading", progress: 0, label: "Initialising…" };
let mainWin = null;

async function initModel() {
  if (!loadModel || !QWEN3_4B_INST_Q4_K_M) {
    const label = sdkLoadError
      ? `SDK error: ${sdkLoadError}`
      : "@qvac/sdk not installed. Run npm install";
    modelStatus = { state: "error", progress: 0, label };
    mainWin?.webContents.send("model-progress", modelStatus);
    return;
  }
  try {
    modelStatus = { state: "loading", progress: 0, label: "Starting local model…" };
    mainWin?.webContents.send("model-progress", modelStatus);

    modelId = await loadModel({
      modelSrc: QWEN3_4B_INST_Q4_K_M,
      modelType: "llamacpp-completion",
      modelConfig: { ctx_size: 16384 },
      onProgress: (p) => {
        const pct = Math.round(p.percentage || 0);
        const isDownloading = pct < 100 && pct > 0;
        modelStatus = {
          state: "loading",
          progress: pct,
          label: isDownloading
            ? `Downloading Qwen3 4B model… ${pct}%`
            : pct === 0
            ? "Preparing model…"
            : "Loading model into memory…",
        };
        mainWin?.webContents.send("model-progress", modelStatus);
      },
    });

    modelStatus = { state: "ready", progress: 100, label: "Qwen3 4B · ready" };
    mainWin?.webContents.send("model-progress", modelStatus);
  } catch (e) {
    console.error("[QVAC] Model load error:", e);
    modelStatus = { state: "error", progress: 0, label: e.message };
    mainWin?.webContents.send("model-progress", modelStatus);
  }
}

// IPC: renderer asks for a SQL generation
ipcMain.handle("generate-sql", async (_event, prompt) => {
  if (!modelId) {
    throw new Error(
      modelStatus.state === "error"
        ? `Model failed to load: ${modelStatus.label}`
        : "Local model is still loading. Please wait a moment."
    );
  }
  const result = completion({
    modelId,
    history: [{ role: "user", content: prompt }],
    stream: false,
  });
  return await result.text;
});

ipcMain.handle("get-model-status", () => modelStatus);

// ---- Static server --------------------------------------------------
function startLocalServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let rel = decodeURIComponent((req.url || "/").split("?")[0]);
      if (rel === "/" || rel === "") rel = "/index.html";
      const filePath = path.normalize(path.join(RENDERER_DIR, rel));
      if (!filePath.startsWith(RENDERER_DIR)) {
        res.writeHead(403).end("Forbidden");
        return;
      }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404).end("Not found"); return; }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

// ---- Window ---------------------------------------------------------
async function createWindow(baseUrl) {
  mainWin = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: "#171817",
    title: "QVAC Natural Language to SQL",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWin.loadURL(`${baseUrl}/index.html`);

  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Start loading the model immediately, runs in parallel with renderer init.
  initModel();
}

app.whenReady().then(async () => {
  // Load SDK before opening window (fast, just an import, no download yet).
  await loadSDK();

  const baseUrl = await startLocalServer();
  createWindow(baseUrl);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(baseUrl);
  });
});

app.on("window-all-closed", () => {
  if (modelId && unloadModel) {
    unloadModel({ modelId }).catch(() => {});
  }
  if (process.platform !== "darwin") app.quit();
});
