// Renderer UI. Talks to the main process only through window.ctk (see preload). No SDK here.
window.__ctkErrors = [];
window.addEventListener("error", (e) => window.__ctkErrors.push(String(e.message)));
window.addEventListener("unhandledrejection", (e) => window.__ctkErrors.push("rejection: " + String(e.reason)));

// Design-preview fallback: a plain browser (no preload -> no window.ctk) gets a static stub so the
// layout is inspectable. Gated on "not Electron" (or an explicit ?preview=1) so a real preload
// failure inside the app fails loudly instead of being masked. If window.ctk exists, this never runs.
if (!window.ctk && (new URLSearchParams(location.search).has("preview") || !navigator.userAgent.includes("Electron"))) {
  const langs = ["en", "es", "fr", "de", "it", "pt", "nl", "pl", "ru", "ja", "ko", "zh"];
  window.ctk = {
    meta: async () => ({
      LLM_MODELS: { "qwen3-4b": { label: "Qwen3 4B (fast, ~2.5 GB)" }, "qwen3-8b": { label: "Qwen3 8B (better, ~5 GB)" }, "gpt-oss-20b": { label: "gpt-oss 20B (strong, ~12 GB)" }, "qwen3.6-35b-a3b": { label: "Qwen3.6 35B-A3B (best, ~22 GB)" }, "llama-1b": { label: "Llama 3.2 1B (tiny, ~0.8 GB)" } },
      WHISPER_MODELS: { base: { label: "Whisper base (fast, ~150 MB)" }, turbo: { label: "Whisper large v3 turbo (accurate, larger)" } },
      TTS_LANGUAGES: langs, TTS_VOICES: ["F1", "M1", "F2", "M2", "F3", "M3"], STT_LANGUAGES: langs,
      outputFolder: "~/Downloads/QVAC Creator Toolkit", modelsFolder: "~/.qvac/models",
      music: { available: false, reason: "Music generation ships with QVAC SDK 0.17 (ACE-Step 1.5). This build is on 0.16, so the tool is disabled until 0.17 is public." },
    }),
    onProgress: () => () => {}, script: async () => ({ text: "(preview only)", path: null, format: "narration" }), voice: async () => ({ files: [], mode: "single", turns: [] }), voiceSample: async () => new ArrayBuffer(0), subtitles: async () => ({ count: 0, srt: "", vtt: "" }),
    detectSpeakers: async (t) => { const s = [...new Set((t || "").split(/\n+/).map((l) => (l.match(/^\s*([A-Za-z][\w .'-]{0,24})\s*(?:\([^)]*\))?\s*:/) || [])[1]).filter(Boolean))]; return s.length ? s : ["Narrator"]; }, scanModels: async () => [{ id: "local:/x/Qwen3.5-9B.gguf", label: "Qwen3.5-9B-Q4_K_M" }, { id: "local:/x/Qwen3.6-27B.gguf", label: "Qwen3.6-27B-Q4_K_XL" }], setModelsFolder: () => {}, setOutputFolder: () => {}, pickFolder: async () => null, saveText: async () => null,
    reveal: () => {}, openOut: () => {}, pickMedia: async () => null, readBytes: async () => new ArrayBuffer(0), musicStatus: async () => ({}), unload: () => {}, unloadAll: () => {}, droppedPath: () => "",
  };
}

const $ = (s) => document.querySelector(s);
const baseName = (p) => String(p || "").split(/[\\/]/).pop();
const LANG_NAMES = { en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian", pt: "Portuguese", nl: "Dutch", pl: "Polish", ru: "Russian", ja: "Japanese", ko: "Korean", zh: "Chinese", ar: "Arabic", hi: "Hindi", tr: "Turkish", uk: "Ukrainian", sv: "Swedish", cs: "Czech", bg: "Bulgarian", da: "Danish", el: "Greek", et: "Estonian", fi: "Finnish", hr: "Croatian", hu: "Hungarian", id: "Indonesian", lt: "Lithuanian", lv: "Latvian", ro: "Romanian", sk: "Slovak", sl: "Slovenian", vi: "Vietnamese" };
const langLabel = (c) => LANG_NAMES[c] ? `${LANG_NAMES[c]} (${c})` : c;
const opt = (v, label, sel) => { const o = document.createElement("option"); o.value = v; o.textContent = label ?? v; if (sel) o.selected = true; return o; };
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
let META = null;

// ---- left side panel navigation (replaces the old tab strip) ----
const NAV = "#side .nav-item[data-tab]";
document.querySelectorAll(NAV).forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll(NAV).forEach((x) => x.classList.toggle("active", x === t));
    document.querySelectorAll(".pane").forEach((p) => p.classList.toggle("active", p.id === "pane-" + t.dataset.tab));
    $("#panes").scrollTop = 0;
  };
});
$("#side-collapse").onclick = () => { const s = $("#side"); const on = s.classList.toggle("collapsed"); $("#side-collapse").title = on ? "Expand the sidebar" : "Collapse the sidebar"; };
$("#tray-toggle").onclick = () => $("#tray").classList.toggle("rail-hidden");

// ---- progress ----
const progHandlers = {};
window.ctk.onProgress((d) => progHandlers[d.tool]?.(d));
const mb = (n) => (n / 1e6).toFixed(1);
function prog(t) { return { box: $(`#${t}-prog`), label: $(`#${t}-prog .t`), bar: $(`#${t}-prog .bar > i`), sub: $(`#${t}-prog .bar-sub`) }; }
function startProg(t, label) { const p = prog(t); p.box.classList.add("show"); p.label.textContent = label || "Working..."; p.bar.style.width = "0%"; p.sub.textContent = ""; }
function endProg(t) { prog(t).box.classList.remove("show"); }
function setLabel(t, s) { prog(t).label.textContent = s; }
function setBar(t, ev) { const p = prog(t); if (ev.percentage != null) { p.bar.style.width = Math.min(100, ev.percentage) + "%"; p.sub.textContent = ev.total ? `Downloading model  ${mb(ev.downloaded)} / ${mb(ev.total)} MB` : ""; } }
function showErr(t, e) { const box = $(`#${t}-err`); box.textContent = String(e && e.message || e); box.classList.add("show"); }
function hideErr(t) { $(`#${t}-err`).classList.remove("show"); }
const phaseLabel = (ev) => ({ loading: "Loading " + (ev.label || "model") + "...", download: "Downloading model...", generating: "Writing...", synthesizing: "Synthesizing " + (ev.label || "speech") + "...", extracting: "Extracting audio...", transcribing: "Transcribing..." }[ev.phase]);
function genericProgress(t) { return (ev) => { if (ev.phase === "download") { setBar(t, ev); setLabel(t, "Downloading model..."); } else if (ev.phase === "token") { $("#s-text").value += ev.token; $("#s-text").scrollTop = $("#s-text").scrollHeight; } else setLabel(t, phaseLabel(ev) || "Working..."); }; }

// ---- output tray ----
const trayList = $("#tray-list");
function addOutput({ name, path, kind, meta }) {
  if (trayList.querySelector(".tray-empty")) trayList.innerHTML = "";
  const icon = { audio: "◍", script: "✎", srt: "≡" }[kind] || "•";
  const row = document.createElement("div"); row.className = "out";
  const top = document.createElement("div"); top.className = "top"; top.innerHTML = `<span class="oi">${icon}</span><span class="name"></span>`;
  top.querySelector(".name").textContent = name; row.appendChild(top);
  if (meta) { const m = document.createElement("div"); m.className = "meta"; m.textContent = meta; row.appendChild(m); }
  const acts = document.createElement("div"); acts.className = "oacts";
  if (kind === "audio") { const b = document.createElement("button"); b.textContent = "Play"; b.onclick = () => playFile(path); acts.appendChild(b); }
  const rev = document.createElement("button"); rev.textContent = "Reveal"; rev.onclick = () => window.ctk.reveal(path); acts.appendChild(rev);
  row.appendChild(acts); trayList.prepend(row);
}
async function playFile(path) { const buf = await window.ctk.readBytes(path); if (!buf) return; const u = URL.createObjectURL(new Blob([buf], { type: "audio/wav" })); const a = new Audio(u); a.onended = () => URL.revokeObjectURL(u); a.play(); }

// ---- output folder (one source of truth: the Settings field, mirrored in the topbar chip) ----
function setOutPath(p) {
  $("#out-path").textContent = p; $("#out-path").title = p;
  if ($("#set-out")) { $("#set-out").value = p; $("#set-out").title = p; }
  if ($("#v-folder")) $("#v-folder").value = p;
}
async function chooseOutputFolder() { const d = await window.ctk.pickFolder(); if (d) { await window.ctk.setOutputFolder(d); setOutPath(d); } }
$("#set-out-pick").onclick = chooseOutputFolder;
$("#set-out-open").onclick = () => window.ctk.openOut();
$("#open-out").onclick = () => window.ctk.openOut();
// typing a path directly also persists it (on blur / Enter)
$("#set-out").onchange = async () => { const d = $("#set-out").value.trim(); if (d) { await window.ctk.setOutputFolder(d); setOutPath(d); } };
// two entry points (sidebar item + Settings button); labelEl is where the transient text goes
async function freeModels(labelEl, btnEl) {
  const old = labelEl.textContent; btnEl.disabled = true; labelEl.textContent = "Freeing...";
  try { await window.ctk.unloadAll(); } finally { btnEl.disabled = false; labelEl.textContent = old; }
}
$("#free-models").onclick = () => freeModels($("#free-models .nav-label"), $("#free-models"));
$("#free-models-2").onclick = () => freeModels($("#free-models-2"), $("#free-models-2"));

// ============ SCRIPT ============
function populateModels(localModels = []) {
  const sel = $("#s-model"); const cur = sel.value; sel.innerHTML = "";
  const g1 = document.createElement("optgroup"); g1.label = "Downloadable models";
  for (const [id, def] of Object.entries(META.LLM_MODELS)) g1.appendChild(opt(id, def.label, id === "qwen3-4b"));
  sel.appendChild(g1);
  if (localModels.length) { const g2 = document.createElement("optgroup"); g2.label = "Local models (this machine)"; for (const m of localModels) g2.appendChild(opt(m.id, m.label)); sel.appendChild(g2); }
  if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
  syncModelChip();
}
// Compose shows which model will write (it now lives in Settings, so surface it where you press Write).
function syncModelChip() {
  const sel = $("#s-model"), chip = $("#s-model-chip");
  if (!chip) return;
  const label = sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : "no model";
  chip.textContent = label; chip.title = "Writing with " + label + " (change it in Settings)";
}
$("#s-model").onchange = syncModelChip;
async function scanModels() {
  const dir = $("#s-mfolder").value.trim() || undefined;
  if (dir) await window.ctk.setModelsFolder(dir);
  $("#s-mscan").textContent = "Scanning...";
  const found = await window.ctk.scanModels(dir);
  populateModels(found);
  $("#s-mscan").textContent = `Scan (${found.length} found)`;
}
$("#s-mpick").onclick = async () => { const d = await window.ctk.pickFolder(); if (d) { $("#s-mfolder").value = d; scanModels(); } };
$("#s-mscan").onclick = scanModels;
async function runScript() {
  const idea = $("#s-idea").value.trim(); if (!idea) { $("#s-idea").focus(); return; }
  hideErr("s"); $("#s-run").disabled = true; startProg("s", "Loading model..."); $("#s-text").value = ""; $("#s-result").classList.add("show");
  progHandlers.script = genericProgress("s");
  try {
    const r = await window.ctk.script({ idea, length: $("#s-length").value, tone: $("#s-tone").value, model: $("#s-model").value, format: $("#s-format").value });
    $("#s-text").value = r.text; scriptStats();
    addOutput({ name: baseName(r.path), path: r.path, kind: "script", meta: `${r.format} · ${r.text.length} chars` });
  } catch (e) { showErr("s", e); } finally { progHandlers.script = null; endProg("s"); $("#s-run").disabled = false; scriptStats(); }
}
$("#s-run").onclick = runScript;
// live editor stats in the panel footer (words / characters / lines)
function scriptStats() {
  const t = $("#s-text").value;
  $("#s-words").textContent = (t.trim() ? t.trim().split(/\s+/).length : 0);
  $("#s-chars").textContent = t.length;
  $("#s-lines").textContent = t ? t.split("\n").length : 0;
}
$("#s-text").addEventListener("input", scriptStats);
$("#s-copy").onclick = () => navigator.clipboard.writeText($("#s-text").value);
$("#s-tovoice").onclick = () => { $("#v-text").value = $("#s-text").value; document.querySelector('#side .nav-item[data-tab="voice"]').click(); refreshSpeakers(); };

// ============ VOICE-OVER (multi-voice) ============
let speakerSelects = {}; // speaker -> <select>
async function refreshSpeakers() {
  const text = $("#v-text").value;
  const speakers = text.trim() ? (await window.ctk.detectSpeakers(text)) : ["Narrator"];
  const box = $("#v-voices"); box.innerHTML = ""; speakerSelects = {};
  speakers.forEach((sp, i) => {
    const row = document.createElement("div"); row.className = "vpick";
    const who = document.createElement("div"); who.className = "who";
    if (sp === "Narrator") who.textContent = "Voice";
    else { who.textContent = sp; const b = document.createElement("span"); b.className = "badge"; b.textContent = "speaker"; who.appendChild(b); }
    const sel = document.createElement("select"); for (const v of META.TTS_VOICES) sel.appendChild(opt(v));
    sel.value = META.TTS_VOICES[i % META.TTS_VOICES.length];
    const smp = document.createElement("button"); smp.className = "vsample"; smp.textContent = "▶"; smp.title = "Hear this voice";
    smp.onclick = async () => { smp.disabled = true; smp.textContent = "..."; try { const buf = await window.ctk.voiceSample({ language: $("#v-lang").value, voice: sel.value }); if (buf && buf.byteLength) { const u = URL.createObjectURL(new Blob([buf], { type: "audio/wav" })); const a = new Audio(u); a.onended = () => URL.revokeObjectURL(u); await a.play(); } } catch { /* */ } finally { smp.disabled = false; smp.textContent = "▶"; } };
    row.append(who, sel, smp); box.appendChild(row); speakerSelects[sp] = sel;
  });
  const lines = text.split(/\r?\n+/).filter((l) => l.trim()).length;
  const nSp = speakers.length;
  $("#v-stats").textContent = lines
    ? `${lines} line${lines > 1 ? "s" : ""} · ${nSp} voice${nSp > 1 ? "s" : ""}${nSp > 1 ? " (" + speakers.join(", ") + ")" : ""}`
    : "no lines yet";
}
$("#v-text").addEventListener("input", debounce(refreshSpeakers, 400));
$("#v-fpick").onclick = async () => { const d = await window.ctk.pickFolder(); if (d) $("#v-folder").value = d; };
async function runVoice() {
  const text = $("#v-text").value.trim(); if (!text) { $("#v-text").focus(); return; }
  hideErr("v"); $("#v-run").disabled = true; startProg("v", "Loading model..."); $("#v-result").classList.remove("show"); $("#v-files").innerHTML = "";
  progHandlers.voice = genericProgress("v");
  const voiceMap = {}; for (const [sp, el] of Object.entries(speakerSelects)) voiceMap[sp] = el.value;
  const defaultVoice = (Object.values(speakerSelects)[0] || {}).value || "F1";
  try {
    const r = await window.ctk.voice({ text, language: $("#v-lang").value, voiceMap, defaultVoice, speed: $("#v-speed").value, mode: $("#v-mode").value, outDir: $("#v-folder").value.trim() || undefined });
    $("#v-result").classList.add("show"); $("#v-empty").classList.add("hidden");
    if (r.mode === "separate") {
      $("#v-audio").style.display = "none"; $("#v-reveal").onclick = () => window.ctk.reveal(r.files[0]?.path);
      for (const f of r.files) {
        const row = document.createElement("div"); row.className = "vfile";
        const n = document.createElement("span"); n.className = "vn"; n.textContent = `${baseName(f.path)}  (${f.speaker}/${f.voice}, ${f.seconds.toFixed(1)}s)`;
        const pb = document.createElement("button"); pb.textContent = "Play"; pb.onclick = () => playFile(f.path);
        const rb = document.createElement("button"); rb.textContent = "Reveal"; rb.onclick = () => window.ctk.reveal(f.path);
        row.append(n, pb, rb); $("#v-files").appendChild(row);
        addOutput({ name: baseName(f.path), path: f.path, kind: "audio", meta: `${f.speaker}/${f.voice}  ${f.seconds.toFixed(1)}s` });
      }
    } else {
      const f = r.files[0]; const buf = await window.ctk.readBytes(f.path); const url = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
      const audio = $("#v-audio"); audio.style.display = ""; if (audio.dataset.url) URL.revokeObjectURL(audio.dataset.url); audio.src = url; audio.dataset.url = url;
      $("#v-reveal").onclick = () => window.ctk.reveal(f.path);
      addOutput({ name: baseName(f.path), path: f.path, kind: "audio", meta: `${f.seconds.toFixed(1)}s  ${r.turns.length} turn(s)` });
    }
  } catch (e) { showErr("v", e); } finally { progHandlers.voice = null; endProg("v"); $("#v-run").disabled = false; }
}
$("#v-run").onclick = runVoice;

// ============ SUBTITLES ============
let subsFile = null, lastSubs = null;
function setSubsFile(p) { subsFile = p; $("#sb-file").textContent = p || ""; $("#sb-run").disabled = !p; }
$("#sb-drop").onclick = async () => { const p = await window.ctk.pickMedia(); if (p) setSubsFile(p); };
$("#sb-drop").ondragover = (e) => { e.preventDefault(); $("#sb-drop").classList.add("hot"); };
$("#sb-drop").ondragleave = () => $("#sb-drop").classList.remove("hot");
$("#sb-drop").ondrop = (e) => { e.preventDefault(); $("#sb-drop").classList.remove("hot"); const f = e.dataTransfer.files[0]; if (!f) return; const p = (window.ctk.droppedPath && window.ctk.droppedPath(f)) || f.path; if (p) setSubsFile(p); };
async function runSubs() {
  if (!subsFile) return;
  hideErr("sb"); $("#sb-run").disabled = true; startProg("sb", "Extracting audio..."); $("#sb-result").classList.remove("show");
  progHandlers.subs = genericProgress("sb");
  try {
    const r = await window.ctk.subtitles({ inputPath: subsFile, language: $("#sb-lang").value, model: $("#sb-model").value });
    if (!r.count) { showErr("sb", "No speech was detected. Check the source language, or that the file has audio."); return; }
    lastSubs = r; $("#sb-srt").textContent = r.srt; $("#sb-result").classList.add("show"); $("#sb-empty").classList.add("hidden");
    $("#sb-stats").textContent = `${r.count} cue${r.count > 1 ? "s" : ""} · sorted and de-overlapped`;
    $("#sb-copy").onclick = () => navigator.clipboard.writeText(r.srt);
    $("#sb-reveal").onclick = () => window.ctk.reveal(r.path);
    addOutput({ name: baseName(r.path), path: r.path, kind: "srt", meta: `${r.count} cues` });
  } catch (e) { showErr("sb", e); } finally { progHandlers.subs = null; endProg("sb"); $("#sb-run").disabled = false; }
}
$("#sb-run").onclick = runSubs;
$("#sb-export-srt").onclick = async () => { if (lastSubs) await window.ctk.saveText({ content: lastSubs.srt, defaultName: `${lastSubs.base}.srt`, filters: [{ name: "SubRip", extensions: ["srt"] }] }); };
$("#sb-export-vtt").onclick = async () => { if (lastSubs) await window.ctk.saveText({ content: lastSubs.vtt, defaultName: `${lastSubs.base}.vtt`, filters: [{ name: "WebVTT", extensions: ["vtt"] }] }); };

// ============ init ============
(async () => {
  META = await window.ctk.meta();
  populateModels();
  for (const c of META.TTS_LANGUAGES) $("#v-lang").appendChild(opt(c, langLabel(c), c === "en"));
  for (const c of META.STT_LANGUAGES) $("#sb-lang").appendChild(opt(c, langLabel(c), c === "en"));
  for (const [id, def] of Object.entries(META.WHISPER_MODELS)) $("#sb-model").appendChild(opt(id, def.label, id === "base"));
  setOutPath(META.outputFolder);          // fills the topbar chip, the Settings field and the VO folder
  $("#s-mfolder").value = META.modelsFolder;
  if (META.music && META.music.reason) $("#music-reason").textContent = META.music.reason;
  refreshSpeakers();
  // auto-scan the default models folder on startup so GGUFs already on disk show up without a click
  try { const found = await window.ctk.scanModels(); if (found.length) { populateModels(found); $("#s-mscan").textContent = `Scan (${found.length} found)`; } } catch { /* */ }
})();
