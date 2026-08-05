// The models the user may choose between, and how to tell which are already on disk.
//
// Two separate lists on purpose, because the app runs two different jobs:
//   TEXT   reads the text layer of a PDF. Any instruct LLM can do it.
//   VISION looks at a scan or a photo. Needs a multimodal model AND its projector, which is a
//          second file: the pair has to be downloaded and loaded together.
//
// Every entry names SDK constants rather than URLs, so the registry stays the source of truth for
// sizes and checksums. `note` is what the settings pane shows, and it should say something true and
// useful rather than marketing: where a number appears, it came from bench-models.cjs.
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CACHE_DIR = path.join(os.homedir(), ".qvac", "models");

// The scores below are not opinions. `bench-models.cjs text` and `bench-vision.cjs` run every
// candidate against the demo set's ground-truth.json and count correct cells, so these numbers are
// reproducible on any machine. Re-run them after an SDK bump rather than trusting this comment.
//
//   TEXT   10 text PDFs x 9 fields = 90 cells
//   VISION  8 image documents x 9 fields = 72 cells
const TEXT_MODELS = [
  { key: "qwen3-1.7b", label: "Qwen3 1.7B", constName: "QWEN3_1_7B_INST_Q4",
    score: "70/90", speed: "0.9s",
    note: "Fastest and smallest, but it mangles continental decimals: 471,16 comes back as 47116. Only pick it if disk or RAM is the constraint." },
  { key: "qwen3-4b", label: "Qwen3 4B", constName: "QWEN3_4B_INST_Q4_K_M",
    score: "90/90", speed: "1.9s",
    note: "The default, and the only one that scored perfectly. Best accuracy per gigabyte on this job." },
  { key: "qwen3-8b", label: "Qwen3 8B", constName: "QWEN3_8B_INST_Q4_K_M",
    score: "86/90", speed: "3.1s",
    note: "Twice the size, 1.6x slower, and slightly WORSE here: it copies the label into the invoice number (\"Invoice numberNOR-2026-1000\"). Bigger is not better on this task." },
];

const VISION_MODELS = [
  { key: "lighton-ocr-1b", label: "LightOnOCR 1B", constName: "OCR_0_6B_MULTIMODAL_Q4_K_M",
    projName: "MMPROJ_OCR_0_6B_MULTIMODAL_F16",
    score: "43/72", speed: "3.0s",
    note: "A dedicated OCR model, and the weakest option here. It transcribes rather than follows instructions: it echoed the column's own description back as the supplier name, and truncated 355,34 to 355. Not recommended." },
  { key: "qwen3vl-2b", label: "Qwen3-VL 2B", constName: "QWEN3VL_2B_MULTIMODAL_Q4_K",
    projName: "MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K",
    score: "72/72", speed: "2.9s",
    note: "The default. Perfect score and the fastest of the three. A general vision model, so it also copes with unusual layouts." },
  { key: "qwen3.5-4b", label: "Qwen3.5-VL 4B", constName: "QWEN3_5_4B_MULTIMODAL_Q4_K_M",
    projName: "MMPROJ_QWEN3_5_4B_MULTIMODAL_F16",
    score: "68/72", speed: "5.1s",
    note: "Newer and larger, 1.7x slower, and it left a few dates blank. Worth a try on genuinely poor scans, where extra capacity may pay off." },
];

const DEFAULT_TEXT = "qwen3-4b";
const DEFAULT_VISION = "qwen3vl-2b";

function textModel(key) {
  return TEXT_MODELS.find((m) => m.key === key) || TEXT_MODELS.find((m) => m.key === DEFAULT_TEXT);
}
function visionModel(key) {
  return VISION_MODELS.find((m) => m.key === key) || VISION_MODELS.find((m) => m.key === DEFAULT_VISION);
}

// The registry stores each blob as "<16 hex>_<modelId>", so a model is present when some file in the
// cache ends with its modelId. Cheaper and more honest than asking the SDK to verify a checksum,
// which would read gigabytes just to paint a dropdown.
function cachedIds() {
  try {
    return new Set(fs.readdirSync(CACHE_DIR).map((f) => f.replace(/^[0-9a-f]{16}_/, "")));
  } catch {
    return new Set();   // no cache dir yet: nothing is downloaded, which is the correct answer
  }
}

// Enrich the two lists with size and download state. Async because only the SDK knows the sizes.
async function catalogue(sdk) {
  const S = await sdk();
  const present = cachedIds();
  const one = (m) => {
    const c = S[m.constName];
    const p = m.projName ? S[m.projName] : null;
    if (!c || (m.projName && !p)) {
      // A constant that this SDK version does not have. Report it instead of crashing the pane, so
      // an SDK bump that renames something degrades to "unavailable" rather than a blank window.
      return { ...m, available: false, cached: false, bytes: 0,
               why: `not in @qvac/sdk ${S.version || ""}`.trim() };
    }
    const bytes = (c.expectedSize || 0) + (p ? p.expectedSize || 0 : 0);
    const cached = present.has(c.modelId) && (!p || present.has(p.modelId));
    return { ...m, available: true, cached, bytes, params: c.params || null };
  };
  return {
    text: TEXT_MODELS.map(one),
    vision: VISION_MODELS.map(one),
    defaults: { text: DEFAULT_TEXT, vision: DEFAULT_VISION },
  };
}

// Resolve one entry to the arguments loadModel wants. Vision models need the projector passed
// through modelConfig, which is the part that is easy to get wrong.
async function loadArgs(sdk, entry, { ctxSize = 8192 } = {}) {
  const S = await sdk();
  const c = S[entry.constName];
  if (!c) throw new Error(`${entry.label} is not available in this SDK version`);
  // reasoning_budget is a LOAD-time parameter. Without it the Qwen3.5 family emits a <think> block
  // before the JSON, which is not what a grammar-constrained caller wants. Harmless on models that
  // do not reason.
  const cfg = { reasoning_budget: 0 };
  if (!entry.projName) {
    return { modelSrc: c.src || c, modelType: c.engine, modelConfig: cfg };
  }
  const p = S[entry.projName];
  if (!p) throw new Error(`${entry.label} is missing its projector in this SDK version`);
  return {
    modelSrc: c.src,
    modelType: c.engine,
    modelConfig: { ...cfg, device: "gpu", projectionModelSrc: p.src, ctx_size: ctxSize },
  };
}

// Every file a model needs, for downloading it up front.
async function assets(sdk, entry) {
  const S = await sdk();
  return [entry.constName, entry.projName].filter(Boolean).map((n) => S[n]).filter(Boolean);
}

// Fetch a model into the cache without loading it, so the settings pane can prepare a model the
// user has not selected yet. A vision model is two files and both must arrive, so progress is
// reported across the pair rather than per file: two bars that each reach 100% look like a bug.
async function download(sdk, entry, onProgress) {
  const S = await sdk();
  const list = await assets(sdk, entry);
  if (!list.length) throw new Error(`${entry.label} is not available in this SDK version`);
  const totals = list.map((a) => a.expectedSize || 0);
  const grand = totals.reduce((x, y) => x + y, 0);
  const done = list.map(() => 0);

  for (let i = 0; i < list.length; i++) {
    // The SDK calls this `assetSrc`, not `modelSrc`. Passing the wrong key fails validation with
    // "Invalid input at assetSrc", which is easy to mistake for a bad URL.
    await S.downloadAsset({
      assetSrc: list[i].src,
      onProgress: (p) => {
        if (!p || typeof p.percentage !== "number") return;
        done[i] = (totals[i] * p.percentage) / 100;
        const sum = done.reduce((x, y) => x + y, 0);
        if (onProgress) {
          onProgress({
            model: entry.label,
            percentage: grand ? Math.min(100, (sum / grand) * 100) : p.percentage,
            downloaded: sum, total: grand,
            file: i + 1, files: list.length,
          });
        }
      },
    });
    done[i] = totals[i];
  }
  return { bytes: grand, files: list.length };
}

module.exports = {
  TEXT_MODELS, VISION_MODELS, DEFAULT_TEXT, DEFAULT_VISION,
  textModel, visionModel, catalogue, loadArgs, assets, download, cachedIds, CACHE_DIR,
};
