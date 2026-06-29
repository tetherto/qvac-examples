// QVAC Voice Relay - enroll your voice, say/type something, hear yourself in another language.
// 100% on-device: Node built-in http + @qvac/sdk (Parakeet STT + Bergamot translate + Chatterbox reference-matched TTS) + ffmpeg.
//
// Wording note (per spec, until QVAC docs support stronger terms): we say "enrolled voice" /
// "voice signature" / "reference-matched voice", not "clone". The engine is QVAC TTS voice
// conditioning via a recorded reference sample configured at model load time.
//
// Pipeline:
//   1) /api/enroll          : record a ~15s reference -> saved as a named, persisted voice (16k mono wav)
//   2) /api/voices/select   : choose the active voice
//   3) DELETE /api/voices/:id : erase a voice (file + entry); clears the active TTS if it was active
//   4) /api/transcribe      : (mic input) audio -> Parakeet STT -> text
//   5) /api/translate       : { text, from, to } -> Bergamot translate
//   6) /api/speak           : { text, to } -> Chatterbox TTS in the active voice -> wav
//
// Voices persist under ~/.qvac-voice-relay/ (outside the app folder, so this stays packageable to a .app/.dmg).
//
// SDK reality:
//   - Chatterbox GGML reference-matched TTS: loadModel({ modelSrc: TTS_T3_MULTILINGUAL_CHATTERBOX_Q8_0.src, modelType:"tts-ggml",
//       modelConfig:{ ttsEngine:"chatterbox", language, s3genModelSrc: TTS_S3GEN_MULTILINGUAL_CHATTERBOX.src, referenceAudioSrc, useGPU:true } })
//     referenceAudioSrc AND language are set at LOAD time -> changing voice OR target language requires a reload.
//   - Parakeet: one shared GGUF transcription model; the selected source language drives translation.
//   - Translate (Bergamot): modelSrc = BERGAMOT_<FROM>_<TO> (required); non-EN<->non-EN uses modelConfig.pivotModel (pivots via English).
//   - textToSpeech returns audio samples (Int16-ish), NOT a ready WAV -> wrap with a 24k mono WAV header.
//
// HARDWARE: GGML chatterbox is multi-GB on Metal unified memory. Built for 16/32 GB. Crashed an 8 GB Mac.

import http from "http";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, statSync } from "fs";
import { spawn } from "child_process";
import { createHash, randomUUID } from "crypto";
import os from "os";
import path from "path";
const qvac = await import("@qvac/sdk");
const {
  loadModel, unloadModel, transcribe, translate, textToSpeech,
  TTS_T3_MULTILINGUAL_CHATTERBOX_Q8_0, TTS_S3GEN_MULTILINGUAL_CHATTERBOX,
} = qvac;
const { getModelByPath } = await import("@qvac/sdk/models");

const PORT = process.env.PORT || 3071;
const DIR = import.meta.dirname;
const TMP = path.join(os.tmpdir(), "qvac-voice-relay");
mkdirSync(TMP, { recursive: true });

// Voices persist here (user-writable, outside the app bundle -> packaging-safe).
const STORE_DIR = path.join(os.homedir(), ".qvac-voice-relay");
const VOICES_DIR = path.join(STORE_DIR, "voices");
const VOICES_JSON = path.join(STORE_DIR, "voices.json");
const EMAILS_JSON = path.join(STORE_DIR, "emails.json");   // captured "Receive Prototype Link" emails
const SDK_HOME_DIR = process.env.QVAC_WORKBENCH_SDK_HOME_PATH || os.homedir();
const MODEL_CACHE_DIR = path.join(SDK_HOME_DIR, ".qvac", "models");
mkdirSync(VOICES_DIR, { recursive: true });

// Output (spoken) languages. The Chatterbox TTS model supports 18 languages (all shipped in
// SDK 0.13.x). We expose every language that has BOTH a TTS voice AND a Bergamot translation
// path (all 18 except Swahili, which has no EN->SW translation model).
const TTS_LANGS = {
  en: "English", es: "Espanol", fr: "Francais", de: "Deutsch", it: "Italiano",
  pt: "Portugues", nl: "Nederlands", pl: "Polski", tr: "Turkce", sv: "Svenska",
  da: "Dansk", fi: "Suomi", no: "Norsk", el: "Ellinika", ms: "Bahasa Melayu",
  ar: "Arabic", ko: "Korean",
};
const LANG_LABELS = {
  en: "English", ar: "Arabic", az: "Azerbaijani", be: "Belarusian", bg: "Bulgarian",
  bn: "Bengali", bs: "Bosnian", ca: "Catalan", cs: "Czech", da: "Danish",
  de: "German", el: "Greek", es: "Spanish", et: "Estonian", fa: "Persian",
  fi: "Finnish", fr: "French", gu: "Gujarati", he: "Hebrew", hi: "Hindi",
  hr: "Croatian", hu: "Hungarian", id: "Indonesian", is: "Icelandic", it: "Italian",
  ja: "Japanese", kn: "Kannada", ko: "Korean", lt: "Lithuanian", lv: "Latvian",
  ml: "Malayalam", ms: "Malay", mt: "Maltese", nb: "Norwegian Bokmal",
  nl: "Dutch", nn: "Norwegian Nynorsk", no: "Norwegian", pl: "Polish",
  pt: "Portuguese", ro: "Romanian", ru: "Russian", sk: "Slovak",
  sl: "Slovenian", sq: "Albanian", sr: "Serbian", sv: "Swedish",
  ta: "Tamil", te: "Telugu", th: "Thai", tr: "Turkish", uk: "Ukrainian",
  vi: "Vietnamese", zh: "Chinese",
};
function labelForLang(code) {
  return LANG_LABELS[code] || code.toUpperCase();
}
// Bergamot pairs are discovered from the SDK registry constants. This keeps source
// language support aligned with the installed SDK instead of freezing it to a demo subset.
const BERGAMOT = {};
for (const [name, desc] of Object.entries(qvac)) {
  const m = /^BERGAMOT_([A-Z]{2,3})_([A-Z]{2,3})$/.exec(name);
  if (m && desc?.src) BERGAMOT[`${m[1].toLowerCase()}|${m[2].toLowerCase()}`] = desc;
}
const PARAKEET_STT = qvac.PARAKEET_TDT_0_6B_V3_Q8_0 || qvac.PARAKEET_CTC_0_6B_Q8_0;
const STT_CACHE_KEY = "parakeet";
const SOURCE_LANG_CODES = Array.from(new Set(["en", ...Object.keys(BERGAMOT).map((k) => k.split("|")[0]).filter((from) => from !== "en" && BERGAMOT[`${from}|en`])]))
  .filter(() => PARAKEET_STT)
  .sort((a, b) => labelForLang(a).localeCompare(labelForLang(b)));
const STT_LANGS = Object.fromEntries(SOURCE_LANG_CODES.map((code) => [code, labelForLang(code)]));
const STT_PARAKEET = Object.fromEntries(SOURCE_LANG_CODES.map((code) => [code, { modelSrc: PARAKEET_STT }]));

function shortHash(s) {
  return createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex").slice(0, 16);
}
function singleCachePath(registryPath) {
  return path.join(MODEL_CACHE_DIR, `${shortHash(registryPath)}_${path.basename(registryPath)}`);
}
function cacheFile(pathname, expectedSize = 0) {
  try {
    const st = statSync(pathname);
    const cached = st.isFile() && (!expectedSize || st.size === expectedSize);
    return { path: pathname, expectedSize, actualSize: st.size, cached };
  } catch {
    return { path: pathname, expectedSize, cached: false };
  }
}
function aggregateFiles(files) {
  const seen = new Set();
  const unique = [];
  for (const f of files) {
    if (!f || seen.has(f.path)) continue;
    seen.add(f.path);
    unique.push(f);
  }
  const missing = unique.filter((f) => !f.cached);
  return {
    cached: missing.length === 0,
    missingCount: missing.length,
    missingBytes: missing.reduce((sum, f) => sum + (f.expectedSize || 0), 0),
    totalBytes: unique.reduce((sum, f) => sum + (f.expectedSize || 0), 0),
    files: unique,
  };
}
function modelCacheStatus(desc) {
  const entry = getModelByPath(desc.registryPath) || desc;
  if (entry.companionSet) {
    const { setKey, files } = entry.companionSet;
    const canonical = aggregateFiles(files.map((f) => cacheFile(path.join(MODEL_CACHE_DIR, "sets", setKey, f.targetName), f.expectedSize)));
    if (canonical.cached) return { name: entry.name, ...canonical };
    if (entry.addon === "nmt") {
      const flat = aggregateFiles(files.map((f) => cacheFile(singleCachePath(f.registryPath), f.expectedSize)));
      if (flat.cached) return { name: entry.name, ...flat };
    }
    return { name: entry.name, ...canonical };
  }
  return { name: entry.name, ...aggregateFiles([cacheFile(singleCachePath(entry.registryPath), entry.expectedSize)]) };
}
function nmtModelsFor(from, to) {
  if (from === to) return [];
  const key = `${from}|${to}`;
  if (BERGAMOT[key]) return [BERGAMOT[key]];
  if (from !== "en" && to !== "en" && BERGAMOT[`${from}|en`] && BERGAMOT[`en|${to}`]) {
    return [BERGAMOT[`${from}|en`], BERGAMOT[`en|${to}`]];
  }
  throw new Error(`No Bergamot translation path for ${from} -> ${to}`);
}
function requiredModelsFor(from, to) {
  const models = [];
  if (STT_PARAKEET[from]) models.push({ role: "speech", desc: STT_PARAKEET[from].modelSrc });
  for (const desc of nmtModelsFor(from, to)) models.push({ role: "translation", desc });
  if (activeRefPath()) {
    models.push({ role: "voice", desc: TTS_T3_MULTILINGUAL_CHATTERBOX_Q8_0 });
    models.push({ role: "voice", desc: TTS_S3GEN_MULTILINGUAL_CHATTERBOX });
  }
  return models;
}

const CHATTERBOX_SR = 24000;
// Worker threads used by Parakeet and Bergamot setup.
const THREADS = Math.min(os.cpus().length, 8);
const TTS_HTTP_CHUNK_SAMPLES = 2048;
const TTS_STREAM_LEAD_PAD_SAMPLES = Math.floor(CHATTERBOX_SR * 0.12);
const TTS_STREAM_TAIL_PAD_SAMPLES = Math.floor(CHATTERBOX_SR * 0.30);
const TTS_STREAM_RMS_FLOOR = 0.012;
// Optional demo-mode warm set. Warming every language hides later language switches, but it
// also queues many multi-second TTS loads behind the single serialized worker. Keep it opt-in
// so a normal first speak only pays for the selected target language.
const TTS_WARM_LANGS = (process.env.TTS_WARM_LANGS || "en,es,fr,it,de").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const TTS_PREWARM_DEMO_SET = /^(1|true|yes)$/i.test(process.env.TTS_PREWARM_DEMO_SET || "");
// LRU must hold the whole warm set (+1 spare) or warming the last would evict the first.
const TTS_LRU_MAX = Math.max(2, TTS_WARM_LANGS.length + 1);

// Native Chatterbox pace (WSOLA, pitch-preserving, load-time). Default 1.0 = raw model
// speed. Env TTS_SPEED or POST /api/speed lowers it live during a demo if the voice rushes;
// changing it drops the resident TTS so the next synth reloads at the new pace.
const TTS_SPEED_DEFAULT = 1.0;
const TTS_SPEED_OVERRIDE = process.env.TTS_SPEED ? Number(process.env.TTS_SPEED) : null;
let runtimeSpeed = TTS_SPEED_OVERRIDE != null ? TTS_SPEED_OVERRIDE : TTS_SPEED_DEFAULT;
const clampSpeed = (v) => Math.max(0.5, Math.min(1.2, Number(v) || TTS_SPEED_DEFAULT));
const speedFor = () => runtimeSpeed;
const log = (m) => console.log(m);

// ---------- voice store (persistent, multi-voice) ----------
function loadStore() {
  try {
    const s = JSON.parse(readFileSync(VOICES_JSON, "utf8"));
    if (!Array.isArray(s.voices)) s.voices = [];
    // prune entries whose audio file disappeared
    s.voices = s.voices.filter((v) => v && v.file && existsSync(path.join(VOICES_DIR, v.file)));
    if (!s.voices.find((v) => v.id === s.activeId)) s.activeId = s.voices[0] ? s.voices[0].id : null;
    return { voices: s.voices, activeId: s.activeId || null };
  } catch {
    return { voices: [], activeId: null };
  }
}
function saveStore() { writeFileSync(VOICES_JSON, JSON.stringify(store, null, 2)); }
function publicVoice(v) { return { id: v.id, name: v.name, lang: v.lang || "en", createdAt: v.createdAt, active: v.id === store.activeId }; }
function activeRefPath() {
  const v = store.voices.find((x) => x.id === store.activeId);
  return v ? path.join(VOICES_DIR, v.file) : null;
}
let store = loadStore();

// ---------- worker serialization ----------
// tts-ggml 0.3.x GPU/Metal SIGSEGVs if two worker operations (loadModel / synth /
// transcribe / translate) overlap on the single Bare worker (0.2.x tolerated it). We
// serialize every worker-touching unit (background warm, /api/speak, /api/transcribe)
// through one promise chain so they can never race. Each call site is a non-nested leaf,
// so there is no re-entrancy / deadlock. The lock releases on both success and error.
let workerChain = Promise.resolve();
function serializeWorker(fn) {
  const run = workerChain.then(fn, fn);
  workerChain = run.then(() => {}, () => {});
  return run;
}

// ---------- model caches ----------
const sttCache = new Map();       // engine key -> modelId
const nmtCache = new Map();       // `${from}|${to}` -> modelId
// TTS: small LRU keyed by `${ref}|${lang}`. Both are load-time params, so each
// (voice, target-language) pair is its own resident model; LRU(2) lets the user
// flip between two target languages without paying a multi-GB reload each time.
const ttsCache = new Map();       // key -> modelId  (insertion order = LRU order)
const ttsLoading = new Map();     // key -> Promise<modelId>  (dedupe concurrent loads)
const ttsWarmed = new Set();      // modelIds already primed with a throwaway synth
const ttsWarmQueued = new Set();  // `${ref}|${lang}` warm jobs already queued
const nmtWarmQueued = new Set();  // `${from}|${to}` warm jobs already queued
const sttWarmQueued = new Set();  // transcription warm jobs already queued
let setupEpoch = 0;                // incremented on reset so queued setup can self-cancel

// ---------- download-progress broadcast (SSE) ----------
// The SDK downloads model weights on first use (into ~/.qvac). We surface that
// to the UI so the user sees a "first-run setup" overlay instead of a silent hang.
const progressClients = new Set();
function emitProgress(obj) {
  const line = `data: ${JSON.stringify(obj)}\n\n`;
  for (const res of progressClients) { try { res.write(line); } catch {} }
}
// Wrap a model load: show the first-run overlay ONLY during a REAL download.
// Cached loads return instantly and emit no progress (or a lone 100%), so we
// lazily emit "start" on the first genuine in-progress event (<100%) and skip the
// overlay entirely otherwise. Without this the overlay flashed on EVERY cached
// loadModel (app open, mic capture, and before each synthesis).
async function withProgress(phase, run) {
  let started = false;
  try {
    return await run((p) => {
      if (!p || p.percentage == null || p.percentage >= 100) return;
      if (!started) { started = true; emitProgress({ phase, status: "start" }); }
      emitProgress({ phase, percentage: p.percentage });
    });
  } finally {
    if (started) emitProgress({ phase, status: "done" });
  }
}

function isMissingModelError(e) {
  return /model with id ".+" not found/i.test(String(e?.message || e));
}
function invalidateSetupQueues() {
  setupEpoch++;
  sttWarmQueued.clear();
  nmtWarmQueued.clear();
  ttsWarmQueued.clear();
}
function evictStt() {
  sttCache.delete(STT_CACHE_KEY);
  sttWarmQueued.delete(STT_CACHE_KEY);
}
function evictNmt(key) {
  nmtCache.delete(key);
  nmtWarmQueued.delete(key);
}
function evictTtsKey(key) {
  const id = ttsCache.get(key);
  if (id) ttsWarmed.delete(id);
  ttsCache.delete(key);
  ttsWarmQueued.delete(key);
}

// Drop ALL resident TTS models. Called when the active voice changes (enroll /
// select / delete) so stale (old-reference) models do not linger in RAM.
async function dropTts() {
  for (const id of ttsCache.values()) {
    try { await unloadModel({ modelId: id, clearStorage: false }); } catch (e) {}
    ttsWarmed.delete(id);
  }
  ttsCache.clear();
  ttsWarmQueued.clear();
}
async function dropAllResidentModels() {
  await dropTts();
  for (const id of sttCache.values()) {
    try { await unloadModel({ modelId: id, clearStorage: false }); } catch (e) {}
  }
  for (const id of nmtCache.values()) {
    try { await unloadModel({ modelId: id, clearStorage: false }); } catch (e) {}
  }
  sttCache.clear();
  nmtCache.clear();
  sttWarmQueued.clear();
  nmtWarmQueued.clear();
  ttsWarmQueued.clear();
}
async function clearVoices() {
  for (const v of store.voices) {
    try { const fp = path.join(VOICES_DIR, v.file); if (existsSync(fp)) unlinkSync(fp); } catch {}
  }
  const had = store.voices.length;
  store.voices = [];
  store.activeId = null;
  saveStore();
  return had;
}

async function ensureTranscription(lang) {
  const spec = STT_PARAKEET[lang];
  if (!spec) throw new Error(`No Parakeet transcription model for source language "${lang}"`);
  if (sttCache.has(STT_CACHE_KEY)) return sttCache.get(STT_CACHE_KEY);
  log("Loading Parakeet transcription...");
  const id = await withProgress("speech recognition", (onProgress) => loadModel({
    modelSrc: spec.modelSrc,
    modelType: "parakeet-transcription",
    modelConfig: { maxThreads: THREADS, useGPU: true, sampleRate: 16000, channels: 1 },
    onProgress,
  }));
  sttCache.set(STT_CACHE_KEY, id);
  return id;
}

async function ensureNmt(from, to) {
  const key = `${from}|${to}`;
  if (nmtCache.has(key)) return nmtCache.get(key);
  let modelSrc, modelConfig;
  if (BERGAMOT[key]) {
    modelSrc = BERGAMOT[key];
    modelConfig = { engine: "Bergamot", from, to };
  } else if (from !== "en" && to !== "en" && BERGAMOT[`${from}|en`] && BERGAMOT[`en|${to}`]) {
    modelSrc = BERGAMOT[`${from}|en`];
    modelConfig = { engine: "Bergamot", from, to, pivotModel: { modelSrc: BERGAMOT[`en|${to}`] } };
  } else {
    throw new Error(`No Bergamot translation path for ${from} -> ${to}`);
  }
  log(`Loading Bergamot NMT (${from} -> ${to})${modelConfig.pivotModel ? " via en pivot" : ""}...`);
  const id = await withProgress("translation", (onProgress) => loadModel({ modelSrc, modelType: "nmt", modelConfig, onProgress }));
  nmtCache.set(key, id);
  return id;
}

// Reference-matched TTS keyed by (active reference, targetLang). Both are
// load-time, so each pair is its own model. Served from an LRU(TTS_LRU_MAX);
// concurrent loads of the same key are deduped so a background pre-warm and a
// real request never double-load.
async function ensureTts(lang) {
  const ref = activeRefPath();
  if (!ref || !existsSync(ref)) throw new Error("No voice enrolled. Enroll a voice first.");
  if (!TTS_LANGS[lang]) throw new Error(`Output voice does not support language "${lang}"`);
  const key = `${ref}|${lang}`;
  if (ttsCache.has(key)) {
    const id = ttsCache.get(key);
    ttsCache.delete(key); ttsCache.set(key, id);   // bump to most-recently-used
    return id;
  }
  if (ttsLoading.has(key)) return ttsLoading.get(key);

  const loadPromise = (async () => {
    log(`Loading reference-matched TTS (target=${lang})... first load for this voice+language is the slow step.`);
    const id = await withProgress("voice", (onProgress) => loadModel({
      modelSrc: TTS_T3_MULTILINGUAL_CHATTERBOX_Q8_0.src,
      modelType: "tts-ggml",
      modelConfig: {
        ttsEngine: "chatterbox",
        language: lang,
        s3genModelSrc: TTS_S3GEN_MULTILINGUAL_CHATTERBOX.src,
        referenceAudioSrc: ref,
        useGPU: true,
        // tts-ggml 0.3.x defaults the KV cache to q8_0, which crashes the Metal/GPU
        // backend on Mac (SIGABRT, "unsupported op CONT"). f16 is the supported type.
        // Forwarded to the engine by patch-sdk.mjs (the SDK plugin does not pass it natively).
        kvCacheType: "f16",
        speed: speedFor(lang),   // native pitch-preserving pace (load-time)
      },
      onProgress: (p) => { if (p && p.percentage != null) { log(`  chatterbox: ${p.percentage.toFixed(0)}%`); onProgress(p); } },
    }));
    ttsCache.set(key, id);
    // Evict least-recently-used beyond the cap.
    while (ttsCache.size > TTS_LRU_MAX) {
      const oldKey = ttsCache.keys().next().value;
      const oldId = ttsCache.get(oldKey);
      ttsCache.delete(oldKey);
      ttsWarmed.delete(oldId);
      ttsWarmQueued.delete(oldKey);
      try { await unloadModel({ modelId: oldId, clearStorage: false }); } catch (e) {}
      log(`Evicted TTS model (LRU): ${oldKey}`);
    }
    return id;
  })();
  ttsLoading.set(key, loadPromise);
  try { return await loadPromise; }
  finally { ttsLoading.delete(key); }
}

async function transcribeWithRetry(lang, wavPath) {
  let modelId = await ensureTranscription(lang);
  try {
    return await transcribe({ modelId, audioChunk: wavPath });
  } catch (e) {
    if (!isMissingModelError(e)) throw e;
    log("Parakeet model ID was stale; reloading transcription model.");
    evictStt();
    modelId = await ensureTranscription(lang);
    return await transcribe({ modelId, audioChunk: wavPath });
  }
}

async function translateWithRetry(from, to, text) {
  const key = `${from}|${to}`;
  const runTranslate = async (modelId) => {
    const tr = translate({ modelId, text, modelType: "nmt", stream: false });
    return String(await tr.text);
  };
  let modelId = await ensureNmt(from, to);
  try {
    return await runTranslate(modelId);
  } catch (e) {
    if (!isMissingModelError(e)) throw e;
    log(`Bergamot model ID was stale; reloading translation model (${from} -> ${to}).`);
    evictNmt(key);
    modelId = await ensureNmt(from, to);
    return await runTranslate(modelId);
  }
}

function stripLeadingListMarker(text) {
  return String(text || "").trim().replace(/^(?:[-\u2010-\u2015\u2212\u2022\u00b7]\s+)+(?=\S)/u, "").trim();
}

function cleanTranslatedText(text) {
  return stripLeadingListMarker(String(text || "").trim().replace(/^\s*>>[a-z]{2,3}<<\s*/i, ""));
}

function makeStreamingTtsGate(onChunk) {
  const frameSize = Math.max(1, Math.floor(CHATTERBOX_SR * 0.02));
  let pending = [];
  let frame = [];
  let pendingStart = 0;
  let generated = 0;
  let lastAudibleEnd = -1;
  let written = 0;

  const writeChunk = (nums) => {
    if (!nums.length) return;
    written += nums.length;
    onChunk(Int16Array.from(nums));
  };
  const trimBefore = (absIndex) => {
    const drop = Math.max(0, Math.min(pending.length, absIndex - pendingStart));
    if (drop > 0) {
      pending = pending.slice(drop);
      pendingStart += drop;
    }
  };
  const markFrame = (samples, frameEndAbs) => {
    let sum = 0;
    for (const sample of samples) {
      const v = sample / 32768;
      sum += v * v;
    }
    if (Math.sqrt(sum / samples.length) < TTS_STREAM_RMS_FLOOR) return;
    const frameStartAbs = frameEndAbs - samples.length;
    if (lastAudibleEnd < 0) trimBefore(Math.max(0, frameStartAbs - TTS_STREAM_LEAD_PAD_SAMPLES));
    lastAudibleEnd = frameEndAbs;
  };
  const flushAvailable = (force = false) => {
    if (lastAudibleEnd < 0) return;
    const flushLimit = Math.min(generated, lastAudibleEnd + TTS_STREAM_TAIL_PAD_SAMPLES);
    let available = Math.max(0, Math.min(pending.length, flushLimit - pendingStart));
    while (available >= TTS_HTTP_CHUNK_SAMPLES || (force && available > 0)) {
      const n = force ? Math.min(available, TTS_HTTP_CHUNK_SAMPLES) : TTS_HTTP_CHUNK_SAMPLES;
      writeChunk(pending.slice(0, n));
      pending = pending.slice(n);
      pendingStart += n;
      available -= n;
    }
  };

  return {
    push(sample) {
      const s = Math.max(-32768, Math.min(32767, Math.round(Number(sample) || 0)));
      pending.push(s);
      frame.push(s);
      generated++;
      if (frame.length === frameSize) {
        markFrame(frame, generated);
        frame = [];
        flushAvailable(false);
      }
    },
    finish() {
      if (frame.length) {
        markFrame(frame, generated);
        frame = [];
      }
      if (lastAudibleEnd < 0) {
        const fallback = trimSpeech(Int16Array.from(pending), CHATTERBOX_SR);
        writeChunk(fallback);
        pending = [];
        return { samples: written };
      }
      const keepUntil = Math.min(generated, lastAudibleEnd + TTS_STREAM_TAIL_PAD_SAMPLES);
      const keep = Math.max(0, Math.min(pending.length, keepUntil - pendingStart));
      if (keep > 0) {
        const tail = trimTrailing(Int16Array.from(pending.slice(0, keep)), CHATTERBOX_SR);
        if (tail.length) writeChunk(tail);
      }
      pending = [];
      return { samples: written };
    },
  };
}

async function streamTtsModel(modelId, text, onChunk) {
  const out = textToSpeech({ modelId, text, inputType: "text", stream: true });
  const gate = makeStreamingTtsGate(onChunk);
  for await (const sample of out.bufferStream) gate.push(sample);
  const stats = gate.finish();
  await out.done;
  return stats;
}

async function streamSynthesizeWithRetry(lang, text, onChunk) {
  const ref = activeRefPath();
  const key = `${ref}|${lang}`;
  let modelId = await ensureTts(lang);
  let wrote = false;
  const tappedChunk = (samples) => {
    if (samples.length) wrote = true;
    onChunk(samples);
  };
  try {
    return await streamTtsModel(modelId, text, tappedChunk);
  } catch (e) {
    if (!isMissingModelError(e) || wrote) throw e;
    log(`Chatterbox model ID was stale; reloading voice model (${lang}).`);
    evictTtsKey(key);
    modelId = await ensureTts(lang);
    return await streamTtsModel(modelId, text, onChunk);
  }
}

// Prime a freshly-loaded model with a tiny throwaway synthesis so the first
// real request runs on warm GPU kernels (cold first-call is ~2x slower).
async function prewarmTts(key, id) {
  if (!id || ttsWarmed.has(id)) return;
  ttsWarmed.add(id);
  try {
    const out = textToSpeech({
      modelId: id, text: "ok", inputType: "text",
      stream: false,
    });
    await out.buffer;
  } catch (e) {
    ttsWarmed.delete(id);
    if (isMissingModelError(e)) evictTtsKey(key);
    throw e;
  }
}

function defaultTargetFor(fromLang) {
  return Object.keys(TTS_LANGS).find((l) => l !== fromLang) || "en";
}
function warmTranscription(lang) {
  if (!STT_PARAKEET[lang] || sttCache.has(STT_CACHE_KEY) || sttWarmQueued.has(STT_CACHE_KEY)) return;
  const epoch = setupEpoch;
  sttWarmQueued.add(STT_CACHE_KEY);
  serializeWorker(async () => {
    try {
      if (epoch !== setupEpoch) return;
      await ensureTranscription(lang);
    } finally {
      sttWarmQueued.delete(STT_CACHE_KEY);
    }
  }).catch((e) => log(`warm parakeet skipped: ${e.message}`));
}
function warmNmtPair(from, to) {
  if (from === to) return;
  const nmtKey = `${from}|${to}`;
  if (nmtCache.has(nmtKey) || nmtWarmQueued.has(nmtKey)) return;
  const epoch = setupEpoch;
  nmtWarmQueued.add(nmtKey);
  serializeWorker(async () => {
    try {
      if (epoch !== setupEpoch) return;
      await ensureNmt(from, to);
    } finally {
      nmtWarmQueued.delete(nmtKey);
    }
  }).catch((e) => log(`warm nmt skipped: ${e.message}`));
}
function warmTtsLang(lang) {
  if (!lang || !TTS_LANGS[lang]) return;
  const ref = activeRefPath();
  if (ref && existsSync(ref)) {
    const ttsKey = `${ref}|${lang}`;
    const cachedTtsId = ttsCache.get(ttsKey);
    if (!(cachedTtsId && ttsWarmed.has(cachedTtsId)) && !ttsWarmQueued.has(ttsKey)) {
      const epoch = setupEpoch;
      ttsWarmQueued.add(ttsKey);
      serializeWorker(async () => {
        try {
          if (epoch !== setupEpoch) return;
          if (activeRefPath() !== ref) return; // active voice changed before this warm ran
          await prewarmTts(ttsKey, await ensureTts(lang));
        } finally {
          ttsWarmQueued.delete(ttsKey);
        }
      }).catch((e) => log(`warm tts skipped: ${e.message}`));
    }
  }
}
// Prepare every model the selected source -> target pair needs: source STT,
// translation, and the target-language voice model for the active reference.
function preparePair(from, to) {
  if (!STT_PARAKEET[from] || !TTS_LANGS[to]) return;
  warmTranscription(from);
  warmNmtPair(from, to);
  warmTtsLang(to);
}
// Pre-warm the whole demo language set (background) so switching between them is instant.
// `priority` (the client's currently-selected target) is warmed FIRST so the first speak is
// ready before the rest of the set loads. Skips the voice's own clone language (not a target).
function warmDemoSet(priority, from = "en") {
  const order = [priority, ...TTS_WARM_LANGS].filter((l, i, a) => l && TTS_LANGS[l] && l !== from && a.indexOf(l) === i);
  if (order.length) log(`Warming demo set: ${order.join(", ")}`);
  for (const lang of order) preparePair(from, lang);
}
function isPairPreparing(from, to) {
  const ref = activeRefPath();
  return sttWarmQueued.has(STT_CACHE_KEY) ||
    (from !== to && nmtWarmQueued.has(`${from}|${to}`)) ||
    (!!ref && (ttsWarmQueued.has(`${ref}|${to}`) || ttsLoading.has(`${ref}|${to}`)));
}
function isPairReady(from, to) {
  const ref = activeRefPath();
  const ttsId = ref ? ttsCache.get(`${ref}|${to}`) : null;
  return sttCache.has(STT_CACHE_KEY) &&
    (from === to || nmtCache.has(`${from}|${to}`)) &&
    (!ref || (ttsId && ttsWarmed.has(ttsId)));
}
function pairSetupStatus(from, to) {
  from = STT_PARAKEET[from] ? from : "en";
  to = TTS_LANGS[to] ? to : defaultTargetFor(from);
  try {
    const models = requiredModelsFor(from, to).map(({ role, desc }) => ({ role, ...modelCacheStatus(desc) }));
    const allFiles = models.flatMap((m) => m.files || []);
    const aggregate = aggregateFiles(allFiles);
    return {
      from, to,
      cached: aggregate.cached,
      ready: aggregate.cached && isPairReady(from, to),
      preparing: isPairPreparing(from, to),
      missingBytes: aggregate.missingBytes,
      totalBytes: aggregate.totalBytes,
      missingCount: aggregate.missingCount,
      models: models.map((m) => ({ role: m.role, name: m.name, cached: m.cached, missingBytes: m.missingBytes, totalBytes: m.totalBytes })),
    };
  } catch (e) {
    return { from, to, cached: false, ready: false, preparing: false, missingBytes: 0, totalBytes: 0, missingCount: 0, error: e.message, models: [] };
  }
}
function setupStatusGrid(from, to) {
  from = STT_PARAKEET[from] ? from : "en";
  to = TTS_LANGS[to] ? to : defaultTargetFor(from);
  const sources = {};
  const targets = {};
  for (const code of Object.keys(STT_PARAKEET)) sources[code] = pairSetupStatus(code, to);
  for (const code of Object.keys(TTS_LANGS)) targets[code] = pairSetupStatus(from, code);
  return { current: pairSetupStatus(from, to), sources, targets };
}

// ---------- audio helpers ----------
function toWav16k(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", ["-y", "-i", inputPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", outputPath]);
    let err = "";
    ff.stderr.on("data", (d) => (err += d.toString()));
    ff.on("close", (c) => (c === 0 && existsSync(outputPath)) ? resolve(outputPath) : reject(new Error("ffmpeg failed: " + err.slice(-300))));
    ff.on("error", (e) => reject(new Error("ffmpeg not found: " + e.message)));
  });
}
function pcmToWav(samples, sr) {
  const arr = (samples instanceof Int16Array) ? samples : Int16Array.from(samples);
  const pcm = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
// Chatterbox appends low-level trailing noise (10-15s) after the utterance. Remove ONLY the
// leading/trailing low-energy; never cut inside the speech. Threshold = 90th-percentile frame
// energy (robust to onset spikes); safety guard keeps the original if it would leave a tiny clip.
function trimSpeech(samples, sr) {
  const arr = (samples instanceof Int16Array) ? samples : Int16Array.from(samples);
  const win = Math.max(1, Math.floor(sr * 0.02));
  const frames = Math.floor(arr.length / win);
  if (frames < 10) return arr;
  const rms = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0; const base = f * win;
    for (let i = 0; i < win; i++) { const v = arr[base + i] / 32768; s += v * v; }
    rms[f] = Math.sqrt(s / win);
  }
  const sorted = Float32Array.from(rms).sort();
  const p90 = sorted[Math.floor(frames * 0.90)] || sorted[frames - 1];
  if (p90 <= 0) return arr;
  const thr = Math.max(0.012, p90 * 0.08);
  let first = 0; while (first < frames && rms[first] < thr) first++;
  let last = frames - 1; while (last > first && rms[last] < thr) last--;
  if (last <= first) return arr;
  const lead = Math.ceil(0.12 / 0.02);
  const tail = Math.ceil(0.30 / 0.02);
  const s0 = Math.max(0, first - lead) * win;
  const s1 = Math.min(frames, last + 1 + tail) * win;
  const out = arr.subarray(s0, s1);
  if (out.length < sr * 0.4) return arr;
  return out;
}

// Trailing-only silence trim for the final gated tail. The streaming gate releases
// speech promptly, but withholds low-energy trailing samples until synthesis ends.
function trimTrailing(samples, sr) {
  const n = samples.length;
  const win = Math.max(1, Math.floor(sr * 0.02));
  if (n < win * 5) return samples;
  const thr = 0.012;            // normalized RMS floor
  let last = Math.floor(n / win) - 1;
  while (last >= 0) {
    let s = 0; const base = last * win;
    for (let i = 0; i < win; i++) { const v = samples[base + i] / 32768; s += v * v; }
    if (Math.sqrt(s / win) >= thr) break;
    last--;
  }
  if (last < 0) return samples;  // all quiet -> leave as-is
  const tailKeep = Math.ceil(0.30 / 0.02);
  const end = Math.min(n, (last + 1 + tailKeep) * win);
  return samples.slice(0, end);
}
// Write an array of int16-range sample numbers to the response as raw PCM (Int16LE).
function writeInt16(res, nums) {
  if (!nums.length) return;
  const a = Int16Array.from(nums);
  res.write(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
}

// ---------- http helpers ----------
function send(res, code, body, type = "application/json") {
  res.writeHead(code, { "Content-Type": type });
  if (typeof body === "string" || Buffer.isBuffer(body)) res.end(body);
  else res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => resolve(Buffer.concat(c))); });
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
  const pathOnly = reqUrl.pathname;
  try {
    if (req.method === "GET" && (pathOnly === "/" || pathOnly === "/index.html")) {
      return send(res, 200, readFileSync(path.join(DIR, "public", "index.html")), "text/html");
    }
    // Static assets from public/ (orb.js, etc.). Without this the index's `import "./orb.js"` 404s
    // and the whole module script aborts (no UI handler wires up).
    if (req.method === "GET" && /^\/[\w.-]+\.(js|css|png|svg|ico|wav|woff2|woff)$/.test(pathOnly)) {
      const fp = path.join(DIR, "public", path.basename(pathOnly));
      if (existsSync(fp)) {
        const ext = path.extname(fp).slice(1);
        const ctypes = { js: "text/javascript", css: "text/css", png: "image/png", svg: "image/svg+xml", ico: "image/x-icon", wav: "audio/wav", woff2: "font/woff2", woff: "font/woff" };
        return send(res, 200, readFileSync(fp), ctypes[ext] || "application/octet-stream");
      }
    }

    // Live download-progress stream (SSE). The UI shows a first-run setup overlay from this.
    if (req.method === "GET" && pathOnly === "/api/progress") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
      res.write("retry: 3000\n\n");
      progressClients.add(res);
      req.on("close", () => progressClients.delete(res));
      return;
    }

    if (req.method === "GET" && pathOnly === "/api/state") {
      return send(res, 200, {
        voices: store.voices.map(publicVoice),
        activeId: store.activeId,
        ttsLangs: TTS_LANGS,
        sttLangs: STT_LANGS,
        transcriptionEngine: "parakeet-transcription",
        ttsEngine: "chatterbox",
        speed: runtimeSpeed,
      });
    }

    // Live voice-speed control. Changing it drops the resident TTS so the next synth
    // reloads at the new pace (speed is a load-time Chatterbox knob).
    if (req.method === "POST" && pathOnly === "/api/speed") {
      const body = JSON.parse((await readBody(req)).toString() || "{}");
      const v = clampSpeed(body.speed);
      if (v !== runtimeSpeed) {
        runtimeSpeed = v;
        await dropTts();
        log(`Speed set to ${runtimeSpeed} (resident TTS dropped; reloads on next synth).`);
      }
      return send(res, 200, { ok: true, speed: runtimeSpeed });
    }

    if (req.method === "GET" && pathOnly === "/api/model-status") {
      const from = (reqUrl.searchParams.get("from") || "en").toLowerCase();
      const to = (reqUrl.searchParams.get("to") || defaultTargetFor(from)).toLowerCase();
      return send(res, 200, setupStatusGrid(from, to));
    }

    if (req.method === "POST" && pathOnly === "/api/prepare") {
      let from = "en", to = "it";
      try {
        const body = JSON.parse((await readBody(req)).toString() || "{}");
        from = (body.from || from).toString().toLowerCase();
        to = (body.to || to).toString().toLowerCase();
      } catch {}
      if (!STT_PARAKEET[from]) return send(res, 400, { error: `unsupported source language: ${from}` });
      if (!TTS_LANGS[to]) return send(res, 400, { error: `unsupported target language: ${to}` });
      if (TTS_PREWARM_DEMO_SET) warmDemoSet(to, from);
      else preparePair(from, to);
      return send(res, 200, { ok: true, ...setupStatusGrid(from, to) });
    }

    if (req.method === "POST" && pathOnly === "/api/reset") {
      invalidateSetupQueues();
      const cleared = await serializeWorker(async () => {
        const clearedVoices = await clearVoices();
        await dropAllResidentModels();
        return clearedVoices;
      });
      log(`Demo reset: cleared ${cleared} voice(s), unloaded resident models.`);
      return send(res, 200, { ok: true, cleared });
    }

    // Capture a "Receive Prototype Link" email -> append to ~/.qvac-voice-relay/emails.json.
    if (req.method === "POST" && pathOnly === "/api/proto-email") {
      let email = "";
      try { email = (JSON.parse((await readBody(req)).toString() || "{}").email || "").toString().trim().slice(0, 160); } catch {}
      if (!email || email.indexOf("@") < 1) return send(res, 400, { error: "invalid email" });
      let list = [];
      try { if (existsSync(EMAILS_JSON)) list = JSON.parse(readFileSync(EMAILS_JSON, "utf8")); } catch {}
      if (!Array.isArray(list)) list = [];
      list.push({ email, at: new Date().toISOString() });
      writeFileSync(EMAILS_JSON, JSON.stringify(list, null, 2));
      log(`Prototype email captured: ${email} (${list.length} total).`);
      return send(res, 200, { ok: true, count: list.length });
    }

    // Enroll: save a new named, persisted voice from a reference recording. Consent is required.
    if (req.method === "POST" && pathOnly === "/api/enroll") {
      if ((req.headers["x-consent"] || "").toString().toLowerCase() !== "yes") {
        return send(res, 400, { error: "Consent required: confirm this is your own voice." });
      }
      const buf = await readBody(req);
      if (buf.length < 1200) return send(res, 400, { error: "Recording too short." });
      let name = "";
      try { name = decodeURIComponent((req.headers["x-voice-name"] || "").toString()); } catch { name = ""; }
      name = name.trim().slice(0, 40) || `My voice ${store.voices.length + 1}`;
      let lang = (req.headers["x-voice-lang"] || "en").toString().toLowerCase();
      if (!STT_PARAKEET[lang]) lang = "en";   // the language this voice was cloned in -> used as the "from" later
      const id = randomUUID();
      const file = `${id}.16k.wav`;
      const inPath = path.join(TMP, "enroll_" + id);
      try {
        writeFileSync(inPath, buf);
        await toWav16k(inPath, path.join(VOICES_DIR, file));
        const voice = { id, name, lang, createdAt: new Date().toISOString(), file };
        invalidateSetupQueues();
        await serializeWorker(async () => {
          store.voices.unshift(voice);
          store.activeId = id;
          saveStore();
          await dropTts();   // new active voice -> the client warms the chosen target via /api/warm
        });
        log(`Voice enrolled: "${name}" (${(buf.length / 1024).toFixed(0)} KB).`);
        return send(res, 200, { voice: publicVoice(voice), activeId: store.activeId });
      } finally { try { if (existsSync(inPath)) unlinkSync(inPath); } catch {} }
    }

    // Select the active voice.
    if (req.method === "POST" && pathOnly === "/api/voices/select") {
      const { id } = JSON.parse((await readBody(req)).toString() || "{}");
      if (!store.voices.find((v) => v.id === id)) return send(res, 404, { error: "Voice not found." });
      if (store.activeId !== id) {
        invalidateSetupQueues();
        await serializeWorker(async () => {
          store.activeId = id;
          saveStore();
          await dropTts();
        });
      }
      return send(res, 200, { ok: true, activeId: store.activeId });
    }

    // Pre-warm the active voice for a target language (fire-and-forget). The client calls this
    // when the user picks/changes the target language so the model is loaded before they speak.
    if (req.method === "POST" && pathOnly === "/api/warm") {
      let from = "en", lang = "";
      try {
        const body = JSON.parse((await readBody(req)).toString() || "{}");
        from = (body.from || from).toString().toLowerCase();
        lang = (body.lang || body.to || "").toString().toLowerCase();
      } catch {}
      if (TTS_PREWARM_DEMO_SET) warmDemoSet(lang, from);
      else preparePair(from, lang);
      return send(res, 200, { ok: true, warming: lang || null, from });
    }

    // Clear ALL voices (entries + audio files).
    if (req.method === "DELETE" && pathOnly === "/api/voices") {
      invalidateSetupQueues();
      const had = await serializeWorker(async () => {
        const cleared = await clearVoices();
        await dropTts();
        return cleared;
      });
      if (had) log(`Cleared ${had} voice(s) on session reset.`);
      return send(res, 200, { ok: true, cleared: had });
    }

    // Delete (erase) a voice: removes the entry + the audio file; clears the active TTS if it was active.
    if (req.method === "DELETE" && pathOnly.startsWith("/api/voices/")) {
      const id = decodeURIComponent(pathOnly.slice("/api/voices/".length));
      const v = store.voices.find((x) => x.id === id);
      if (!v) return send(res, 404, { error: "Voice not found." });
      const wasActive = store.activeId === id;
      if (wasActive) invalidateSetupQueues();
      const deleteVoice = async () => {
        store.voices = store.voices.filter((x) => x.id !== id);
        try { const fp = path.join(VOICES_DIR, v.file); if (existsSync(fp)) unlinkSync(fp); } catch {}
        if (wasActive) {
          store.activeId = store.voices[0] ? store.voices[0].id : null;
          await dropTts();
        }
        saveStore();
        return store.activeId;
      };
      const activeId = wasActive ? await serializeWorker(deleteVoice) : await deleteVoice();
      log(`Voice erased: "${v.name}".`);
      return send(res, 200, { ok: true, activeId });
    }

    // Transcribe (mic input): audio -> text in the selected source language.
    if (req.method === "POST" && pathOnly === "/api/transcribe") {
      let lang = (req.headers["x-language"] || "en").toString().toLowerCase();
      if (!STT_PARAKEET[lang]) lang = "en";
      const buf = await readBody(req);
      const stamp = process.hrtime.bigint().toString();
      const inPath = path.join(TMP, "in_" + stamp);
      const wavPath = inPath + ".16k.wav";
      try {
        writeFileSync(inPath, buf);
        await toWav16k(inPath, wavPath);
        // Serialize the STT load+transcribe so it never overlaps another worker op (0.3.x GPU SIGSEGVs on overlap).
        const text = await serializeWorker(async () => {
          const raw = await transcribeWithRetry(lang, wavPath);
          return stripLeadingListMarker(String(raw).replace(/\[[A-Z_ ]+\]/g, "").replace(/\s+/g, " "));
        });
        return send(res, 200, { text, language: lang });
      } finally { for (const f of [inPath, wavPath]) { try { if (existsSync(f)) unlinkSync(f); } catch {} } }
    }

    // Translate text as soon as speech transcription or typing settles. This endpoint
    // uses the user-selected source language, preloads the needed Bergamot path, and
    // returns the final target-language text that the play button will synthesize later.
    if (req.method === "POST" && pathOnly === "/api/translate") {
      const body = JSON.parse((await readBody(req)).toString() || "{}");
      const text = (body.text || "").toString().trim();
      const from = (body.from || "en").toString().toLowerCase();
      const to = (body.to || "it").toString().toLowerCase();
      if (!text) return send(res, 400, { error: "text is required" });
      if (!STT_PARAKEET[from]) return send(res, 400, { error: `unsupported source language: ${from}` });
      if (!TTS_LANGS[to]) return send(res, 400, { error: `unsupported output language: ${to}` });

      const translated = await serializeWorker(async () => {
        if (from === to) return text;
        return cleanTranslatedText(await translateWithRetry(from, to, text));
      });
      warmTtsLang(to);
      return send(res, 200, { text, translated, from, to });
    }

    // Speak: synthesize already-translated text in the ACTIVE voice (target language).
    // Streams raw Int16LE PCM @ 24k as the engine produces it, so the client can start
    // playing within a few hundred ms instead of waiting for the whole utterance.
    if (req.method === "POST" && pathOnly === "/api/speak") {
      if (!activeRefPath()) return send(res, 400, { error: "No voice enrolled. Enroll a voice first." });
      const body = JSON.parse((await readBody(req)).toString() || "{}");
      const text = (body.text || body.translatedText || "").toString().trim();
      const sourceText = (body.sourceText || "").toString().trim();
      const to = (body.to || "it").toString().toLowerCase();
      if (!text) return send(res, 400, { error: "text is required" });
      if (!TTS_LANGS[to]) return send(res, 400, { error: `unsupported output language: ${to}` });

      // Serialize the whole worker portion (model load + synth stream) so it
      // never overlaps another worker op (background warm, another request) -> 0.3.x GPU
      // SIGSEGVs on overlap. The lock is held for the full synth/stream (the worker can only
      // do one at a time anyway). Errors before headers propagate to the outer 500 handler.
      await serializeWorker(async () => {
        const translated = cleanTranslatedText(text);
        log(`Speak: "${(sourceText || text).slice(0, 40)}" -> "${translated.slice(0, 40)}" (${to})`);

        const t0 = process.hrtime.bigint();
        let firstChunkMs = null;
        const writeAudioChunk = (samples) => {
          if (!samples.length || res.destroyed) return;
          if (!res.headersSent) {
            firstChunkMs = Number(process.hrtime.bigint() - t0) / 1e6;
            res.writeHead(200, {
              "Content-Type": "application/octet-stream",
              "Cache-Control": "no-store",
              "X-Sample-Rate": String(CHATTERBOX_SR),
              "X-Translated": encodeURIComponent(translated),
            });
          }
          writeInt16(res, samples);
        };
        const stats = await streamSynthesizeWithRetry(to, translated, writeAudioChunk);
        const synthMs = Number(process.hrtime.bigint() - t0) / 1e6;
        if (!res.headersSent) {
          res.writeHead(200, {
            "Content-Type": "application/octet-stream",
            "Cache-Control": "no-store",
            "X-Sample-Rate": String(CHATTERBOX_SR),
            "X-Translated": encodeURIComponent(translated),
          });
        }
        res.end();
        log(`TTS stream: first ${firstChunkMs == null ? "none" : `${firstChunkMs.toFixed(0)}ms`}, total ${synthMs.toFixed(0)}ms, ${stats.samples} samples (${(stats.samples / CHATTERBOX_SR).toFixed(2)}s) (${to})`);
      });
      return;
    }

    send(res, 404, { error: "not found" });
  } catch (e) {
    log("ERROR: " + e.message);
    if (!res.headersSent) send(res, 500, { error: e.message });
    else res.destroy(e);
  }
});

server.listen(PORT, () => {
  console.log("QVAC Voice Relay");
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Voices stored in ${STORE_DIR}`);
});
