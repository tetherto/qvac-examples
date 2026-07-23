// Pre-downloads and loads the Qwen3.5-VL 4B model from the QVAC registry, so the
// first real analysis is instant. Run once: `node scripts/warmup.mjs`.
// Everything here is on-device; the only network use is the one-time model fetch.

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const binDir = path.join(__dir, "..", "node_modules", ".bin");
process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH || ""}`;

const {
  loadModel,
  unloadModel,
  QWEN3_5_4B_MULTIMODAL_Q4_K_M,
  MMPROJ_QWEN3_5_4B_MULTIMODAL_F16,
} = await import("@qvac/sdk");

let last = -1;
console.log("[warmup] downloading + loading Qwen3.5-VL 4B (Q4_K_M) …");

const t0 = Date.now();
const id = await loadModel({
  modelSrc: QWEN3_5_4B_MULTIMODAL_Q4_K_M,
  modelType: "llamacpp-completion",
  modelConfig: { ctx_size: 16384, projectionModelSrc: MMPROJ_QWEN3_5_4B_MULTIMODAL_F16 },
  onProgress: (p) => {
    const pct = Math.floor(p?.percentage ?? 0);
    if (pct !== last) { last = pct; process.stdout.write(`\r[warmup] ${pct}%   `); }
  },
});

console.log(`\n[warmup] model ready in ${((Date.now() - t0) / 1000).toFixed(1)}s (id: ${id})`);
try { await unloadModel({ modelId: id }); } catch {}
console.log("[warmup] done — cached on-device. You can now `npm start`.");
process.exit(0);
