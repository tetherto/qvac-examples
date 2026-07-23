// QVAC SMART CAMERA - on-device security-camera server
// ---------------------------------------------------------------------------
// A fixed camera (a video file or a webcam pointed at a scene) is watched entirely
// on-device. Two QVAC models cooperate:
//   1. YOLOv10 (COCO) on @qvac/onnx  -> fast object boxes (people, vehicles, animals, bags)
//   2. Qwen3-VL 2B on @qvac/sdk       -> a one-sentence RISK VERDICT for a person event
//                                         (NORMAL vs ALERT) plus a plain scene description
// No cloud, no API keys: every frame is analysed on the machine. The browser captures the
// frame, sends it here, and receives boxes + a verdict. Fast boxes come from the ONNX
// detector (detector/detector.mjs); the risk reasoning comes from the VLM.
// ---------------------------------------------------------------------------

import express from "express";
import multer from "multer";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execSync } from "node:child_process";

// The QVAC runtime launches its worker with spawn("bare", ...): the `bare` executable lives
// in node_modules/.bin. `npm start` puts it on PATH, but launching `node server.js` directly
// does not, so we add it to PATH ourselves so the server works however it is launched.
const __dir = path.dirname(fileURLToPath(import.meta.url));
const binDir = path.join(__dir, "node_modules", ".bin");
process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH || ""}`;
try { process.chdir(__dir); } catch {}

import {
  loadModel,
  unloadModel,
  completion,
  QWEN3VL_2B_MULTIMODAL_Q4_K,
  MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K,
} from "@qvac/sdk";

const PORT = process.env.PORT || 3080;   // UI + VLM
const DETECTOR_PORT = 3085;              // ONNX detector child service
const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }, // 12 MB per frame (plenty for a JPEG)
});

app.use(express.json({ limit: "12mb" }));
app.use(express.static(path.join(__dir, "public")));

// --- Multimodal model from the QVAC registry (downloaded on-device on first run) ---
const MODEL = {
  name: "Qwen3-VL 2B (QVAC)",
  src: QWEN3VL_2B_MULTIMODAL_Q4_K,
  mmproj: MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K,
};

let handle = null;    // loaded model handle (singleton cache)
let loading = null;   // in-flight load promise (avoid concurrent double-loads)
let busy = false;     // one completion at a time (single GPU)

async function getModel() {
  if (handle) return handle;
  if (loading) return loading;
  loading = loadModel({
    modelSrc: MODEL.src,
    modelType: "llamacpp-completion",
    modelConfig: { ctx_size: 8192, projectionModelSrc: MODEL.mmproj },
  }).then((h) => { handle = h; loading = null; return h; });
  return loading;
}

// task=alert: a plain one-sentence description of what is in the frame (used for
// non-person events like a vehicle appearing).
function buildAlertPrompt() {
  return [
    `You are a security camera assistant. In ONE short factual sentence, describe what is happening in this frame.`,
    `Focus on any people, vehicles, animals, or bags/packages: what they are and what they are doing or where they are.`,
    `No preamble, no lists, no markdown, no quotes. Do NOT mention the image, its resolution, or pixel size. Max ~20 words.`,
  ].join("\n");
}

// task=assess: the model JUDGES the risk of the scene (a person event). This is what makes the
// camera react differently to a resident coming home (NORMAL) vs a masked person prowling a car
// at night (ALERT). The client passes a computed day/night hint. Parsed by parseAssess().
function buildAssessPrompt(night) {
  return [
    `You are a home security camera analyst. It is currently ${night ? "night-time" : "daytime"}.`,
    `Judge the security risk shown in this frame.`,
    `Answer ALERT if the scene looks suspicious or threatening: a person hiding their face or wearing a mask or hood, lurking or prowling near a vehicle or door, pulling on a car door handle, forcing a door or window, or creeping around at night.`,
    `Answer NORMAL for ordinary activity: a resident walking to their own front door, unlocking it and going inside, carrying bags, or everyday daytime movement.`,
    `Reply in EXACTLY this format and nothing else:`,
    `RISK: NORMAL or ALERT`,
    `REASON: one short sentence`,
  ].join("\n");
}

// Parse the assess response into { risk: "normal"|"alert", reason }.
function parseAssess(raw) {
  let t = String(raw).replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```[a-z]*\n?/gi, "").trim();
  const riskM = t.match(/RISK\s*:?\s*(ALERT|SUSPICIOUS|THREAT|HIGH|NORMAL|SAFE|LOW)/i);
  const r = riskM ? riskM[1].toUpperCase() : "";
  const risk = (r === "ALERT" || r === "SUSPICIOUS" || r === "THREAT" || r === "HIGH") ? "alert" : "normal";
  let reason = "";
  const reasonM = t.match(/REASON\s*:?\s*([^\n]+)/i);
  if (reasonM) reason = reasonM[1];
  else reason = t.replace(/RISK\s*:?.*(\n|$)/i, "").trim();
  reason = reason.replace(/^[\s"'`*:.-]+|[\s"'`*]+$/g, "").slice(0, 200).trim();
  return { risk, reason };
}

// Plain description fallback: strip any think/JSON wrapping to a bare sentence.
function parseDescription(raw) {
  let t = String(raw).replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```[a-z]*\n?/gi, "").trim();
  const m = t.match(/"(?:narration|caption)"\s*:\s*"([^"]+)"/i);
  if (m) t = m[1];
  return t.replace(/^[\s"'`*]+|[\s"'`*]+$/g, "").slice(0, 200).trim();
}

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", model: MODEL.name, loaded: !!handle });
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
        task: "object detection: YOLOv10 (ONNX, COCO-80)",
        qvac_engine: "@qvac/onnx", version: onnx.version,
        execution_providers: detector?.providers || "(detector offline)",
      },
      risk_and_description: {
        task: "risk verdict + scene description: Qwen3-VL 2B (GGUF)",
        qvac_engine: "@qvac/sdk → llama.cpp (@qvac/embed-llamacpp)",
        sdk_version: sdk.version, llama_version: llama.version,
      },
    },
    non_qvac: [],
    note: "The browser does box smoothing and the day/night check locally; no model runs outside QVAC and the UI loads no external CDN.",
  });
});

// Main endpoint: receives a frame, returns a description or a risk verdict.
app.post("/api/look", upload.single("frame"), async (req, res) => {
  const startedAt = Date.now();
  let tmp = null;
  try {
    if (!req.file) return res.status(400).json({ error: "No frame received" });
    if (busy) return res.status(429).json({ error: "busy" });

    const w = parseInt(req.body.w, 10) || 0;
    const h = parseInt(req.body.h, 10) || 0;
    const task = req.body.task === "assess" ? "assess" : "alert";

    tmp = path.join(os.tmpdir(), `qvac-cam-${process.pid}-${startedAt}.jpg`);
    fs.writeFileSync(tmp, req.file.buffer);

    busy = true;
    const model = await getModel();

    const run = completion({
      modelId: model,
      history: [
        { role: "system", content: "You are a helpful assistant." },
        {
          role: "user",
          content: task === "assess" ? buildAssessPrompt(req.body.night === "1") : buildAlertPrompt(),
          attachments: [{ path: tmp }],
        },
      ],
      stream: true,
      generationParams: task === "assess"
        ? { predict: 80, temp: 0.15, top_p: 0.9, seed: 42 }
        : { predict: 96, temp: 0.4, top_p: 0.9, seed: 42 },
    });

    const final = await run.final;
    const out = (final.contentText || final.raw?.fullText || "").trim();
    const tps = final.stats?.tokensPerSecond || final.raw?.tokensPerSecond || null;

    if (task === "assess") {
      const a = parseAssess(out);
      return res.json({ ok: true, model: MODEL.name, w, h, risk: a.risk, narration: a.reason, tps, elapsed_ms: Date.now() - startedAt });
    }
    res.json({ ok: true, model: MODEL.name, w, h, narration: parseDescription(out), tps, elapsed_ms: Date.now() - startedAt });
  } catch (err) {
    const msg = err.message || String(err);
    if (/concurrency policy|already running/i.test(msg)) res.status(429).json({ error: "busy" });
    else { console.error("[qvac-cam] look failed:", err); res.status(500).json({ error: msg }); }
  } finally {
    busy = false;
    if (tmp) { try { fs.unlinkSync(tmp); } catch {} }
  }
});

// --- ONNX detector service (Bare + @qvac/onnx, GPU via CoreML/DirectML) on :3085 ---
let detectorProc = null;
function startDetector() {
  const bareJs = path.join(__dir, "node_modules", "bare-runtime", "bin", "bare");
  try {
    detectorProc = spawn(process.execPath, [bareJs, "detector/detector.mjs"], {
      cwd: __dir, stdio: "inherit", env: process.env,
    });
    detectorProc.on("exit", (code) => { console.log(`[qvac-cam] detector exited (code ${code})`); detectorProc = null; });
    console.log(`[qvac-cam] ONNX detector started (port ${DETECTOR_PORT})`);
  } catch (e) {
    console.error("[qvac-cam] failed to start detector:", e.message);
  }
}

async function shutdown() {
  try { if (detectorProc) detectorProc.kill(); } catch {}
  // The detector runs as `node bare detector.mjs` -> the real Bare process is a GRANDCHILD,
  // so it can orphan when a launcher kills our direct children. Kill whatever still holds the
  // detector port so a relaunch can rebind it.
  if (process.platform !== "win32") {
    try { execSync(`lsof -nP -iTCP:${DETECTOR_PORT} -sTCP:LISTEN -t | xargs kill -9`, { stdio: "ignore" }); } catch {}
  }
  try { if (handle) await unloadModel({ modelId: handle, clearStorage: false }); } catch {}
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[qvac-cam] http://localhost:${PORT}  (also reachable from a phone on the local network)`);
  startDetector();
});
