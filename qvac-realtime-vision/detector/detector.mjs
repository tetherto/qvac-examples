// QVAC ONNX Detector service (Bare runtime)
// Loads a YOLO-World open-vocab detector (ONNX, ~110 curated classes) on the @qvac/onnx engine and
// exposes a small HTTP server: POST /detect with body = RGB 640x640 (uint8, HWC) -> JSON boxes.
// 100% QVAC: uses the QVAC SDK's ONNX engine, no external runtime.
import onnx from '@qvac/onnx'
import http from 'bare-http1'
import { Buffer } from 'bare-buffer'

const PORT = 3085
const SIZE = 640
const HW = SIZE * SIZE
// Paths RELATIVE to cwd (server.js launches the detector with cwd = project root):
// this way it works on Windows and macOS without changes.
const MODEL = (typeof Bare !== 'undefined' && Bare.argv && Bare.argv[2]) || 'models/yolo-world.onnx'
const SCORE_MIN = 0.25  // lower = more recall (catch more objects); raise toward 0.35 if you see junk labels

// Open-vocab class list baked into the YOLO-World export (must match scripts that built the .onnx).
// To change what the detector can recognise, edit the VOCAB in the export script and re-export.
const LABELS = ['person','face','hand','glasses','sunglasses','hat','cap','helmet','headphones','earbuds','face mask','phone','laptop','tablet','keyboard','mouse','monitor','tv','camera','microphone','speaker','smartwatch','watch','vr headset','game controller','remote','drone','charger','cable','usb drive','power bank','battery','backpack','handbag','suitcase','wallet','keys','lanyard','badge','id card','credit card','banknote','coin','umbrella','pen','pencil','marker','notebook','book','magazine','paper','sticky note','sticker','business card','folder','scissors','stapler','ruler','envelope','poster','whiteboard','bottle','cup','mug','coffee cup','wine glass','can','banana','apple','orange','sandwich','donut','pizza','cake','candy','chocolate','t-shirt','jacket','hoodie','tie','scarf','gloves','shoe','sneaker','boot','chair','couch','table','desk','lamp','potted plant','clock','picture frame','mirror','shelf','trash can','fan','ball','balloon','teddy bear','toy','dice','flag','gift box','box','tissue','toothbrush','ring','bracelet','necklace']

const HAND_MODEL = 'models/yolo_hand_pose.onnx'
const HAND_SCORE_MIN = 0.40
const NMS_IOU = 0.5  // IoU threshold for the JS non-max-suppression of the raw YOLO-World output

// IoU of two {x1,y1,x2,y2} boxes (pixel space) for NMS.
function bIou(a, b) {
  const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1))
  const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1))
  const inter = ix * iy
  const ua = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter
  return ua > 0 ? inter / ua : 0
}

onnx.configureEnvironment({ loggingLevel: 'error' })
console.log('[detector] providers:', JSON.stringify(onnx.getAvailableProviders()))
console.log('[detector] loading object model:', MODEL)
const session = onnx.createSession(MODEL, { provider: 'auto_gpu' })
const INPUT_NAME = onnx.getInputInfo(session)[0].name
console.log('[detector] loading hand-pose model:', HAND_MODEL)
const handSession = onnx.createSession(HAND_MODEL, { provider: 'auto_gpu' })
const HAND_INPUT = onnx.getInputInfo(handSession)[0].name
console.log('[detector] ready -> http://0.0.0.0:' + PORT)

// reusable buffer for the CHW float32 tensor (no per-frame realloc)
const tensor = new Float32Array(3 * HW)
let busy = false

function infer(rgb, wantObjects, wantHands) {
  // rgb: Buffer/Uint8Array HWC RGB (length 640*640*3) -> CHW float32 /255
  for (let i = 0; i < HW; i++) {
    tensor[i] = rgb[i * 3] / 255
    tensor[HW + i] = rgb[i * 3 + 1] / 255
    tensor[2 * HW + i] = rgb[i * 3 + 2] / 255
  }
  const tin = [{ name: INPUT_NAME, shape: [1, 3, SIZE, SIZE], type: 'float32', data: tensor }]

  // --- objects (YOLO-World RAW output [1, 4+NC, A]: box(cx,cy,w,h) + per-class scores) ---
  // NMS is done HERE in JS (not in the ONNX graph): the embedded-NMS export crashed CoreML
  // on empty frames (GatherND with 0 elements). Raw output runs fine on CoreML; JS NMS also
  // handles the "nothing detected" case trivially. Skipped (?objects=0) in Fruit mode.
  let dets = null
  if (wantObjects) {
    const out = onnx.run(session, tin)
    const o = out[0].data
    const NC = LABELS.length
    const A = (o.length / (4 + NC)) | 0   // anchors (e.g. 8400)
    const cand = []
    for (let a = 0; a < A; a++) {
      let best = -1, bsc = SCORE_MIN
      for (let c = 0; c < NC; c++) { const v = o[(4 + c) * A + a]; if (v > bsc) { bsc = v; best = c } }
      if (best < 0) continue
      const cx = o[a], cy = o[A + a], w = o[2 * A + a], h = o[3 * A + a]
      cand.push({ x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2, score: bsc, cls: best })
    }
    cand.sort((p, q) => q.score - p.score)
    dets = []
    const kept = []
    for (const dcand of cand) {
      let drop = false
      for (const k of kept) { if (k.cls === dcand.cls && bIou(dcand, k) > NMS_IOU) { drop = true; break } }
      if (drop) continue
      kept.push(dcand)
      dets.push({ label: LABELS[dcand.cls] || 'obj', score: +dcand.score.toFixed(3), box: [dcand.x1 / SIZE, dcand.y1 / SIZE, dcand.x2 / SIZE, dcand.y2 / SIZE] })
      if (dets.length >= 60) break
    }
  }

  // --- hands (YOLO hand-pose, [1,300,69]: x1,y1,x2,y2,score,class,(kx,ky,kc)x21) ---
  // Only every other frame (client sends ?hands=0 to skip) -> roughly doubles the object
  // detection rate. When skipped we return hands:null so the client keeps the last hands.
  let hands = null
  if (wantHands) {
    const ho = onnx.run(handSession, [{ name: HAND_INPUT, shape: [1, 3, SIZE, SIZE], type: 'float32', data: tensor }])
    const hd = ho[0].data
    hands = []
    for (let i = 0; i < 300; i++) {
      const b = i * 69
      const sc = hd[b + 4]
      if (sc < HAND_SCORE_MIN) continue
      const kpts = []
      for (let k = 0; k < 21; k++) {
        kpts.push([hd[b + 6 + k*3] / SIZE, hd[b + 6 + k*3 + 1] / SIZE, +hd[b + 6 + k*3 + 2].toFixed(2)])
      }
      hands.push({
        score: +sc.toFixed(3),
        box: [hd[b] / SIZE, hd[b+1] / SIZE, hd[b+2] / SIZE, hd[b+3] / SIZE],
        kpts,
      })
    }
  }
  return { objects: dets, hands }
}

const server = http.createServer((req, res) => {
  // CORS (the client is served from :3080 / local IP)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'content-type')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, model: MODEL, size: SIZE, providers: onnx.getAvailableProviders() }))
    return
  }

  if (req.method === 'POST' && req.url.startsWith('/detect')) {
    if (busy) { res.writeHead(429); res.end('{"error":"busy"}'); return }
    const wantObjects = !/[?&]objects=0/.test(req.url) // skipped in Fruit mode (only hands needed)
    const wantHands = !/[?&]hands=0/.test(req.url)      // skipped in Detect alt-frames + Head mode
    const chunks = []
    let len = 0
    req.on('data', (c) => { chunks.push(c); len += c.length })
    req.on('end', () => {
      const body = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks)
      if (len < 3 * HW) { res.writeHead(400); res.end('{"error":"frame too small"}'); return }
      busy = true
      const t0 = Date.now()
      let r
      try { r = infer(body, wantObjects, wantHands) } catch (e) { busy = false; res.writeHead(500); res.end(JSON.stringify({ error: String(e && e.message || e) })); return }
      busy = false
      res.writeHead(200, { 'content-type': 'application/json' })
      // omit a part when skipped so the client keeps the previous overlay (no flicker)
      res.end(JSON.stringify({ ok: true, ms: Date.now() - t0, ...(r.objects != null ? { objects: r.objects } : {}), ...(r.hands != null ? { hands: r.hands } : {}) }))
    })
    req.on('error', () => { busy = false; try { res.writeHead(500); res.end('{"error":"stream"}') } catch {} })
    return
  }

  res.writeHead(404); res.end('not found')
})

server.listen(PORT, '0.0.0.0', () => console.log('[detector] listening on ' + PORT))
