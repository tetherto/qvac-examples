// QVAC MegaLoc demo: find where a Paris street photo was taken, on this machine.
//
//   npm start      -> http://127.0.0.1:3111
//
// Loads MegaLoc through the QVAC SDK once, plus the descriptors built by `npm run fetch` and
// `npm run index`. Each search embeds the query photo with the SDK, then ranks the database by
// cosine similarity. No network call at search time.
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadModel, embed, unloadModel, close, ModelType, MEGALOC_F16 } from '@qvac/sdk'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 3111)
const HOST = process.env.HOST || '127.0.0.1'
const DATA = path.join(HERE, 'data')
const EXAMPLES = path.join(HERE, 'examples')
const CHALLENGES = path.join(HERE, 'challenges') // You vs MegaLoc photos (not in the index)
const PUBLIC = path.join(HERE, 'public')
const DIM = 8448
const TOP = 5
const MAX_UPLOAD = 25 * 1024 * 1024

const readJson = (file, fallback) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback

if (!fs.existsSync(path.join(DATA, 'db.json')) || !fs.existsSync(path.join(DATA, 'descriptors.f32'))) {
  console.error('No street-photo index yet. Run `npm run fetch` then `npm run index` first (see README).')
  process.exit(1)
}
const db = readJson(path.join(DATA, 'db.json'))
const raw = fs.readFileSync(path.join(DATA, 'descriptors.f32'))
const desc = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
if (desc.length !== db.length * DIM) {
  console.error(`descriptors.f32 holds ${desc.length / DIM} rows but db.json lists ${db.length} photos. Run \`npm run index\` again.`)
  process.exit(1)
}
const index = readJson(path.join(DATA, 'index.json'), {})
const ids = new Set(db.map(r => r.id))

// Challenges: which photos MegaLoc gets right or wrong is re-measured on YOUR index by
// `npm run index` (data/challenges-measured.json), because Mapillary changes over time.
// If this index leaves fewer than 3 photos MegaLoc gets right or 2 it gets wrong, the game keeps the
// results we measured on our own index instead.
const shipped = readJson(path.join(CHALLENGES, 'challenges.json'), [])
const measuredHere = readJson(path.join(DATA, 'challenges-measured.json'), {})
const kinds = Object.values(measuredHere).map(m => m.kind)
const useHere = kinds.filter(k => k === 'hit').length >= 3 && kinds.filter(k => k === 'miss').length >= 2
const challenges = useHere ? shipped.map(c => measuredHere[c.file] ? { ...c, measured: measuredHere[c.file] } : c) : shipped

console.log(`database ${db.length} photos, loading MegaLoc`)
const t = performance.now()
const modelId = await loadModel({ modelSrc: MEGALOC_F16, modelType: ModelType.ggmlImageEmbedding })
const loadMs = Math.round(performance.now() - t)

function search (q) {
  const top = []
  for (let j = 0, o = 0; j < db.length; j++, o += DIM) {
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0
    for (let k = 0; k < DIM; k += 4) {
      s0 += q[k] * desc[o + k]; s1 += q[k + 1] * desc[o + k + 1]
      s2 += q[k + 2] * desc[o + k + 2]; s3 += q[k + 3] * desc[o + k + 3]
    }
    const s = s0 + s1 + s2 + s3
    if (top.length < TOP || s > top[top.length - 1].s) {
      top.push({ j, s }); top.sort((a, b) => b.s - a.s); if (top.length > TOP) top.pop()
    }
  }
  return top
}

let queue = Promise.resolve()
async function locate (bytes) {
  const t0 = performance.now()
  const { embedding, stats } = await embed({ modelId, input: { image: new Uint8Array(bytes) } })
  const t1 = performance.now()
  const top = search(Float32Array.from(embedding))
  const t2 = performance.now()
  return {
    matches: top.map(({ j, s }) => {
      const r = db[j]
      return { id: r.id, lat: r.lat, lon: r.lon, heading: Math.round(r.heading), score: +s.toFixed(3),
        creator: r.creator, year: r.captured_at ? new Date(r.captured_at).getUTCFullYear() : null }
    }),
    timing: { embedMs: Math.round(t1 - t0), nativeMs: stats?.totalTime ? Math.round(stats.totalTime) : null,
      searchMs: Math.round(t2 - t1), totalMs: Math.round(t2 - t0) },
    backendId: stats?.backendId ?? null,
  }
}

const meta = {
  photos: db.length,
  indexMsPerPhoto: index.msPerPhotoWall ?? null,
  indexWallMs: index.wallMs ?? null,
  loadMs,
  dims: DIM,
  points: db.map(r => [+r.lat.toFixed(6), +r.lon.toFixed(6)]),
  examples: readJson(path.join(EXAMPLES, 'examples.json'), []),
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json' }

function sendFile (res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found') }
    const ext = path.extname(file)
    const cache = ext === '.jpg' || ext === '.woff2' ? 'max-age=3600' : 'no-cache'
    res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': cache })
    res.end(buf)
  })
}

function json (res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (req.method === 'GET' && url.pathname === '/api/meta') return json(res, 200, meta)
  if (req.method === 'GET' && url.pathname === '/api/challenges') return json(res, 200, challenges)
  const ch = url.pathname.match(/^\/challenges\/(challenge-\d+\.jpg)$/)
  if (ch) return sendFile(res, path.join(CHALLENGES, ch[1]))
  if (req.method === 'GET' && url.pathname === '/map.json') return sendFile(res, path.join(HERE, 'map', 'map.json'))
  if (req.method === 'POST' && url.pathname === '/api/locate') {
    const chunks = []
    let size = 0
    req.on('data', c => { size += c.length; if (size > MAX_UPLOAD) req.destroy(); else chunks.push(c) })
    req.on('end', () => {
      const bytes = Buffer.concat(chunks)
      const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8
      const isPng = bytes[0] === 0x89 && bytes[1] === 0x50
      if (!isJpeg && !isPng) return json(res, 415, { error: 'Use a JPEG or PNG photo' })
      queue = queue.then(() => locate(bytes)).then(r => json(res, 200, r), e => json(res, 500, { error: String(e?.message || e) }))
    })
    return
  }
  const m = url.pathname.match(/^\/photo\/(\d+)\.jpg$/)
  if (m && ids.has(m[1])) return sendFile(res, path.join(DATA, 'img', `${m[1]}.jpg`))
  const ex = url.pathname.match(/^\/examples\/([\w-]+\.jpg)$/)
  if (ex) return sendFile(res, path.join(EXAMPLES, ex[1]))
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
  const file = path.join(PUBLIC, rel)
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end() }
  sendFile(res, file)
})

server.on('error', async e => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use. Stop the other server or start with PORT=${PORT + 1} npm start.`)
  else console.error(e)
  try { await unloadModel({ modelId }) } finally { await close(); process.exit(1) }
})
server.listen(PORT, HOST, () => console.log(`MegaLoc demo ready on http://${HOST}:${PORT} (model loaded in ${loadMs} ms)`))

let closing = false
async function shutdown () {
  if (closing) return
  closing = true
  server.close()
  try { await unloadModel({ modelId }) } finally { await close(); process.exit(0) }
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
