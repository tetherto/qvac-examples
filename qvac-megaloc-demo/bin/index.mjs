// Embed every downloaded street photo with MegaLoc, on this machine.
//
//   npm run index
//
// Reads data/db.json and data/img/<id>.jpg (from `npm run fetch`). Writes data/descriptors.f32
// (N x 8448 float32, row i = db.json[i]) and data/index.json (timings). Resumable: if it stops,
// run it again and it carries on from the last written row.
//
// Then it plays every challenge photo of the game against this index and records which ones
// MegaLoc gets right (data/challenges-measured.json), so the game always deals 3 rounds MegaLoc
// wins and 2 it loses on YOUR index, even after Mapillary photos change.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadModel, embed, embedBatch, unloadModel, close, ModelType, MEGALOC_F16 } from '@qvac/sdk'

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(HERE, 'data')
const CHALLENGES = path.join(HERE, 'challenges')
const DIM = 8448
const BATCH = 16
const HIT_M = 50 // first match within 50 m: MegaLoc gets it right
const MISS_M = 100 // more than 100 m off: MegaLoc gets it wrong (in between: not used by the game)

if (!fs.existsSync(path.join(DATA, 'db.json'))) {
  console.error('data/db.json is missing. Run `npm run fetch` first.')
  process.exit(1)
}
const db = JSON.parse(fs.readFileSync(path.join(DATA, 'db.json'), 'utf8'))
const out = path.join(DATA, 'descriptors.f32')
const idsFile = path.join(DATA, 'descriptors.ids.json')
const rowBytes = DIM * 4

// Resume only if the descriptors were written for this exact list of photos.
const sameList = fs.existsSync(idsFile) && fs.readFileSync(idsFile, 'utf8') === JSON.stringify(db.map(r => r.id))
const size = sameList && fs.existsSync(out) ? fs.statSync(out).size : 0
const done = Math.floor(size / rowBytes)
if (fs.existsSync(out)) fs.truncateSync(out, done * rowBytes)
fs.writeFileSync(idsFile, JSON.stringify(db.map(r => r.id)))
console.log(`database ${db.length} photos, ${done} already embedded`)

function metres (a, b) {
  const dlat = (a[0] - b[0]) * 111320
  const dlon = (a[1] - b[1]) * 111320 * Math.cos(a[0] * Math.PI / 180)
  return Math.hypot(dlat, dlon)
}

let modelId
try {
  let t = performance.now()
  modelId = await loadModel({ modelSrc: MEGALOC_F16, modelType: ModelType.ggmlImageEmbedding })
  const loadMs = performance.now() - t
  const fd = fs.openSync(out, 'a')
  let nativeMs = 0
  let backendId
  t = performance.now()
  for (let i = done; i < db.length; i += BATCH) {
    const rows = db.slice(i, i + BATCH)
    const inputs = rows.map(r => ({ image: fs.readFileSync(path.join(DATA, 'img', `${r.id}.jpg`)) }))
    const { embedding, stats } = await embedBatch({ modelId, inputs })
    nativeMs += stats?.totalTime ?? 0
    backendId = stats?.backendId ?? backendId
    const buf = new Float32Array(rows.length * DIM)
    embedding.forEach((e, k) => buf.set(e, k * DIM))
    fs.writeSync(fd, Buffer.from(buf.buffer))
    const n = i + rows.length
    if (n % 800 < BATCH || n === db.length) {
      const per = (performance.now() - t) / (n - done)
      console.log(`${n}/${db.length}  ${per.toFixed(1)} ms per photo, about ${((db.length - n) * per / 60000).toFixed(1)} min left`)
    }
  }
  fs.closeSync(fd)
  const wallMs = performance.now() - t
  const n = db.length - done
  const summary = { photos: db.length, embeddedNow: n, loadMs: Math.round(loadMs), wallMs: Math.round(wallMs),
    msPerPhotoWall: n ? +(wallMs / n).toFixed(1) : null, msPerPhotoNative: n ? +(nativeMs / n).toFixed(1) : null,
    backendId: backendId ?? null }
  // Keep the timings of the run that embedded the whole set, not of a short resume.
  const prev = fs.existsSync(path.join(DATA, 'index.json')) ? JSON.parse(fs.readFileSync(path.join(DATA, 'index.json'), 'utf8')) : null
  if (done === 0 || !prev) fs.writeFileSync(path.join(DATA, 'index.json'), JSON.stringify(summary, null, 1))
  console.log(JSON.stringify(summary))

  // ---- measure the game's challenge photos against this index ----
  const raw = fs.readFileSync(out)
  const desc = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
  const challenges = JSON.parse(fs.readFileSync(path.join(CHALLENGES, 'challenges.json'), 'utf8'))
  const measured = {}
  for (const c of challenges) {
    const { embedding } = await embed({ modelId, input: { image: fs.readFileSync(path.join(CHALLENGES, c.file)) } })
    const q = Float32Array.from(embedding)
    let best = -Infinity, bestJ = -1
    for (let j = 0, o = 0; j < db.length; j++, o += DIM) {
      let s = 0
      for (let k = 0; k < DIM; k++) s += q[k] * desc[o + k]
      if (s > best) { best = s; bestJ = j }
    }
    const errorM = Math.round(metres([c.lat, c.lon], [db[bestJ].lat, db[bestJ].lon]))
    const kind = errorM <= HIT_M ? 'hit' : errorM > MISS_M ? 'miss' : 'close'
    measured[c.file] = { kind, errorM, score: +best.toFixed(3) }
  }
  fs.writeFileSync(path.join(DATA, 'challenges-measured.json'), JSON.stringify(measured, null, 1))
  const count = k => Object.values(measured).filter(m => m.kind === k).length
  console.log(`challenges: ${count('hit')} MegaLoc gets right, ${count('miss')} it gets wrong, ${count('close')} in between`)
  if (count('hit') < 3 || count('miss') < 2) console.log('warning: the game needs at least 3 photos MegaLoc gets right and 2 it gets wrong, so it will use the results we measured')
  console.log('next: npm start')
} finally {
  try { if (modelId) await unloadModel({ modelId }) } finally { await close() }
}
