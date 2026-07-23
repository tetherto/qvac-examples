// QVAC SMART CAMERA - client
// A security-camera repurpose of the on-device vision infra. 100% QVAC inference.
//   - QVAC ONNX detector (YOLOv10, COCO) = fast object boxes (via :3085/detect?det=coco)
//   - QVAC Qwen3-VL = one-sentence event description when an alert fires (via /api/look task=alert)
// Input is a VIDEO FILE (drop a clip) or a webcam pointed at a scene - no one needs to be on camera.
// When a watched object (person / vehicle / animal / bag) enters the frame, we log a timestamped alert.

const els = {
  video: document.getElementById("video"),
  overlay: document.getElementById("overlay"),
  stage: document.getElementById("stage"),
  camHint: document.getElementById("camHint"),
  camBadge: document.getElementById("camBadge"),
  camTime: document.getElementById("camTime"),
  flash: document.getElementById("flash"),
  toasts: document.getElementById("toasts"),
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  soundBtn: document.getElementById("soundBtn"),
  fileInput: document.getElementById("fileInput"),
  hintFile: document.getElementById("hintFile"),
  hintCam: document.getElementById("hintCam"),
  srcSeg: document.getElementById("srcSeg"),
  watchChips: document.getElementById("watchChips"),
  status: document.getElementById("status"),
  error: document.getElementById("error"),
  feed: document.getElementById("feed"),
  alertCount: document.getElementById("alertCount"),
  mRate: document.getElementById("mRate"),
  mLatency: document.getElementById("mLatency"),
  mObjects: document.getElementById("mObjects"),
  mAlerts: document.getElementById("mAlerts"),
};

// ---- Categories (COCO label -> watch category + colour) ----
const CATS = {
  people:   { title: "Person detected",  color: "#FF4D4D", labels: ["person"] },
  vehicles: { title: "Vehicle detected", color: "#3B82F6", labels: ["bicycle","car","motorcycle","airplane","bus","train","truck","boat"] },
  animals:  { title: "Animal detected",  color: "#22C55E", labels: ["bird","cat","dog","horse","sheep","cow","elephant","bear","zebra","giraffe"] },
  bags:     { title: "Bag / package",    color: "#F59E0B", labels: ["backpack","handbag","suitcase"] },
};
const LABEL_CAT = {};
for (const k in CATS) for (const l of CATS[k].labels) LABEL_CAT[l] = k;
function catOf(label) { return LABEL_CAT[(label || "").toLowerCase()] || null; }
const watch = new Set(["people", "vehicles", "animals", "bags"]); // all on by default

// ---- Constants (tracking, tuned like the realtime-vision demo) ----
const DET = 640;
const DETECTOR_URL = `${location.protocol}//${location.hostname}:3085/detect?det=coco&hands=0&objects=1`;
const IOU_MATCH = 0.30, IOU_STRONG = 0.55;
const EMA_SLOW = 0.25, EMA_FAST = 0.80, FRAME_EASE = 0.35, MOTION_SNAP = 0.08;
const MAX_MISSES = 8, MIN_HITS = 3, FADE_IN = 0.08, FADE_OUT = 0.06, MAX_TRACKS = 40;
const ALERT_COOLDOWN_MS = 4000;   // per-category min gap between alerts (avoid spam from one event)
const SEND_MAX_W = 1280, JPEG_Q = 0.8;

let running = false, stream = null, srcMode = "file";
let detTimer = null, rafId = null, tickCounter = 0, trackSeq = 0;
let lastLB = null, lastFrameTs = 0, detectorOk = false;
let alertsTotal = 0, soundOn = false;
let vlmChain = Promise.resolve(); // serialize on-device VLM calls (model is single-flight)
const tracks = [];
const rateWindow = [];
const lastCatAlert = {}; // category -> last alert timestamp (cooldown)

const ctx = els.overlay.getContext("2d");
const detCanvas = document.createElement("canvas"); detCanvas.width = DET; detCanvas.height = DET;
const detCtx = detCanvas.getContext("2d", { willReadFrequently: true });
const capCanvas = document.createElement("canvas"); const capCtx = capCanvas.getContext("2d");
const thumbCanvas = document.createElement("canvas"); const thumbCtx = thumbCanvas.getContext("2d");
const lumaCanvas = document.createElement("canvas"); lumaCanvas.width = 32; lumaCanvas.height = 18;
const lumaCtx = lumaCanvas.getContext("2d", { willReadFrequently: true });

// ---- Init ----
async function init() {
  try {
    const h = await fetch("/api/health").then((r) => r.json());
    setStatus(h.loaded ? "model loaded" : "ready", true);
  } catch { setStatus("server offline", false); }
  renderWatch();
}
function setStatus(text, ok) { els.status.innerHTML = `<span class="dot ${ok ? "ok" : "bad"}"></span> ${text}`; }
function showError(msg) { els.error.textContent = msg; els.error.classList.remove("hidden"); }
function clearError() { els.error.classList.add("hidden"); }

// ---- Source selection ----
els.srcSeg.addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  srcMode = b.dataset.src;
  for (const x of els.srcSeg.querySelectorAll("button")) x.classList.toggle("active", x === b);
});
els.hintFile.addEventListener("click", () => { setSrc("file"); els.fileInput.click(); });
els.hintCam.addEventListener("click", () => { setSrc("webcam"); startWebcam(); });
function setSrc(m) {
  srcMode = m;
  for (const x of els.srcSeg.querySelectorAll("button")) x.classList.toggle("active", x.dataset.src === m);
}

els.fileInput.addEventListener("change", (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const url = URL.createObjectURL(f);
  els.video.srcObject = null;
  els.video.src = url;
  els.video.loop = true;
  els.video.muted = true;
  els.video.play().then(() => beginMonitoring()).catch((err) => showError("Cannot play video: " + err.message));
});

async function startWebcam() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: { ideal: "environment" } },
      audio: false,
    });
    els.video.srcObject = stream;
    els.video.loop = false;
    await els.video.play();
    beginMonitoring();
  } catch (e) { showError("Cannot access webcam: " + e.message); }
}

// ---- Start / stop ----
els.startBtn.addEventListener("click", () => {
  if (running) return;
  if (srcMode === "webcam") startWebcam();
  else els.fileInput.click(); // file mode: pick a clip -> beginMonitoring on load
});
els.stopBtn.addEventListener("click", stop);
els.soundBtn.addEventListener("click", () => {
  soundOn = !soundOn;
  els.soundBtn.classList.toggle("on", soundOn);
  els.soundBtn.textContent = soundOn ? "🔔 Sound on" : "🔕 Sound off";
});

function beginMonitoring() {
  if (running) return;
  clearError();
  els.camHint.classList.add("hidden");
  els.camBadge.classList.remove("hidden");
  els.camTime.classList.remove("hidden");
  running = true;
  els.startBtn.disabled = true;
  els.stopBtn.disabled = false;
  resizeOverlay();
  detectLoop();
  renderFrame();
}
function stop() {
  running = false;
  els.startBtn.disabled = false;
  els.stopBtn.disabled = true;
  els.camBadge.classList.add("hidden");
  clearTimeout(detTimer);
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  tracks.length = 0;
  lastFrameTs = 0;
  ctx.clearRect(0, 0, els.overlay.width, els.overlay.height);
  els.video.pause();
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
}

els.watchChips.addEventListener("click", (e) => {
  const c = e.target.closest(".wchip"); if (!c) return;
  const cat = c.dataset.cat;
  if (watch.has(cat)) watch.delete(cat); else watch.add(cat);
  renderWatch();
});
function renderWatch() {
  for (const c of els.watchChips.querySelectorAll(".wchip")) c.classList.toggle("off", !watch.has(c.dataset.cat));
}

window.addEventListener("resize", resizeOverlay);
function resizeOverlay() {
  const r = els.stage.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  els.overlay.width = Math.round(r.width * dpr);
  els.overlay.height = Math.round(r.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ============== DETECTOR (QVAC ONNX, COCO, ~10-16fps) ==============
async function detectLoop() {
  if (!running) return;
  try {
    const rgb = buildLetterboxRGB();
    if (rgb) {
      const res = await fetch(DETECTOR_URL, {
        method: "POST", body: rgb, headers: { "Content-Type": "application/octet-stream" },
      });
      if (res.ok) { if (!detectorOk) { detectorOk = true; setStatus("monitoring · on-device", true); } onDetections(await res.json()); }
    }
  } catch (e) { /* detector still loading the COCO model -> retry */ }
  if (!running) return;
  detTimer = setTimeout(detectLoop, 0); // back-to-back; detector inference is the throttle
}

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
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
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
  if (!data.objects) return;
  const dets = data.objects
    .map((o) => ({ label: o.label, cat: catOf(o.label), conf: o.score, box: undoLetterbox(o.box) }))
    .filter((d) => d.box && d.cat && watch.has(d.cat)); // only watched categories
  reconcile(dets, ++tickCounter);
  const live = tracks.filter((t) => t.confirmed && t.misses <= MAX_MISSES);
  els.mObjects.textContent = live.length;
}

// ===================== TRACKING (set reconciliation + EMA) =====================
function iou(a, b) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy, uni = a.w * a.h + b.w * b.h - inter;
  return uni > 0 ? inter / uni : 0;
}
const center = (b) => [b.x + b.w / 2, b.y + b.h / 2];
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
function emaToward(box, tgt, a) {
  box.x += a * (tgt.x - box.x); box.y += a * (tgt.y - box.y);
  box.w += a * (tgt.w - box.w); box.h += a * (tgt.h - box.h);
}
function reconcile(detections, tick) {
  for (const t of tracks) t.matched = false;
  const pairs = [];
  for (const t of tracks) for (const d of detections) {
    const o = iou(t.box, d.box);
    if (o >= IOU_MATCH && (t.label === d.label || o >= IOU_STRONG)) pairs.push({ t, d, o });
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
  const [cx0, cy0] = center(t.box), [cx1, cy1] = center(d.box);
  const a = dist([cx0, cy0], [cx1, cy1]) > MOTION_SNAP ? EMA_FAST : EMA_SLOW;
  t.targetBox = d.box;
  emaToward(t.box, d.box, a);
  t.label = d.label; t.cat = d.cat; t.conf = Math.max(t.conf, d.conf);
  if (!t.confirmed && t.hits >= MIN_HITS) { t.confirmed = true; maybeAlert(t); } // fire once on confirmation
}
function spawn(d, tick) {
  return {
    id: ++trackSeq, label: d.label, cat: d.cat, conf: d.conf,
    box: { ...d.box }, targetBox: { ...d.box },
    lastTick: tick, hits: 1, misses: 0, confirmed: false, opacity: 0, matched: true,
  };
}

// ===================== EVENT + RISK ENGINE =====================
// Every watched object that enters the frame becomes an event. A PERSON event is
// sent to Qwen3-VL for a RISK VERDICT (task=assess, with a day/night hint) so the app
// behaves differently for a resident coming home (NORMAL, calm) vs a masked person
// prowling a car at night (ALERT, red alarm). Other objects just get a plain description.
function maybeAlert(track) {
  const cat = track.cat;
  if (!cat || !watch.has(cat)) return;
  const now = performance.now();
  if (lastCatAlert[cat] && now - lastCatAlert[cat] < ALERT_COOLDOWN_MS) return; // debounce per category
  lastCatAlert[cat] = now;
  fireEvent(track);
}

function fireEvent(track) {
  alertsTotal++;
  els.mAlerts.textContent = alertsTotal;
  const cat = CATS[track.cat];
  const isPerson = track.cat === "people";
  const stamp = clockNow();
  const thumb = cropThumb(track.box);
  const night = isNight();
  const nearVehicle = isPerson && personNearVehicle(track);
  const framePromise = captureFrame(); // grab the frame at event time for the VLM

  const card = document.createElement("div");
  card.className = "alert";
  card.style.setProperty("--ac", cat.color);
  card.innerHTML = `
    <img class="thumb" alt="" ${thumb ? `src="${thumb}"` : ""} />
    <div class="body">
      <div class="top"><span class="title">${isPerson ? "Person" : cat.title}</span><span class="time">${stamp}</span></div>
      <div class="desc wait">${isPerson ? "Assessing risk on-device…" : "Describing the scene on-device…"}</div>
      <div class="tags"><span class="tag" style="color:${cat.color}">${escapeHtml(track.label)}</span></div>
    </div>`;
  const empty = els.feed.querySelector(".empty");
  if (empty) empty.remove();
  els.feed.prepend(card);
  while (els.feed.children.length > 60) els.feed.lastElementChild.remove();
  els.alertCount.textContent = `${alertsTotal} event${alertsTotal === 1 ? "" : "s"}`;

  if (!isPerson) flashStage(cat.color); // non-people: quiet flash now; people wait for the verdict

  vlmChain = vlmChain.then(() => analyze({ card, cat, isPerson, night, nearVehicle, stamp, framePromise }));
}

// One on-device VLM call per event. People -> risk verdict (assess); others -> description.
// Final risk is a HYBRID: the VLM opinion OR a geometric rule (a person right next to a
// vehicle at night = prowling a car). The rule guarantees the alarm fires even when the
// small VLM is too conservative; the VLM still writes the human-readable reason.
async function analyze({ card, cat, isPerson, night, nearVehicle, stamp, framePromise }) {
  const descEl = card.querySelector(".desc");
  const frame = await framePromise;
  const finish = (txt) => { descEl.classList.remove("wait"); descEl.textContent = txt || "Scene captured."; };
  if (!frame) { finish(""); if (isPerson) (night && nearVehicle ? escalateAlarm(card, stamp) : calmPerson(card, stamp)); return; }
  let vlmRisk = "normal", reason = "";
  try {
    const fd = new FormData();
    fd.append("frame", frame.blob, "frame.jpg");
    fd.append("w", frame.w); fd.append("h", frame.h);
    fd.append("task", isPerson ? "assess" : "alert");
    if (isPerson) fd.append("night", night ? "1" : "0");
    const res = await fetch("/api/look", { method: "POST", body: fd });
    if (res.ok) { const j = await res.json(); reason = (j.narration || "").trim(); if (j.risk) vlmRisk = j.risk; }
  } catch {}
  finish(reason);
  if (!isPerson) return; // non-people already flashed; nothing louder
  const isAlert = vlmRisk === "alert" || (night && nearVehicle);
  if (isAlert) escalateAlarm(card, stamp, night && nearVehicle ? "Person at vehicle, night" : "Flagged by on-device vision");
  else calmPerson(card, stamp);
}

// High risk: turn the card red, raise a red pulsing alarm toast + border flash + alarm sound.
function escalateAlarm(card, stamp, factor) {
  card.classList.add("alarm");
  card.style.setProperty("--ac", "#FF3B3B");
  const title = card.querySelector(".title"); if (title) title.textContent = "Security alert";
  addRiskBadge(card, "High risk", "#FF3B3B");
  if (factor) {
    const tags = card.querySelector(".tags");
    if (tags) { const f = document.createElement("span"); f.className = "factor"; f.textContent = factor; tags.appendChild(f); }
  }
  showToast({ color: "#FF3B3B", title: "SECURITY ALERT" }, stamp, true);
  flashStage("#FF3B3B");
  alarm();
}

// Normal person activity: calm green treatment, no alarm.
function calmPerson(card, stamp) {
  card.style.setProperty("--ac", "#22C55E");
  addRiskBadge(card, "Normal", "#22C55E");
  showToast({ color: "#22C55E", title: "Person detected" }, stamp, false);
  flashStage("#22C55E");
  if (soundOn) blip();
}

function addRiskBadge(card, text, color) {
  const tags = card.querySelector(".tags");
  if (!tags) return;
  const b = document.createElement("span");
  b.className = "risk"; b.textContent = text; b.style.background = color;
  tags.prepend(b);
}

// Is this person right next to a detected vehicle? (person prowling a car = a risk factor)
function personNearVehicle(personTrack) {
  const pc = center(personTrack.box);
  for (const t of tracks) {
    if (t === personTrack || t.cat !== "vehicles" || !t.confirmed) continue;
    if (iou(personTrack.box, t.box) > 0) return true;
    const vc = center(t.box);
    if (Math.hypot(pc[0] - vc[0], pc[1] - vc[1]) < 0.35) return true;
  }
  return false;
}

// Day/night from the average luminance of the current video frame (used as a hint to the VLM).
function isNight() {
  const vw = els.video.videoWidth, vh = els.video.videoHeight;
  if (!vw || !vh) return false;
  lumaCtx.drawImage(els.video, 0, 0, 32, 18);
  const d = lumaCtx.getImageData(0, 0, 32, 18).data;
  let sum = 0; const n = 32 * 18;
  for (let i = 0; i < n; i++) sum += 0.299 * d[i*4] + 0.587 * d[i*4+1] + 0.114 * d[i*4+2];
  return sum / n < 70;
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

// Crop the alerting object's box (with padding) into a small thumbnail data URL.
function cropThumb(box) {
  const vw = els.video.videoWidth, vh = els.video.videoHeight;
  if (!vw || !vh) return null;
  const padX = box.w * 0.18, padY = box.h * 0.18;
  const sx = clamp01(box.x - padX) * vw, sy = clamp01(box.y - padY) * vh;
  const sw = Math.min(vw - sx, (box.w + 2 * padX) * vw), sh = Math.min(vh - sy, (box.h + 2 * padY) * vh);
  if (sw < 4 || sh < 4) return null;
  const TW = 148, TH = 112;
  thumbCanvas.width = TW; thumbCanvas.height = TH;
  thumbCtx.fillStyle = "#0c0d0d"; thumbCtx.fillRect(0, 0, TW, TH);
  const s = Math.min(TW / sw, TH / sh), dw = sw * s, dh = sh * s;
  thumbCtx.drawImage(els.video, sx, sy, sw, sh, (TW - dw) / 2, (TH - dh) / 2, dw, dh);
  try { return thumbCanvas.toDataURL("image/jpeg", 0.7); } catch { return null; }
}

// On-screen toast: slides in at the top of the video, auto-dismisses. Visible in any recording.
// alarm=true -> bigger red pulsing toast with a "!" badge, stays longer.
function showToast(cat, stamp, alarm) {
  const t = document.createElement("div");
  t.className = "toast" + (alarm ? " alarm" : "");
  t.style.setProperty("--tc", cat.color);
  const icon = alarm ? `<span class="tbang">!</span>` : `<span class="tdot"></span>`;
  t.innerHTML = `${icon}<span class="ttitle">${escapeHtml(cat.title)}</span><span class="ttime">${stamp}</span>`;
  els.toasts.prepend(t);
  while (els.toasts.children.length > 3) els.toasts.lastElementChild.remove();
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 360); }, alarm ? 6000 : 3600);
}

// Urgent two-tone alarm for a high-risk alert (respects the sound toggle).
function alarm() {
  if (!soundOn) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    blip.ac = blip.ac || new AC();
    const ac = blip.ac;
    [0, 0.22].forEach((dt, i) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = "square"; o.frequency.value = i ? 1046 : 784;
      o.connect(g); g.connect(ac.destination);
      const t0 = ac.currentTime + dt;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.09, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.19);
      o.start(t0); o.stop(t0 + 0.2);
    });
  } catch {}
}

// Brief flash of the camera border in the alert colour.
let flashTimer = null;
function flashStage(color) {
  els.flash.style.setProperty("--fc", color);
  els.flash.classList.add("on");
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => els.flash.classList.remove("on"), 420);
}

function blip() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    blip.ac = blip.ac || new AC();
    const ac = blip.ac, o = ac.createOscillator(), g = ac.createGain();
    o.type = "sine"; o.frequency.value = 880;
    g.gain.value = 0.06;
    o.connect(g); g.connect(ac.destination);
    o.start(); o.frequency.exponentialRampToValueAtTime(660, ac.currentTime + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.18);
    o.stop(ac.currentTime + 0.2);
  } catch {}
}

// ===================== RENDER (60fps) =====================
function viewTransform() {
  const r = els.stage.getBoundingClientRect();
  const vw = els.video.videoWidth || 16, vh = els.video.videoHeight || 9;
  const scale = Math.min(r.width / vw, r.height / vh);
  const dispW = vw * scale, dispH = vh * scale;
  return { w: r.width, h: r.height, offX: (r.width - dispW) / 2, offY: (r.height - dispH) / 2, dispW, dispH };
}
function renderFrame() {
  if (!running) return;
  updateClock();
  try {
    const view = viewTransform();
    ctx.clearRect(0, 0, view.w, view.h);
    for (const t of tracks) emaToward(t.box, t.targetBox, FRAME_EASE * EMA_SLOW);
    for (const t of tracks) {
      if (t.confirmed && t.misses === 0) t.opacity = Math.min(1, t.opacity + FADE_IN);
      else if (t.misses > MAX_MISSES) t.opacity = Math.max(0, t.opacity - FADE_OUT);
      else if (!t.confirmed) t.opacity = Math.min(0.5, t.opacity + FADE_IN);
    }
    drawTracks(view);
    for (let i = tracks.length - 1; i >= 0; i--) {
      if (tracks[i].misses > MAX_MISSES && tracks[i].opacity <= 0.01) tracks.splice(i, 1);
    }
  } catch (e) { console.error("renderFrame:", e); }
  rafId = requestAnimationFrame(renderFrame);
}
function drawTracks(view) {
  ctx.lineWidth = 2;
  ctx.font = "600 12px Geist, sans-serif";
  for (const t of tracks) {
    if (t.opacity <= 0.02) continue;
    const bx = view.offX + t.box.x * view.dispW, by = view.offY + t.box.y * view.dispH;
    const bw = t.box.w * view.dispW, bh = t.box.h * view.dispH;
    if (bw < 2 || bh < 2) continue;
    const col = (CATS[t.cat] || {}).color || "#3B82F6";
    ctx.globalAlpha = t.opacity;
    ctx.strokeStyle = col;
    ctx.shadowColor = col; ctx.shadowBlur = 8;
    ctx.strokeRect(bx, by, bw, bh);
    ctx.shadowBlur = 0;
    const txt = `${t.label} ${Math.round((t.conf || 0) * 100)}%`;
    const tw = ctx.measureText(txt).width + 10;
    ctx.fillStyle = col;
    ctx.fillRect(bx, Math.max(0, by - 18), tw, 18);
    ctx.fillStyle = "#0f1010";
    ctx.fillText(txt, bx + 5, Math.max(12, by - 5));
    ctx.globalAlpha = 1;
  }
}

// ---- clock overlay (video time for a file, wall clock for a webcam) ----
function pad(n) { return String(n).padStart(2, "0"); }
function clockNow() {
  if (srcMode === "file" && els.video.duration && isFinite(els.video.currentTime)) {
    const s = Math.floor(els.video.currentTime);
    return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  }
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function updateClock() { els.camTime.textContent = clockNow(); }

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

init();
