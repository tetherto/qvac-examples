// ============================================================
// QVAC Gym Training — Electron main process
// Opens a single desktop window. No browser, no menu clutter.
//
// The renderer is served from a tiny localhost static server (not
// file://) so the in-app pipeline behaves like a normal page. The
// server binds to 127.0.0.1 only — not reachable from the network.
//
// The local AI model (Qwen3.5-VL 4B, multimodal) runs here in the main
// process via @qvac/sdk. The renderer samples ~10 frames from the video
// on a <canvas> and hands the JPEG bytes to this process over IPC; the
// model reads them and returns the coaching notes. The video file itself
// never leaves the renderer, and nothing leaves the machine.
//
// @qvac/sdk is an ES module — it must be loaded with dynamic import(),
// not require(). We do this before the window opens.
// ============================================================
const { app, BrowserWindow, Menu, shell, ipcMain } = require("electron");
const path = require("path");
const http = require("http");
const fs = require("fs");
const os = require("os");

Menu.setApplicationMenu(null);

// The QVAC runtime launches its worker with spawn("bare", ...): the `bare`
// executable lives in node_modules/.bin. Add it to PATH so the worker starts
// no matter how the app was launched.
const binDir = path.join(__dirname, "node_modules", ".bin");
process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH || ""}`;

const RENDERER_DIR = path.join(__dirname, "renderer");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".json": "application/json",
};

// ---- QVAC SDK -------------------------------------------------------
// @qvac/sdk is an ES module: use dynamic import(), never require().
let loadModel, completion, unloadModel;
let QWEN3_5_4B_MULTIMODAL_Q4_K_M, MMPROJ_QWEN3_5_4B_MULTIMODAL_F16;
let sdkLoadError = null;

async function loadSDK() {
  try {
    const sdk = await import("@qvac/sdk");
    loadModel = sdk.loadModel;
    completion = sdk.completion;
    unloadModel = sdk.unloadModel;
    QWEN3_5_4B_MULTIMODAL_Q4_K_M = sdk.QWEN3_5_4B_MULTIMODAL_Q4_K_M;
    MMPROJ_QWEN3_5_4B_MULTIMODAL_F16 = sdk.MMPROJ_QWEN3_5_4B_MULTIMODAL_F16;
    console.log("[qvac-gym] SDK loaded.");
  } catch (e) {
    sdkLoadError = e.message;
    console.error("[qvac-gym] Failed to import @qvac/sdk:", e.message);
  }
}

let modelId = null;
let modelStatus = { state: "loading", progress: 0, label: "Initialising…" };
let busy = false; // one completion at a time (single GPU)
let mainWin = null;

function pushStatus(status) {
  modelStatus = status;
  mainWin?.webContents.send("model-progress", modelStatus);
}

async function initModel() {
  if (!loadModel || !QWEN3_5_4B_MULTIMODAL_Q4_K_M) {
    pushStatus({
      state: "error",
      progress: 0,
      label: sdkLoadError ? `SDK error: ${sdkLoadError}` : "@qvac/sdk not installed — run npm install",
    });
    return;
  }
  try {
    pushStatus({ state: "loading", progress: 0, label: "Preparing the on-device model…" });
    modelId = await loadModel({
      modelSrc: QWEN3_5_4B_MULTIMODAL_Q4_K_M,
      modelType: "llamacpp-completion",
      // Ten small frames plus the reply fit comfortably in a wide context window.
      modelConfig: { ctx_size: 16384, projectionModelSrc: MMPROJ_QWEN3_5_4B_MULTIMODAL_F16 },
      onProgress: (p) => {
        const pct = Math.round(p?.percentage || 0);
        const downloading = pct > 0 && pct < 100;
        if (pct % 10 === 0) console.log(`[qvac-gym] model ${downloading ? "downloading" : "loading"}… ${pct}%`);
        pushStatus({
          state: "loading",
          progress: pct,
          label: downloading
            ? `Downloading the model… ${pct}%`
            : pct >= 100
            ? "Loading the model into memory…"
            : "Preparing the on-device model…",
        });
      },
    });
    pushStatus({ state: "ready", progress: 100, label: "Model · ready" });
    console.log("[qvac-gym] Model ready.");
  } catch (e) {
    console.error("[qvac-gym] Model load error:", e);
    pushStatus({ state: "error", progress: 0, label: e.message });
  }
}

// ---- Prompt + strict-JSON reply -------------------------------------
const SYSTEM_PROMPT =
  "You are an expert strength and conditioning coach. You are shown a set of " +
  "still frames sampled in order from a single video of one lifter performing " +
  "one set of a strength exercise, usually filmed from the side. The first " +
  "frame is the start of the set and the last frame is the end. Read the frames " +
  "as one continuous movement.";

// A grammar-constrained shape for the reply. Passing this as responseFormat
// forces the model to emit schema-valid JSON from the first token, so a
// reasoning model can't wander off into a <think> block and never answer.
const REPLY_SCHEMA = {
  type: "object",
  properties: {
    exercise: { type: "string" },
    strengths: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 },
    improvements: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 },
  },
  required: ["exercise", "strengths", "improvements"],
  additionalProperties: false,
};

function buildPrompt(frameCount) {
  return [
    `Here are ${frameCount} frames, in order, from one set.`,
    "Name the exercise, then judge the form across the whole set.",
    "Check: bar or movement path, joint stacking, range of motion, tempo and control, bracing and base.",
    "",
    "Reply with STRICT JSON only:",
    "{",
    '  "exercise": "<name, or \\"unclear\\">",',
    '  "strengths": ["<short cue>", ...],',
    '  "improvements": ["<short cue>", ...]',
    "}",
    "",
    "Rules for every item:",
    '- Talk straight to the lifter as "you".',
    "- One short line, about 6 to 12 words. No filler.",
    "- Plain words, active voice. Skip jargon.",
    "- For each fix, say what to change and how, in a few words.",
    "- 3 to 4 items per list. If the frames are unclear, use fewer items and say so.",
  ].join("\n");
}

// The grammar guarantees a schema-valid JSON object, but the chat template can
// wrap it in <think>…</think> tags — so we drop the *tags* (keeping the JSON
// between them) rather than the whole block, then slice out the object.
function parseResult(raw) {
  let t = String(raw)
    .replace(/<\/?think>/gi, " ")
    .replace(/```[a-z]*\n?/gi, "")
    .trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) t = t.slice(start, end + 1);

  let obj;
  try {
    obj = JSON.parse(t);
  } catch {
    return null;
  }
  const clean = (arr) =>
    (Array.isArray(arr) ? arr : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 4);
  return {
    exercise: obj.exercise ? String(obj.exercise).trim() : "unclear",
    strengths: clean(obj.strengths),
    improvements: clean(obj.improvements),
  };
}

// ---- IPC: analyse the sampled frames --------------------------------
// `frames` is an array of ArrayBuffers (JPEG bytes) sent from the renderer.
ipcMain.handle("analyze-frames", async (_event, frames) => {
  if (!modelId) {
    throw new Error(
      modelStatus.state === "error"
        ? `Model failed to load: ${modelStatus.label}`
        : "The on-device model is still loading — please wait a moment."
    );
  }
  if (!Array.isArray(frames) || !frames.length) throw new Error("No frames received.");
  if (busy) throw new Error("busy");

  const tmp = [];
  try {
    frames.forEach((ab, i) => {
      const p = path.join(os.tmpdir(), `qvac-gym-${process.pid}-${Date.now()}-${i}.jpg`);
      fs.writeFileSync(p, Buffer.from(ab));
      tmp.push(p);
    });

    busy = true;
    const run = completion({
      modelId,
      history: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildPrompt(tmp.length), attachments: tmp.map((p) => ({ path: p })) },
      ],
      stream: true,
      responseFormat: { type: "json_schema", json_schema: { name: "form_feedback", schema: REPLY_SCHEMA } },
      generationParams: { predict: 1024, temp: 0.3, top_p: 0.9, seed: 42 },
    });

    const final = await run.final;
    const out = (final.contentText || final.raw?.fullText || "").trim();
    const parsed = parseResult(out);

    if (!parsed || (!parsed.strengths.length && !parsed.improvements.length)) {
      throw new Error("The model could not read the lift from those frames. Try a clearer, side-on clip.");
    }
    return { ok: true, frames: tmp.length, ...parsed };
  } finally {
    busy = false;
    for (const p of tmp) { try { fs.unlinkSync(p); } catch {} }
  }
});

ipcMain.handle("get-model-status", () => modelStatus);

// ---- Static server (127.0.0.1 only) ---------------------------------
function startLocalServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let rel = decodeURIComponent((req.url || "/").split("?")[0]);
      if (rel === "/" || rel === "") rel = "/index.html";
      const filePath = path.normalize(path.join(RENDERER_DIR, rel));
      if (!filePath.startsWith(RENDERER_DIR)) { res.writeHead(403).end("Forbidden"); return; }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404).end("Not found"); return; }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

// ---- Window ---------------------------------------------------------
function createWindow(baseUrl) {
  mainWin = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 980,
    minHeight: 660,
    backgroundColor: "#171817",
    title: "QVAC Gym Training",
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

  // Start loading the model immediately — runs in parallel with renderer init.
  initModel();
}

app.whenReady().then(async () => {
  await loadSDK();
  const baseUrl = await startLocalServer();
  createWindow(baseUrl);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(baseUrl);
  });
});

app.on("window-all-closed", () => {
  if (modelId && unloadModel) unloadModel({ modelId }).catch(() => {});
  if (process.platform !== "darwin") app.quit();
});
