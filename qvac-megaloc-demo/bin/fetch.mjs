// Download the street photos the demo searches, from Mapillary (CC BY-SA 4.0).
//
//   npm run fetch                 all 10,000 photos (about 1.6 GB)
//   npm run fetch -- --limit 500  a quick try with the first 500
//
// mapillary-ids.json lists the photos we picked in Saint-Germain and Canal Saint-Martin, Paris:
// ordinary perspective photos, one frame every 8 m or 45 degrees per sequence, spread evenly over
// 25 m cells, with dark and blurry frames already removed. This script looks each id up with your
// own Mapillary token, downloads the 1024 px version and writes data/db.json. Photos already on
// disk are skipped, so it can be run again after an interruption.
//
// Needs MAPILLARY_TOKEN, a free client token from https://www.mapillary.com/dashboard/developers,
// in .env or in the environment. The token is sent in a header and never printed.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(HERE, 'data')
const IMG = path.join(DATA, 'img')
const BATCH = 100 // ids per API call
const LOOKUPS = 4 // API calls in flight
const DOWNLOADS = 12 // photo downloads in flight
const FIELDS = 'id,thumb_1024_url,computed_geometry,geometry,computed_compass_angle,compass_angle,captured_at,creator,sequence'

try { process.loadEnvFile(path.join(HERE, '.env')) } catch {}
const TOKEN = process.env.MAPILLARY_TOKEN?.trim()
if (!TOKEN) {
  console.error('MAPILLARY_TOKEN is not set. Copy .env.example to .env and paste your free client token from https://www.mapillary.com/dashboard/developers')
  process.exit(1)
}
const redact = s => String(s).split(TOKEN).join('<token>')

const limitAt = process.argv.indexOf('--limit')
let wanted = JSON.parse(fs.readFileSync(path.join(HERE, 'mapillary-ids.json'), 'utf8'))
if (limitAt > 0) wanted = wanted.slice(0, Number(process.argv[limitAt + 1]))
fs.mkdirSync(IMG, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function lookup (batch) {
  const url = `https://graph.mapillary.com/images?image_ids=${batch.join(',')}&fields=${FIELDS}`
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { headers: { Authorization: `OAuth ${TOKEN}` } })
      if (res.ok) return (await res.json()).data || []
      const body = redact((await res.text()).slice(0, 200))
      if (res.status === 401 || res.status === 403) throw Object.assign(new Error(`Mapillary refused the token (HTTP ${res.status}): ${body}`), { fatal: true })
      if (res.status < 500 && res.status !== 429) throw Object.assign(new Error(`HTTP ${res.status}: ${body}`), { fatal: true })
    } catch (e) {
      if (e.fatal) throw e
    }
    await sleep(1000 * 2 ** attempt)
  }
  throw new Error('The Mapillary API kept failing. Check your connection and run `npm run fetch` again.')
}

async function download (x) {
  const file = path.join(IMG, `${x.id}.jpg`)
  if (fs.existsSync(file)) return true
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(x.thumb_1024_url)
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer())
        if (buf[0] === 0xff && buf[1] === 0xd8) { fs.writeFileSync(file, buf); return true }
      }
    } catch {}
    await sleep(1000 * (attempt + 1))
  }
  return false
}

async function pool (items, size, fn) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i) }
  }))
  return out
}

const batches = []
for (let i = 0; i < wanted.length; i += BATCH) batches.push(wanted.slice(i, i + BATCH))
const found = new Map()
let done = 0
const t0 = performance.now()
console.log(`looking up ${wanted.length} photos on Mapillary`)

// Signed photo URLs expire, so each batch is downloaded right after it is looked up.
try {
  await pool(batches, LOOKUPS, async batch => {
    // Only numeric ids we asked for: they become file names and URLs.
    const asked = new Set(batch)
    const rows = (await lookup(batch)).filter(x => /^\d+$/.test(String(x.id)) && asked.has(String(x.id)))
    const ok = await pool(rows, DOWNLOADS, download)
    rows.forEach((x, k) => {
      const g = (x.computed_geometry || x.geometry)?.coordinates
      if (ok[k] && g) {
        found.set(x.id, {
          id: x.id, lat: g[1], lon: g[0],
          heading: x.computed_compass_angle ?? x.compass_angle ?? 0,
          sequence: x.sequence ?? null, captured_at: x.captured_at ?? null,
          creator: x.creator?.username ?? null,
        })
      }
    })
    done += batch.length
    if (done % 1000 < BATCH || done === wanted.length) {
      const s = (performance.now() - t0) / 1000
      console.log(`${done}/${wanted.length}  ${found.size} ready, ${Math.round(s)} s`)
    }
  })
} catch (e) {
  console.error(redact(e.message))
  process.exit(1)
}

const db = wanted.filter(id => found.has(id)).map(id => found.get(id))
fs.writeFileSync(path.join(DATA, 'db.json'), JSON.stringify(db))
const gone = wanted.length - db.length
console.log(`database ${db.length} photos in data/db.json${gone ? `, ${gone} no longer available on Mapillary or failed to download` : ''}`)
console.log('next: npm run index')
