// Patch the @qvac/sdk TTS language schema to unlock all 18 languages the TTS package
// actually supports. The SDK 0.12.x ships a zod enum capped at en/es/de/it
// (dist/schemas/text-to-speech.js), which the QVAC SDK team confirmed is a schema-validation
// bug, not a model limit: "We currently support 18 languages at TTS package level but the
// SDK has an issue in the schema validation that only allows those 4. We will fix it in the
// SDK. Meanwhile, patch locally to bypass it." This script does exactly that, idempotently.
//
// The validation runs in the SDK worker process too, which re-imports the SDK from disk, so
// the patch must live on disk (an in-memory monkey-patch would not reach the worker). Re-run
// after any `npm install`, which restores the original file. server.js runs it automatically.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// The 18 languages the TTS package supports (per the QVAC SDK team).
const LANGS = [
  ["en", "English"], ["es", "Spanish"], ["fr", "French"], ["de", "German"], ["it", "Italian"],
  ["pt", "Portuguese"], ["nl", "Dutch"], ["pl", "Polish"], ["tr", "Turkish"], ["sv", "Swedish"],
  ["da", "Danish"], ["fi", "Finnish"], ["no", "Norwegian"], ["el", "Greek"], ["ms", "Malay"],
  ["sw", "Swahili"], ["ar", "Arabic"], ["ko", "Korean"],
];

function resolveSchemaFile() {
  const require = createRequire(import.meta.url);
  const main = require.resolve("@qvac/sdk");                 // .../@qvac/sdk/dist/index.js
  const root = main.slice(0, main.indexOf("@qvac/sdk") + "@qvac/sdk".length);
  return path.join(root, "dist", "schemas", "text-to-speech.js");
}

export function patchSdkTtsLanguages() {
  let file;
  try { file = resolveSchemaFile(); } catch { console.error("[patch-sdk] could not resolve @qvac/sdk"); return false; }
  if (!existsSync(file)) { console.error("[patch-sdk] schema file not found:", file); return false; }
  const src = readFileSync(file, "utf8");

  const arrayLiteral = "export const TTS_LANGUAGES = [\n" +
    LANGS.map(([code, name]) => `    "${code}", // ${name}`).join("\n") + "\n];";

  // Already patched? (more than the original 4 codes present)
  const current = (src.match(/export const TTS_LANGUAGES = \[([\s\S]*?)\];/) || [])[1] || "";
  const codeCount = (current.match(/"[a-z]{2}"/g) || []).length;
  if (codeCount >= LANGS.length) { console.log(`[patch-sdk] already patched (${codeCount} languages).`); return true; }

  if (!/export const TTS_LANGUAGES = \[[\s\S]*?\];/.test(src)) { console.error("[patch-sdk] TTS_LANGUAGES block not found; SDK layout changed."); return false; }
  const patched = src.replace(/export const TTS_LANGUAGES = \[[\s\S]*?\];/, arrayLiteral);
  writeFileSync(file, patched);
  console.log(`[patch-sdk] patched ${file} -> ${LANGS.length} languages.`);
  return true;
}

// Run directly: `node patch-sdk.mjs`
if (import.meta.url === `file://${process.argv[1]}`) patchSdkTtsLanguages();
