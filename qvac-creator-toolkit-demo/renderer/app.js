// Renderer UI. Talks to the main process only through window.ctk (see preload). No SDK here.
window.__ctkErrors = [];
window.addEventListener("error", (e) => window.__ctkErrors.push(String(e.message)));
window.addEventListener("unhandledrejection", (e) => window.__ctkErrors.push("rejection: " + String(e.reason)));

// Design-preview fallback: a plain browser (no preload -> no window.ctk) gets a stub so the layout is
// inspectable. Gated on "not Electron" (or an explicit ?preview=1) so a real preload failure inside the
// app fails loudly instead of being masked. If window.ctk exists, this never runs.
if (!window.ctk && (new URLSearchParams(location.search).has("preview") || !navigator.userAgent.includes("Electron"))) {
  const langs = ["en", "es", "fr", "de", "it", "pt", "nl", "pl", "ru", "ja", "ko", "zh"];
  const tone = (sec) => { const sr = 22050, n = Math.round(sr * sec), b = new ArrayBuffer(44 + n * 2), v = new DataView(b); const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0))); w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true); for (let i = 0; i < n; i++) { const t = i / sr; const env = Math.abs(Math.sin(t * 1.7)) * (0.3 + 0.7 * Math.abs(Math.sin(t * 9))); v.setInt16(44 + i * 2, Math.sin(2 * Math.PI * 220 * t) * env * 12000, true); } return b; };
  const turns = [{ speaker: "Maya", voice: "F1", text: "Wait, the Wi-Fi is off and it still answered me?", start: 0, end: 2.6 }, { speaker: "Leo", voice: "M1", text: "That's the point. It runs right here on the laptop.", start: 2.9, end: 5.4 }, { speaker: "Maya", voice: "F1", text: "So my notes never leave this machine.", start: 5.7, end: 7.8 }];
  window.ctk = {
    meta: async () => ({
      LLM_MODELS: { "qwen3-4b": { label: "Qwen3 4B (fast, ~2.5 GB)" }, "qwen3-8b": { label: "Qwen3 8B (better, ~5 GB)" }, "llama-1b": { label: "Llama 3.2 1B (tiny, ~0.8 GB)" } },
      TTS_LANGUAGES: langs, TTS_VOICES: ["F1", "M1", "F2", "M2", "F3", "M3"], expressive: { available: true, languages: ["en", "fr", "es", "de", "it", "pt", "nl"], maxSpeakers: 5 },
      home: "/home/someone", outputFolder: "/home/someone/Downloads/QVAC Creator Toolkit", modelsFolder: "/home/someone/.qvac/models",
      music: { available: true, planner: "4B", quality: { draft: { label: "Draft", rtf: 0.2 }, studio: { label: "Studio", rtf: 0.85 } } },
    }),
    onProgress: () => () => {},
    script: async () => ({ text: turns.map((t) => `${t.speaker}: ${t.text}`).join("\n"), path: "/x/script-preview.txt", format: "dialogue" }),
    voice: async () => ({ files: [{ path: "/x/voiceover-preview.wav", seconds: 7.8 }], mode: "single", turns }),
    voiceSample: async () => tone(1.2),
    subtitles: async () => ({ count: 3, path: "/x/voiceover-preview.srt", base: "voiceover-preview", srt: turns.map((t, i) => `${i + 1}\r\n00:00:0${Math.floor(t.start)},${String(Math.round((t.start % 1) * 1000)).padStart(3, "0")} --> 00:00:0${Math.floor(t.end)},${String(Math.round((t.end % 1) * 1000)).padStart(3, "0")}\r\n${t.text}`).join("\r\n\r\n"), vtt: "WEBVTT" }),
    detectSpeakers: async (t) => { const s = [...new Set((t || "").split(/\n+/).map((l) => (l.match(/^\s*([A-Za-z][\w .'-]{0,24})\s*(?:\([^)]*\))?\s*:/) || [])[1]).filter(Boolean))]; return s.length ? s : ["Narrator"]; },
    scanModels: async () => [], setModelsFolder: async (d) => d, setOutputFolder: async (d) => d, pickFolder: async () => null, saveText: async () => null,
    reveal: () => {}, openOut: () => {}, pickMedia: async () => null, readBytes: async () => tone(8), readText: async () => "",
    musicStatus: async () => ({ available: true }), music: async () => ({ path: "/x/music-lofi-study-preview.wav", seconds: 30, trimmedSec: 4.1, levelDb: -16.2, seed: 12345, bpm: 78, tookMs: 34000, sampleRate: 48000, channels: 2, quality: "studio", qualityLabel: "Studio", planner: "4B" }),
    musicCancel: async () => true, unload: () => {}, unloadAll: async () => {}, droppedPath: () => "",
  };
}

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const baseName = (p) => String(p || "").split(/[\\/]/).pop();
const svg = (id, cls = "i") => `<svg class="${cls}"><use href="#${id}"/></svg>`;
const LANG_NAMES = { en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian", pt: "Portuguese", nl: "Dutch", pl: "Polish", ru: "Russian", ja: "Japanese", ko: "Korean", zh: "Chinese", ar: "Arabic", hi: "Hindi", tr: "Turkish", uk: "Ukrainian", sv: "Swedish", cs: "Czech", bg: "Bulgarian", da: "Danish", el: "Greek", et: "Estonian", fi: "Finnish", hr: "Croatian", hu: "Hungarian", id: "Indonesian", lt: "Lithuanian", lv: "Latvian", ro: "Romanian", sk: "Slovak", sl: "Slovenian", vi: "Vietnamese" };
const VOICE_NAMES = { F1: "Female 1", F2: "Female 2", F3: "Female 3", M1: "Male 1", M2: "Male 2", M3: "Male 3" };
const opt = (v, label, sel) => { const o = document.createElement("option"); o.value = v; o.textContent = label ?? v; if (sel) o.selected = true; return o; };
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const clock = (s) => { s = Math.max(0, s || 0); return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`; };
const clockMs = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
let META = null;
// Paths are shown relative to home: shorter, and the account name never ends up in a screenshot.
const tilde = (p) => { const h = META && META.home; return h && p && (p === h || p.startsWith(h + "/")) ? "~" + p.slice(h.length) : (p || ""); };

// ---- segmented controls and single-choice chip rows share one helper ----
function choice(id, onChange) {
  const host = document.getElementById(id);
  const btns = [...host.querySelectorAll("button[data-v]")];
  const paint = () => btns.forEach((b) => { b.setAttribute("role", "radio"); b.setAttribute("aria-checked", b.classList.contains("on") ? "true" : "false"); });
  btns.forEach((b) => b.addEventListener("click", () => { btns.forEach((x) => x.classList.toggle("on", x === b)); paint(); onChange && onChange(b.dataset.v); }));
  paint();
  return { get value() { const on = btns.find((b) => b.classList.contains("on")); return on ? on.dataset.v : undefined; }, set(v) { btns.forEach((x) => x.classList.toggle("on", x.dataset.v === v)); paint(); } };
}

// ---- navigation ----
const NAV = "#side .nav-item[data-tab]";
function go(tab) {
  $$(NAV).forEach((x) => x.classList.toggle("active", x.dataset.tab === tab));
  $$(".pane").forEach((p) => p.classList.toggle("active", p.id === "pane-" + tab));
  $("#panes").scrollTop = 0;
}
$$(NAV).forEach((t) => (t.onclick = () => go(t.dataset.tab)));
const markDone = (tab) => document.querySelector(`#side .nav-item[data-tab="${tab}"]`)?.classList.add("done");
$("#tray-toggle").onclick = () => { const hidden = $("#tray").classList.toggle("rail-hidden"); $("#tray-toggle").classList.toggle("on", !hidden); $("#tray-toggle").setAttribute("aria-pressed", String(!hidden)); };
$("#out-chip").onclick = () => window.ctk.openOut();

// ---- progress ----
const progHandlers = {};
window.ctk.onProgress((d) => progHandlers[d.tool]?.(d));
const mb = (n) => (n / 1e6).toFixed(0);
function prog(t) { return { box: $(`#${t}-prog`), label: $(`#${t}-prog .t`), bar: $(`#${t}-prog .bar`), fill: $(`#${t}-prog .bar > i`), sub: $(`#${t}-prog .bar-sub`) }; }
const downloading = {}; // set once a real download is under way, per tool
function startProg(t, label) { downloading[t] = false; const p = prog(t); p.box.classList.add("show"); p.label.textContent = label || "Working"; p.fill.style.width = "0%"; p.bar.classList.add("pulse"); p.sub.textContent = ""; }
function endProg(t) { prog(t).box.classList.remove("show"); }
function setLabel(t, s) { prog(t).label.textContent = s; }
function setPct(t, pct, sub) { const p = prog(t); p.bar.classList.remove("pulse"); p.fill.style.width = Math.max(2, Math.min(100, pct)) + "%"; if (sub != null) p.sub.textContent = sub; }
function showErr(t, e) { const box = $(`#${t}-err`); box.textContent = String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""); box.classList.add("show"); }
function hideErr(t) { $(`#${t}-err`).classList.remove("show"); }
// A model already on disk reports one progress event at 100%: that is a load, not a download.
function downloadEvent(t, ev) {
  const pct = ev.percentage ?? (ev.total ? (ev.downloaded / ev.total) * 100 : null);
  const what = ev.label || "the model";
  if (pct != null && pct >= 100 && !downloading[t]) { setLabel(t, `Loading ${what}`); return; }
  downloading[t] = true;
  setLabel(t, `Downloading ${what}`);
  if (pct != null) setPct(t, pct, ev.total ? `${mb(ev.downloaded)} / ${mb(ev.total)} MB` : "");
}

// ---- waveform player: one component for voice-over, subtitles and music ----
const peaksCache = new WeakMap();
async function computePeaks(bytes, n = 900) {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const buf = await ctx.decodeAudioData(bytes.slice(0));
  const ch = [...Array(buf.numberOfChannels)].map((_, i) => buf.getChannelData(i));
  const len = ch[0].length, step = Math.max(1, Math.floor(len / n)), out = new Float32Array(n);
  let max = 1e-6;
  for (let i = 0; i < n; i++) {
    let m = 0; const a = i * step, b = Math.min(len, a + step);
    for (const c of ch) for (let j = a; j < b; j += 4) { const v = Math.abs(c[j]); if (v > m) m = v; }
    out[i] = m; if (m > max) max = m;
  }
  for (let i = 0; i < n; i++) out[i] = Math.pow(out[i] / max, 0.6);
  return out;
}
function makePlayer(host, { large = false, small = false, media = null } = {}) {
  host.innerHTML = "";
  const el = document.createElement("div"); el.className = "player" + (large ? " lg" : "") + (small ? " sm" : "");
  const btn = document.createElement("button"); btn.className = "pbtn"; btn.setAttribute("aria-label", "Play"); btn.innerHTML = `<svg><use href="#i-play"/></svg>`;
  const cv = document.createElement("canvas"); cv.className = "wave"; cv.setAttribute("aria-label", "Waveform, click to seek");
  const tm = document.createElement("span"); tm.className = "ptime"; tm.textContent = "0:00 / 0:00";
  el.append(btn, cv, tm); host.appendChild(el);
  const audio = media || new Audio(); let url = null, peaks = null, raf = 0; const listeners = [];
  function draw() {
    const w = cv.clientWidth, h = cv.clientHeight, dpr = window.devicePixelRatio || 1;
    if (!w || !h) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const bars = Math.floor(w / 4), at = audio.duration ? audio.currentTime / audio.duration : 0;
    for (let i = 0; i < bars; i++) {
      let v = 0.08;
      if (peaks) { const a = Math.floor((i / bars) * peaks.length), z = Math.max(a + 1, Math.floor(((i + 1) / bars) * peaks.length)); v = 0; for (let k = a; k < z; k++) if (peaks[k] > v) v = peaks[k]; }
      const bh = Math.max(2, v * h * 0.92), x = i * 4, y = (h - bh) / 2;
      g.fillStyle = i / bars < at ? "#16E3C1" : "rgba(236,241,238,0.24)";
      g.beginPath(); g.roundRect ? g.roundRect(x, y, 2, bh, 1) : g.rect(x, y, 2, bh); g.fill();
    }
  }
  function tick() { draw(); tm.textContent = `${clock(audio.currentTime)} / ${clock(audio.duration)}`; listeners.forEach((f) => f(audio.currentTime)); cancelAnimationFrame(raf); if (!audio.paused) raf = requestAnimationFrame(tick); }
  const icon = (id) => { btn.innerHTML = `<svg><use href="#${id}"/></svg>`; btn.setAttribute("aria-label", id === "i-play" ? "Play" : "Pause"); };
  btn.onclick = () => { if (!audio.src) return; audio.paused ? audio.play() : audio.pause(); };
  audio.onplay = () => { icon("i-pause"); tick(); };
  audio.onpause = () => { icon("i-play"); tick(); };
  audio.onended = () => { icon("i-play"); tick(); };
  audio.onloadedmetadata = () => tick();
  cv.onclick = (e) => { if (!audio.duration) return; const r = cv.getBoundingClientRect(); audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration; tick(); };
  new ResizeObserver(() => draw()).observe(cv);
  async function load(bytes, mime = "audio/wav") {
    audio.pause(); if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(new Blob([bytes], { type: mime })); audio.src = url; peaks = null; draw();
    try { peaks = bytes.byteLength < 200e6 ? await computePeaks(bytes) : null; } catch { peaks = null; }
    draw();
  }
  return { el, audio, load, onTime: (f) => listeners.push(f), seek: (t) => { audio.currentTime = t; tick(); }, stop: () => audio.pause() };
}

// A video source plays in a stage with its captions drawn over it, the way they will look burned in.
// The stage keeps the video's shape: a phone clip sits beside the caption list, a wide one above it.
const VIDEO_MIME = { mp4: "video/mp4", m4v: "video/mp4", mov: "video/mp4", webm: "video/webm", mkv: "video/webm" };
function makeVideoPlayer(host, cues) {
  host.innerHTML = "";
  const stage = document.createElement("div"); stage.className = "vstage";
  const video = document.createElement("video"); video.playsInline = true; video.preload = "auto";
  const cap = document.createElement("div"); cap.className = "vcap"; cap.dataset.content = ""; cap.hidden = true;
  const bar = document.createElement("div");
  stage.append(video, cap); host.append(stage, bar);
  const p = makePlayer(bar, { small: true, media: video });
  video.addEventListener("click", () => (video.paused ? video.play() : video.pause()));
  const fit = () => {
    const ar = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 9 / 16, res = $("#sb-result");
    res.classList.toggle("tall", ar < 1);
    let h = ar < 1 ? 440 : 320, w = h * ar; const maxW = res.clientWidth || 560;
    if (w > maxW) { w = maxW; h = w / ar; }
    stage.style.width = bar.style.width = `${Math.round(w)}px`; stage.style.height = `${Math.round(h)}px`;
  };
  video.addEventListener("loadedmetadata", fit);
  p.onTime((t) => { const c = cues.find((c) => t >= c.start && t < c.end); cap.hidden = !c; if (c && cap.textContent !== c.text) cap.textContent = c.text; });
  return p;
}

// ---- session rail ----
const trayList = $("#tray-list");
let trayCount = 0, trayAudio = null, trayBtn = null;
const KIND_ICON = { script: "i-script", audio: "i-voice", music: "i-music", srt: "i-subs" };
function addOutput({ name, path, kind, meta }) {
  if (trayList.querySelector(".tray-empty")) trayList.innerHTML = "";
  const row = document.createElement("div"); row.className = "out";
  row.innerHTML = `<span class="oi">${svg(KIND_ICON[kind] || "i-file")}</span><span class="ot"><span class="name"></span><span class="meta"></span></span>`;
  row.querySelector(".name").textContent = name; row.querySelector(".name").title = tilde(path);
  row.querySelector(".meta").textContent = meta || "";
  if (kind === "audio" || kind === "music") {
    const b = document.createElement("button"); b.className = "ibtn"; b.setAttribute("aria-label", "Play " + name); b.innerHTML = svg("i-play");
    b.onclick = () => trayPlay(path, b); row.appendChild(b);
  }
  const rev = document.createElement("button"); rev.className = "ibtn"; rev.setAttribute("aria-label", "Show in folder"); rev.innerHTML = svg("i-reveal");
  rev.onclick = () => window.ctk.reveal(path); row.appendChild(rev);
  trayList.prepend(row); trayCount++; $("#tray-count").textContent = String(trayCount);
}
async function trayPlay(path, btn) {
  if (trayAudio) { trayAudio.pause(); const same = trayBtn === btn; trayBtn.innerHTML = svg("i-play"); trayAudio = null; trayBtn = null; if (same) return; }
  const buf = await window.ctk.readBytes(path); if (!buf) return;
  const u = URL.createObjectURL(new Blob([buf], { type: "audio/wav" })); const a = new Audio(u);
  trayAudio = a; trayBtn = btn; btn.innerHTML = svg("i-pause");
  a.onended = () => { URL.revokeObjectURL(u); btn.innerHTML = svg("i-play"); if (trayAudio === a) { trayAudio = null; trayBtn = null; } };
  a.play();
}

// ---- output folder: Settings field, mirrored in the topbar chip ----
function setOutPath(p) { $("#out-path").textContent = tilde(p); $("#out-chip").title = "Open " + tilde(p); $("#set-out").value = tilde(p); }
async function chooseOutputFolder() { const d = await window.ctk.pickFolder(); if (d) setOutPath(await window.ctk.setOutputFolder(d) || d); }
$("#set-out-pick").onclick = chooseOutputFolder;
$("#set-out-open").onclick = () => window.ctk.openOut();
$("#set-out").onchange = async () => { const d = $("#set-out").value.trim(); if (d) setOutPath(await window.ctk.setOutputFolder(d) || d); };
async function freeModels(btn) { btn.disabled = true; try { await window.ctk.unloadAll(); } finally { btn.disabled = false; } }
$("#free-models").onclick = () => freeModels($("#free-models"));
$("#free-models-2").onclick = () => freeModels($("#free-models-2"));

// ============ 1. SCRIPT ============
const sFormat = choice("s-format"), sLength = choice("s-length"), sTone = choice("s-tone");
function populateModels(localModels = []) {
  const sel = $("#s-model"); const cur = sel.value; sel.innerHTML = "";
  const g1 = document.createElement("optgroup"); g1.label = "Downloadable";
  for (const [id, def] of Object.entries(META.LLM_MODELS)) g1.appendChild(opt(id, def.label, id === "qwen3-4b"));
  sel.appendChild(g1);
  if (localModels.length) { const g2 = document.createElement("optgroup"); g2.label = "On this machine"; for (const m of localModels) g2.appendChild(opt(m.id, m.label)); sel.appendChild(g2); }
  if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
  syncModelChip();
}
function syncModelChip() { const sel = $("#s-model"); const label = sel.selectedOptions[0] ? sel.selectedOptions[0].textContent.replace(/\s*\(.*\)\s*$/, "") : ""; $("#s-model-chip").textContent = label; }
$("#s-model").onchange = syncModelChip;
async function scanModels() {
  const dir = $("#s-mfolder").value.trim() || undefined;
  if (dir) await window.ctk.setModelsFolder(dir);
  $("#s-mscan").textContent = "Scanning";
  const found = await window.ctk.scanModels(dir);
  populateModels(found);
  $("#s-mscan").textContent = `Scan (${found.length})`;
}
$("#s-mpick").onclick = async () => { const d = await window.ctk.pickFolder(); if (d) { $("#s-mfolder").value = tilde(d); scanModels(); } };
$("#s-mscan").onclick = scanModels;
function scriptStats() {
  const t = $("#s-text").value; const words = t.trim() ? t.trim().split(/\s+/).length : 0;
  $("#s-words").textContent = words; $("#s-chars").textContent = t.length;
  $("#s-secs").textContent = Math.round(words / 2.6);
  $("#s-lines").textContent = t.trim() ? t.trim().split(/\n+/).length : 0;
  for (const id of ["#s-tovoice", "#s-copy"]) { $(id).disabled = !t.trim(); $(id).title = t.trim() ? "" : "Write a script first"; }
}
async function runScript() {
  const idea = $("#s-idea").value.trim(); if (!idea) { $("#s-idea").focus(); return; }
  hideErr("s"); $("#s-run").disabled = true; startProg("s", "Loading the model"); $("#s-text").value = ""; scriptStats();
  let toks = 0;
  progHandlers.script = (ev) => {
    if (ev.phase === "download") downloadEvent("s", ev);
    else if (ev.phase === "loading") setLabel("s", "Loading " + String(ev.label || "the model").replace(/\s*\(.*\)\s*$/, ""));
    else if (ev.phase === "generating") setLabel("s", "Writing");
    else if (ev.phase === "token") { toks++; $("#s-text").value += ev.token; $("#s-text").scrollTop = $("#s-text").scrollHeight; prog("s").sub.textContent = `${toks} tokens`; if (toks % 8 === 0) scriptStats(); }
  };
  try {
    const r = await window.ctk.script({ idea, length: sLength.value, tone: sTone.value, model: $("#s-model").value, format: sFormat.value });
    $("#s-text").value = r.text; markDone("script");
    addOutput({ name: baseName(r.path), path: r.path, kind: "script", meta: `${r.format} · ${r.text.trim().split(/\s+/).length} words` });
  } catch (e) { showErr("s", e); } finally { progHandlers.script = null; endProg("s"); $("#s-run").disabled = false; scriptStats(); }
}
$("#s-run").onclick = runScript;
$("#s-idea").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) runScript(); });
$("#s-text").addEventListener("input", scriptStats);
$("#s-copy").onclick = () => navigator.clipboard.writeText($("#s-text").value);
$("#s-tovoice").onclick = () => { $("#v-text").value = $("#s-text").value; go("voice"); refreshSpeakers(); };

// ============ 2. VOICE-OVER ============
const vSpeed = choice("v-speed"), vMode = choice("v-mode"), vStyle = choice("v-style", () => syncStyle());
// Expressive = MOSS-TTSD (performs the whole dialogue, clones the cast's voices); Fast = Supertonic.
// Speed only exists for Fast. Expressive needs its model, a language it has a reference line for,
// and at most five speakers; otherwise Fast is the only choice and the button says why.
function syncStyle(nSpeakers) {
  const ex = META.expressive || {}, btn = document.querySelector('#v-style button[data-v="moss"]');
  const n = nSpeakers ?? Object.keys(speakerSelects).length;
  const why = !ex.available ? ex.reason : !(ex.languages || []).includes($("#v-lang").value) ? "Expressive voices: English, French, Spanish, German, Italian, Portuguese, Dutch" : n > (ex.maxSpeakers || 5) ? "Expressive voices take up to five speakers" : "";
  btn.disabled = !!why; btn.title = why || "";
  if (why && vStyle.value === "moss") vStyle.set("supertonic");
  $("#v-speed-field").hidden = vStyle.value === "moss";
  $("#v-dl").textContent = vStyle.value === "moss" && !ex.downloaded ? `first take downloads about ${ex.downloadGB || 20} GB` : "";
}
let speakerSelects = {}, lastVoice = null, vPlayer = null;
async function refreshSpeakers() {
  const text = $("#v-text").value;
  const speakers = text.trim() ? (await window.ctk.detectSpeakers(text)) : ["Narrator"];
  const prev = Object.fromEntries(Object.entries(speakerSelects).map(([k, el]) => [k, el.value]));
  const box = $("#v-voices"); box.innerHTML = ""; speakerSelects = {};
  speakers.forEach((sp, i) => {
    const row = document.createElement("div"); row.className = "vpick";
    const av = document.createElement("span"); av.className = "avatar"; av.textContent = sp === "Narrator" ? "N" : sp[0].toUpperCase();
    const who = document.createElement("span"); who.className = "who"; who.textContent = sp;
    const sel = document.createElement("select"); sel.setAttribute("aria-label", "Voice for " + sp);
    for (const v of META.TTS_VOICES) sel.appendChild(opt(v, VOICE_NAMES[v] || v));
    sel.value = prev[sp] || META.TTS_VOICES[i % META.TTS_VOICES.length];
    const smp = document.createElement("button"); smp.className = "ibtn"; smp.innerHTML = svg("i-play"); smp.setAttribute("aria-label", "Hear this voice");
    smp.onclick = async () => {
      smp.disabled = true;
      try { const buf = await window.ctk.voiceSample({ language: $("#v-lang").value, voice: sel.value }); if (buf && buf.byteLength) { const u = URL.createObjectURL(new Blob([buf], { type: "audio/wav" })); const a = new Audio(u); smp.innerHTML = svg("i-pause"); a.onended = () => { URL.revokeObjectURL(u); smp.innerHTML = svg("i-play"); }; await a.play(); } }
      catch { /* sample is a nicety */ } finally { smp.disabled = false; }
    };
    row.append(av, who, sel, smp); box.appendChild(row); speakerSelects[sp] = sel;
  });
  const lines = text.split(/\r?\n+/).filter((l) => l.trim()).length;
  syncStyle(speakers.length);
  $("#v-stats").textContent = lines ? `${lines} line${lines > 1 ? "s" : ""} · ${speakers.length} voice${speakers.length > 1 ? "s" : ""}` : "no lines yet";
}
$("#v-text").addEventListener("input", debounce(refreshSpeakers, 400));
$("#v-lang").addEventListener("change", () => syncStyle());
function renderLines(turns) {
  const box = $("#v-lines"); box.innerHTML = "";
  for (const t of turns) {
    const row = document.createElement("div"); row.className = "line";
    row.innerHTML = `<span class="sp"></span><span class="tx"></span>`;
    row.querySelector(".sp").textContent = t.speaker; row.querySelector(".tx").textContent = t.text || "";
    row.dataset.start = t.start ?? ""; row.dataset.end = t.end ?? "";
    box.appendChild(row);
  }
}
async function runVoice() {
  const text = $("#v-text").value.trim(); if (!text) { $("#v-text").focus(); return; }
  hideErr("v"); $("#v-run").disabled = true; startProg("v", "Loading the voice model");
  progHandlers.voice = (ev) => {
    if (ev.phase === "download") downloadEvent("v", ev);
    else if (ev.phase === "loading" && ev.label) setLabel("v", `Loading ${ev.label}`);
    else if (ev.phase === "performing") { setLabel("v", "Performing the dialogue"); prog("v").sub.textContent = ev.seconds ? `${ev.seconds} s of audio` : ""; }
    else if (ev.phase === "checking") setLabel("v", "Checking the take");
    else if (ev.phase === "retrying") { setLabel("v", `Take ${ev.attempt} of 3`); prog("v").sub.textContent = "the last take missed a line"; }
    else if (ev.phase === "synthesizing" && ev.n) { setLabel("v", `Voicing ${ev.speaker === "Narrator" ? "the narration" : ev.speaker}`); setPct("v", ((ev.i - 1) / ev.n) * 100, `line ${ev.i} of ${ev.n}`); }
  };
  const voiceMap = {}; for (const [sp, el] of Object.entries(speakerSelects)) voiceMap[sp] = el.value;
  const defaultVoice = (Object.values(speakerSelects)[0] || {}).value || "F1";
  try {
    const names = Object.keys(speakerSelects).filter((n) => n !== "Narrator");
    const r = await window.ctk.voice({ text, language: $("#v-lang").value, voiceMap, defaultVoice, speed: vSpeed.value, mode: vMode.value, engine: vStyle.value, title: names.length ? names.join(" and ") : "narration" });
    $("#v-result").hidden = false; $("#v-empty").hidden = true; $("#v-files").innerHTML = ""; markDone("voice");
    if (r.fellBack) showErr("v", "The expressive voices missed a line three times, so the Fast voices read it.");
    if (r.engine === "moss" && META.expressive) { META.expressive.downloaded = true; syncStyle(); }
    if (r.mode === "separate") {
      $("#v-player").innerHTML = ""; $("#v-lines").innerHTML = ""; lastVoice = null;
      for (const f of r.files) {
        const row = document.createElement("div"); row.className = "vfile";
        row.innerHTML = `<span class="vn"></span>`; row.querySelector(".vn").textContent = `${f.speaker} · ${f.seconds.toFixed(1)} s`;
        const pb = document.createElement("button"); pb.className = "ibtn"; pb.innerHTML = svg("i-play"); pb.setAttribute("aria-label", "Play line"); pb.onclick = () => trayPlay(f.path, pb);
        row.appendChild(pb); $("#v-files").appendChild(row);
        addOutput({ name: baseName(f.path), path: f.path, kind: "audio", meta: `${f.speaker} · ${f.seconds.toFixed(1)} s` });
      }
      $("#v-reveal").onclick = () => window.ctk.reveal(r.files[0]?.path);
    } else {
      const f = r.files[0]; lastVoice = { path: f.path, seconds: f.seconds, turns: r.turns };
      if (vPlayer) vPlayer.stop();
      vPlayer = makePlayer($("#v-player"), { large: true });
      renderLines(r.turns);
      vPlayer.onTime((t) => $$("#v-lines .line").forEach((l) => { const on = l.dataset.start !== "" && t >= +l.dataset.start && t < +l.dataset.end + 0.3 && !vPlayer.audio.paused; l.style.color = on ? "var(--fg)" : ""; l.style.background = on ? "var(--raised)" : ""; }));
      await vPlayer.load(await window.ctk.readBytes(f.path));
      $("#v-reveal").onclick = () => window.ctk.reveal(f.path);
      addOutput({ name: baseName(f.path), path: f.path, kind: "audio", meta: `${f.seconds.toFixed(1)} s · ${r.turns.length} lines` });
      setSubsVoiceSource();
    }
    for (const b of [$("#v-reveal"), $("#v-tosubs")]) { b.disabled = false; b.title = ""; }
    $("#v-tosubs").disabled = !lastVoice; if (!lastVoice) $("#v-tosubs").title = "Subtitles need a single-track voice-over";
  } catch (e) { showErr("v", e); } finally { progHandlers.voice = null; endProg("v"); $("#v-run").disabled = false; }
}
$("#v-run").onclick = runVoice;
$("#v-tosubs").onclick = () => { if (vPlayer) vPlayer.stop(); pickSubsSource("vo"); go("subs"); };

// ============ 3. SUBTITLES ============
let subsSrc = null, lastSubs = null, sbPlayer = null;
const AUDIO_EXT = /\.(wav|mp3|m4a|aac|flac|ogg|aiff?)$/i;
function setSubsVoiceSource() { if (!lastVoice) return; $("#sb-src-vo").hidden = false; $("#sb-src-vo-name").textContent = `${baseName(lastVoice.path)} · ${lastVoice.seconds.toFixed(1)} s`; }
function pickSubsSource(kind, filePath) {
  if (kind === "vo" && lastVoice) subsSrc = { path: lastVoice.path, audio: true };
  else if (kind === "file" && filePath) { subsSrc = { path: filePath, audio: AUDIO_EXT.test(filePath) }; $("#sb-file").textContent = baseName(filePath); }
  $("#sb-src-vo").classList.toggle("on", kind === "vo" && !!subsSrc);
  $("#sb-drop").classList.toggle("on", kind === "file" && !!subsSrc);
  $("#sb-run").disabled = !subsSrc; $("#sb-run").title = subsSrc ? "" : "Choose a source first";
}
$("#sb-src-vo").onclick = () => pickSubsSource("vo");
$("#sb-drop").onclick = async () => { const p = await window.ctk.pickMedia(); if (p) pickSubsSource("file", p); };
$("#sb-drop").ondragover = (e) => { e.preventDefault(); $("#sb-drop").classList.add("hot"); };
$("#sb-drop").ondragleave = () => $("#sb-drop").classList.remove("hot");
$("#sb-drop").ondrop = (e) => { e.preventDefault(); $("#sb-drop").classList.remove("hot"); const f = e.dataTransfer.files[0]; if (!f) return; const p = (window.ctk.droppedPath && window.ctk.droppedPath(f)) || f.path; if (p) pickSubsSource("file", p); };
function parseSrt(srt) {
  const t = (h, m, s, ms) => +h * 3600 + +m * 60 + +s + +ms / 1000;
  return String(srt || "").split(/\r?\n\r?\n/).map((b) => {
    const l = b.trim().split(/\r?\n/); const m = (l[1] || "").match(/(\d+):(\d+):(\d+),(\d+) --> (\d+):(\d+):(\d+),(\d+)/);
    return m ? { start: t(m[1], m[2], m[3], m[4]), end: t(m[5], m[6], m[7], m[8]), text: l.slice(2).join(" ") } : null;
  }).filter(Boolean);
}
async function runSubs() {
  if (!subsSrc) return;
  hideErr("sb"); $("#sb-run").disabled = true; startProg("sb", "Reading the audio");
  progHandlers.subs = (ev) => {
    if (ev.phase === "download") downloadEvent("sb", ev);
    else if (ev.phase === "loading") setLabel("sb", `Loading ${ev.label || "the model"}`);
    else if (ev.phase === "transcribing") setLabel("sb", "Listening");
  };
  try {
    const r = await window.ctk.subtitles({ inputPath: subsSrc.path });
    if (!r.count) { showErr("sb", "No speech found. TranscribePsy reads Dutch, English, French, German, Italian, Polish, Portuguese and Spanish."); return; }
    lastSubs = r; markDone("subs");
    $("#sb-result").hidden = false; $("#sb-empty").hidden = true;
    const cues = parseSrt(r.srt);
    const box = $("#sb-cues"); box.innerHTML = "";
    cues.forEach((c) => {
      const row = document.createElement("button"); row.className = "cue"; row.dataset.start = c.start; row.dataset.end = c.end;
      row.innerHTML = `<span class="tc"></span><span class="tx"></span>`;
      row.querySelector(".tc").textContent = `${clockMs(c.start)}  ${clockMs(c.end)}`; row.querySelector(".tx").textContent = c.text;
      row.onclick = () => { if (sbPlayer) { sbPlayer.seek(c.start + 0.01); sbPlayer.audio.play(); } };
      box.appendChild(row);
    });
    if (sbPlayer) sbPlayer.stop();
    const ext = (subsSrc.path.match(/[.]([a-z0-9]+)$/i) || [])[1]?.toLowerCase(), isVideo = !subsSrc.audio && !!VIDEO_MIME[ext];
    $("#sb-result").classList.toggle("video", isVideo); $("#sb-result").classList.toggle("tall", false);
    if (subsSrc.audio || isVideo) {
      sbPlayer = isVideo ? makeVideoPlayer($("#sb-player"), cues) : makePlayer($("#sb-player"));
      sbPlayer.onTime((t) => $$("#sb-cues .cue").forEach((el) => el.classList.toggle("live", t >= +el.dataset.start && t < +el.dataset.end)));
      await sbPlayer.load(await window.ctk.readBytes(subsSrc.path), isVideo ? VIDEO_MIME[ext] : undefined);
    } else { $("#sb-player").innerHTML = ""; sbPlayer = null; }
    $("#sb-stats").textContent = `${r.count} caption${r.count > 1 ? "s" : ""} · ${baseName(r.path)}`;
    for (const id of ["#sb-copy", "#sb-export-srt", "#sb-export-vtt"]) { $(id).disabled = false; $(id).title = ""; }
    addOutput({ name: baseName(r.path), path: r.path, kind: "srt", meta: `${r.count} captions` });
  } catch (e) { showErr("sb", e); } finally { progHandlers.subs = null; endProg("sb"); $("#sb-run").disabled = !subsSrc; }
}
$("#sb-run").onclick = runSubs;
$("#sb-copy").onclick = () => lastSubs && navigator.clipboard.writeText(lastSubs.srt);
$("#sb-export-srt").onclick = async () => { if (lastSubs) await window.ctk.saveText({ content: lastSubs.srt, defaultName: `${lastSubs.base}.srt`, filters: [{ name: "SubRip", extensions: ["srt"] }] }); };
$("#sb-export-vtt").onclick = async () => { if (lastSubs) await window.ctk.saveText({ content: lastSubs.vtt, defaultName: `${lastSubs.base}.vtt`, filters: [{ name: "WebVTT", extensions: ["vtt"] }] }); };

// ============ 4. MUSIC ============
// Nobody should have to know how to prompt a music model. A preset is a caption in the shape the
// ACE-Step authors publish (genre first, moods, four sound sources, comma keywords) plus described
// sections for the `lyrics` field, which is what makes an instrumental develop instead of looping.
const M_PRESETS = [
  { id: "lofi", label: "Lo-fi study", sub: "Rhodes, dusty drums", genre: "lo-fi hip hop", moods: ["relaxed", "mellow", "warm"], instr: ["rhodes piano", "soft dusty drums", "upright bass", "vinyl crackle"], bpm: 78,
    sec: { intro: "soft rhodes alone", verse: "dusty drums and bass enter", chorus: "fuller, jazzy guitar melody", bridge: "drums drop out, rhodes only", outro: "slow fade, vinyl crackle" } },
  { id: "chillhop", label: "Chillhop groove", sub: "Jazzy keys, swing", genre: "chillhop", moods: ["laid-back", "smooth", "warm"], instr: ["jazzy electric piano", "muted guitar", "swung boom bap drums", "warm bass"], bpm: 88,
    sec: { intro: "electric piano chords alone", verse: "swung drums and bass join", chorus: "muted guitar melody on top", bridge: "half-time, keys and bass only", outro: "groove thins out and fades" } },
  { id: "ambient", label: "Ambient bed", sub: "Pads, no drums", genre: "ambient", moods: ["calm", "airy", "peaceful"], instr: ["warm synth pads", "soft piano notes", "gentle shimmer textures", "no percussion"], bpm: null,
    sec: { intro: "a single warm pad", verse: "soft piano notes drift in", chorus: "pads open up, wider and brighter", bridge: "piano alone, sparse", outro: "pads dissolve into silence" } },
  { id: "acoustic", label: "Acoustic morning", sub: "Guitar, light shaker", genre: "acoustic folk", moods: ["sunny", "gentle", "hopeful"], instr: ["fingerpicked acoustic guitar", "light shaker", "soft bass", "glockenspiel"], bpm: 96,
    sec: { intro: "fingerpicked guitar alone", verse: "shaker and soft bass join", chorus: "glockenspiel melody, fuller strum", bridge: "guitar alone, quieter", outro: "last chord rings out" } },
  { id: "downtempo", label: "Downtempo", sub: "Warm synths, sub bass", genre: "downtempo electronica", moods: ["chill", "dreamy", "smooth"], instr: ["warm analog synths", "deep sub bass", "soft electronic drums", "airy pads"], bpm: 92,
    sec: { intro: "airy pads and a filtered synth", verse: "soft drums and sub bass enter", chorus: "analog synth melody, filter opens", bridge: "drums drop, pads and bass", outro: "filter closes, slow fade" } },
  { id: "bossa", label: "Bossa café", sub: "Nylon guitar, brushes", genre: "bossa nova", moods: ["breezy", "relaxed", "warm"], instr: ["nylon string guitar", "brushed drums", "upright bass", "soft flute"], bpm: 100,
    sec: { intro: "nylon guitar alone", verse: "brushed drums and upright bass join", chorus: "soft flute melody", bridge: "guitar and bass only", outro: "gentle ending on guitar" } },
];
const M_FORM = { 30: ["intro", "verse", "chorus", "outro"], 60: ["intro", "verse", "chorus", "bridge", "chorus", "outro"], 120: ["intro", "verse", "chorus", "verse", "bridge", "chorus", "outro"] };
const M_ENERGY = { calm: { word: "slow", bpm: -10 }, steady: { word: "", bpm: 0 }, upbeat: { word: "upbeat", bpm: 14 } };
const askFor = (sec) => { const f = sec <= 15 ? 1.5 : sec >= 90 ? 1.05 : 1.5 - 0.45 * (sec - 15) / 75; return Math.round(sec * f); };
const cap = (s) => s[0].toUpperCase() + s.slice(1);
let mPreset = M_PRESETS[0], mBusy = false, mPlayer = null, mTakes = [], mLoaded = new Set();
const mEnergy = choice("m-energy", () => mBuildPrompt()), mLength = choice("m-length", () => mBuildPrompt()), mQuality = choice("m-quality", () => mBuildPrompt());

function mBuild() {
  const p = mPreset, e = M_ENERGY[mEnergy.value] || M_ENERGY.steady;
  const extra = $("#m-extra").value.trim();
  const caption = [p.genre, e.word, ...p.moods, ...p.instr, extra, "instrumental"].filter(Boolean).join(", ");
  const duration = +mLength.value;
  const lyrics = (M_FORM[duration] || M_FORM[30]).map((k) => `[${cap(k)} - ${p.sec[k]}]`).join("\n\n");
  const bpm = p.bpm ? p.bpm + e.bpm : null;
  return { caption, lyrics, bpm, duration, quality: mQuality.value };
}
function mEta(b) {
  const q = (META.music && META.music.quality && META.music.quality[b.quality]) || { rtf: b.quality === "draft" ? 0.2 : 0.85 };
  return Math.round(askFor(b.duration) * q.rtf + (mLoaded.has(b.quality) ? 0 : 4));
}
function mBuildPrompt() {
  const b = mBuild(); const box = $("#m-prompt"); box.textContent = "";
  const add = (label, value) => { const l = document.createElement("b"); l.textContent = label + "  "; box.append(l, document.createTextNode(value + "\n")); };
  add("caption", b.caption); add("bpm", b.bpm ? String(b.bpm) : "free"); add("sections", b.lyrics.replace(/\n\n/g, " "));
  $("#m-eta").textContent = `about ${mEta(b)} s`;
}
function mSetBusy(on) { mBusy = on; $("#m-run").disabled = on; $("#m-stop").hidden = !on; $("#m-again").disabled = on || !mTakes.length; $("#m-reveal").disabled = !mTakes.length; }
const STAGES = { lm: "Composing", planner: "Composing", dit: "Rendering", diffusion: "Rendering", vae: "Mixing down", decode: "Mixing down" };
async function mGenerate() {
  if (mBusy) return;
  hideErr("m"); mSetBusy(true); startProg("m", "Loading the music model");
  const b = mBuild(); const eta = mEta(b); const t0 = Date.now();
  const timer = setInterval(() => { prog("m").sub.textContent = `${Math.round((Date.now() - t0) / 1000)} s of about ${eta} s`; }, 500);
  progHandlers.music = (ev) => {
    if (ev.phase === "downloading") { setLabel("m", "Downloading the music model"); setPct("m", ev.pct); }
    else if (ev.phase === "loading") setLabel("m", "Loading the music model");
    else if (ev.phase === "generating") { setLabel("m", STAGES[String(ev.stage || "").toLowerCase()] || "Generating"); if (ev.total) setPct("m", (ev.step / ev.total) * 100); }
  };
  try {
    const r = await window.ctk.music({ caption: b.caption, lyrics: b.lyrics, duration: b.duration, bpm: b.bpm ?? undefined, quality: b.quality, title: mPreset.label });
    mLoaded = new Set([b.quality]);
    const take = { ...r, n: mTakes.length + 1, preset: mPreset.label };
    mTakes.unshift(take); markDone("music");
    await mShow(take);
    addOutput({ name: baseName(r.path), path: r.path, kind: "music", meta: `${r.seconds} s · ${mPreset.label}` });
  } catch (e) { showErr("m", e); }
  finally { clearInterval(timer); progHandlers.music = null; mSetBusy(false); endProg("m"); mBuildPrompt(); }
}
async function mShow(take) {
  $("#m-result").hidden = false; $("#m-empty").hidden = true;
  if (!mPlayer) mPlayer = makePlayer($("#m-player"), { large: true });
  await mPlayer.load(await window.ctk.readBytes(take.path));
  const meta = $("#m-meta"); meta.innerHTML = "";
  for (const t of [`${take.seconds} s`, take.bpm ? `${take.bpm} bpm` : "free tempo", `${take.qualityLabel || take.quality}`, `${take.sampleRate / 1000} kHz stereo`, `made in ${Math.round(take.tookMs / 1000)} s`]) { const s = document.createElement("span"); s.textContent = t; meta.appendChild(s); }
  const list = $("#m-takes"); list.innerHTML = "";
  for (const t of mTakes) {
    const row = document.createElement("button"); row.className = "take" + (t === take ? " on" : "");
    row.innerHTML = `<span class="tn"></span><span class="td"></span>`;
    row.querySelector(".tn").textContent = `Take ${t.n} · ${t.preset}`; row.querySelector(".td").textContent = `${t.seconds} s`;
    row.onclick = () => mShow(t); list.appendChild(row);
  }
  $("#m-reveal").onclick = () => window.ctk.reveal(take.path);
  for (const id of ["#m-reveal", "#m-again"]) { $(id).disabled = mBusy; $(id).title = ""; }
  $("#m-stats").textContent = `${mTakes.length} take${mTakes.length > 1 ? "s" : ""} · planner ${take.planner || ""}`;
}
function mWire() {
  const host = $("#m-presets");
  for (const p of M_PRESETS) {
    const b = document.createElement("button"); b.className = "preset" + (p === mPreset ? " on" : ""); b.dataset.id = p.id;
    b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(p === mPreset));
    b.innerHTML = `<b></b><span></span>`; b.querySelector("b").textContent = p.label; b.querySelector("span").textContent = p.sub;
    b.onclick = () => { mPreset = p; [...host.children].forEach((c) => { c.classList.toggle("on", c === b); c.setAttribute("aria-checked", String(c === b)); }); mBuildPrompt(); };
    host.appendChild(b);
  }
  $("#m-extra").oninput = debounce(mBuildPrompt, 150);
  $("#m-run").onclick = () => mGenerate();
  $("#m-again").onclick = () => mGenerate();
  $("#m-stop").onclick = () => window.ctk.musicCancel();
  mBuildPrompt();
}

// ============ init ============
(async () => {
  META = await window.ctk.meta();
  populateModels();
  for (const c of META.TTS_LANGUAGES) $("#v-lang").appendChild(opt(c, LANG_NAMES[c] || c, c === "en"));
  setOutPath(META.outputFolder);
  $("#s-mfolder").value = tilde(META.modelsFolder);
  const ms = (META.music && META.music.available === null) ? await window.ctk.musicStatus() : (META.music || {});
  META.music = ms;
  mWire();
  if (ms.available === false) {
    $("#music-reason").textContent = ms.reason || "Music is not available in this build.";
    $("#m-unavail").classList.add("show"); $("#m-run").disabled = true; $("#m-run").title = ms.reason || "Music is not available";
  }
  scriptStats();
  refreshSpeakers();
  try { const found = await window.ctk.scanModels(); if (found.length) { populateModels(found); $("#s-mscan").textContent = `Scan (${found.length})`; } } catch { /* */ }
})();
