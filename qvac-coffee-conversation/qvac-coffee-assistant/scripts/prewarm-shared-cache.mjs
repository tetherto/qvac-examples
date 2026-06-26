// Prewarm the SHARED SDK model cache (~/.qvac/models) for the multilingual coffee demo,
// using SDK model CONSTANTS only. This is the anti-duplication guarantee: every recipe's SDK
// reads/writes the same ~/.qvac/models (content-hashed), so a model already pulled by the
// football predictor / voice-cloner is REUSED here, never re-downloaded. The old
// scripts/setup-models.ts (which fetched a 4.5GB GGUF into a LOCAL ./models dir) is bypassed.
//
// What it loads (load = download-if-missing into the shared cache, else instant mmap):
//   - Qwen3-4B (LLM)             : already cached by recipe 21
//   - Whisper FR + EN (STT)      : already cached by recipe 07
//   - Bergamot FR<->EN (NMT)     : small, may be missing -> downloaded to the shared cache
//   - Chatterbox t3+s3gen (TTS)  : already cached by recipe 07 (load skipped here: needs a ref clip)
// Each model is loaded then unloaded so peak RAM stays one-model-at-a-time.
import os from "node:os";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { patchSdkTtsLanguages } from "../patch-sdk.mjs";
patchSdkTtsLanguages();
const sdk = await import("@qvac/sdk");
const {
  loadModel, unloadModel,
  QWEN3_4B_INST_Q4_K_M, WHISPER_BASE_Q8_0, WHISPER_FRENCH_BASE_Q8_0,
  BERGAMOT_FR_EN, BERGAMOT_EN_FR,
  TTS_T3_MULTILINGUAL_CHATTERBOX_Q8_0, TTS_S3GEN_MULTILINGUAL_CHATTERBOX,
} = sdk;

const CACHE = path.join(os.homedir(), ".qvac", "models");
const cacheSize = () => {
  try { return readdirSync(CACHE).reduce((s, f) => { try { return s + statSync(path.join(CACHE, f)).size; } catch { return s; } }, 0); }
  catch { return 0; }
};
const gb = (b) => (b / 2 ** 30).toFixed(2) + " GB";

// hardware gate: Chatterbox GGML is multi-GB; never load blind (crashed an 8GB Mac)
const ramGB = os.totalmem() / 2 ** 30;
console.log(`hw: ${os.platform()}-${os.arch()}, ram ${ramGB.toFixed(0)} GB, shared cache before: ${gb(cacheSize())}`);
if (ramGB < 16) { console.error("ABORT: under 16 GB RAM."); process.exit(1); }

async function warm(label, modelSrc, modelType, modelConfig) {
  const before = cacheSize();
  const t = Date.now();
  process.stdout.write(`  ${label.padEnd(22)} ... `);
  try {
    const id = await loadModel({ modelSrc, modelType, modelConfig });
    const dl = cacheSize() - before;
    console.log(`ok in ${((Date.now() - t) / 1000).toFixed(1)}s  ${dl > 5e6 ? "(downloaded " + gb(dl) + ")" : "(cache hit, reused)"}`);
    await unloadModel({ modelId: id, clearStorage: false }).catch(() => {});
  } catch (e) { console.log(`FAILED: ${String(e?.message || e).slice(0, 120)}`); }
}

console.log("\nprewarming the FRENCH e2e path (LLM + STT + NMT), shared cache, one model at a time:");
await warm("Qwen3-4B (LLM)", QWEN3_4B_INST_Q4_K_M, "llamacpp-completion", { device: "gpu", ctx_size: 1024 });
await warm("Whisper EN (STT)", WHISPER_BASE_Q8_0, "whisper", { audio_format: "f32le", strategy: "greedy", n_threads: 4, language: "en", temperature: 0.0 });
await warm("Whisper FR (STT)", WHISPER_FRENCH_BASE_Q8_0, "whisper", { audio_format: "f32le", strategy: "greedy", n_threads: 4, language: "fr", temperature: 0.0 });
await warm("Bergamot FR->EN", BERGAMOT_FR_EN, "nmt", { engine: "Bergamot", from: "fr", to: "en" });
await warm("Bergamot EN->FR", BERGAMOT_EN_FR, "nmt", { engine: "Bergamot", from: "en", to: "fr" });

// Chatterbox t3+s3gen are already cached by recipe 07; confirm the blobs exist rather than
// loading (load needs a reference clip). Report presence.
const haveChatter = existsSync(CACHE) && readdirSync(CACHE).some((f) => /chatterbox-t3-mtl/.test(f)) && readdirSync(CACHE).some((f) => /chatterbox-s3gen/.test(f));
console.log(`  Chatterbox t3+s3gen    ... ${haveChatter ? "present in shared cache (reused, no download)" : "MISSING (will download on first TTS load)"}`);

console.log(`\nshared cache after: ${gb(cacheSize())}  (location: ${CACHE})`);
console.log("done. The coffee app uses SDK constants -> this same shared cache. No per-project duplication.");
process.exit(0);
