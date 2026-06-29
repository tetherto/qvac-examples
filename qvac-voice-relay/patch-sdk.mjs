// On-disk patches to the installed @qvac/sdk, applied before the SDK is
// imported. The SDK worker re-imports the SDK from disk, so these MUST be
// on-disk edits (an in-memory monkey-patch would not reach the worker). All
// patches are idempotent and re-apply cleanly after an `npm install` (which
// restores the original files). server.js calls patchSdk() automatically before
// importing the SDK (required: on Mac, kvCacheType must be forwarded or the Metal
// backend crashes on the q8_0 default). You can also run it manually: node patch-sdk.mjs
//
// What is patched — Chatterbox knobs the SDK's chatterbox plugin does NOT forward:
// it only passes `language` + `useGPU` to the @qvac/tts-ggml engine, and its load
// schema is `.strict()` (rejects unknown keys). The engine itself accepts extra
// knobs (streaming/perf, plus `speed` and `kvCacheType` on tts-ggml 0.3.x). We
// (a) allow these keys in the schema and (b) forward them in createChatterboxModel.
// NOTE: `kvCacheType` is a STRING ('f16'|'f32'|'q8_0'); on tts-ggml 0.3.x the q8_0
// default crashes the Metal path ("unsupported op 'CONT'"), so f16 is the fix there.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// Number-valued chatterbox modelConfig knobs to allow + forward.
const NUM_KNOBS = ["streamChunkTokens", "streamFirstChunkTokens", "cfmSteps", "threads", "nGpuLayers", "seed", "speed", "nCtx"];
// String-valued knobs (separate so the schema uses z.string()).
const STR_KNOBS = ["kvCacheType"];
const ALL_KNOBS = [...NUM_KNOBS, ...STR_KNOBS];

// Robustly locate the installed SDK's dist/ dir. (The previous implementation
// used main.indexOf("@qvac/sdk"), which fails on Windows because require.resolve
// returns backslash paths -> "@qvac\\sdk" never matches "@qvac/sdk".)
function distDir() {
  const require = createRequire(import.meta.url);
  const main = require.resolve("@qvac/sdk"); // .../@qvac/sdk/dist/index.js
  return path.dirname(main);
}

// Allow the extra knob keys in the chatterbox runtime config so the `.strict()`
// load schema does not reject them. Regex-based so it tolerates the language
// schema name differing across SDK versions (ttsLanguageSchema in 0.12.x,
// ttsChatterboxLanguageSchema in 0.13.x).
function patchTtsSchemaKnobs(dist) {
  const file = path.join(dist, "schemas", "text-to-speech.js");
  if (!existsSync(file)) { console.error("[patch-sdk] schema file not found:", file); return false; }
  const src = readFileSync(file, "utf8");
  if (src.includes("streamChunkTokens:")) { console.log("[patch-sdk] schema knobs already patched."); return true; }

  // Match the chatterbox runtime config object and capture up to its closing `});`.
  const re = /(export const ttsChatterboxRuntimeConfigSchema = z\.object\(\{[\s\S]*?useGPU: z\.boolean\(\)\.optional\(\),\n)(\}\);)/;
  if (!re.test(src)) { console.error("[patch-sdk] ttsChatterboxRuntimeConfigSchema block not found; SDK layout changed."); return false; }

  const knobLines = [
    ...NUM_KNOBS.map((k) => `    ${k}: z.number().optional(),`),
    ...STR_KNOBS.map((k) => `    ${k}: z.string().optional(),`),
  ].join("\n") + "\n";
  writeFileSync(file, src.replace(re, `$1${knobLines}$2`));
  console.log(`[patch-sdk] patched schema to allow ${ALL_KNOBS.length} chatterbox knobs.`);
  return true;
}

// Forward the knobs to the @qvac/tts-ggml constructor (top-level options).
function patchChatterboxPlugin(dist) {
  const file = path.join(dist, "server", "bare", "plugins", "tts-ggml", "plugin.js");
  if (!existsSync(file)) { console.error("[patch-sdk] tts-ggml plugin not found:", file); return false; }
  const src = readFileSync(file, "utf8");
  if (src.includes("streamChunkTokens:")) { console.log("[patch-sdk] plugin knobs already patched."); return true; }

  const anchor = `        files: { t3Model, s3genModel },\n`;
  if (!src.includes(anchor)) { console.error("[patch-sdk] createChatterboxModel anchor not found; SDK layout changed."); return false; }

  const forward = ALL_KNOBS.map(
    (k) => `        ...(config.${k} !== undefined ? { ${k}: config.${k} } : {}),\n`
  ).join("");
  writeFileSync(file, src.replace(anchor, anchor + forward));
  console.log(`[patch-sdk] patched plugin to forward ${ALL_KNOBS.length} chatterbox knobs.`);
  return true;
}

export function patchSdk() {
  let dist;
  try { dist = distDir(); } catch { console.error("[patch-sdk] could not resolve @qvac/sdk"); return false; }
  const a = patchTtsSchemaKnobs(dist);
  const b = patchChatterboxPlugin(dist);
  return a && b;
}

// Run directly: `node patch-sdk.mjs`
if (import.meta.url === `file://${process.argv[1]}`) patchSdk();
