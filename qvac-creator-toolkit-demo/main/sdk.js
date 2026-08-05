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
const { writeWav, wavBytes, toWav16k } = require("./wav.js");

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
async function unloadTool(tool) { // unloading is a worker op too -> serialize it (review P1)
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
function outputFolder() { return readConfig().outputFolder || DEFAULT_OUT; }
function modelsFolder() { return readConfig().modelsFolder || DEFAULT_MODELS; }
function setOutputFolder(dir) { if (dir) writeConfig({ outputFolder: dir }); return outputFolder(); }
function setModelsFolder(dir) { if (dir) writeConfig({ modelsFolder: dir }); return modelsFolder(); }

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
const NOT_LLM = /mmproj|projection|embed|whisper|supertonic|parakeet|chatterbox|silero|clip|siglip|vae/i;
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
// A speaker label ("Alice:", "Bob (whisper):") starting a line of dialogue.
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
// text can be a plain script (single Narrator, labels stripped) or a multi-speaker conversation.
// voiceMap maps speaker -> voice; unmapped speakers get a rotating voice. mode: "single" | "separate".
async function voiceOver({ text, language = "en", voiceMap = {}, defaultVoice = "F1", speed = 1.0, mode = "single", outDir, title = "" } = {}, onEvent = () => {}) {
  return serialize(async () => {
    const q = await sdk();
    const turns = parseScript(text);
    if (!turns.length) throw new Error("Nothing to narrate once the section labels are removed.");
    const dir = ensureDir(outDir || outputFolder());
    const speakers = [...new Set(turns.map((t) => t.speaker))];
    const voiceOf = (sp) => voiceMap[sp] || (speakers.length > 1 ? TTS_VOICES[speakers.indexOf(sp) % TTS_VOICES.length] : defaultVoice);
    const files = [];
    const gap = new Int16Array(Math.round(TTS_SAMPLE_RATE * 0.3)); // 300 ms between turns
    const parts = [];
    for (let i = 0; i < turns.length; i++) {
      const t = turns[i]; const voice = voiceOf(t.speaker);
      onEvent({ phase: "synthesizing", label: `${i + 1}/${turns.length}  ${t.speaker} (${voice})` });
      const buf = await synthTurn(q, language, voice, speed, t.text, onEvent);
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
    return { files, mode, turns: turns.map((t) => ({ speaker: t.speaker, voice: voiceOf(t.speaker) })) };
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
// TOOL 3 - Subtitles (Whisper -> timed cues; export SRT or VTT)
// ============================================================================
const WHISPER_MODELS = {
  base: { label: "Whisper base (fast, ~150 MB)", constant: "WHISPER_BASE_Q8_0" },
  turbo: { label: "Whisper large v3 turbo (accurate, larger)", constant: "WHISPER_LARGE_V3_TURBO" },
};
const STT_LANGUAGES = ["en", "es", "fr", "de", "it", "pt", "nl", "pl", "ru", "ja", "ko", "zh", "ar", "hi", "tr", "uk", "sv", "cs"];
const WHISPER_CONFIG = {
  audio_format: "f32le", strategy: "greedy", n_threads: 4, translate: false,
  no_timestamps: false, single_segment: false, print_timestamps: false, token_timestamps: true,
  temperature: 0.0, suppress_blank: true, suppress_nst: true, entropy_thold: 2.4, logprob_thold: -1.0,
  vad_params: { threshold: 0.35, min_speech_duration_ms: 200, min_silence_duration_ms: 150, max_speech_duration_s: 30.0, speech_pad_ms: 600, samples_overlap: 0.3 },
  contextParams: { use_gpu: true, flash_attn: true, gpu_device: 0 },
};
// Sorted, de-overlapped cues (VAD padding makes segments overlap; players double-line without this).
function cues(segments) {
  const rows = (segments || []).map((s) => ({ start: Math.max(0, s.startMs | 0), end: Math.max(0, s.endMs | 0), text: String(s.text || "").trim() }))
    .filter((s) => s.text && s.end > s.start).sort((a, b) => a.start - b.start);
  for (let i = 0; i < rows.length - 1; i++) if (rows[i].end > rows[i + 1].start) rows[i].end = rows[i + 1].start;
  return rows;
}
function tc(ms, sep) { const t = Math.max(0, ms | 0); const p = (n, w) => String(n).padStart(w, "0"); return `${p(Math.floor(t / 3600000), 2)}:${p(Math.floor((t % 3600000) / 60000), 2)}:${p(Math.floor((t % 60000) / 1000), 2)}${sep}${p(t % 1000, 3)}`; }
function buildSrt(segments) { const r = cues(segments); return r.map((s, i) => `${i + 1}\r\n${tc(s.start, ",")} --> ${tc(s.end, ",")}\r\n${s.text}`).join("\r\n\r\n") + "\r\n"; }
function buildVtt(segments) { const r = cues(segments); return "WEBVTT\n\n" + r.map((s) => `${tc(s.start, ".")} --> ${tc(s.end, ".")}\n${s.text}`).join("\n\n") + "\n"; }

async function subtitles({ inputPath, language = "en", model = "base" } = {}, onEvent = () => {}) {
  return serialize(async () => {
    const q = await sdk();
    if (!inputPath || !fs.existsSync(inputPath)) throw new Error("No input file.");
    onEvent({ phase: "extracting" });
    const wavPath = path.join(os.tmpdir(), `ctk-stt-${Date.now()}.wav`);
    await toWav16k(inputPath, wavPath);
    const m = WHISPER_MODELS[model] || WHISPER_MODELS.base;
    onEvent({ phase: "loading", label: m.label });
    const modelId = await ensureModel("subs", `whisper-${model}-${language}`, { modelSrc: q[m.constant], modelConfig: { ...WHISPER_CONFIG, language } }, (p) => onEvent({ phase: "download", ...p }));
    onEvent({ phase: "transcribing" });
    let segments;
    try { segments = await q.transcribe({ modelId, audioChunk: wavPath, metadata: true }); }
    finally { try { fs.unlinkSync(wavPath); } catch { /* */ } }
    const srt = buildSrt(segments), vtt = buildVtt(segments);
    const base = slug(path.basename(inputPath).replace(/\.[^.]+$/, ""));
    const out = outFile(`${base}.srt`); fs.writeFileSync(out, srt, "utf8"); // default save as SRT
    return { path: out, srt, vtt, base, count: cues(segments).length };
  });
}

// ============================================================================
// TOOL 4 - Music (ACE-Step 1.5) - COMING SOON (needs SDK 0.17)
// ============================================================================
function musicStatus() { return { available: false, reason: "Music generation ships with QVAC SDK 0.17 (ACE-Step 1.5). This build is on 0.16, so the tool is disabled until 0.17 is public." }; }

module.exports = {
  unloadTool, unloadAll,
  writeScript, voiceOver, voiceSample, subtitles, musicStatus,
  scanModelsFolder, parseScript,
  outputFolder, modelsFolder, setOutputFolder, setModelsFolder, ensureDir,
  meta: () => ({ LLM_MODELS, WHISPER_MODELS, TTS_LANGUAGES, TTS_VOICES, STT_LANGUAGES, outputFolder: outputFolder(), modelsFolder: modelsFolder(), music: musicStatus() }),
  _test: { buildSrt, buildVtt, stripThinking, parseScript },
};
