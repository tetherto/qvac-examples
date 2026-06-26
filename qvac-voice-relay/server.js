// QVAC Voice Relay - enroll your voice, say/type something, hear yourself in another language.
// 100% on-device: Node built-in http + @qvac/sdk (Whisper STT + Bergamot translate + Chatterbox reference-matched TTS) + ffmpeg.
//
// Wording note (per spec, until QVAC docs support stronger terms): we say "enrolled voice" /
// "voice signature" / "reference-matched voice", not "clone". The engine is QVAC TTS voice
// conditioning via a recorded reference sample configured at model load time.
//
// Pipeline:
//   1) /api/enroll          : record a ~15s reference -> saved as a named, persisted voice (16k mono wav)
//   2) /api/voices/select   : choose the active voice
//   3) DELETE /api/voices/:id : erase a voice (file + entry); clears the active TTS if it was active
//   4) /api/transcribe      : (mic input) audio -> Whisper STT (source lang) -> text
//   5) /api/speak           : { text, from, to } -> Bergamot translate -> Chatterbox TTS in the active voice -> wav
//
// Voices persist under ~/.qvac-voice-relay/ (outside the app folder, so this stays packageable to a .app/.dmg).
//
// SDK reality (validated 2026-06-05, SDK 0.12.x):
//   - Chatterbox GGML reference-matched TTS: loadModel({ modelSrc: TTS_T3_MULTILINGUAL_CHATTERBOX_Q8_0.src, modelType:"tts",
//       modelConfig:{ ttsEngine:"chatterbox", language, s3genModelSrc: TTS_S3GEN_MULTILINGUAL_CHATTERBOX.src, referenceAudioSrc, useGPU:true } })
//     referenceAudioSrc AND language are set at LOAD time -> changing voice OR target language requires a reload.
//     Output languages limited to en/es/de/it (TTS_LANGUAGES). French/Japanese are NOT possible as output voices.
//   - Whisper: language fixed at load (no auto-detect). One model per source language.
//   - Translate (Bergamot): modelSrc = BERGAMOT_<FROM>_<TO> (required); non-EN<->non-EN uses modelConfig.pivotModel (pivots via English).
//   - textToSpeech returns audio samples (Int16-ish), NOT a ready WAV -> wrap with a 24k mono WAV header.
//
// HARDWARE: GGML chatterbox is multi-GB on Metal unified memory. Built for 16/32 GB. Crashed an 8 GB Mac.

import http from "http";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import os from "os";
import path from "path";
import { patchSdk } from "./patch-sdk.mjs";
// Forward the chatterbox streaming/perf knobs BEFORE the SDK module evaluates. ESM static
// imports are hoisted, so the SDK is imported DYNAMICALLY here (after the on-disk patch runs);
// this also keeps it working after an `npm install` restores the original SDK files.
patchSdk();
const {
  loadModel, unloadModel, transcribe, translate, textToSpeech,
  WHISPER_BASE_Q8_0, WHISPER_ITALIAN_BASE_Q8_0, WHISPER_SPANISH_TINY_Q8_0, WHISPER_FRENCH_BASE_Q8_0,
  BERGAMOT_EN_ES, BERGAMOT_ES_EN, BERGAMOT_EN_FR, BERGAMOT_FR_EN, BERGAMOT_EN_IT, BERGAMOT_IT_EN,
  BERGAMOT_EN_DE, BERGAMOT_EN_PT, BERGAMOT_EN_NL, BERGAMOT_EN_PL, BERGAMOT_EN_TR, BERGAMOT_EN_SV,
  BERGAMOT_EN_DA, BERGAMOT_EN_FI, BERGAMOT_EN_NO, BERGAMOT_EN_EL, BERGAMOT_EN_MS, BERGAMOT_EN_AR, BERGAMOT_EN_KO,
  TTS_T3_MULTILINGUAL_CHATTERBOX_Q8_0, TTS_S3GEN_MULTILINGUAL_CHATTERBOX,
} = await import("@qvac/sdk");

const PORT = process.env.PORT || 3071;
const DIR = import.meta.dirname;
const TMP = path.join(os.tmpdir(), "qvac-voice-relay");
mkdirSync(TMP, { recursive: true });

// Voices persist here (user-writable, outside the app bundle -> packaging-safe).
const STORE_DIR = path.join(os.homedir(), ".qvac-voice-relay");
const VOICES_DIR = path.join(STORE_DIR, "voices");
const VOICES_JSON = path.join(STORE_DIR, "voices.json");
const EMAILS_JSON = path.join(STORE_DIR, "emails.json");   // captured "Receive Prototype Link" emails
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
// STT source languages (mic input). es = SPANISH_TINY (tiny only), fr = FRENCH_BASE.
const STT_WHISPER = {
  en: WHISPER_BASE_Q8_0,
  it: WHISPER_ITALIAN_BASE_Q8_0,
  es: WHISPER_SPANISH_TINY_Q8_0,
  fr: WHISPER_FRENCH_BASE_Q8_0,
};
// Bergamot pairs (pivot through English; SDK chains non-EN<->non-EN via pivotModel).
// X->EN covers the spoken input languages; EN->X covers every output language above.
const BERGAMOT = {
  "es|en": BERGAMOT_ES_EN, "fr|en": BERGAMOT_FR_EN, "it|en": BERGAMOT_IT_EN,
  "en|es": BERGAMOT_EN_ES, "en|fr": BERGAMOT_EN_FR, "en|it": BERGAMOT_EN_IT,
  "en|de": BERGAMOT_EN_DE, "en|pt": BERGAMOT_EN_PT, "en|nl": BERGAMOT_EN_NL,
  "en|pl": BERGAMOT_EN_PL, "en|tr": BERGAMOT_EN_TR, "en|sv": BERGAMOT_EN_SV,
  "en|da": BERGAMOT_EN_DA, "en|fi": BERGAMOT_EN_FI, "en|no": BERGAMOT_EN_NO,
  "en|el": BERGAMOT_EN_EL, "en|ms": BERGAMOT_EN_MS, "en|ar": BERGAMOT_EN_AR, "en|ko": BERGAMOT_EN_KO,
};

const CHATTERBOX_SR = 24000;
// Engine threads: tts-ggml caps its own default at 4; on bigger boxes we lift it.
const THREADS = Math.min(os.cpus().length, 8);
// TTS engine config (tts-ggml 0.3.x via package.json override + patch-sdk forwarding):
//  - threads: lift the engine's default cap of 4 on bigger boxes.
//  - kvCacheType "f16": tts-ggml 0.3.x defaults the KV cache to q8_0, which CRASHES the
//    Metal/GPU path ("unsupported op 'CONT'" -> SIGABRT). f16 fixes it (SDK team / Max,
//    2026-06-24). Tiny memory cost for this model.
// Do not enable native chunk streaming by default. We generate a complete utterance before
// sending it to the browser so playback is continuous instead of dependent on burst timing.
const TTS_STREAM_CFG = { threads: THREADS, kvCacheType: "f16" };
// Optional demo-mode warm set. Warming every language hides later language switches, but it
// also queues many multi-second TTS loads behind the single serialized worker. Keep it opt-in
// so a normal first speak only pays for the selected target language.
const TTS_WARM_LANGS = (process.env.TTS_WARM_LANGS || "en,es,fr,it,de").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const TTS_PREWARM_DEMO_SET = /^(1|true|yes)$/i.test(process.env.TTS_PREWARM_DEMO_SET || "");
// LRU must hold the whole warm set (+1 spare) or warming the last would evict the first.
const TTS_LRU_MAX = Math.max(2, TTS_WARM_LANGS.length + 1);
// Pace control is a post-synthesis WSOLA time-stretch. It improves speaking rate, but can
// add artifacts, so default to raw model speed for quality. Env TTS_SPEED=0.85 can re-enable
// the old slowdown if the output feels too rushed.
const TTS_SPEED_BY_LANG = {
};
const TTS_SPEED_DEFAULT = 1.0;
const TTS_SPEED_OVERRIDE = process.env.TTS_SPEED ? Number(process.env.TTS_SPEED) : null;
// Live, UI-adjustable speaking rate (load-time WSOLA stretch; <1 = slower). Starts from the
// env override or the default; POST /api/speed changes it live during a demo (resident models
// are dropped so the next synth reloads at the new rate). Clamped to a sane band.
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
const whisperCache = new Map();   // lang -> modelId
const nmtCache = new Map();       // `${from}|${to}` -> modelId
// TTS: small LRU keyed by `${ref}|${lang}`. Both are load-time params, so each
// (voice, target-language) pair is its own resident model; LRU(2) lets the user
// flip between two target languages without paying a multi-GB reload each time.
const ttsCache = new Map();       // key -> modelId  (insertion order = LRU order)
const ttsLoading = new Map();     // key -> Promise<modelId>  (dedupe concurrent loads)
const ttsWarmed = new Set();      // modelIds already primed with a throwaway synth
const ttsWarmQueued = new Set();  // `${ref}|${lang}` warm jobs already queued
const nmtWarmQueued = new Set();  // `${from}|${to}` warm jobs already queued

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

async function ensureWhisper(lang) {
  if (!STT_WHISPER[lang]) throw new Error(`No whisper model for source language "${lang}"`);
  if (whisperCache.has(lang)) return whisperCache.get(lang);
  log(`Loading Whisper (${lang})...`);
  const id = await withProgress("speech recognition", (onProgress) => loadModel({
    modelSrc: STT_WHISPER[lang],
    modelType: "whisper",
    modelConfig: { audio_format: "f32le", strategy: "greedy", n_threads: THREADS, language: lang, temperature: 0.0 },
    onProgress,
  }));
  whisperCache.set(lang, id);
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
      modelType: "tts",
      modelConfig: {
        ttsEngine: "chatterbox",
        language: lang,
        s3genModelSrc: TTS_S3GEN_MULTILINGUAL_CHATTERBOX.src,
        referenceAudioSrc: ref,
        useGPU: true,
        speed: speedFor(lang),   // native pitch-preserving pace (load-time, per language)
        ...TTS_STREAM_CFG,
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

// Prime a freshly-loaded model with a tiny throwaway synthesis so the first
// real request runs on warm GPU kernels (cold first-call is ~2x slower).
async function prewarmTts(id) {
  if (!id || ttsWarmed.has(id)) return;
  ttsWarmed.add(id);
  try {
    const out = textToSpeech({
      modelId: id, text: "ok", inputType: "text",
      stream: false,
    });
    await out.buffer;
  } catch (e) { ttsWarmed.delete(id); }
}

// Background warm of the active voice for a likely target language. Fired after
// enroll / select so the model is loaded AND warm by the time the user speaks.
function defaultTargetFor(fromLang) {
  return Object.keys(TTS_LANGS).find((l) => l !== fromLang) || "en";
}
// Warm the active voice for a SPECIFIC target language (driven by the client via /api/warm
// when the user picks a target). Pre-loading the RIGHT language during the user's typing
// window makes the first speak fast (~0.7s) instead of paying the multi-second model load
// then. We do NOT guess a language on enroll/select anymore: a wrong guess just blocked the
// real first request (serialized) without helping. Serialized so it never races another op.
function warmVoiceLang(lang) {
  const v = store.voices.find((x) => x.id === store.activeId);
  if (!v || !lang || !TTS_LANGS[lang]) return;
  const from = v.lang || "en";
  // Warm the TTS model AND the translation model (if a cross-language pair) so the first
  // speak pays neither load. Serialized so it never races another worker op.
  const ref = activeRefPath();
  if (ref && existsSync(ref)) {
    const ttsKey = `${ref}|${lang}`;
    const cachedTtsId = ttsCache.get(ttsKey);
    if (!(cachedTtsId && ttsWarmed.has(cachedTtsId)) && !ttsWarmQueued.has(ttsKey)) {
      ttsWarmQueued.add(ttsKey);
      serializeWorker(async () => {
        try {
          if (activeRefPath() !== ref) return; // active voice changed before this warm ran
          await prewarmTts(await ensureTts(lang));
        } finally {
          ttsWarmQueued.delete(ttsKey);
        }
      }).catch((e) => log(`warm tts skipped: ${e.message}`));
    }
  }
  if (from !== lang) {
    const nmtKey = `${from}|${lang}`;
    if (!nmtCache.has(nmtKey) && !nmtWarmQueued.has(nmtKey)) {
      nmtWarmQueued.add(nmtKey);
      serializeWorker(() => ensureNmt(from, lang).finally(() => nmtWarmQueued.delete(nmtKey))).catch((e) => log(`warm nmt skipped: ${e.message}`));
    }
  }
}
// Pre-warm the whole demo language set (background) so switching between them is instant.
// `priority` (the client's currently-selected target) is warmed FIRST so the first speak is
// ready before the rest of the set loads. Skips the voice's own clone language (not a target).
function warmDemoSet(priority) {
  const v = store.voices.find((x) => x.id === store.activeId);
  if (!v) return;
  const from = v.lang || "en";
  const order = [priority, ...TTS_WARM_LANGS].filter((l, i, a) => l && TTS_LANGS[l] && l !== from && a.indexOf(l) === i);
  if (order.length) log(`Warming demo set: ${order.join(", ")}`);
  for (const lang of order) warmVoiceLang(lang);
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

// Trailing-only silence trim for the streamed tail. We stream the bulk of the
// audio as it arrives and hold back the last ~1s; at the end we drop trailing
// low-energy (Chatterbox can append a quiet tail) but keep a short 0.3s pad.
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
  const url = req.url || "/";
  const pathOnly = url.split("?")[0];
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
        sttLangs: Object.keys(STT_WHISPER),
        speed: runtimeSpeed,
      });
    }

    // Live speaking-rate control (demo): set the load-time speed; drop resident TTS models so
    // the next synth reloads at the new rate, then re-warm the current/demo languages.
    if (req.method === "POST" && pathOnly === "/api/speed") {
      let v = runtimeSpeed;
      try { v = clampSpeed(JSON.parse((await readBody(req)).toString() || "{}").speed); } catch {}
      if (v !== runtimeSpeed) {
        runtimeSpeed = v;
        await dropTts();   // models bake speed at load time -> force reload at the new rate
        log(`Speed set to ${runtimeSpeed} (resident TTS dropped; will reload on next synth).`);
      }
      return send(res, 200, { ok: true, speed: runtimeSpeed });
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
      if (!STT_WHISPER[lang]) lang = "en";   // the language this voice was cloned in -> used as the "from" later
      const id = randomUUID();
      const file = `${id}.16k.wav`;
      const inPath = path.join(TMP, "enroll_" + id);
      try {
        writeFileSync(inPath, buf);
        await toWav16k(inPath, path.join(VOICES_DIR, file));
        const voice = { id, name, lang, createdAt: new Date().toISOString(), file };
        store.voices.unshift(voice);
        store.activeId = id;
        saveStore();
        await dropTts();   // new active voice -> the client warms the chosen target via /api/warm
        log(`Voice enrolled: "${name}" (${(buf.length / 1024).toFixed(0)} KB).`);
        return send(res, 200, { voice: publicVoice(voice), activeId: store.activeId });
      } finally { try { if (existsSync(inPath)) unlinkSync(inPath); } catch {} }
    }

    // Select the active voice.
    if (req.method === "POST" && pathOnly === "/api/voices/select") {
      const { id } = JSON.parse((await readBody(req)).toString() || "{}");
      if (!store.voices.find((v) => v.id === id)) return send(res, 404, { error: "Voice not found." });
      if (store.activeId !== id) { store.activeId = id; saveStore(); await dropTts(); }
      return send(res, 200, { ok: true, activeId: store.activeId });
    }

    // Pre-warm the active voice for a target language (fire-and-forget). The client calls this
    // when the user picks/changes the target language so the model is loaded before they speak.
    if (req.method === "POST" && pathOnly === "/api/warm") {
      let lang = "";
      try { lang = (JSON.parse((await readBody(req)).toString() || "{}").lang || "").toString().toLowerCase(); } catch {}
      if (TTS_PREWARM_DEMO_SET) warmDemoSet(lang);
      else warmVoiceLang(lang);
      return send(res, 200, { ok: true, warming: lang || null });
    }

    // Clear ALL voices (entries + audio files). Used on page load so a reload forces a fresh re-record.
    if (req.method === "DELETE" && pathOnly === "/api/voices") {
      for (const v of store.voices) {
        try { const fp = path.join(VOICES_DIR, v.file); if (existsSync(fp)) unlinkSync(fp); } catch {}
      }
      const had = store.voices.length;
      store.voices = []; store.activeId = null;
      saveStore(); await dropTts();
      if (had) log(`Cleared ${had} voice(s) on session reset.`);
      return send(res, 200, { ok: true, cleared: had });
    }

    // Delete (erase) a voice: removes the entry + the audio file; clears the active TTS if it was active.
    if (req.method === "DELETE" && pathOnly.startsWith("/api/voices/")) {
      const id = decodeURIComponent(pathOnly.slice("/api/voices/".length));
      const v = store.voices.find((x) => x.id === id);
      if (!v) return send(res, 404, { error: "Voice not found." });
      store.voices = store.voices.filter((x) => x.id !== id);
      try { const fp = path.join(VOICES_DIR, v.file); if (existsSync(fp)) unlinkSync(fp); } catch {}
      if (store.activeId === id) {
        store.activeId = store.voices[0] ? store.voices[0].id : null;
        await dropTts();
      }
      saveStore();
      log(`Voice erased: "${v.name}".`);
      return send(res, 200, { ok: true, activeId: store.activeId });
    }

    // Transcribe (mic input): audio -> text in the source language.
    if (req.method === "POST" && pathOnly === "/api/transcribe") {
      let lang = (req.headers["x-language"] || "en").toString().toLowerCase();
      if (!STT_WHISPER[lang]) lang = "en";
      const buf = await readBody(req);
      const stamp = process.hrtime.bigint().toString();
      const inPath = path.join(TMP, "in_" + stamp);
      const wavPath = inPath + ".16k.wav";
      try {
        writeFileSync(inPath, buf);
        await toWav16k(inPath, wavPath);
        // Serialize the STT load+transcribe so it never overlaps another worker op (0.3.x GPU SIGSEGVs on overlap).
        const text = await serializeWorker(async () => {
          const wId = await ensureWhisper(lang);
          const raw = await transcribe({ modelId: wId, audioChunk: wavPath });
          return String(raw).replace(/\[[A-Z_ ]+\]/g, "").replace(/\s+/g, " ").trim();
        });
        return send(res, 200, { text });
      } finally { for (const f of [inPath, wavPath]) { try { if (existsSync(f)) unlinkSync(f); } catch {} } }
    }

    // Speak: translate text from->to, synthesize in the ACTIVE voice (target language).
    // Streams raw Int16LE PCM @ 24k as the engine produces it, so the client can start
    // playing within a few hundred ms instead of waiting for the whole utterance.
    if (req.method === "POST" && pathOnly === "/api/speak") {
      if (!activeRefPath()) return send(res, 400, { error: "No voice enrolled. Enroll a voice first." });
      const body = JSON.parse((await readBody(req)).toString() || "{}");
      const text = (body.text || "").toString().trim();
      const from = (body.from || "en").toString().toLowerCase();
      const to = (body.to || "it").toString().toLowerCase();
      if (!text) return send(res, 400, { error: "text is required" });
      if (!TTS_LANGS[to]) return send(res, 400, { error: `unsupported output language: ${to}` });

      // Serialize the whole worker portion (translate + model load + synth stream) so it
      // never overlaps another worker op (background warm, another request) -> 0.3.x GPU
      // SIGSEGVs on overlap. The lock is held for the full synth/stream (the worker can only
      // do one at a time anyway). Errors before headers propagate to the outer 500 handler.
      await serializeWorker(async () => {
        let translated = text;
        if (from !== to) {
          const nmtId = await ensureNmt(from, to);
          const tr = translate({ modelId: nmtId, text, modelType: "nmt", stream: false });
          // Some Bergamot multilingual models echo a ">>lang<<" target token; strip it so the
          // voice does not try to read it aloud (e.g. ">>por<< Esta frase..." -> "Esta frase...").
          translated = String(await tr.text).trim().replace(/^\s*>>[a-z]{2,3}<<\s*/i, "").trim();
        }
        log(`Speak: "${text.slice(0, 40)}" (${from}) -> "${translated.slice(0, 40)}" (${to})`);

        const ttsId = await ensureTts(to);
        // Pace is applied by the engine at load time. Generate the full utterance before
        // responding so the browser plays one continuous buffer without stream underruns.
        const t0 = process.hrtime.bigint();
        const out = textToSpeech({
          modelId: ttsId, text: translated, inputType: "text",
          stream: false,
        });
        const samples = Array.from(await out.buffer);
        const synthMs = Number(process.hrtime.bigint() - t0) / 1e6;
        const trimmed = trimTrailing(samples, CHATTERBOX_SR);
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Cache-Control": "no-store",
          "X-Sample-Rate": String(CHATTERBOX_SR),
          "X-Translated": encodeURIComponent(translated),
        });
        writeInt16(res, trimmed);
        res.end();
        log(`TTS full: synth ${synthMs.toFixed(0)}ms, ${trimmed.length} samples (${(trimmed.length / CHATTERBOX_SR).toFixed(2)}s) speed=${speedFor(to)} (${to})`);
      });
      return;
    }

    send(res, 404, { error: "not found" });
  } catch (e) {
    log("ERROR: " + e.message);
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log("QVAC Voice Relay");
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Voices stored in ${STORE_DIR}`);
});
