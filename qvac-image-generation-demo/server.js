// QVAC Image Generation demo: type a sentence, get an image, on this machine.
// Three models from the QVAC registry, one in memory at a time, one queue.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  loadModel, unloadModel, diffusion, downloadAsset, getModelInfo,
  FLUX_2_KLEIN_4B_Q4_0, FLUX_2_KLEIN_4B_VAE, QWEN3_4B_Q4_K_M,
  SDXL_BASE_1_0_3B_Q4_0, SD_V2_1_1B_Q8_0
} from '@qvac/sdk'
import { STYLES, IDEAS, styled, blocked } from './lib/prompts.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC = path.join(HERE, 'public')
const OUT = path.join(HERE, 'out')
const SEEDS = path.join(OUT, 'seeds') // seed images sent by the page, kept for the last few requests
const SEEDS_KEPT = 30
const PORT = Number(process.env.PORT || 3098)
const HOST = process.env.HOST || '127.0.0.1'
fs.mkdirSync(SEEDS, { recursive: true })

// Each model with the settings it was trained for. Run a model away from its native size or with
// the wrong guidance and the output degrades, so these are defaults and limits, not suggestions.
// File names are the SDK constant names, which getModelInfo takes.
const MODELS = {
  flux: {
    label: 'FLUX.2 klein 4B',
    // A split model: the diffusion model, a Qwen3 LLM as text encoder, and a VAE decoder.
    files: [
      { name: 'FLUX_2_KLEIN_4B_Q4_0', src: FLUX_2_KLEIN_4B_Q4_0, label: 'Image model' },
      { name: 'QWEN3_4B_Q4_K_M', src: QWEN3_4B_Q4_K_M, label: 'Text encoder' },
      { name: 'FLUX_2_KLEIN_4B_VAE', src: FLUX_2_KLEIN_4B_VAE, label: 'Decoder' }
    ],
    // prediction 'flux2_flow' lets FLUX take a seed image (in-context conditioning); text to image
    // works the same with it, so it is always on.
    load: { modelSrc: FLUX_2_KLEIN_4B_Q4_0, modelConfig: { device: 'gpu', threads: 4, llmModelSrc: QWEN3_4B_Q4_K_M, vaeModelSrc: FLUX_2_KLEIN_4B_VAE, prediction: 'flux2_flow' } },
    // Step- and guidance-distilled: 4 steps is enough (8 doubles the time for no visible gain).
    gen: { cfg_scale: 1, guidance: 3.5 },
    // FLUX edits a seed image from the prompt; it has no strength setting.
    strength: false,
    sizes: [512, 768, 1024],
    size: 768,
    steps: { min: 1, max: 12, value: 4 }
  },
  sdxl: {
    label: 'SDXL 1.0',
    files: [{ name: 'SDXL_BASE_1_0_3B_Q4_0', src: SDXL_BASE_1_0_3B_Q4_0, label: 'Image model' }],
    load: { modelSrc: SDXL_BASE_1_0_3B_Q4_0, modelConfig: { device: 'gpu', threads: 4 } },
    gen: { cfg_scale: 7 },
    // Stable Diffusion redraws a seed image (SDEdit): strength 0 keeps it, 1 ignores it.
    strength: true,
    // Trained at 1024; at 512 its images come out mangled.
    sizes: [768, 1024],
    size: 1024,
    steps: { min: 10, max: 50, value: 30 }
  },
  sd21: {
    label: 'SD 2.1',
    files: [{ name: 'SD_V2_1_1B_Q8_0', src: SD_V2_1_1B_Q8_0, label: 'Image model' }],
    load: { modelSrc: SD_V2_1_1B_Q8_0, modelConfig: { device: 'gpu', threads: 4, prediction: 'v' } },
    gen: { cfg_scale: 7 },
    strength: true,
    // The registry file is the 768 v-prediction model: 768 is its native size, 512 is a faster draft.
    sizes: [512, 768],
    size: 768,
    steps: { min: 10, max: 50, value: 30 }
  }
}
const DEFAULT_MODEL = 'flux'
const bytesOf = (m) => m.files.reduce((n, f) => n + f.src.expectedSize, 0)

// cached: every file on disk. lastSeconds: the last generation time, to quote before the next one.
const models = Object.fromEntries(Object.keys(MODELS).map((k) => [k, { cached: false, lastSeconds: null, error: null }]))
const state = { loaded: null, loading: null, download: null, checked: false }

async function refreshCached (key) {
  let all = true
  for (const f of MODELS[key].files) {
    if (!(await getModelInfo({ name: f.name })).isCached) all = false
  }
  models[key].cached = all
  return all
}

// Load and unload happen one after the other, never at the same time as a generation: callers hold
// the generation queue (see acquire) while they switch models.
async function ensureModel (key) {
  if (state.loaded?.key === key) return state.loaded.modelId
  if (state.loaded) {
    const old = state.loaded
    state.loaded = null
    // autoClose: false. Unloading the last model would otherwise stop the SDK's worker, and with it
    // any download in progress.
    try { await unloadModel({ modelId: old.modelId, clearStorage: false, autoClose: false }) } catch (err) {
      console.error('[image-gen] unload failed:', err?.message || err)
    }
  }
  state.loading = key
  models[key].error = null
  try {
    const modelId = await loadModel({ modelType: 'sdcpp-generation', ...MODELS[key].load })
    state.loaded = { key, modelId }
    console.log(`[image-gen] ${MODELS[key].label} ready`)
    return modelId
  } catch (err) {
    models[key].error = 'The model did not load. Check there is about 8 GB of free memory, then try again.'
    console.error('[image-gen] load failed:', err?.message || err)
    throw err
  } finally {
    state.loading = null
  }
}

// One generation (or model switch) at a time. Visitors wait in line instead of getting an error.
const QUEUE_MAX = 6
let running = false
const waiting = []
function acquire () {
  if (!running) { running = true; return Promise.resolve(true) }
  if (waiting.length >= QUEUE_MAX) return Promise.resolve(false)
  return new Promise((resolve) => waiting.push(resolve))
}
function release () {
  const next = waiting.shift()
  if (next) next(true)
  else running = false
}

// Load a model ahead of the first click, through the queue so it never cuts into a generation.
async function preload (key) {
  if (!(await acquire())) return
  // By the time the queue lets us in, someone may already have loaded the model they want.
  try { if (!state.loaded) await ensureModel(key) } catch {} finally { release() }
}

async function downloadModel (key) {
  const m = MODELS[key]
  try {
    if (await refreshCached(key)) return
    const total = bytesOf(m)
    let done = 0
    for (const f of m.files) {
      if (!(await getModelInfo({ name: f.name })).isCached) {
        await downloadAsset({
          assetSrc: f.src,
          onProgress: (p) => { state.download = { key, label: f.label, received: done + (p.downloaded || 0), total } }
        })
      }
      done += f.src.expectedSize
    }
    await refreshCached(key)
    state.download = null
    if (!state.loaded && key === DEFAULT_MODEL) preload(key)
  } catch (err) {
    models[key].error = 'The download stopped. Check the connection and press Download again: it resumes where it stopped.'
    console.error('[image-gen] download failed:', err?.message || err)
  } finally {
    state.download = null
  }
}

// What a request may ask for: a known model, one of its sizes, steps in its range, a seed or none.
function settingsFrom (body) {
  const key = typeof body.model === 'string' && Object.hasOwn(MODELS, body.model) ? body.model : DEFAULT_MODEL
  const m = MODELS[key]
  const size = m.sizes.includes(Number(body.size)) ? Number(body.size) : m.size
  const steps = Number.isInteger(body.steps) ? Math.min(m.steps.max, Math.max(m.steps.min, body.steps)) : m.steps.value
  const seed = Number.isInteger(body.seed) && body.seed >= 0 && body.seed < 2 ** 31 ? body.seed : crypto.randomInt(0, 2 ** 31 - 1)
  // A seed image is referenced by the id /api/seed returned, never by a path.
  const seedImage = typeof body.seedImage === 'string' && /^[a-f0-9]{16}$/.test(body.seedImage) ? body.seedImage : null
  const strength = typeof body.strength === 'number' && Number.isFinite(body.strength) ? Math.min(1, Math.max(0.1, body.strength)) : 0.6
  return { key, size, steps, seed, seedImage, strength }
}

async function generate (req, res, body) {
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, 300) : ''
  const style = Object.hasOwn(STYLES, body.style) ? body.style : 'none'
  if (!prompt) return json(res, 400, { error: 'Write what you want to see first.' })
  if (blocked(prompt)) return json(res, 422, { error: 'Try a different idea. This demo keeps images family friendly.' })
  const s = settingsFrom(body)
  const m = MODELS[s.key]
  if (!models[s.key].cached) return json(res, 409, { error: `Download ${m.label} first.` })
  let initImage = null
  if (s.seedImage) {
    try { initImage = new Uint8Array(fs.readFileSync(path.join(SEEDS, `${s.seedImage}.png`))) } catch {
      return json(res, 410, { error: 'The seed image expired. Add it again.' })
    }
  }

  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
  const send = (event, data) => { if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) }
  let gone = false
  res.on('close', () => { gone = true })

  send('queued', { ahead: running ? waiting.length + 1 : 0, loading: state.loading ? MODELS[state.loading].label : null })
  const ok = await acquire()
  if (!ok) { send('fail', { error: 'Too many people are waiting. Try again in a minute.' }); return res.end() }
  if (gone) { release(); return }

  try {
    if (state.loaded?.key !== s.key) send('loading', { label: m.label })
    const modelId = await ensureModel(s.key)
    const t0 = Date.now()
    const seeded = initImage ? { init_image: initImage, ...(m.strength ? { strength: s.strength } : {}) } : {}
    const { progressStream, outputs } = diffusion({
      modelId, prompt: styled(prompt, style), seed: s.seed, steps: s.steps, width: s.size, height: s.size, ...m.gen, ...seeded
    })
    send('start', { estimate: models[s.key].lastSeconds })
    for await (const { step, totalSteps } of progressStream) send('step', { step, total: totalSteps })
    const [png] = await outputs
    const id = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
    fs.writeFileSync(path.join(OUT, `${id}.png`), png)
    const seconds = Math.round((Date.now() - t0) / 100) / 10
    models[s.key].lastSeconds = seconds
    send('done', {
      url: `/out/${id}.png`, seconds, model: s.key, label: m.label, size: s.size, steps: s.steps, seed: s.seed,
      seedImage: Boolean(initImage), strength: initImage && m.strength ? s.strength : null
    })
    console.log(`[image-gen] ${m.label} ${s.size}px ${s.steps} steps seed ${s.seed}: ${seconds}s, style=${style}`)
  } catch (err) {
    console.error('[image-gen] generation failed:', err?.message || err)
    // A crashed worker comes back empty: forget the model so the next request loads it again.
    if (state.loaded?.key === s.key && /WORKER_CRASHED|MODEL_NOT_FOUND|MODEL_NOT_LOADED/.test(`${err?.name} ${err?.message}`)) {
      state.loaded = null
    }
    send('fail', { error: models[s.key].error || 'That image did not render. Try again.' })
  } finally {
    release()
    res.end()
  }
}

function status () {
  return {
    checked: state.checked,
    loaded: state.loaded?.key || null,
    loading: state.loading,
    download: state.download,
    defaultModel: DEFAULT_MODEL,
    models: Object.entries(MODELS).map(([key, m]) => ({
      key,
      label: m.label,
      bytes: bytesOf(m),
      cached: models[key].cached,
      error: models[key].error,
      lastSeconds: models[key].lastSeconds,
      sizes: m.sizes,
      size: m.size,
      steps: m.steps,
      strength: m.strength
    })),
    styles: Object.keys(STYLES),
    ideas: IDEAS
  }
}

// HTTP plumbing.
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain' }

function json (res, code, data) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(data))
}

function sendFile (res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) return json(res, 404, { error: 'Not found' })
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' })
    res.end(buf)
  })
}

// Bound to this computer, answer only to this computer's own names: a web page that rebinds its
// domain to 127.0.0.1 cannot reach the server. With HOST set to a network address the check is off.
const LOOPBACK = ['127.0.0.1', 'localhost', '::1'].includes(HOST)
const OWN_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`])
function hostAllowed (req) {
  return !LOOPBACK || OWN_HOSTS.has(String(req.headers.host || '').toLowerCase())
}

function sameOrigin (req) {
  const origin = req.headers.origin
  if (!origin) return true
  try { return new URL(origin).host === req.headers.host } catch { return false }
}

// A seed image: a PNG the page has already cropped and resized, at most 1024 px a side.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
function readRaw (req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { reject(new Error('too large')); req.destroy() } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function saveSeed (buf) {
  if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIGNATURE) || buf.toString('latin1', 12, 16) !== 'IHDR') return null
  const w = buf.readUInt32BE(16)
  const h = buf.readUInt32BE(20)
  if (w < 64 || h < 64 || w > 1024 || h > 1024) return null
  const id = crypto.randomBytes(8).toString('hex')
  fs.writeFileSync(path.join(SEEDS, `${id}.png`), buf)
  // Keep the most recent few; a booth runs for days.
  const old = fs.readdirSync(SEEDS).map((f) => ({ f, t: fs.statSync(path.join(SEEDS, f)).mtimeMs })).sort((a, b) => b.t - a.t).slice(SEEDS_KEPT)
  for (const { f } of old) fs.rmSync(path.join(SEEDS, f), { force: true })
  return id
}

function readBody (req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > 4096) { reject(new Error('too large')); req.destroy() } else chunks.push(c)
    })
    req.on('end', () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        resolve(parsed && typeof parsed === 'object' ? parsed : {})
      } catch { reject(new Error('bad json')) }
    })
    req.on('error', reject)
  })
}

const server = http.createServer(async (req, res) => {
  let url
  try { url = new URL(req.url, 'http://localhost') } catch { return json(res, 400, { error: 'Bad request' }) }
  const p = url.pathname
  if (!hostAllowed(req)) return json(res, 403, { error: 'Forbidden' })

  if (req.method === 'GET') {
    if (p === '/') return sendFile(res, path.join(PUBLIC, 'index.html'))
    if (p === '/api/status') return json(res, 200, status())
    const outMatch = /^\/out\/([a-z0-9]+-[a-f0-9]{8})\.png$/.exec(p)
    if (outMatch) return sendFile(res, path.join(OUT, `${outMatch[1]}.png`))
    if (/^\/(assets\/)?[A-Za-z0-9._-]+$/.test(p) && !p.includes('..')) return sendFile(res, path.join(PUBLIC, p))
    return json(res, 404, { error: 'Not found' })
  }

  if (req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'Forbidden' })
    if (p === '/api/seed') {
      // image/png is not a type a form or a no-cors request can send, so this also needs a preflight.
      if (String(req.headers['content-type'] || '') !== 'image/png') return json(res, 415, { error: 'PNG only' })
      let buf
      try { buf = await readRaw(req, 12 * 1024 * 1024) } catch { return json(res, 413, { error: 'That image is too large.' }) }
      const id = saveSeed(buf)
      return id ? json(res, 200, { id }) : json(res, 400, { error: 'That file is not a usable image.' })
    }
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return json(res, 415, { error: 'JSON only' })
    let body
    try { body = await readBody(req) } catch { return json(res, 400, { error: 'Bad request' }) }
    if (p === '/api/download') {
      const key = typeof body.model === 'string' && Object.hasOwn(MODELS, body.model) ? body.model : DEFAULT_MODEL
      if (state.download?.key === key) return json(res, 202, { ok: true })
      if (state.download) return json(res, 409, { error: 'Another model is downloading. Wait for it to finish.' })
      state.download = { key, label: 'Checking', received: 0, total: bytesOf(MODELS[key]) }
      models[key].error = null
      downloadModel(key)
      return json(res, 202, { ok: true })
    }
    if (p === '/api/generate') return generate(req, res, body)
    return json(res, 404, { error: 'Not found' })
  }

  json(res, 405, { error: 'Method not allowed' })
})

server.requestTimeout = 15000
server.headersTimeout = 10000
server.listen(PORT, HOST, async () => {
  console.log(`[image-gen] http://localhost:${PORT}`)
  try {
    for (const key of Object.keys(MODELS)) await refreshCached(key)
    state.checked = true
    if (models[DEFAULT_MODEL].cached) preload(DEFAULT_MODEL)
    else console.log(`[image-gen] ${MODELS[DEFAULT_MODEL].label} is not downloaded: open the page and press Download`)
  } catch (err) {
    state.checked = true
    for (const key of Object.keys(MODELS)) models[key].error = 'Could not read the model cache.'
    console.error('[image-gen] model check failed:', err?.message || err)
  }
})

process.on('unhandledRejection', (err) => console.error('[image-gen] unhandled:', err?.message || err))
