// The ONLY place the QVAC SDK is touched (Electron main process; never the renderer - a renderer
// context blocks the SDK's fetch on CORS grounds). See README for the architecture.
//
// Load-bearing SDK 0.16 facts:
//  - ESM SDK loaded once via dynamic import().
//  - EVERY worker op is SERIALIZED (incl. unloadModel): the single Bare worker SIGSEGVs on Metal if
//    two ops overlap.
//  - completion REQUIRES `stream`; transcribe(metadata:true) -> per-segment {startMs,endMs,text};
//    textToSpeech(stream:false).buffer is an Int16 sample array @ 44100 Hz.
//  - Sampling/language/voice are LOAD-TIME (modelConfig); the model key encodes them so ensureModel
//    reloads on change. A LOCAL gguf loads with modelSrc = the file path + modelType 'llamacpp-completion'.
//  - Qwen3 emits <think>...</think>: disable with reasoning_budget:0 AND strip it from the text.
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { writeWav, wavBytes, toWav16k, toWavRate, pcmWavBytes, levelDb, shapeTail, silences } = require("./wav.js");
const crypto = require("node:crypto");

let _sdk = null;
async function sdk() { if (!_sdk) _sdk = await import("@qvac/sdk"); return _sdk; }

// ---- serialize all worker ops (Metal SIGSEGVs on overlap) ----
let chain = Promise.resolve();
function serialize(fn) { const run = chain.then(fn, fn); chain = run.then(() => {}, () => {}); return run; }

// ---- resident model per tool; reload only when its config key changes ----
const loaded = {};
async function ensureModel(tool, key, loadArgs, onProgress) {
  const q = await sdk();
  if (loaded[tool] && loaded[tool].key === key) return loaded[tool].modelId;
  if (loaded[tool]) { try { await q.unloadModel({ modelId: loaded[tool].modelId, clearStorage: false }); } catch { /* */ } loaded[tool] = null; }
  const modelId = await q.loadModel({ ...loadArgs, onProgress });
  loaded[tool] = { modelId, key };
  return modelId;
}
async function unloadTool(tool) { // unloading is a worker op too -> serialize it
  return serialize(async () => { const q = await sdk(); if (loaded[tool]) { try { await q.unloadModel({ modelId: loaded[tool].modelId, clearStorage: false }); } catch { /* */ } loaded[tool] = null; } });
}
async function unloadAll() { for (const t of Object.keys(loaded)) await unloadTool(t); }

// ---- config (output folder + models folder), persisted ----
const CONFIG_DIR = path.join(os.homedir(), ".qvac-creator");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const DEFAULT_OUT = path.join(os.homedir(), "Downloads", "QVAC Creator Toolkit");
const DEFAULT_MODELS = path.join(os.homedir(), ".qvac", "models"); // where QVAC already caches GGUFs
function readConfig() { try { return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); } catch { return {}; } }
function writeConfig(patch) { const c = { ...readConfig(), ...patch }; try { fs.mkdirSync(CONFIG_DIR, { recursive: true }); fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2)); } catch { /* */ } return c; }
function expandHome(p) { return typeof p === "string" && /^~(?=$|[\\/])/.test(p) ? path.join(os.homedir(), p.slice(1)) : p; }
function outputFolder() { return expandHome(readConfig().outputFolder) || DEFAULT_OUT; }
function modelsFolder() { return expandHome(readConfig().modelsFolder) || DEFAULT_MODELS; }
function setOutputFolder(dir) { if (dir) writeConfig({ outputFolder: expandHome(dir) }); return outputFolder(); }
function setModelsFolder(dir) { if (dir) writeConfig({ modelsFolder: expandHome(dir) }); return modelsFolder(); }

function stamp() { const d = new Date(); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; }
function slug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "untitled"; }
function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); return d; }
function outFile(name, dir) { return path.join(ensureDir(dir || outputFolder()), name); }

// ============================================================================
// TOOL 1 - Script writer (registry models OR a local GGUF by path)
// ============================================================================
const LLM_MODELS = {
  "qwen3-4b": { label: "Qwen3 4B (fast, ~2.5 GB)", constant: "QWEN3_4B_INST_Q4_K_M" },
  "qwen3-8b": { label: "Qwen3 8B (better, ~5 GB)", constant: "QWEN3_8B_INST_Q4_K_M" },
  "gpt-oss-20b": { label: "gpt-oss 20B (strong, ~12 GB)", constant: "GPT_OSS_20B_INST_Q4_K_M" },
  "qwen3.6-35b-a3b": { label: "Qwen3.6 35B-A3B (best, ~22 GB)", constant: "QWEN3_6_35B_A3B_MULTIMODAL_Q4_K_M" },
  "llama-1b": { label: "Llama 3.2 1B (tiny, ~0.8 GB)", constant: "LLAMA_3_2_1B_INST_Q4_0" },
};
// The QVAC cache mixes chat LLMs with image/OCR/TTS/vision GGUFs. Allow-list known chat-LLM families
// (robust) and reject vision-projector / embedding companions. Better a known-good list than a
// never-ending blocklist of every non-LLM model type.
const LLM_HINT = /qwen|llama|gemma|mistral|mixtral|phi[-_ ]?\d|gpt[-_ ]?oss|bitnet|deepseek|granite|smollm|olmo|falcon|command[-_ ]?r|hermes|dolphin|nemotron|minitron|tinyllama|stablelm|starcoder|codellama|magistral|exaone/i;
const NOT_LLM = /mmproj|projection|embed|supertonic|parakeet|chatterbox|silero|clip|siglip|vae/i;
// Scan a folder for chat-capable .gguf files loadable by path. Names are cleaned of the <hash>_ prefix.
function scanModelsFolder(dir) {
  const out = [];
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.toLowerCase().endsWith(".gguf")) continue;
      if (/-\d{5}-of-\d{5}\./i.test(name)) continue;          // skip shard parts
      if (!LLM_HINT.test(name) || NOT_LLM.test(name)) continue; // chat LLMs only
      const full = path.join(dir, name);
      try { if (!fs.statSync(full).isFile()) continue; } catch { continue; }
      const clean = name.replace(/^[0-9a-f]{8,}_/i, "").replace(/\.gguf$/i, "");
      out.push({ id: "local:" + full, label: clean, path: full });
    }
  } catch { /* folder missing */ }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}
function isLocalModel(model) { return typeof model === "string" && (model.startsWith("local:") || model.includes("/")); }
function stripThinking(s) { return String(s).replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^\s*<think>[\s\S]*$/i, "").replace(/<\/?think>/gi, "").trim(); }

// Two output formats. Narration = one voice, HOOK/BEAT/OUTRO structure. Dialogue = a conversation
// with "Name:" prefixes, which flows straight into the multi-voice voice-over (the user's ask: when
// you describe people talking, write a dialogue, not a one-voice ad script). "auto" picks by the idea.
const PROMPTS = {
  narration: {
    system: "You are a professional short-form video scriptwriter. Write tight spoken narration for ONE voice that hooks in the first line. Output plain narration only: no markdown, no reasoning, no camera notes. You may mark sections with a leading label like HOOK: or BEAT 2: on their own line.",
    user: (idea, length, tone) => `Write a one-voice video script.\n\nIdea: ${idea}\nTarget length: ${length}\nTone: ${tone}\n\nStructure it as HOOK, a few BEATs, and an OUTRO, written as narration the creator reads aloud.`,
  },
  dialogue: {
    system: "You are a scriptwriter for spoken dialogue. Write a natural back-and-forth conversation. Put EACH spoken line on its own line, prefixed with the speaker's name and a colon, e.g.\nBeth: ...\nJohn: ...\nUse ONLY the names from the request. Do NOT write scene headings, stage directions, camera notes, or HOOK/BEAT/OUTRO labels. Output nothing but the name-prefixed spoken lines.",
    user: (idea, length, tone) => `Write a spoken dialogue.\n\nWho and what: ${idea}\nApprox length: ${length}\nTone: ${tone}\n\nUse the exact names given. Keep each line short and natural to say out loud, and alternate speakers.`,
  },
};
function pickFormat(fmt, idea) {
  if (fmt === "narration" || fmt === "dialogue") return fmt;
  return /\b(talk|talking|conversation|dialogue|dialog|chat|interview|between .* and |arguing|discuss|debate)\b/i.test(idea) ? "dialogue" : "narration";
}
async function writeScript({ idea, length = "60 seconds", tone = "energetic", model = "qwen3-4b", format = "auto" } = {}, onEvent = () => {}) {
  return serialize(async () => {
    const q = await sdk();
    let key, loadArgs, label;
    if (isLocalModel(model)) {
      const p = model.replace(/^local:/, "");
      key = "llm-local:" + p; label = path.basename(p);
      loadArgs = { modelSrc: p, modelType: "llamacpp-completion", modelConfig: { ctx_size: 8192, temp: 0.7, repeat_penalty: 1.1, reasoning_budget: 0 } };
    } else {
      const m = LLM_MODELS[model] || LLM_MODELS["qwen3-4b"];
      key = "llm-" + model; label = m.label;
      loadArgs = { modelSrc: q[m.constant], modelConfig: { temp: 0.7, repeat_penalty: 1.1, reasoning_budget: 0 } };
    }
    onEvent({ phase: "loading", label });
    const modelId = await ensureModel("script", key, loadArgs, (p) => onEvent({ phase: "download", ...p }));
    onEvent({ phase: "generating" });
    const fmt = pickFormat(format, idea);
    const P = PROMPTS[fmt];
    const result = q.completion({ modelId, history: [{ role: "system", content: P.system }, { role: "user", content: P.user(idea, length, tone) }], stream: true });
    let raw = "";
    for await (const tok of result.tokenStream) { raw += tok; onEvent({ phase: "token", token: tok }); }
    const text = stripThinking(raw);
    const out = outFile(`script-${slug(idea)}-${stamp()}.txt`);
    fs.writeFileSync(out, text, "utf8");
    return { text, path: out, format: fmt };
  });
}

// ============================================================================
// TOOL 2 - Voice-over (Supertonic 3). Multi-voice conversations + label stripping.
// ============================================================================
const TTS_SAMPLE_RATE = 44100;
const TTS_LANGUAGES_FALLBACK = ["en", "ko", "ja", "ar", "bg", "cs", "da", "de", "el", "es", "et", "fi", "fr", "hi", "hr", "hu", "id", "it", "lt", "lv", "nl", "pl", "pt", "ro", "ru", "sk", "sl", "sv", "tr", "uk", "vi"];
function detectTtsLanguages() {
  try {
    const dist = path.dirname(require.resolve("@qvac/sdk"));
    const src = fs.readFileSync(path.join(dist, "schemas", "text-to-speech.js"), "utf8");
    let best = [];
    for (const m of src.matchAll(/\[([^[\]]{40,})\]/g)) { const codes = [...m[1].matchAll(/['"]([a-z]{2,3})['"]/g)].map((x) => x[1]); if (codes.length > best.length && codes.length >= 10) best = codes; }
    if (best.length >= 10) return best;
  } catch { /* */ }
  return TTS_LANGUAGES_FALLBACK;
}
const TTS_LANGUAGES = detectTtsLanguages();
const TTS_VOICES = ["F1", "M1", "F2", "M2", "F3", "M3"]; // all verified against the installed Supertonic 3

// Structural labels a creator's script carries that must NOT be spoken (the user's bug: the VO read
// "body" and "outro"). Stripped from the START of a line.
const STRUCT_LABEL = /^\s*(hook|intro|introduction|body|outro|conclusion|cta|call\s*to\s*action|beat\s*\d*|scene\s*\d*|part\s*\d*|section\s*\d*|shot\s*\d*|voiceover|vo|narration|narrator)\s*[:\-]\s*/i;
// A speaker label ("Alice:", "Bob (quietly):") starting a line of dialogue.
const SPEAKER_RE = /^\s*([A-Za-z][A-Za-z0-9 ._'-]{0,24})\s*(?:\([^)]*\))?\s*:\s*(.*)$/;
function cleanSpoken(s) { return String(s).replace(/\[[^\]]*\]/g, " ").replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim(); }
// Parse text into speaker turns, stripping structural labels. Lines with no speaker inherit the last.
function parseScript(text) {
  const turns = [];
  let cur = null;
  for (const rawLine of String(text || "").split(/\r?\n+/)) {
    let line = rawLine.trim(); if (!line) continue;
    if (STRUCT_LABEL.test(line)) line = line.replace(STRUCT_LABEL, "").trim(); // "HOOK: text" -> "text"
    if (!line) continue;
    let speaker = cur;
    const sm = line.match(SPEAKER_RE);
    if (sm && /^[A-Za-z]/.test(sm[1]) && !STRUCT_LABEL.test(sm[1] + ":")) { speaker = sm[1].trim(); line = sm[2].trim(); cur = speaker; }
    line = cleanSpoken(line);
    if (line) turns.push({ speaker: speaker || "Narrator", text: line });
  }
  return turns;
}
async function synthTurn(q, language, voice, speed, text, onEvent) {
  const modelId = await ensureModel("voice", `st3-${language}-${voice}-${speed}`,
    { modelSrc: q.TTS_MULTILINGUAL_SUPERTONIC3_Q8_0, modelConfig: { ttsEngine: "supertonic", language, voice, ttsSpeed: Number(speed) || 1.0, ttsNumInferenceSteps: 5 } },
    (p) => onEvent({ phase: "download", ...p }));
  const res = q.textToSpeech({ modelId, text, inputType: "text", stream: false });
  return res.buffer; // Int16 samples
}

// ---- Expressive voice-over: MOSS-TTSD (OpenMOSS), the whole dialogue in one pass ----
// Supertonic reads every line in the same neutral tone. MOSS-TTSD performs a conversation: up to five speakers tagged [S1] to
// [S5], generated together so the replies answer each other. Measured on a 5-line two-speaker
// script: 0% word errors (checked by transcription), 18 to 23 s of speech, ~13 s to generate after a ~10 s load.
// Voices: each speaker clones a short reference clip that Supertonic speaks in the voice picked in
// the cast, so the cast picker still decides who sounds like whom. The backbone (16.7 GB) is not in
// the SDK registry: it is read from the QVAC cache, where the OpenMOSS demos put it.
const MOSS_RATE = 24000;
const MOSS_LANGS = ["en", "zh", "es", "fr", "de", "ja", "pt", "it", "ko", "ru", "ar", "hi", "nl", "pl", "tr", "cs", "da", "fi", "el", "hu", "ro", "sv", "vi"];
// What each reference clip says, per language. The text before the dialogue repeats it under its
// speaker tag, which is how MOSS-TTSD knows which recording is which voice.
// A plain statement, nothing a dialogue line would start with: a greeting reference ("Hey, I just
// got here...") made the model jump into it on a line starting "Hey," and loop.
const REF_TEXT = {
  en: "The library on Fourth Street opens at nine, and the coffee there is better than you would think.",
  fr: "La bibliothèque de la rue Pasteur ouvre à neuf heures, et le café y est meilleur qu'on ne le croit.",
  es: "La biblioteca de la calle Mayor abre a las nueve, y el café allí es mejor de lo que parece.",
  de: "Die Bibliothek in der Lindenstraße öffnet um neun, und der Kaffee dort ist besser, als man denkt.",
  it: "La biblioteca di via Roma apre alle nove, e il caffè lì è più buono di quanto si pensi.",
  pt: "A biblioteca da rua Augusta abre às nove, e o café de lá é melhor do que parece.",
  nl: "De bibliotheek in de Dorpsstraat gaat om negen uur open, en de koffie daar is beter dan je denkt.",
};
const EXPRESSIVE_LANGS = MOSS_LANGS.filter((l) => REF_TEXT[l] && TTS_LANGUAGES.includes(l));
// Not in the SDK's model constants (0.23), but in the QVAC Registry: the app downloads it by registry
// path on first use, and the SDK caches it as <sha256(path)[:16]>_moss-ttsd-f16.gguf.
const TTSD = { file: "moss-ttsd-f16.gguf", bytes: 16716943744, src: "registry://s3/qvac_models_compiled/ggml/openmoss/2026-10-01/moss-ttsd-f16.gguf" };
function ttsdPath() {
  const dirs = [path.join(os.homedir(), ".qvac", "models", "openmoss"), path.join(modelsFolder(), "openmoss"), DEFAULT_MODELS, modelsFolder()];
  for (const d of dirs) {
    let names = [];
    try { names = fs.readdirSync(d); } catch { continue; }
    for (const n of names) {
      if (n !== TTSD.file && !n.endsWith("_" + TTSD.file)) continue;
      try { if (fs.statSync(path.join(d, n)).size === TTSD.bytes) return path.join(d, n); } catch { /* */ }
    }
  }
  return null;
}
// Always offered: the first expressive take downloads MOSS-TTSD (16.7 GB) and its codec (3.6 GB).
function expressiveStatus() {
  return { available: true, languages: EXPRESSIVE_LANGS, maxSpeakers: 5, downloaded: !!ttsdPath(), downloadGB: 20 };
}
async function ensureTtsd(q, onEvent) {
  const have = ttsdPath();
  if (have) return have;
  const report = (p) => {
    const total = p.total || TTSD.bytes, downloaded = p.downloaded || 0;
    onEvent({ phase: "download", label: "MOSS-TTSD", downloaded, total, percentage: (downloaded / total) * 100 });
  };
  report({ downloaded: 0 });
  await q.downloadAsset({ assetSrc: TTSD.src, onProgress: report });
  const got = ttsdPath();
  if (!got) throw new Error("The MOSS-TTSD download did not arrive complete. Try again.");
  return got;
}
// A 24 kHz reference clip of one preset voice, made once with Supertonic and kept.
async function referenceClip(q, language, voice, onEvent) {
  const dir = ensureDir(path.join(CONFIG_DIR, "voices"));
  const tag = crypto.createHash("sha256").update(REF_TEXT[language]).digest("hex").slice(0, 8);
  const out = path.join(dir, `${language}-${voice}-${tag}-24k.wav`);
  if (fs.existsSync(out)) return out;
  onEvent({ phase: "loading", label: `the ${voice} voice` });
  const buf = await synthTurn(q, language, voice, 1.0, REF_TEXT[language], onEvent);
  const tmp = path.join(os.tmpdir(), `ctk-ref-${process.pid}-${voice}.wav`);
  writeWav(buf, TTS_SAMPLE_RATE, tmp);
  try { await toWavRate(tmp, out, MOSS_RATE); } finally { try { fs.unlinkSync(tmp); } catch { /* */ } }
  return out;
}
// Where each line starts and ends in the one-pass take: the quiet gaps between turns, matched in
// order to where the text says each turn should end (by character count).
function turnTimes(samples, rate, turns) {
  const hop = Math.round(rate * 0.02), frames = [];
  for (let i = 0; i + hop <= samples.length; i += hop) { let e = 0; for (let k = i; k < i + hop; k++) e += samples[k] * samples[k]; frames.push(Math.sqrt(e / hop)); }
  const loud = frames.slice().sort((a, b) => a - b)[Math.floor(frames.length * 0.95)] || 1;
  const quiet = frames.map((v) => v < loud * 0.05);
  const gaps = []; // centre of every quiet run of 150 ms or more, in seconds
  for (let i = 0; i < quiet.length;) {
    if (!quiet[i]) { i++; continue; }
    let j = i; while (j < quiet.length && quiet[j]) j++;
    if ((j - i) * 0.02 >= 0.15) gaps.push(((i + j) / 2) * 0.02);
    i = j;
  }
  const total = samples.length / rate, chars = turns.map((t) => t.text.length), sum = chars.reduce((a, b) => a + b, 0);
  const cuts = []; let acc = 0, from = 0;
  for (let k = 0; k < turns.length - 1; k++) {
    acc += chars[k]; const want = (acc / sum) * total;
    let best = -1;
    for (let g = from; g < gaps.length; g++) if (best < 0 || Math.abs(gaps[g] - want) < Math.abs(gaps[best] - want)) best = g;
    if (best < 0 || gaps.length - best < turns.length - 1 - k) { cuts.push(want); continue; }
    cuts.push(gaps[best]); from = best + 1;
  }
  const edges = [0, ...cuts, total];
  return turns.map((_, k) => ({ start: edges[k], end: edges[k + 1] }));
}
let mossRequestId = null;
async function performDialogue(q, { turns, speakers, voiceOf, language, seed }, onEvent) {
  // A take that runs well past what the text needs is looping: stop it (about 11 characters a
  // second measured, so this leaves 60% plus 4 s of slack).
  const maxSamples = Math.round((turns.reduce((n, t) => n + t.text.length, 0) / 11 * 1.6 + 4) * MOSS_RATE);
  const refs = [];
  for (const sp of speakers) refs.push(await referenceClip(q, language, voiceOf(sp), onEvent));
  // MOSS-TTSD with its codec is ~20 GB: free the other big resident model (music) first.
  if (loaded.music) { try { await q.unloadModel({ modelId: loaded.music.modelId, clearStorage: false }); } catch { /* */ } loaded.music = null; }
  const ttsd = await ensureTtsd(q, onEvent);
  onEvent({ phase: "loading", label: "MOSS-TTSD" });
  const modelId = await ensureModel("voiceMoss", `ttsd-${language}-${seed}-${refs.join("|")}`, {
    modelSrc: ttsd, modelType: "tts-ggml",
    modelConfig: { ttsEngine: "moss", language, mossCodecDecoderModelSrc: q.TTS_CODEC_DECODER_MOSS_TTS_F16, mossCodecEncoderModelSrc: q.TTS_CODEC_ENCODER_MOSS_TTS_F16,
      dialogueReferenceSrcs: refs, streamChunkTokens: 25, useGPU: true, seed },
  }, (p) => onEvent({ phase: "download", ...p }));
  const tag = (sp) => `[S${speakers.indexOf(sp) + 1}]`;
  const text = speakers.map((sp) => `${tag(sp)} ${REF_TEXT[language]}`).join(" ") + " " + turns.map((t) => `${tag(t.speaker)} ${t.text}`).join(" ");
  onEvent({ phase: "performing", seconds: 0 });
  // MOSS-TTSD can keep going in silence after the last line, or stay silent: stop 5 s after the
  // last speech, give up after 8 s with none .
  mossRequestId = crypto.randomUUID();
  const run = q.textToSpeech({ modelId, requestId: mossRequestId, text, stream: true });
  const all = []; let lastSpeech = -1, loudest = 0, win = 0, winN = 0, stopped = false, nextTick = MOSS_RATE;
  const stop = () => { if (!stopped) { stopped = true; q.cancel({ requestId: mossRequestId }).catch(() => {}); } };
  try {
    for await (const smp of run.bufferStream) {
      all.push(smp); win += smp * smp;
      if (++winN === MOSS_RATE / 10) {
        const rms = Math.sqrt(win / winN); loudest = Math.max(loudest, rms);
        if (rms > 150 && rms > loudest * 0.1) lastSpeech = all.length;
        win = 0; winN = 0;
        if (lastSpeech >= 0 && all.length - lastSpeech >= 5 * MOSS_RATE) stop();
        if (lastSpeech < 0 && all.length >= 8 * MOSS_RATE) stop();
        if (all.length >= maxSamples) stop();
      }
      if (all.length >= nextTick) { nextTick += MOSS_RATE; onEvent({ phase: "performing", seconds: Math.round(all.length / MOSS_RATE) }); }
    }
  } finally { mossRequestId = null; }
  if (lastSpeech < 0) return null;
  const end = Math.min(all.length, lastSpeech + Math.round(0.4 * MOSS_RATE));
  const out = Int16Array.from(all.slice(0, end));
  const fade = Math.min(out.length, Math.round(0.03 * MOSS_RATE)); // 30 ms, so the cut does not click
  for (let i = 0; i < fade; i++) out[out.length - fade + i] = Math.round(out[out.length - fade + i] * (1 - i / fade));
  return out;
}

// Does the take say the script, once, in order? MOSS-TTSD sometimes skips a line, says its
// reference line or starts over (seen: lines 1 to 3, the reference, lines 1 to 3 again).
// TranscribePsy (the model the Subtitles tool uses, so it stays warm) transcribes the take, and the
// words are compared with the script's: word errors and extra words must both stay under 20%.
// Its eight languages cover every expressive language.
const words = (t) => String(t).toLowerCase().replace(/[’']/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, " ").split(/\s+/).filter(Boolean);
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
async function checkTake(q, samples, turns, language, onEvent) {
  onEvent({ phase: "checking" });
  const stamp24 = path.join(os.tmpdir(), `ctk-take-${process.pid}-${Date.now()}.wav`), stamp16 = stamp24.replace(".wav", "-16k.wav");
  writeWav(samples, MOSS_RATE, stamp24);
  try {
    await toWavRate(stamp24, stamp16, 16000);
    const modelId = await sttModel(q, onEvent);
    const r = await q.transcribe({ modelId, audioChunk: stamp16 });
    const heard = words(typeof r === "string" ? r : (r && r.text) || (Array.isArray(r) ? r.map((x) => x.text).join(" ") : ""));
    const said = words(turns.map((t) => t.text).join(" "));
    const wer = editDistance(said, heard) / Math.max(1, said.length);
    const extra = Math.max(0, heard.length - said.length) / Math.max(1, said.length);
    return { ok: wer <= 0.2 && extra <= 0.2, wer, extra };
  } finally { for (const f of [stamp24, stamp16]) { try { fs.unlinkSync(f); } catch { /* */ } } }
}
// text can be a plain script (single Narrator, labels stripped) or a multi-speaker conversation.
// voiceMap maps speaker -> voice; unmapped speakers get a rotating voice. mode: "single" | "separate".
async function voiceOver({ text, language = "en", voiceMap = {}, defaultVoice = "F1", speed = 1.0, mode = "single", outDir, title = "", engine = "supertonic", seed = 2026 } = {}, onEvent = () => {}) {
  return serialize(async () => {
    const q = await sdk();
    const turns = parseScript(text);
    if (!turns.length) throw new Error("Nothing to narrate once the section labels are removed.");
    const dir = ensureDir(expandHome(outDir) || outputFolder());
    const speakers = [...new Set(turns.map((t) => t.speaker))];
    const voiceOf = (sp) => voiceMap[sp] || (speakers.length > 1 ? TTS_VOICES[speakers.indexOf(sp) % TTS_VOICES.length] : defaultVoice);
    let take = null, fellBack = false;
    if (engine === "moss" && expressiveStatus().available && EXPRESSIVE_LANGS.includes(language) && speakers.length <= 5) {
      // Up to three seeds; the first take that says the script once, in order, wins. If none does,
      // the Fast voices read it instead: a wrong take is worse than a flat one.
      let verdict = null;
      for (let k = 0; k < 3 && !take; k++) {
        const t = await performDialogue(q, { turns, speakers, voiceOf, language, seed: seed + k }, onEvent);
        if (!t) continue;
        verdict = await checkTake(q, t, turns, language, onEvent);
        if (verdict.ok) take = t;
        else onEvent({ phase: "retrying", attempt: k + 2, wer: Math.round(verdict.wer * 100) });
      }
      fellBack = !take;
    }
    if (take) {
      const times = turnTimes(take, MOSS_RATE, turns);
      const files = [];
      if (mode === "separate") {
        turns.forEach((t, i) => {
          const a = Math.round(times[i].start * MOSS_RATE), b = Math.round(times[i].end * MOSS_RATE);
          const out = path.join(dir, `vo-${String(i + 1).padStart(2, "0")}-${slug(t.speaker)}-${stamp()}.wav`);
          writeWav(take.subarray(a, b), MOSS_RATE, out); files.push({ path: out, speaker: t.speaker, voice: voiceOf(t.speaker), seconds: (b - a) / MOSS_RATE });
        });
      } else {
        const out = path.join(dir, `voiceover-${slug(title) || "narration"}-${stamp()}.wav`);
        writeWav(take, MOSS_RATE, out); files.push({ path: out, seconds: take.length / MOSS_RATE });
      }
      return { files, mode, engine: "moss", turns: turns.map((t, i) => ({ speaker: t.speaker, voice: voiceOf(t.speaker), text: t.text, ...times[i] })) };
    }
    const files = [];
    const gap = new Int16Array(Math.round(TTS_SAMPLE_RATE * 0.3)); // 300 ms between turns
    const parts = [];
    const times = []; let cursor = 0; // where each turn starts in the single track (seconds)
    for (let i = 0; i < turns.length; i++) {
      const t = turns[i]; const voice = voiceOf(t.speaker);
      onEvent({ phase: "synthesizing", label: `${i + 1}/${turns.length}  ${t.speaker} (${voice})`, i: i + 1, n: turns.length, speaker: t.speaker });
      const buf = await synthTurn(q, language, voice, speed, t.text, onEvent);
      const secs = buf.length / TTS_SAMPLE_RATE; times.push({ start: cursor, end: cursor + secs }); cursor += secs + 0.3;
      if (mode === "separate") {
        const out = path.join(dir, `vo-${String(i + 1).padStart(2, "0")}-${slug(t.speaker)}-${stamp()}.wav`);
        writeWav(buf, TTS_SAMPLE_RATE, out); files.push({ path: out, speaker: t.speaker, voice, seconds: buf.length / TTS_SAMPLE_RATE });
      } else { parts.push(buf); if (i < turns.length - 1) parts.push(gap); }
    }
    if (mode !== "separate") {
      const total = parts.reduce((n, b) => n + b.length, 0);
      const merged = new Int16Array(total); let off = 0; for (const b of parts) { merged.set(b, off); off += b.length; }
      const out = path.join(dir, `voiceover-${slug(title) || "narration"}-${stamp()}.wav`);
      writeWav(merged, TTS_SAMPLE_RATE, out); files.push({ path: out, seconds: merged.length / TTS_SAMPLE_RATE });
    }
    return { files, mode, engine: "supertonic", fellBack, turns: turns.map((t, i) => ({ speaker: t.speaker, voice: voiceOf(t.speaker), text: t.text, ...times[i] })) };
  });
}

// Hear a voice before choosing it: synthesize a short line and return the WAV bytes (in memory).
const SAMPLE_TEXT = { en: "Here is how this voice sounds.", fr: "Voici comment cette voix sonne.", es: "Asi suena esta voz.", de: "So klingt diese Stimme.", it: "Ecco come suona questa voce.", pt: "E assim que esta voz soa.", nl: "Zo klinkt deze stem.", pl: "Tak brzmi ten glos.", ru: "Vot kak zvuchit etot golos.", ja: "これがこの声の音です。", ko: "이 목소리는 이렇게 들려요.", zh: "这是这个声音的样子。" };
async function voiceSample({ language = "en", voice = "F1" } = {}) {
  return serialize(async () => {
    const q = await sdk();
    const buf = await synthTurn(q, language, voice, 1.0, SAMPLE_TEXT[language] || SAMPLE_TEXT.en, () => {});
    return wavBytes(buf, TTS_SAMPLE_RATE); // Buffer (full WAV) for immediate playback
  });
}

// ============================================================================
// TOOL 3 - Subtitles (TranscribePsy -> timed cues; export SRT or VTT)
// ============================================================================
// TranscribePsy (QVAC's own speech model, 254M, SDK registry since 0.23) reads Dutch, English,
// French, German, Italian, Polish, Portuguese and Spanish and finds the language itself. It returns
// one segment per call, so the audio is cut at its pauses first and each piece is transcribed alone:
// the pieces give the captions their timing.
const TPSY_LANGS = ["en", "fr", "de", "es", "it", "pt", "nl", "pl"];
async function sttModel(q, onEvent) {
  onEvent({ phase: "loading", label: "TranscribePsy" });
  return ensureModel("subs", "transcribepsy", { modelSrc: q.PARAKEET_TRANSCRIBEPSY_250M_Q8_0, modelType: "parakeet-transcription", modelConfig: { useGPU: true } }, (p) => onEvent({ phase: "download", ...p }));
}
// Speech pieces of 1 to 12 s, cut at pauses: a pause of 0.4 s or more ends a piece once it is 2 s
// long, any pause ends it past 7 s, and a run with no pause at all is split evenly past 12 s.
function speechPieces({ quiet, duration }) {
  const speech = []; let t = 0;
  for (const q of quiet) { if (q.start - t > 0.05) speech.push({ start: t, end: q.start, gapAfter: q.end - q.start }); t = q.end; }
  if (duration - t > 0.05) speech.push({ start: t, end: duration, gapAfter: 0 });
  const out = []; let cur = null;
  for (const s of speech) {
    if (!cur) cur = { start: s.start, end: s.end };
    else cur.end = s.end;
    const len = cur.end - cur.start;
    if ((len >= 2 && s.gapAfter >= 0.4) || len >= 7 || s === speech[speech.length - 1]) { out.push(cur); cur = null; }
  }
  return out.flatMap((p) => {
    const n = Math.ceil((p.end - p.start) / 12);
    return Array.from({ length: n }, (_, i) => ({ start: p.start + ((p.end - p.start) * i) / n, end: p.start + ((p.end - p.start) * (i + 1)) / n }));
  });
}
// The words come from one pass over the whole file: a piece cut mid-sentence loses words and gains a
// full stop ("using a day-to-day basis." for "using on a day-to-day basis our concerns"). The pieces
// only say how many words fall where, and the whole transcript is shared out in that proportion.
const asText = (r) => (Array.isArray(r) ? r.map((x) => x.text).join(" ") : (r && r.text) || String(r || "")).trim();
async function transcribePieces(q, modelId, wavPath, onEvent) {
  const all = asText(await q.transcribe({ modelId, audioChunk: wavPath, metadata: true })).split(/\s+/).filter(Boolean);
  const pieces = speechPieces(await silences(wavPath));
  const pieceWords = [];
  for (const [i, p] of pieces.entries()) {
    onEvent({ phase: "transcribing", done: i, total: pieces.length });
    const piece = wavPath.replace(".wav", `-p${i}.wav`);
    await toWavRate(wavPath, piece, 16000, `atrim=start=${p.start.toFixed(3)}:end=${p.end.toFixed(3)}`);
    try { pieceWords.push(asText(await q.transcribe({ modelId, audioChunk: piece, metadata: true })).split(/\s+/).filter(Boolean)); }
    finally { try { fs.unlinkSync(piece); } catch { /* */ } }
  }
  const heard = pieceWords.reduce((a, w) => a + w.length, 0);
  if (!all.length || !heard) return [];
  // Each piece ends after its own last word: look for that word within 4 places of where the counts
  // put the boundary (a piece cut mid-sentence can drop or add a word), else trust the counts.
  const norm = (w) => String(w).toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
  const segs = []; let from = 0, acc = 0;
  for (const [i, p] of pieces.entries()) {
    acc += pieceWords[i].length;
    let to = i === pieces.length - 1 ? all.length : Math.round((acc / heard) * all.length);
    const last = norm(pieceWords[i][pieceWords[i].length - 1] || "");
    if (i < pieces.length - 1 && last) {
      let best = -1;
      for (let j = Math.max(from + 1, to - 4); j <= Math.min(all.length, to + 4); j++) if (norm(all[j - 1]) === last && (best < 0 || Math.abs(j - to) < Math.abs(best - to))) best = j;
      if (best > 0) to = best;
    }
    if (to > from) segs.push({ startMs: p.start * 1000, endMs: p.end * 1000, text: all.slice(from, to).join(" ") });
    from = Math.max(from, to);
  }
  return segs;
}
// Sorted, de-overlapped cues (a player double-lines two cues that overlap).
function cues(segments) {
  const rows = (segments || []).map((s) => ({ start: Math.max(0, s.startMs | 0), end: Math.max(0, s.endMs | 0), text: String(s.text || "").trim() }))
    .filter((s) => s.text && s.end > s.start).sort((a, b) => a.start - b.start);
  for (let i = 0; i < rows.length - 1; i++) if (rows[i].end > rows[i + 1].start) rows[i].end = rows[i + 1].start;
  return reflow(rows);
}
// Re-flow the words into captions of at most 42 characters (one line, the broadcast norm) that end
// where the speech does: at a sentence end, a comma once the line is long enough, or a
// pause. A word's time is its share of its segment, by length. A sentence under 10 characters
// ("Watch.") rides with the next one rather than flashing up alone.
function reflow(rows, max = 42) {
  const words = [];
  for (const r of rows) {
    const ws = r.text.split(/\s+/).filter(Boolean), total = ws.reduce((a, w) => a + w.length + 1, 0);
    let t = r.start;
    for (const w of ws) { const d = ((r.end - r.start) * (w.length + 1)) / total; words.push({ w, start: t, end: t + d }); t += d; }
  }
  const out = []; let cur = [];
  const size = (list) => list.reduce((a, x) => a + x.w.length + 1, 0) - 1;
  const flush = () => { if (cur.length) out.push({ start: Math.round(cur[0].start), end: Math.round(cur[cur.length - 1].end), text: cur.map((x) => x.w).join(" ") }); cur = []; };
  for (const x of words) {
    const pause = cur.length && x.start - cur[cur.length - 1].end > 600;
    if (cur.length && (pause || size([...cur, x]) > max)) {
      // never leave "and" or "the" hanging at the end of a line: it moves down with its phrase
      const carry = !pause && cur.length > 3 && /^(and|or|but|a|an|the|to|of|in|on|at|my|your|our|for|with|that)$/i.test(cur[cur.length - 1].w) ? [cur.pop()] : [];
      flush(); cur = carry;
    }
    cur.push(x);
    const n = size(cur);
    if ((/[.?!\u2026]["')\]]?$/.test(x.w) && n >= 10) || (/[,;:]$/.test(x.w) && n >= 24)) flush();
  }
  flush();
  return out;
}
function tc(ms, sep) { const t = Math.max(0, ms | 0); const p = (n, w) => String(n).padStart(w, "0"); return `${p(Math.floor(t / 3600000), 2)}:${p(Math.floor((t % 3600000) / 60000), 2)}:${p(Math.floor((t % 60000) / 1000), 2)}${sep}${p(t % 1000, 3)}`; }
function buildSrt(segments) { const r = cues(segments); return r.map((s, i) => `${i + 1}\r\n${tc(s.start, ",")} --> ${tc(s.end, ",")}\r\n${s.text}`).join("\r\n\r\n") + "\r\n"; }
function buildVtt(segments) { const r = cues(segments); return "WEBVTT\n\n" + r.map((s) => `${tc(s.start, ".")} --> ${tc(s.end, ".")}\n${s.text}`).join("\n\n") + "\n"; }

async function subtitles({ inputPath } = {}, onEvent = () => {}) {
  return serialize(async () => {
    const q = await sdk();
    if (!inputPath || !fs.existsSync(inputPath)) throw new Error("No input file.");
    onEvent({ phase: "extracting" });
    const wavPath = path.join(os.tmpdir(), `ctk-stt-${Date.now()}.wav`);
    await toWav16k(inputPath, wavPath);
    const modelId = await sttModel(q, onEvent);
    onEvent({ phase: "transcribing" });
    let segments;
    try { segments = await transcribePieces(q, modelId, wavPath, onEvent); }
    finally { try { fs.unlinkSync(wavPath); } catch { /* */ } }
    const srt = buildSrt(segments), vtt = buildVtt(segments);
    const base = slug(path.basename(inputPath).replace(/\.[^.]+$/, ""));
    const out = outFile(`${base}.srt`); fs.writeFileSync(out, srt, "utf8"); // default save as SRT
    return { path: out, srt, vtt, base, count: cues(segments).length, engine: "TranscribePsy" };
  });
}

// ============================================================================
// TOOL 4 - Background music (AudioGen / ACE-Step 1.5)
// ============================================================================
// Load-bearing facts, measured rather than assumed on an M-series laptop:
//  - ACE-Step is a FOUR-model set: text encoder + planner LM + DiT + VAE, all passed at load.
//  - Two qualities. Draft = turbo Q4 DiT (8 steps) + 0.6B planner: 45 s of music in ~8 s.
//    Studio = sft Q8 DiT (50 steps, the authors' quality reference) + the 4B planner from Hugging Face
//    when it is on disk: 45 s in ~37 s on an M-series laptop. The planner writes the composition, so
//    the bigger one is what cuts the 5 to 7 s loops (loop score 0.63 -> 0.43 in our tests).
//  - Sections described in `lyrics` ("[Bridge - drums drop out, piano only]") make an instrumental
//    develop: chroma repetition at the best lag 0.76/0.79 with "[Instrumental]" vs 0.45/0.24 with
//    described sections (same caption, seeds, studio config). The renderer writes them per preset.
//  - ACE-Step ends early and pads with a low rumble, worst on short lengths, so the engine is asked
//    for more (askFor) and shapeTail() trims the rumble and caps the take with a fade.
const MUSIC_QUALITY = {
  draft: { label: "Draft", dit: "AUDIOGEN_ACESTEP_V15_TURBO_Q4_K_M", lm: "AUDIOGEN_ACESTEP_5HZ_LM_0_6B_Q8_0", steps: 8, rtf: 0.2 },
  studio: { label: "Studio", dit: "AUDIOGEN_ACESTEP_V15_SFT_Q8_0", lm: "AUDIOGEN_ACESTEP_5HZ_LM_0_6B_Q8_0", bigPlanner: true, rtf: 0.85 },
};
const MUSIC_PARTS = { textEncModelSrc: "AUDIOGEN_QWEN3_EMBEDDING_0_6B_Q8_0", vaeModelSrc: "AUDIOGEN_VAE_BF16" };
// Not in the QVAC registry: Serveurperso/ACE-Step-1.5-GGUF (MIT), same engine. Exact size, so a
// half-finished download is never loaded.
const PLANNER_4B = { file: "acestep-5Hz-lm-4B-Q8_0.gguf", bytes: 4457323648 };
function bigPlanner() {
  for (const d of [path.join(modelsFolder(), "acestep-hf"), path.join(DEFAULT_MODELS, "acestep-hf"), modelsFolder(), DEFAULT_MODELS]) {
    const f = path.join(d, PLANNER_4B.file);
    try { if (fs.statSync(f).size === PLANNER_4B.bytes) return f; } catch { /* not there */ }
  }
  return null;
}
// Over-ask: x1.5 up to 15 s, easing to x1.05 from 90 s.
function askFor(sec) { const f = sec <= 15 ? 1.5 : sec >= 90 ? 1.05 : 1.5 - 0.45 * (sec - 15) / 75; return Math.min(600, Math.round(sec * f)); }

function musicStatus() {
  // Feature-detect rather than trusting a version string.
  try {
    const q = _sdk;
    if (!q) return { available: null, reason: "Checking the installed SDK" };
    const ok = typeof q.audioGen === "function" && q[MUSIC_QUALITY.draft.dit] && q[MUSIC_QUALITY.studio.dit] && q[MUSIC_QUALITY.draft.lm];
    if (!ok) return { available: false, reason: "This QVAC SDK build has no AudioGen. Music needs SDK 0.17 or newer." };
    const big = bigPlanner();
    return { available: true, planner: big ? "4B" : "0.6B", quality: Object.fromEntries(Object.entries(MUSIC_QUALITY).map(([k, v]) => [k, { label: v.label, rtf: v.rtf }])) };
  } catch { return { available: false, reason: "Could not read the installed SDK." }; }
}
async function musicStatusAsync() {
  try { await sdk(); } catch (e) { return { available: false, reason: "The QVAC SDK failed to load: " + ((e && e.message) || e) }; }
  return musicStatus();
}

let musicRequestId = null;
async function cancelMusic() {
  if (!musicRequestId) return false;
  try { const q = await sdk(); await q.cancel({ requestId: musicRequestId }); return true; } catch { return false; }
}

async function makeMusic({ caption, lyrics = "", duration = 30, bpm, seed, quality = "studio", outDir, title = "" } = {}, onEvent = () => {}) {
  return serialize(async () => {
    const q = await sdk();
    if (typeof q.audioGen !== "function") throw new Error("This QVAC SDK build has no AudioGen (needs 0.17 or newer).");
    const text = String(caption || "").trim();
    if (!text) throw new Error("Pick a style first.");

    const Q = MUSIC_QUALITY[quality] || MUSIC_QUALITY.studio;
    const srcOf = (name) => { const c = q[name]; if (!c || !c.src) throw new Error(`This SDK build is missing ${name}.`); return c.src; };
    const big = Q.bigPlanner ? bigPlanner() : null;
    const lmSrc = big || srcOf(Q.lm);
    const modelConfig = { textEncModelSrc: srcOf(MUSIC_PARTS.textEncModelSrc), lmModelSrc: lmSrc, ditModelSrc: srcOf(Q.dit), vaeModelSrc: srcOf(MUSIC_PARTS.vaeModelSrc), useGPU: true };
    if (Q.steps) modelConfig.inferenceSteps = Q.steps;
    // The expressive voice model is ~20 GB: free it before the music model loads (~8 GB for Studio).
    if (loaded.voiceMoss) { try { await q.unloadModel({ modelId: loaded.voiceMoss.modelId, clearStorage: false }); } catch { /* */ } loaded.voiceMoss = null; }
    onEvent({ phase: "loading", label: `${Q.label} music model` });
    const modelId = await ensureModel("music", `${quality}:${lmSrc}`, { modelType: "audiogen", modelConfig },
      (p) => { if (p && p.percentage != null) onEvent({ phase: "downloading", pct: p.percentage, downloaded: p.downloaded, total: p.total }); });

    const asked = Math.max(5, Math.round(duration));
    const usedSeed = Number.isInteger(seed) ? seed : Math.floor(Math.random() * 1e9);
    const params = { modelId, caption: text, lyrics: String(lyrics || "").trim() || "[Instrumental]", duration: askFor(asked), seed: usedSeed };
    if (Number.isFinite(bpm) && bpm > 0) params.bpm = Math.round(bpm);

    const t0 = Date.now();
    const run = q.audioGen(params);
    musicRequestId = run.requestId;
    try {
      for await (const p of run.progressStream) onEvent({ phase: "generating", stage: p.stage, step: p.step, total: p.total });
      const audio = await run.audio;
      const stats = (await run.stats) || {};
      const fmt = { sampleRate: audio.sampleRate || 48000, channels: audio.channels || 2, bitsPerSample: audio.bitsPerSample || 16 };

      const { pcm, trimmedSec, seconds } = shapeTail(audio.pcm, fmt, asked);
      const level = levelDb(pcm, fmt, 0, Infinity, fmt.sampleRate);
      if (!(level > -60)) throw new Error("That take came back silent. Try another take.");

      const name = `music-${slug(title) || "track"}-${stamp()}.wav`;
      const out = outFile(name, expandHome(outDir));
      fs.writeFileSync(out, pcmWavBytes(pcm, fmt));
      return {
        path: out, seconds: Math.round(seconds * 10) / 10, trimmedSec: Math.round(trimmedSec * 10) / 10,
        levelDb: Math.round(level * 10) / 10, seed: usedSeed, bpm: params.bpm || null,
        caption: text, lyrics: params.lyrics, quality, qualityLabel: Q.label, planner: big ? "4B" : "0.6B",
        tookMs: Date.now() - t0,
        realTimeFactor: stats.realTimeFactor != null ? Math.round(stats.realTimeFactor * 100) / 100 : null,
        sampleRate: fmt.sampleRate, channels: fmt.channels,
      };
    } finally { musicRequestId = null; }
  });
}

module.exports = {
  unloadTool, unloadAll,
  writeScript, voiceOver, voiceSample, cancelVoice: async () => { if (!mossRequestId) return false; try { const q = await sdk(); await q.cancel({ requestId: mossRequestId }); return true; } catch { return false; } }, subtitles, musicStatus, musicStatusAsync, makeMusic, cancelMusic,
  scanModelsFolder, parseScript,
  outputFolder, modelsFolder, setOutputFolder, setModelsFolder, ensureDir, expandHome,
  meta: () => ({ LLM_MODELS, TTS_LANGUAGES, TTS_VOICES, TPSY_LANGS, expressive: expressiveStatus(), home: os.homedir(), outputFolder: outputFolder(), modelsFolder: modelsFolder(), music: musicStatus() }),
  _test: { buildSrt, buildVtt, stripThinking, parseScript, checkTake: async (samples, turns, language = "en") => serialize(async () => checkTake(await sdk(), samples, turns, language, () => {})) },
};
