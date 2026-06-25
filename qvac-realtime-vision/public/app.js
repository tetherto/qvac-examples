// QVAC REALTIME - client (tracking-by-detection)
// 100% on-device, 100% QVAC inference. No external CDN, no OpenCV, no cloud.
// QVAC Qwen3-VL = narration/labeler (~1/s, via /api/look).
// QVAC ONNX detector = fast object boxes + hands/gestures (~10-16fps, via :3085).
// Between detections an EMA smoother eases each box toward its last detection so the
// overlay stays stable. Each detection re-anchors boxes, adds new ones, removes gone ones.

const els = {
  video: document.getElementById("video"),
  overlay: document.getElementById("overlay"),
  stage: document.getElementById("stage"),
  scan: document.getElementById("scan"),
  camHint: document.getElementById("camHint"),
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  narration: document.getElementById("narration"),
  objectList: document.getElementById("objectList"),
  thinking: document.getElementById("thinking"),
  status: document.getElementById("status"),
  flowState: document.getElementById("flowState"),
  enginesPanel: document.getElementById("enginesPanel"),
  error: document.getElementById("error"),
  mLatency: document.getElementById("mLatency"),
  mRate: document.getElementById("mRate"),
  mObjects: document.getElementById("mObjects"),
  // mode + cards to show/hide per mode
  modes: document.getElementById("modes"),
  detectPanel: document.getElementById("detectPanel"),
  metrics: document.getElementById("metrics"),
  hsOverlay: document.getElementById("hsOverlay"),
  hsName: document.getElementById("hsName"),
  hsSave: document.getElementById("hsSave"),
  sidePanel: document.getElementById("sidePanel"),
  sideBoard: document.getElementById("sideBoard"),
};

// localStorage leaderboard keys (must match games.js)
const HS_KEY = { fruit: "qvac_hs_fruit", head: "qvac_hs_head" };
// Render the right-side leaderboard (outside the video) for the active game.
function renderSideboard(key) {
  let t = [];
  try { t = JSON.parse(localStorage.getItem(key) || "[]"); } catch {}
  els.sideBoard.innerHTML = t.length
    ? t.slice(0, 5).map((e, i) => `<li class="${i === 0 ? "top" : ""}"><span class="r">${i + 1}.</span><span>${escapeHtml(e.name)}</span><span class="sc">${e.score}</span></li>`).join("")
    : `<li class="empty">no scores yet</li>`;
}

// ---- Constants ----
const SEND_MAX_W = 1280;      // 1280 = multiple of 32 (Qwen3-VL token stride): more precise boxes
const JPEG_Q = 0.8;

// Tracking (set reconciliation)
const IOU_MATCH = 0.30, IOU_STRONG = 0.55;
const EMA_SLOW = 0.25, EMA_FAST = 0.80;
const MOTION_SNAP = 0.08;
const MAX_MISSES = 6;         // detector now ticks ~2x faster -> keep tracks alive ~same wall-time
const MIN_HITS = 2;
const FADE_IN = 0.08, FADE_OUT = 0.06;
const LABEL_SWITCH_TICKS = 3; // need 3 consistent ticks before relabeling -> less flicker
const FRAME_EASE = 0.35;      // snappier box follow toward the latest detection
const MAX_TRACKS = 40;

// The 80 COCO classes already covered by the ONNX detector: VLM objects with these
// names (or synonyms) are NOT re-drawn (the detector does it, more precisely).
const COCO_SET = new Set(["person","bicycle","car","motorcycle","airplane","bus","train","truck","boat","traffic light","fire hydrant","stop sign","parking meter","bench","bird","cat","dog","horse","sheep","cow","elephant","bear","zebra","giraffe","backpack","umbrella","handbag","tie","suitcase","frisbee","skis","snowboard","sports ball","kite","baseball bat","baseball glove","skateboard","surfboard","tennis racket","bottle","wine glass","cup","fork","knife","spoon","bowl","banana","apple","sandwich","orange","broccoli","carrot","hot dog","pizza","donut","cake","chair","couch","potted plant","bed","dining table","toilet","tv","laptop","mouse","remote","keyboard","cell phone","microwave","oven","toaster","sink","refrigerator","book","clock","vase","scissors","teddy bear","hair drier","toothbrush"]);
const COCO_SYN = ["man","woman","boy","girl","guy","human","monitor","screen","display","television","phone","smartphone","mobile","sofa","couch"];
function coveredByDetector(label) {
  const l = label.toLowerCase();
  return COCO_SET.has(l) || COCO_SYN.includes(l);
}

const SYNONYMS = [
  ["person","man","woman","human","boy","girl","guy","face"],
  ["phone","cellphone","smartphone","mobile"],
  ["cup","mug","glass"],
  ["laptop","computer","notebook"],
  ["monitor","screen","display","tv","television"],
  ["couch","sofa"],
  ["chair","seat","stool","armchair"],
  ["bottle","flask"],
  ["microphone","mic"],
  ["glasses","eyeglasses","spectacles"],
];

let stream = null;
let running = false;
let netTimer = null;
let rafId = null;
let tickCounter = 0;
let lastNarration = "";
const tracks = [];
const rateWindow = [];

// modes: "detect" (boxes + narration), "fruit", "head" (mini-games)
let mode = "detect";
let lastFrameTs = 0;
const NARRATION_INTERVAL = 1.5; // seconds between VLM narrations (replaced the Cadence slider)

const ctx = els.overlay.getContext("2d");
const capCanvas = document.createElement("canvas");
const capCtx = capCanvas.getContext("2d");

// ---- Initial setup ----
async function init() {
  try {
    const h = await fetch("/api/health").then((r) => r.json());
    setStatus(h.loaded ? "model loaded" : "ready", true);
  } catch {
    setStatus("server offline", false);
  }
  // "Powered by QVAC" panel: shows the live QVAC inference engines.
  fetch("/api/engines").then((r) => r.json()).then(renderEngines).catch(() => {});

  setFlowState("EMA smoothing (on-device)");
  setMode("detect");
}
function setStatus(text, ok) {
  els.status.innerHTML = `<span class="dot ${ok ? "ok" : "bad"}"></span> ${text}`;
}
function setFlowState(t) { if (els.flowState) els.flowState.textContent = "visual tracker: " + t; }

function renderEngines(d) {
  if (!els.enginesPanel || !d || !d.engines) return;
  const e = d.engines;
  const prov = Array.isArray(e.object_detection.execution_providers)
    ? e.object_detection.execution_providers.join(", ")
    : e.object_detection.execution_providers;
  const card = (title, lines) =>
    `<div class="eng-card"><div class="eng-title">${title}</div>${lines.map((l) => `<div class="eng-line">${escapeHtml(l)}</div>`).join("")}</div>`;
  els.enginesPanel.innerHTML = [
    card("Object detection", ["YOLO-World open-vocab (ONNX)", "→ @qvac/onnx v" + e.object_detection.version, "GPU: " + prov]),
    card("Hands + gestures", ["YOLO hand-pose (ONNX)", "→ @qvac/onnx v" + e.hands_gestures.version]),
    card("Narration (VLM)", ["Qwen3-VL 2B (GGUF)", "→ @qvac/sdk v" + e.vlm_narration.sdk_version, "llama.cpp v" + e.vlm_narration.llama_version]),
  ].join("");
}
function showError(msg) { els.error.textContent = msg; els.error.classList.remove("hidden"); }

// ---- Webcam ----
els.startBtn.addEventListener("click", async () => {
  if (running) return;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: { ideal: "environment" } },
      audio: false,
    });
    els.video.srcObject = stream;
    await els.video.play();
    els.camHint.classList.add("hidden");
    els.error.classList.add("hidden");
    running = true;
    els.startBtn.disabled = true;
    els.stopBtn.disabled = false;
    resizeOverlay();
    loop();          // VLM (network, ~1/s): narration + open vocabulary
    detectLoop();    // ONNX detector on QVAC (~10-16fps): fast, precise boxes
    renderFrame();   // motion engine + drawing (60fps)
  } catch (e) {
    showError("Cannot access webcam: " + e.message);
  }
});

els.stopBtn.addEventListener("click", stop);
function stop() {
  running = false;
  els.startBtn.disabled = false;
  els.stopBtn.disabled = true;
  els.scan.classList.add("hidden");
  els.thinking.classList.add("hidden");
  clearTimeout(netTimer);
  clearTimeout(detTimer);
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  tracks.length = 0;
  lastHands = [];
  lastVlmExtras = [];
  lastFrameTs = 0;
  if (window.QGames) QGames.resetAll();
  hideHs();
  ctx.clearRect(0, 0, els.overlay.width, els.overlay.height);
  if (stream) stream.getTracks().forEach((t) => t.stop());
}

// ---- Modes ----
els.modes.addEventListener("click", (e) => {
  const b = e.target.closest(".mode-tab");
  if (b) setMode(b.dataset.mode);
});

function setMode(m) {
  if (!["detect", "fruit", "head"].includes(m)) m = "detect";
  mode = m;
  for (const b of els.modes.querySelectorAll(".mode-tab")) b.classList.toggle("active", b.dataset.mode === m);
  const game = m === "fruit" || m === "head";
  els.video.classList.toggle("mirror", game);              // mirror for the games (natural to play)
  els.detectPanel.classList.toggle("hidden", m !== "detect"); // right container: narration (detect) ...
  els.sidePanel.classList.toggle("hidden", m === "detect");   // ... or leaderboard (games)
  els.metrics.classList.toggle("hidden", m !== "detect");  // detector metrics -> detect only
  if (game) renderSideboard(HS_KEY[m]);
  if (window.QGames) { QGames.fruit.start(); QGames.head.start(); } // fresh game state on each entry
  hideHs();
  if (ctx) ctx.clearRect(0, 0, els.stage.clientWidth, els.stage.clientHeight);
}

// ---- High-score name entry (games) ----
let hsOpen = false, hsGameKey = null;
function onGameFrame(game, r) {
  if (!r) return;
  if (r.needName) showHs(game);
  else if (hsOpen && r.phase !== "over") hideHs();
}
function showHs(game) {
  if (hsOpen) return;
  hsOpen = true; hsGameKey = game;
  els.hsName.value = localStorage.getItem("qvac_hs_lastname") || "";
  els.hsOverlay.classList.remove("hidden");
  setTimeout(() => els.hsName.focus(), 30);
}
function hideHs() { hsOpen = false; els.hsOverlay.classList.add("hidden"); }
function saveHs() {
  if (!hsOpen) return;
  const name = (els.hsName.value || "Player").trim().slice(0, 12) || "Player";
  localStorage.setItem("qvac_hs_lastname", name);
  if (window.QGames && QGames[hsGameKey]) QGames[hsGameKey].submitName(name);
  renderSideboard(HS_KEY[hsGameKey]);                       // refresh the side panel with the new score
  hideHs();
}
els.hsSave.addEventListener("click", saveHs);
els.hsName.addEventListener("keydown", (e) => { if (e.key === "Enter") saveHs(); });

window.addEventListener("resize", resizeOverlay);
function resizeOverlay() {
  const r = els.stage.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  els.overlay.width = Math.round(r.width * dpr);
  els.overlay.height = Math.round(r.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ============================ NETWORK (one tick ~1s) ============================
async function loop() {
  if (!running) return;
  const t0 = performance.now();
  let backoff = 0;
  if (mode === "detect") {          // narration only runs in the detect mode
    try {
      const frame = await captureFrame();
      if (frame) {
        els.scan.classList.remove("hidden");
        els.thinking.classList.remove("hidden");
        const fd = new FormData();
        fd.append("frame", frame.blob, "frame.jpg");
        fd.append("w", frame.w);
        fd.append("h", frame.h);
        fd.append("persona", "plain");   // narration is always neutral (facts only)
        const res = await fetch("/api/look", { method: "POST", body: fd });
        if (res.status === 429) backoff = 400 + Math.random() * 500;
        else if (!res.ok) { const e = await res.json().catch(() => ({})); showError(e.error || "Analysis error"); }
        else onTick(await res.json());
      }
    } catch (e) {
      showError("Loop: " + e.message);
    } finally {
      els.scan.classList.add("hidden");
      els.thinking.classList.add("hidden");
    }
  }
  if (!running) return;
  const elapsed = performance.now() - t0;
  const wait = NARRATION_INTERVAL * 1000;
  netTimer = setTimeout(loop, Math.max(backoff, wait - elapsed));
}

function captureFrame() {
  return new Promise((resolve) => {
    const vw = els.video.videoWidth, vh = els.video.videoHeight;
    if (!vw || !vh) return resolve(null);
    const scale = Math.min(1, SEND_MAX_W / vw);
    const w = Math.round(vw * scale), h = Math.round(vh * scale);
    capCanvas.width = w; capCanvas.height = h;
    capCtx.drawImage(els.video, 0, 0, w, h);
    capCanvas.toBlob((blob) => resolve(blob ? { blob, w, h } : null), "image/jpeg", JPEG_Q);
  });
}

// VLM response = NARRATION (open vocabulary). The boxes now come from the ONNX detector.
// We only show the VLM's real narration, and update it only when the scene actually
// changes (no "in scene: ..." fallback, no rewriting of nearly identical sentences).
function onTick(data) {
  // Open-vocab fusion: the VLM adds boxes the COCO detector doesn't know
  // (glasses, microphone, posters...). VLM boxes are 0..1 on the full frame (no letterbox).
  lastVlmExtras = normalizeDetections(data.objects || [])
    .filter((d) => !coveredByDetector(d.label) && d.box.w < 0.7 && d.box.h < 0.9)
    .slice(0, 8);

  const narr = (data.narration || "").trim();
  if (!narr) return;                                        // VLM empty -> keep the last sentence
  if (lastNarration && wordSimilarity(narr, lastNarration) > 0.6) return; // same scene -> don't re-narrate
  lastNarration = narr;
  typeOut(narr);
}

// Jaccard word similarity: high = same scene, low = scene changed.
function wordSimilarity(a, b) {
  const wa = new Set((a.toLowerCase().match(/[a-z0-9']+/g) || []));
  const wb = new Set((b.toLowerCase().match(/[a-z0-9']+/g) || []));
  if (!wa.size || !wb.size) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / (wa.size + wb.size - inter);
}

// ============== ONNX DETECTOR on QVAC (fast, precise boxes, ~10-16fps) ==============
const DET = 640;
const DETECTOR_URL = `${location.protocol}//${location.hostname}:3085/detect`;
const detCanvas = document.createElement("canvas");
detCanvas.width = DET; detCanvas.height = DET;
const detCtx = detCanvas.getContext("2d", { willReadFrequently: true });
let lastLB = null;       // letterbox params of the last sent frame (to undo them)
let detTimer = null;
let detectorOk = false;
let detFrame = 0;        // counter to throttle hand detection to every other frame
let lastHands = [];      // detected hands (box 0..1 video + gesture + keypoints)
let lastVlmExtras = [];  // open-vocab objects from the VLM not covered by the detector (e.g. glasses)

async function detectLoop() {
  if (!running) return;
  try {
    const rgb = buildLetterboxRGB();
    if (rgb) {
      // Run the detector full-rate on what the active mode needs:
      // detect = objects + alternating hands; fruit = hands only; head = objects only.
      let wantObjects = true, wantHands;
      if (mode === "fruit") { wantObjects = false; wantHands = true; }
      else if (mode === "head") { wantHands = false; }
      else { wantHands = (detFrame % 2 === 0); }
      detFrame++;
      const res = await fetch(`${DETECTOR_URL}?objects=${wantObjects ? 1 : 0}&hands=${wantHands ? 1 : 0}`, {
        method: "POST", body: rgb, headers: { "Content-Type": "application/octet-stream" },
      });
      if (res.ok) {
        if (!detectorOk) { detectorOk = true; setFlowState("active · QVAC ONNX detector"); }
        onDetections(await res.json());
      }
    }
  } catch (e) {
    // detector not ready yet (loading the model): retry
  }
  if (!running) return;
  detTimer = setTimeout(detectLoop, 0); // run back-to-back; the detector inference is the throttle
}

// Builds the 640x640 letterbox RGB uint8 frame to send to the detector.
function buildLetterboxRGB() {
  const vw = els.video.videoWidth, vh = els.video.videoHeight;
  if (!vw || !vh) return null;
  const scale = DET / Math.max(vw, vh);
  const dw = vw * scale, dh = vh * scale;
  const padX = (DET - dw) / 2, padY = (DET - dh) / 2;
  detCtx.fillStyle = "#000"; detCtx.fillRect(0, 0, DET, DET);
  detCtx.drawImage(els.video, padX, padY, dw, dh);
  const img = detCtx.getImageData(0, 0, DET, DET).data;
  const rgb = new Uint8Array(DET * DET * 3);
  for (let i = 0; i < DET * DET; i++) { rgb[i*3]=img[i*4]; rgb[i*3+1]=img[i*4+1]; rgb[i*3+2]=img[i*4+2]; }
  lastLB = { scale, padX, padY, vw, vh };
  return rgb;
}

// Detector box (0..1 in the 640 letterbox space) -> 0..1 in the video space.
function undoLetterbox(b) {
  const lb = lastLB; if (!lb) return null;
  const px = (f) => (f * DET - lb.padX) / lb.scale / lb.vw;
  const py = (f) => (f * DET - lb.padY) / lb.scale / lb.vh;
  let x1 = clamp01(px(b[0])), y1 = clamp01(py(b[1])), x2 = clamp01(px(b[2])), y2 = clamp01(py(b[3]));
  if (x2 < x1) [x1, x2] = [x2, x1];
  if (y2 < y1) [y1, y2] = [y2, y1];
  const box = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  return (box.w < 0.01 || box.h < 0.01) ? null : box;
}

function onDetections(data) {
  els.mLatency.textContent = (data.ms || 0) + "ms";
  const now = performance.now();
  rateWindow.push(now);
  while (rateWindow.length && now - rateWindow[0] > 60000) rateWindow.shift();
  els.mRate.textContent = (rateWindow.length / 60).toFixed(1) + "/s";
  // objects -> tracker (with tracking/smoothing). Absent in Fruit mode (objects skipped).
  if (data.objects) {
    const dets = data.objects
      .map((o) => ({ label: o.label, conf: o.score, box: undoLetterbox(o.box) }))
      .filter((d) => d.box);
    reconcile(dets, ++tickCounter);
    updateObjectChips();
  }
  // hands -> separate layer. Only present every other frame (throttled); keep the previous
  // overlay when the detector skipped hands this frame, so the boxes don't flicker.
  if (data.hands) {
    lastHands = data.hands
      .map((h) => ({
        box: undoLetterbox(h.box),
        gesture: classifyGesture(h.kpts),
        kpts: (h.kpts || []).map(undoPoint).filter(Boolean),
      }))
      .filter((h) => h.box);
  }
}

// Classifies the gesture from the 21 keypoints (MediaPipe topology: 0 wrist; 1-4 thumb;
// 5-8 index; 9-12 middle; 13-16 ring; 17-20 pinky). ANGLE metric at the joints =
// orientation-independent (robust).
function jointAngle(a, b, c) {
  const v1x = a[0]-b[0], v1y = a[1]-b[1], v2x = c[0]-b[0], v2y = c[1]-b[1];
  const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
  if (!m1 || !m2) return 180;
  let cos = (v1x*v2x + v1y*v2y) / (m1*m2);
  cos = Math.max(-1, Math.min(1, cos));
  return Math.acos(cos) * 180 / Math.PI;
}
function classifyGesture(k) {
  if (!k || k.length < 21) return "✋ hand";
  const straight = (mcp, pip, tip) => jointAngle(k[mcp], k[pip], k[tip]) > 150;
  const index = straight(5, 6, 8), middle = straight(9, 10, 12);
  const ring = straight(13, 14, 16), pinky = straight(17, 18, 20);
  const thumb = jointAngle(k[1], k[2], k[4]) > 150;
  if (thumb && !index && !middle && !ring && !pinky) return "👍 thumbs up";
  if (index && middle && !ring && !pinky) return "✌️ peace";
  if (index && pinky && !middle && !ring) return "🤘 rock";
  if (index && !middle && !ring && !pinky) return "☝️ pointing";
  if (index && middle && ring && pinky) return "🖐️ open hand";
  if (!index && !middle && !ring && !pinky && !thumb) return "✊ fist";
  return "✋ hand";
}

// Keypoint (0..1 in 640 letterbox space) -> 0..1 in video space.
function undoPoint(p) {
  const lb = lastLB; if (!lb) return null;
  return [clamp01((p[0]*DET - lb.padX)/lb.scale/lb.vw), clamp01((p[1]*DET - lb.padY)/lb.scale/lb.vh)];
}

// ===================== COORDINATE NORMALIZATION (0-1000 -> 0..1) =====================
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function normalizeDetections(objects) {
  let maxv = 0;
  for (const o of objects) {
    const b = o.bbox || o.bbox_2d || o.box;
    if (Array.isArray(b)) for (const v of b) if (Number.isFinite(v)) maxv = Math.max(maxv, Math.abs(v));
  }
  let div;
  if (maxv <= 1.5) div = (v) => v;
  else if (maxv > 1000.5) div = (v) => v / (maxv > 2000 ? maxv : 1280);
  else div = (v) => v / 1000;

  const out = [];
  for (const o of objects) {
    const b = o.bbox || o.bbox_2d || o.box;
    if (!Array.isArray(b) || b.length < 4) continue;
    let [x1, y1, x2, y2] = b.map(Number);
    if ([x1, y1, x2, y2].some((n) => !Number.isFinite(n))) continue;
    let fx1 = clamp01(div(x1)), fy1 = clamp01(div(y1)), fx2 = clamp01(div(x2)), fy2 = clamp01(div(y2));
    if (fx2 < fx1) [fx1, fx2] = [fx2, fx1];
    if (fy2 < fy1) [fy1, fy2] = [fy2, fy1];
    const box = { x: fx1, y: fy1, w: fx2 - fx1, h: fy2 - fy1 };
    if (box.w < 0.01 || box.h < 0.01 || box.w * box.h < 0.0005) continue;
    out.push({ label: String(o.label || o.name || "object").toLowerCase().slice(0, 40), conf: Number(o.conf) || 1, box });
  }
  return out;
}

// ===================== TRACKING =====================
function iou(a, b) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy, uni = a.w * a.h + b.w * b.h - inter;
  return uni > 0 ? inter / uni : 0;
}
const center = (b) => [b.x + b.w / 2, b.y + b.h / 2];
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
function labelOK(a, b) {
  if (a === b || a.includes(b) || b.includes(a)) return true;
  for (const set of SYNONYMS) if (set.includes(a) && set.includes(b)) return true;
  return false;
}
function emaToward(box, tgt, a) {
  box.x += a * (tgt.x - box.x); box.y += a * (tgt.y - box.y);
  box.w += a * (tgt.w - box.w); box.h += a * (tgt.h - box.h);
}

function reconcile(detections, tick) {
  for (const t of tracks) t.matched = false;
  const pairs = [];
  for (const t of tracks) for (const d of detections) {
    const o = iou(t.box, d.box);
    if (o >= IOU_MATCH && (labelOK(t.label, d.label) || o >= IOU_STRONG)) pairs.push({ t, d, o });
  }
  pairs.sort((a, b) => b.o - a.o);
  const usedT = new Set(), usedD = new Set();
  for (const p of pairs) {
    if (usedT.has(p.t) || usedD.has(p.d)) continue;
    usedT.add(p.t); usedD.add(p.d); applyMatch(p.t, p.d, tick);
  }
  for (const d of detections) if (!usedD.has(d) && tracks.length < MAX_TRACKS) tracks.push(spawn(d, tick));
  for (const t of tracks) if (!t.matched) t.misses++;
}

function applyMatch(t, d, tick) {
  t.matched = true; t.hits++; t.misses = 0; t.lastTick = tick;
  if (t.hits >= MIN_HITS) t.confirmed = true;
  const [cx0, cy0] = center(t.box), [cx1, cy1] = center(d.box);
  const a = dist([cx0, cy0], [cx1, cy1]) > MOTION_SNAP ? EMA_FAST : EMA_SLOW;
  t.targetBox = d.box;
  // The detection is ground truth -> ease the box toward it (EMA).
  emaToward(t.box, d.box, a);
  // sticky label
  if (d.label !== t.label) {
    if (d.conf > t.labelConf && iou(t.box, d.box) >= IOU_STRONG) {
      if (d.label === t.pendingLabel) t.pendingLabelTicks++;
      else { t.pendingLabel = d.label; t.pendingLabelTicks = 1; }
      if (t.pendingLabelTicks >= LABEL_SWITCH_TICKS) {
        t.label = d.label; t.labelConf = d.conf; t.pendingLabel = null; t.pendingLabelTicks = 0;
      }
    }
  } else { t.labelConf = Math.max(t.labelConf, d.conf); t.pendingLabel = null; t.pendingLabelTicks = 0; }
}

let trackSeq = 0;
function spawn(d, tick) {
  return {
    id: ++trackSeq, label: d.label, labelConf: d.conf,
    box: { ...d.box }, targetBox: { ...d.box },
    lastTick: tick, hits: 1, misses: 0, confirmed: false,
    opacity: 0, matched: true, pendingLabel: null, pendingLabelTicks: 0,
  };
}

// ===================== RENDER (60fps) =====================
// The displayed-video rectangle inside the overlay (object-contain letterbox).
function viewTransform() {
  const r = els.stage.getBoundingClientRect();
  const vw = els.video.videoWidth || 16, vh = els.video.videoHeight || 9;
  const scale = Math.min(r.width / vw, r.height / vh);
  const dispW = vw * scale, dispH = vh * scale;
  return { w: r.width, h: r.height, offX: (r.width - dispW) / 2, offY: (r.height - dispH) / 2, dispW, dispH };
}
function clearOverlay(view) { ctx.clearRect(0, 0, view.w, view.h); }

// index fingertip(s) for AI Slash (kpt 8). x is mirrored to match the mirrored video.
function fingerTips(view) {
  const out = [];
  for (const h of lastHands) {
    const k = h.kpts;
    if (k && k.length >= 9 && k[8]) out.push({ x: view.offX + (1 - k[8][0]) * view.dispW, y: view.offY + k[8][1] * view.dispH });
  }
  return out;
}
// the largest tracked person's head (top-center of the box) for Head Stack, mirrored.
function headPoint(view) {
  let best = null, bestA = 0;
  for (const t of tracks) {
    if (t.misses > MAX_MISSES) continue;
    if (!PERSON_SET.has((t.label || "").toLowerCase())) continue;
    const a = t.box.w * t.box.h;
    if (a > bestA) { bestA = a; best = t; }
  }
  if (!best) return null;
  const b = best.targetBox || best.box;   // latest raw detection -> minimal lag (skip render EMA)
  const cx = b.x + b.w / 2, ty = b.y + b.h * 0.10;
  return { x: view.offX + (1 - cx) * view.dispW, y: view.offY + ty * view.dispH };
}

function renderFrame() {
  if (!running) return;
  const now = performance.now();
  const dt = lastFrameTs ? now - lastFrameTs : 16;
  lastFrameTs = now;
  try {
    const view = viewTransform();
    clearOverlay(view);
    if (mode === "fruit" && window.QGames) {
      onGameFrame("fruit", QGames.fruit.frame(ctx, view, { now, dt, hands: fingerTips(view) }));
    } else if (mode === "head" && window.QGames) {
      onGameFrame("head", QGames.head.frame(ctx, view, { now, dt, head: headPoint(view) }));
    } else {
      // detect: object boxes + hands + narration
      for (const t of tracks) emaToward(t.box, t.targetBox, FRAME_EASE * EMA_SLOW);
      for (const t of tracks) {
        if (t.confirmed && t.misses === 0) t.opacity = Math.min(1, t.opacity + FADE_IN);
        else if (t.misses > MAX_MISSES) t.opacity = Math.max(0, t.opacity - FADE_OUT);
        else if (!t.confirmed) t.opacity = Math.min(0.5, t.opacity + FADE_IN);
      }
      drawTracks();
      if (mode === "detect") drawVlmExtras();
      drawHands();
      for (let i = tracks.length - 1; i >= 0; i--) {
        if (tracks[i].misses > MAX_MISSES && tracks[i].opacity <= 0.01) tracks.splice(i, 1);
      }
    }
  } catch (e) {
    console.error("renderFrame:", e);
  }
  rafId = requestAnimationFrame(renderFrame);
}

// Box colour by category: people=red, food/fruit=purple, books=orange, other objects=blue.
const FOOD_SET = new Set(["banana","apple","sandwich","orange","broccoli","carrot","hot dog","pizza","donut","cake"]);
const PERSON_SET = new Set(["person","man","woman","boy","girl","guy","human","face"]);
function categoryColor(label) {
  const l = (label || "").toLowerCase();
  if (l === "book") return { s: "#FF7A1A", g: "rgba(255,122,26,0.55)", t: "#1a1205" }; // books = orange
  if (PERSON_SET.has(l)) return { s: "#FF4D4D", g: "rgba(255,77,77,0.5)", t: "#ffffff" };
  if (FOOD_SET.has(l))   return { s: "#A855F7", g: "rgba(168,85,247,0.5)", t: "#ffffff" };
  return { s: "#3B82F6", g: "rgba(59,130,246,0.5)", t: "#ffffff" }; // stationary / generic objects
}

function drawTracks() {
  const r = els.stage.getBoundingClientRect();
  const vw = els.video.videoWidth, vh = els.video.videoHeight;
  if (!vw || !vh) return;
  const scale = Math.min(r.width / vw, r.height / vh);
  const dispW = vw * scale, dispH = vh * scale;
  const offX = (r.width - dispW) / 2, offY = (r.height - dispH) / 2;
  ctx.lineWidth = 2;
  ctx.font = "600 12px Geist, sans-serif";
  for (const t of tracks) {
    if (t.opacity <= 0.02) continue;
    const bx = offX + t.box.x * dispW, by = offY + t.box.y * dispH;
    const bw = t.box.w * dispW, bh = t.box.h * dispH;
    if (bw < 2 || bh < 2) continue;
    const c = categoryColor(t.label);
    ctx.globalAlpha = t.opacity;
    ctx.strokeStyle = c.s;
    ctx.shadowColor = c.g;
    ctx.shadowBlur = 8;
    ctx.strokeRect(bx, by, bw, bh);
    ctx.shadowBlur = 0;
    const txt = `${t.label} ${Math.round((t.labelConf || 0) * 100)}%`;
    const tw = ctx.measureText(txt).width + 10;
    ctx.fillStyle = c.s;
    ctx.fillRect(bx, Math.max(0, by - 18), tw, 18);
    ctx.fillStyle = c.t;
    ctx.fillText(txt, bx + 5, Math.max(12, by - 5));
    ctx.globalAlpha = 1;
  }
}

// Draws the hands (amber box + gesture + keypoints) on top of the object boxes.
function drawHands() {
  if (!lastHands.length) return;
  const r = els.stage.getBoundingClientRect();
  const vw = els.video.videoWidth, vh = els.video.videoHeight;
  if (!vw || !vh) return;
  const scale = Math.min(r.width / vw, r.height / vh);
  const dispW = vw * scale, dispH = vh * scale;
  const offX = (r.width - dispW) / 2, offY = (r.height - dispH) / 2;
  ctx.lineWidth = 2;
  ctx.font = "600 13px Geist, sans-serif";
  for (const h of lastHands) {
    const bx = offX + h.box.x * dispW, by = offY + h.box.y * dispH;
    const bw = h.box.w * dispW, bh = h.box.h * dispH;
    ctx.strokeStyle = "#FFB020";
    ctx.shadowColor = "rgba(255,176,32,0.6)"; ctx.shadowBlur = 8;
    ctx.strokeRect(bx, by, bw, bh);
    ctx.shadowBlur = 0;
    // keypoints
    ctx.fillStyle = "#FFB020";
    for (const p of h.kpts) ctx.fillRect(offX + p[0]*dispW - 1.5, offY + p[1]*dispH - 1.5, 3, 3);
    // gesture label
    const tw = ctx.measureText(h.gesture).width + 12;
    ctx.fillStyle = "#FFB020";
    ctx.fillRect(bx, Math.max(0, by - 20), tw, 20);
    ctx.fillStyle = "#1a1205";
    ctx.fillText(h.gesture, bx + 6, Math.max(14, by - 6));
  }
}

// Open-vocab boxes from the VLM (glasses, microphone...): dashed/faint style to tell
// them apart from the detector's precise boxes.
function drawVlmExtras() {
  if (!lastVlmExtras.length) return;
  const r = els.stage.getBoundingClientRect();
  const vw = els.video.videoWidth, vh = els.video.videoHeight;
  if (!vw || !vh) return;
  const scale = Math.min(r.width / vw, r.height / vh);
  const dispW = vw * scale, dispH = vh * scale;
  const offX = (r.width - dispW) / 2, offY = (r.height - dispH) / 2;
  ctx.lineWidth = 1.5;
  ctx.font = "500 11px Geist, sans-serif";
  ctx.setLineDash([5, 4]);
  for (const o of lastVlmExtras) {
    const bx = offX + o.box.x * dispW, by = offY + o.box.y * dispH;
    const bw = o.box.w * dispW, bh = o.box.h * dispH;
    if (bw < 4 || bh < 4) continue;
    ctx.strokeStyle = "rgba(174,184,179,0.85)";
    ctx.strokeRect(bx, by, bw, bh);
    const tw = ctx.measureText(o.label).width + 8;
    ctx.fillStyle = "rgba(20,26,24,0.85)";
    ctx.fillRect(bx, Math.max(0, by - 15), tw, 15);
    ctx.fillStyle = "#aeb8b3";
    ctx.fillText(o.label, bx + 4, Math.max(11, by - 4));
  }
  ctx.setLineDash([]);
}

function updateObjectChips() {
  const live = tracks.filter((t) => t.confirmed && t.misses <= MAX_MISSES);
  els.mObjects.textContent = live.length;
  els.objectList.innerHTML = live.length
    ? live.map((t) => `<span class="chip">${escapeHtml(t.label)}</span>`).join("")
    : `<span class="empty">no distinct object</span>`;
}

// ===================== Typewriter =====================
let typeTimer = null;
function typeOut(text) {
  clearInterval(typeTimer);
  els.narration.classList.add("typewriter");
  let i = 0;
  els.narration.textContent = "";
  typeTimer = setInterval(() => {
    els.narration.textContent = text.slice(0, ++i);
    if (i >= text.length) { clearInterval(typeTimer); els.narration.classList.remove("typewriter"); }
  }, 9);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

init();
