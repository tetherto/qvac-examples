// QVAC Gym Training — renderer
// Ported from the Claude Design "Gym Training.dc.html" component. Same three-state
// flow (drop -> working -> results) and QVAC tokens. Frames are sampled from the
// video here on a <canvas>; the JPEG bytes are handed to the main process (which
// runs Qwen3.5-VL 4B via @qvac/sdk) over the preload bridge. The video file never
// leaves this renderer.

const FRAMES = 10;          // frames sampled per clip (matches the "/ 10" progress)
const FRAME_MAX_W = 512;    // downscale width sent to the model (keeps tokens small)
const MAX_DURATION = 60;    // seconds
const MAX_SIZE = 200 * 1024 * 1024; // 200 MB

const bridge = window.QVAC_BRIDGE || null;
const app = document.getElementById("app");

// Cycled under "Analysis" so the wait feels like work, not a hang.
const ANALYZE_MSGS = [
  "Reading your lift…",
  "Tracing the bar path…",
  "Checking your range of motion…",
  "Watching your joints stay stacked…",
  "Judging tempo and control…",
  "Putting your feedback together…",
];
let analyzeTimer = null;

const state = {
  view: "drop",            // drop | working | results
  error: null,
  drag: false,
  frames: 0,               // frames sampled so far
  analyzing: false,        // true once sampling is done and the model is thinking
  thumbUrl: null,
  exercise: null,
  strengths: [],
  improvements: [],
  model: { state: "loading", progress: 0, label: "Initialising…" },
};

let objectUrl = null;

function setState(patch) {
  Object.assign(state, patch);
  render();
}

// ---------- helpers ----------
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function buildSteps(view) {
  const idx = view === "drop" ? 0 : view === "working" ? 1 : 2;
  const labels = ["Upload", "Analysis", "Results"];
  return labels
    .map((label, i) => {
      const done = i < idx, active = i === idx;
      const dotBg = done || active ? "var(--qvac-green)" : "transparent";
      const dotBorder = done || active ? "var(--qvac-green)" : "var(--qvac-border)";
      const dotColor = done || active ? "var(--qvac-black)" : "var(--qvac-muted)";
      const labelColor = active ? "var(--qvac-white)" : done ? "var(--qvac-green)" : "var(--qvac-muted)";
      const lineColor = i <= idx ? "var(--qvac-green)" : "var(--qvac-border)";
      const line = i > 0
        ? `<span style="width: 28px; height: 0.5px; background: ${lineColor}; margin: 0 4px; flex: none;"></span>`
        : "";
      return `
        ${line}
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="width: 22px; height: 22px; border-radius: 50%; border: 0.5px solid ${dotBorder}; background: ${dotBg}; color: ${dotColor}; display: flex; align-items: center; justify-content: center; font-family: var(--font-display); font-weight: 600; font-size: 12px; flex: none;">${i + 1}</span>
          <span style="font-family: var(--font-display); font-weight: 500; font-size: 13px; letter-spacing: 0.4px; color: ${labelColor};">${label}</span>
        </div>`;
    })
    .join("");
}

function header() {
  return `
  <header style="display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 20px 32px; flex: none; border-bottom: 0.5px solid var(--qvac-border);">
    <div style="display: flex; align-items: center; gap: 14px;">
      <div style="width: 40px; height: 40px; border-radius: 10px; border: 0.5px solid var(--qvac-border); background: rgba(22,227,193,0.06); display: flex; align-items: center; justify-content: center; flex: none;">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--qvac-green)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6.5 6.5v11"></path><path d="M17.5 6.5v11"></path>
          <path d="M4 9v6"></path><path d="M20 9v6"></path>
          <path d="M6.5 12h11"></path>
        </svg>
      </div>
      <div style="display: flex; flex-direction: column; gap: 2px;">
        <div style="font-family: var(--font-display); font-weight: 700; font-size: 20px; letter-spacing: 0.3px; line-height: 1;">
          <span style="color: var(--qvac-green);">qvac.</span><span style="color: var(--qvac-white);"> gym training</span>
        </div>
        <div style="font-family: var(--font-body); font-weight: 300; font-size: 13px; color: var(--qvac-muted); line-height: 1;">Analyze your strength training</div>
      </div>
    </div>
    <div style="display: flex; align-items: center; gap: 0;">${buildSteps(state.view)}</div>
  </header>`;
}

// ---------- views ----------
// Shown on the drop screen while the on-device model is still downloading/loading.
function viewModelPrep() {
  const err = state.model.state === "error";
  const pct = Math.max(0, Math.min(100, state.model.progress || 0));
  const spinner = err
    ? `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--qvac-dark-green)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 8v5"></path><path d="M12 16.5v.01"></path></svg>`
    : `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--qvac-green)" stroke-width="1.8" stroke-linecap="round" style="animation: gtSpin 1s linear infinite;"><path d="M12 3a9 9 0 1 0 9 9" opacity="0.9"></path></svg>`;
  const bar = err ? "" : `
    <div style="width: 100%; max-width: 360px; height: 4px; border-radius: 999px; background: var(--surface); overflow: hidden;">
      <div style="height: 100%; width: ${pct}%; background: var(--qvac-green); border-radius: 999px; transition: width 0.3s var(--ease);"></div>
    </div>`;
  return `
  <div class="gt-fadein" style="width: 100%; max-width: 680px; display: flex; flex-direction: column; align-items: center; gap: 22px;">
    <div style="width: 100%; padding: 72px 40px; border: 1.5px dashed var(--qvac-border); border-radius: 16px; display: flex; flex-direction: column; align-items: center; gap: 20px; text-align: center;">
      <div style="width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 0.5px solid var(--qvac-border); background: rgba(22,227,193,0.06);">${spinner}</div>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        <h1 style="margin: 0; font-family: var(--font-body); font-weight: 500; font-size: 24px; line-height: 1.2; color: var(--qvac-white);">${err ? "The model couldn't start" : "Getting the on-device model ready"}</h1>
        <p style="margin: 0; font-family: var(--font-body); font-weight: 300; font-size: 16px; color: var(--qvac-muted);">${esc(state.model.label)}</p>
      </div>
      ${bar}
    </div>
    <p style="margin: 0; font-family: var(--font-body); font-weight: 300; font-size: 14px; color: var(--qvac-muted); text-align: center; line-height: 1.5; max-width: 560px;">${err ? "Check the terminal for details, then restart the app." : "First run downloads the model (~3.4 GB) once, then it's cached on your machine."}</p>
  </div>`;
}

function viewDrop() {
  if (state.model.state !== "ready") return viewModelPrep();

  const dropBorder = state.drag ? "var(--qvac-green)" : "var(--qvac-border)";
  const dropBg = state.drag ? "var(--qvac-green-glass)" : "transparent";
  const errorBlock = state.error
    ? `<div class="gt-fadein" style="display: flex; align-items: center; gap: 10px; padding: 12px 16px; border: 0.5px solid var(--qvac-dark-green); border-radius: 12px; background: rgba(0,175,146,0.08); max-width: 560px;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--qvac-green)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="flex: none;">
          <circle cx="12" cy="12" r="9"></circle><path d="M12 8v5"></path><path d="M12 16.5v.01"></path>
        </svg>
        <span style="font-family: var(--font-body); font-weight: 300; font-size: 14.5px; color: var(--qvac-white); line-height: 1.4;">${esc(state.error)}</span>
      </div>`
    : "";

  return `
  <div class="gt-fadein" style="width: 100%; max-width: 680px; display: flex; flex-direction: column; align-items: center; gap: 22px;">
    <div id="dropzone" role="button" tabindex="0"
      style="width: 100%; padding: 72px 40px; border: 1.5px dashed ${dropBorder}; border-radius: 16px; background: ${dropBg}; display: flex; flex-direction: column; align-items: center; gap: 20px; text-align: center; cursor: pointer; transition: var(--transition); outline: none;">
      <div style="width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 0.5px solid var(--qvac-border); background: rgba(22,227,193,0.06);">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--qvac-green)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 16V4"></path><path d="M7 9l5-5 5 5"></path><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"></path>
        </svg>
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        <h1 style="margin: 0; font-family: var(--font-body); font-weight: 500; font-size: 26px; line-height: 1.2; color: var(--qvac-white);">Drop your training video here</h1>
        <p style="margin: 0; font-family: var(--font-body); font-weight: 300; font-size: 17px; color: var(--qvac-muted);">or click to browse</p>
      </div>
      <input id="file-input" type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" style="display: none;" />
    </div>
    <p style="margin: 0; font-family: var(--font-body); font-weight: 300; font-size: 14px; color: var(--qvac-muted); text-align: center; line-height: 1.5; max-width: 560px;">One set, filmed from the side, 10–30s works best · mp4, mov, webm · max 60s</p>
    ${errorBlock}
  </div>`;
}

function viewWorking() {
  const sampling = !state.analyzing;
  const pct = Math.round((state.frames / FRAMES) * 100) + "%";
  const label = sampling ? "Sampling frames…" : ANALYZE_MSGS[0];
  const right = sampling
    ? `frames ${state.frames} / ${FRAMES}`
    : "on your machine";
  // While sampling: a real 0–100% bar. While the model reads: an indeterminate
  // sweep, since the model gives no exact progress.
  const bar = sampling
    ? `<div style="width: 100%; height: 4px; border-radius: 999px; background: var(--surface); overflow: hidden;">
         <div style="height: 100%; width: ${pct}; background: var(--qvac-green); border-radius: 999px; transition: width 0.3s var(--ease);"></div>
       </div>`
    : `<div class="gt-indet" style="width: 100%; height: 4px; border-radius: 999px; background: var(--surface);"><span></span></div>`;
  return `
  <div class="gt-fadein" style="width: 100%; max-width: 480px; display: flex; flex-direction: column; align-items: center; gap: 28px;">
    <div style="width: 280px; height: 158px; border-radius: 12px; overflow: hidden; border: 0.5px solid var(--qvac-border); background: var(--qvac-dark); position: relative;">
      <video src="${state.thumbUrl || ""}" muted playsinline style="width: 100%; height: 100%; object-fit: cover; opacity: 0.85;"></video>
      <div style="position: absolute; inset: 0; box-shadow: inset 0 0 0 0.5px rgba(22,227,193,0.15);"></div>
    </div>
    <div style="width: 100%; display: flex; flex-direction: column; gap: 14px;">
      <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 12px;">
        <span id="work-label" style="font-family: var(--font-body); font-weight: 400; font-size: 18px; color: var(--qvac-white);">${label}</span>
        <span style="font-family: var(--font-display); font-weight: 500; font-size: 14px; color: var(--qvac-muted); letter-spacing: 0.4px;">${right}</span>
      </div>
      ${bar}
    </div>
  </div>`;
}

function resultColumn(title, color, dotColor, iconSvg, items, opts = {}) {
  const border = opts.border || "0.5px solid var(--qvac-border)";
  const background = opts.background || "var(--surface)";
  const lis = items
    .map(
      (item) => `
      <li style="display: flex; gap: 12px; align-items: flex-start;">
        <span style="flex: none; width: 6px; height: 6px; border-radius: 50%; background: ${dotColor}; margin-top: 9px;"></span>
        <span style="font-family: var(--font-body); font-weight: 300; font-size: 16px; line-height: 1.5; color: var(--qvac-white); text-wrap: pretty;">${esc(item)}</span>
      </li>`
    )
    .join("");
  return `
    <section style="border: ${border}; border-radius: 12px; padding: 28px; background: ${background}; display: flex; flex-direction: column; gap: 18px;">
      <div style="display: flex; align-items: center; gap: 10px;">${iconSvg}
        <h2 style="margin: 0; font-family: var(--font-body); font-weight: 600; font-size: 20px; color: ${color};">${title}</h2>
      </div>
      <ul style="margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 14px;">${lis}</ul>
    </section>`;
}

function viewResults() {
  const checkIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--qvac-green)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg>`;
  // Alert triangle in amber — signals "caution / advice" at a glance.
  const workIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--qvac-warn)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path></svg>`;
  const exercise = state.exercise && state.exercise.toLowerCase() !== "unclear"
    ? `<p style="margin: 0; font-family: var(--font-display); font-weight: 500; font-size: 17px; letter-spacing: 0.6px; color: var(--qvac-white); text-transform: uppercase;">Detected: <span style="color: var(--qvac-green);">${esc(state.exercise)}</span></p>`
    : "";

  const strengthsBox = resultColumn("Strengths", "var(--qvac-green)", "var(--qvac-green)", checkIcon, state.strengths);
  const workBox = resultColumn("Work on this", "var(--qvac-warn)", "var(--qvac-warn)", workIcon, state.improvements, {
    border: "1px solid var(--qvac-warn-line)",
    background: "var(--qvac-warn-surface)",
  });

  return `
  <div class="gt-fadein" style="width: 100%; max-width: 1040px; display: flex; flex-direction: column; align-items: center; gap: 24px;">
    ${exercise}
    <div style="width: 100%; display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 20px; align-items: center;">
      <video src="${state.thumbUrl || ""}" controls loop muted playsinline
        style="width: 100%; max-height: 560px; border-radius: 12px; border: 0.5px solid var(--qvac-border); background: var(--qvac-dark); display: block; object-fit: contain;"></video>
      <div style="display: flex; flex-direction: column; gap: 20px;">
        ${strengthsBox}
        ${workBox}
      </div>
    </div>
    <p style="margin: 0; font-family: var(--font-body); font-weight: 300; font-size: 13.5px; color: var(--qvac-white); text-align: center;">General guidance, not a substitute for a qualified coach.</p>
    <button id="reset-btn" class="gt-reset"
      style="font-family: var(--font-display); font-weight: 500; font-size: 15px; letter-spacing: 0.8px; padding: 10px 22px; border-radius: 12px; border: 0.5px solid var(--qvac-green); background: transparent; color: var(--qvac-green); cursor: pointer; transition: var(--transition);">Analyze another</button>
  </div>`;
}

function render() {
  let main = "";
  if (state.view === "drop") main = viewDrop();
  else if (state.view === "working") main = viewWorking();
  else main = viewResults();

  app.innerHTML = `
    <div style="min-height: 100vh; background: var(--qvac-black); color: var(--qvac-white); font-family: var(--font-body); font-weight: 300; display: flex; flex-direction: column;">
      ${header()}
      <main style="flex: 1 1 auto; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 32px 28px 64px;">${main}</main>
    </div>`;

  bind();
}

// ---------- events ----------
function bind() {
  if (state.view === "drop" && state.model.state === "ready") {
    const zone = document.getElementById("dropzone");
    const input = document.getElementById("file-input");
    if (!zone || !input) return;
    zone.addEventListener("click", () => input.click());
    zone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
    });
    input.addEventListener("change", (e) => handleFiles(e.target.files));
    zone.addEventListener("dragover", (e) => { e.preventDefault(); if (!state.drag) setState({ drag: true }); });
    zone.addEventListener("dragleave", (e) => { e.preventDefault(); setState({ drag: false }); });
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      state.drag = false;
      handleFiles(e.dataTransfer.files);
    });
  }
  if (state.view === "results") {
    const btn = document.getElementById("reset-btn");
    if (btn) btn.addEventListener("click", reset);
  }
}

// ---------- flow ----------
function handleFiles(list) {
  const f = list && list[0];
  if (!f) return;
  const okType =
    ["video/mp4", "video/quicktime", "video/webm"].includes(f.type) ||
    /\.(mp4|mov|webm)$/i.test(f.name);
  if (!okType) {
    setState({ error: "That file isn't a video we can read — please use an mp4, mov, or webm." });
    return;
  }
  if (f.size > MAX_SIZE) {
    setState({ error: "That video is over 200 MB. Try a shorter clip or a lower resolution." });
    return;
  }

  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(f);

  const v = document.createElement("video");
  v.preload = "metadata";
  v.muted = true;
  v.playsInline = true;
  v.onloadedmetadata = () => {
    if (v.duration && v.duration > MAX_DURATION) {
      setState({ error: "That clip is longer than 60 seconds. One set — around 10–30s — works best." });
      return;
    }
    runAnalysis(v);
  };
  v.onerror = () => setState({ error: "That video could not be opened. Try a different file." });
  v.src = objectUrl;
}

function seek(v, t) {
  return new Promise((resolve) => {
    const onSeeked = () => { v.removeEventListener("seeked", onSeeked); resolve(); };
    v.addEventListener("seeked", onSeeked);
    v.currentTime = Math.min(t, Math.max(0, (v.duration || t) - 0.05));
  });
}

async function runAnalysis(v) {
  setState({ view: "working", error: null, thumbUrl: objectUrl, frames: 0, analyzing: false });

  const dur = v.duration && isFinite(v.duration) ? v.duration : 0;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const buffers = [];

  try {
    for (let i = 0; i < FRAMES; i++) {
      const t = dur ? (dur * (i + 0.5)) / FRAMES : 0;
      await seek(v, t);
      const vw = v.videoWidth || 640, vh = v.videoHeight || 360;
      const scale = Math.min(1, FRAME_MAX_W / vw);
      canvas.width = Math.max(1, Math.round(vw * scale));
      canvas.height = Math.max(1, Math.round(vh * scale));
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.8));
      if (blob) buffers.push(await blob.arrayBuffer());
      setState({ frames: i + 1 });
    }
  } catch {
    setState({ view: "drop", error: "We couldn't read frames from that clip. Try another video." });
    return;
  }

  if (!buffers.length) {
    setState({ view: "drop", error: "We couldn't read frames from that clip. Try another video." });
    return;
  }

  // Frames are in hand — the on-device model reasons about the lift.
  setState({ analyzing: true });

  // Rotate the status line so the wait reads as work, not a stall. We update the
  // text node directly (no re-render) so the video preview doesn't restart.
  let mi = 0;
  clearInterval(analyzeTimer);
  analyzeTimer = setInterval(() => {
    mi = (mi + 1) % ANALYZE_MSGS.length;
    const el = document.getElementById("work-label");
    if (el) el.textContent = ANALYZE_MSGS[mi];
  }, 2200);

  try {
    const data = await bridge.analyzeFrames(buffers);
    setState({
      view: "results",
      exercise: data.exercise || null,
      strengths: data.strengths || [],
      improvements: data.improvements || [],
      analyzing: false,
    });
  } catch (err) {
    const msg = String(err && err.message ? err.message : err).replace(/^Error invoking remote method '[^']+':\s*/i, "");
    const friendly = /\bbusy\b/i.test(msg)
      ? "The model is busy with another clip. Give it a moment and try again."
      : msg || "Analysis failed. Please try again.";
    setState({ view: "drop", error: friendly });
  } finally {
    clearInterval(analyzeTimer);
    analyzeTimer = null;
  }
}

function reset() {
  clearInterval(analyzeTimer);
  analyzeTimer = null;
  if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
  setState({
    view: "drop", error: null, drag: false, frames: 0, analyzing: false,
    thumbUrl: null, exercise: null, strengths: [], improvements: [],
  });
}

window.addEventListener("beforeunload", () => {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
});

// ---------- model status wiring ----------
if (bridge) {
  bridge.onModelProgress((status) => setState({ model: status }));
  bridge.getModelStatus().then((status) => { if (status) setState({ model: status }); }).catch(() => {});
} else {
  state.model = { state: "error", progress: 0, label: "Preload bridge missing — run the app with `npm start`." };
}

render();
