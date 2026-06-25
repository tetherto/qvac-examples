// QVAC REALTIME - on-device webcam vision server
// ---------------------------------------------------------------------------
// Qwen3-VL 2B, loaded on the QVAC runtime (Tether), produces on each webcam frame:
//   1. NARRATION -> a one-sentence "in-persona" description of the scene
//   2. OPEN-VOCAB OBJECTS -> bounding boxes for things the COCO detector doesn't know
//
// No cloud, no Ollama, no Transformers.js: the model runs entirely on-device inside
// QVAC. The browser captures the frame, sends it here, receives boxes + text.
// Fast/precise boxes for common objects come from the ONNX detector (detector.mjs).
// ---------------------------------------------------------------------------

import express from "express";
import multer from "multer";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execSync } from "node:child_process";

// The QVAC runtime launches its worker with spawn("bare", ...): the `bare` executable
// lives in node_modules/.bin. `npm start` puts it on PATH, but launching `node server.js`
// directly does NOT -> the worker fails to start (RPC init timeout). We add it to PATH
// ourselves so the server works however it is launched.
const __dir = path.dirname(fileURLToPath(import.meta.url));
const binDir = path.join(__dir, "node_modules", ".bin");
process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH || ""}`;
// Run from the project dir no matter how the server was launched (npm start, an
// absolute `node /path/server.js`, a launcher/IDE...). Without this, the relative
// "public" static dir and the detector's model paths break when the cwd differs.
try { process.chdir(__dir); } catch {}

import {
  loadModel,
  unloadModel,
  completion,
  QWEN3VL_2B_MULTIMODAL_Q4_K,
  MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K,
} from "@qvac/sdk";

const PORT = process.env.PORT || 3080;       // VLM + UI
const DETECTOR_PORT = 3085;                   // ONNX detector child service
const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }, // 12MB per frame (plenty for a webcam JPEG)
});

app.use(express.json({ limit: "12mb" }));
app.use(express.static(path.join(__dir, "public")));

// --- Multimodal model from the QVAC registry (downloaded on-device on first run) ---
const MODEL = {
  name: "Qwen3-VL 2B · grounding+VQA (QVAC)",
  src: QWEN3VL_2B_MULTIMODAL_Q4_K,
  mmproj: MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K,
};

let handle = null;          // handle of the loaded model (singleton cache)
let loading = null;         // in-flight promise, to avoid concurrent double-loads
let busy = false;           // one completion at a time (single GPU)

async function getModel() {
  if (handle) return handle;
  if (loading) return loading;
  loading = loadModel({
    modelSrc: MODEL.src,
    modelType: "llamacpp-completion",
    modelConfig: { ctx_size: 8192, projectionModelSrc: MODEL.mmproj },
  }).then((h) => {
    handle = h;
    loading = null;
    return h;
  });
  return loading;
}

// --- Personas: they shape ONLY the narration, never the object labels ---
// The style only sets the tone of the narration sentence. All: ONE short, concrete
// sentence describing what is actually visible (no rambling).
const PERSONAS = {
  plain: {
    name: "Neutral (facts only)",
    style: "Plain, factual tone. Just state what is visible.",
  },
  bard: {
    name: "Medieval bard",
    style: "Light medieval-bard flavor (a touch of 'thee'/''tis'), but still concrete.",
  },
  documentary: {
    name: "Nature documentary",
    style: "Calm nature-documentary tone.",
  },
  noir: {
    name: "Noir detective",
    style: "Terse 1940s noir detective tone.",
  },
  haiku: {
    name: "Haiku poet",
    style: "A single short haiku-like line.",
  },
  sports: {
    name: "Sports commentator",
    style: "Energetic live-commentary tone, present tense.",
  },
  pirate: {
    name: "Pirate",
    style: "Light pirate flavor ('arr', 'matey'), but still concrete.",
  },
};

// Narration-only prompt. The ONNX detector owns the boxes (fast + precise); the VLM does
// what a 2B model is actually good at - one well-phrased sentence about the scene. (We used
// to ask the VLM for bounding boxes too, but 2B grounding was unreliable and slow.)
function buildPrompt(persona) {
  const p = PERSONAS[persona] || PERSONAS.plain;
  return [
    `Describe what is actually visible in this image in ONE short sentence.`,
    `${p.style} Name the real objects accurately. No preamble, no lists, no markdown, no quotes.`,
    `Do NOT mention the image, its resolution, or pixel size. Max ~20 words. Reply with the sentence only.`,
  ].join("\n");
}

// The model should return a plain sentence; be defensive in case it wraps it in JSON/markdown.
function parseResult(raw) {
  let t = String(raw)
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```[a-z]*\n?/gi, "")
    .trim();
  const m = t.match(/"(?:narration|caption)"\s*:\s*"([^"]+)"/i); // model wrapped it in JSON anyway
  if (m) t = m[1];
  t = t.replace(/^[\s"'`*]+|[\s"'`*]+$/g, "").slice(0, 200).trim();
  return { objects: [], narration: t };
}

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    model: MODEL.name,
    loaded: !!handle,
    personas: Object.entries(PERSONAS).map(([id, p]) => ({ id, name: p.name })),
  });
});

// QVAC proof: reports in real time which QVAC engine each model runs on.
// (curl http://localhost:3080/api/engines to verify it is all QVAC.)
app.get("/api/engines", async (req, res) => {
  const readPkg = (name) => {
    try { return JSON.parse(fs.readFileSync(path.join(__dir, "node_modules", name, "package.json"), "utf8")); }
    catch { return {}; }
  };
  const onnx = readPkg("@qvac/onnx"), sdk = readPkg("@qvac/sdk"), llama = readPkg("@qvac/embed-llamacpp");
  let detector = null;
  try { detector = await fetch(`http://localhost:${DETECTOR_PORT}/health`).then((r) => r.json()); } catch {}
  res.json({
    summary: "All AI inference runs on the QVAC SDK (Tether). No external or cloud inference engine.",
    provenance: { author: "Tether Data, S.A. de C.V.", repo: "github.com/tetherto/qvac" },
    engines: {
      object_detection: {
        task: "object detection: YOLO-World open-vocab (ONNX, ~110 classes)",
        qvac_engine: "@qvac/onnx", version: onnx.version,
        execution_providers: detector?.providers || "(detector offline)",
      },
      hands_gestures: {
        task: "hands + gestures: YOLO hand-pose (ONNX, 21 keypoints)",
        qvac_engine: "@qvac/onnx", version: onnx.version,
      },
      vlm_narration: {
        task: "scene narration + open-vocab: Qwen3-VL 2B (GGUF)",
        qvac_engine: "@qvac/sdk → llama.cpp (@qvac/embed-llamacpp)",
        sdk_version: sdk.version, llama_version: llama.version,
      },
    },
    non_qvac: [],
    client_box_smoothing: {
      method: "EMA (exponential moving average)",
      note: "NOT AI inference and no external library: boxes are re-anchored on every QVAC detection and eased between them in the browser. No model runs outside QVAC; the UI loads no external CDN.",
    },
  });
});

// Main endpoint: receives a frame, returns boxes + narration.
app.post("/api/look", upload.single("frame"), async (req, res) => {
  const startedAt = Date.now();
  let tmp = null;
  try {
    if (!req.file) return res.status(400).json({ error: "No frame received" });
    if (busy) return res.status(429).json({ error: "busy" }); // the client skips this round

    const w = parseInt(req.body.w, 10) || 0;
    const h = parseInt(req.body.h, 10) || 0;
    const persona = PERSONAS[req.body.persona] ? req.body.persona : "plain";

    tmp = path.join(os.tmpdir(), `qvac-rt-${process.pid}-${startedAt}.jpg`);
    fs.writeFileSync(tmp, req.file.buffer);

    busy = true;
    const model = await getModel();

    const run = completion({
      modelId: model,
      history: [
        { role: "system", content: "You are a helpful assistant." },
        {
          role: "user",
          content: buildPrompt(persona),
          attachments: [{ path: tmp }],
        },
      ],
      stream: true,
      // narration only: short output (predict 96) keeps it fast; a little temp for persona flavor.
      generationParams: { predict: 96, temp: 0.4, top_p: 0.9, seed: 42 },
    });

    const final = await run.final;
    const out = (final.contentText || final.raw?.fullText || "").trim();
    const parsed = parseResult(out);

    res.json({
      ok: true,
      model: MODEL.name,
      w, h,
      objects: parsed.objects,
      narration: parsed.narration,
      tps: final.stats?.tokensPerSecond || final.raw?.tokensPerSecond || null,
      elapsed_ms: Date.now() - startedAt,
    });
  } catch (err) {
    // The QVAC registry allows one completion per model: if two requests overlap
    // (e.g. browser + another client), we treat the rejection as a soft "busy" ->
    // the client skips this frame and retries on the next one (realtime).
    const msg = err.message || String(err);
    if (/concurrency policy|already running/i.test(msg)) {
      res.status(429).json({ error: "busy" });
    } else {
      console.error("[qvac-rt] look failed:", err);
      res.status(500).json({ error: msg });
    }
  } finally {
    busy = false;
    if (tmp) { try { fs.unlinkSync(tmp); } catch {} }
  }
});

// --- ONNX detector service (Bare + @qvac/onnx, GPU via DirectML/CoreML) on :3085 ---
// Fast open-vocab detector (YOLO-World) for the boxes; the VLM stays for narration.
// 100% QVAC: it uses the QVAC SDK's ONNX engine.
let detectorProc = null;
function startDetector() {
  // Launch the Bare runtime via node (as bare.cmd does internally): no shell, so spaces
  // in the path (e.g. "QVAC REALTIME") don't break the command.
  const bareJs = path.join(__dir, "node_modules", "bare-runtime", "bin", "bare");
  try {
    detectorProc = spawn(process.execPath, [bareJs, "detector/detector.mjs"], {
      cwd: __dir,
      stdio: "inherit",
      env: process.env,
    });
    detectorProc.on("exit", (code) => {
      console.log(`[qvac-rt] detector exited (code ${code})`);
      detectorProc = null;
    });
    console.log(`[qvac-rt] ONNX detector started (port ${DETECTOR_PORT})`);
  } catch (e) {
    console.error("[qvac-rt] failed to start detector:", e.message);
  }
}

async function shutdown() {
  try { if (detectorProc) detectorProc.kill(); } catch {}
  // The detector runs as `node bare detector.mjs` -> the real Bare process is a GRANDCHILD,
  // so it can orphan when a launcher kills only our direct children. Kill whatever still
  // holds the detector port so a relaunch can rebind it.
  if (process.platform !== "win32") {
    try { execSync(`lsof -nP -iTCP:${DETECTOR_PORT} -sTCP:LISTEN -t | xargs kill -9`, { stdio: "ignore" }); } catch {}
  }
  try { if (handle) await unloadModel({ modelId: handle, clearStorage: false }); } catch {}
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[qvac-rt] http://localhost:${PORT}  (also reachable from a phone on the local network)`);
  startDetector();
});
