// QVAC Image Generation demo: type a sentence, get an image, on this machine.
// One model (FLUX.2 [klein] 4B, split into diffusion model + Qwen3 text encoder + VAE), one queue.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  loadModel, diffusion, downloadAsset, getModelInfo,
  FLUX_2_KLEIN_4B_Q4_0, FLUX_2_KLEIN_4B_VAE, QWEN3_4B_Q4_K_M
} from '@qvac/sdk'
import { STYLES, IDEAS, styled, blocked } from './lib/prompts.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC = path.join(HERE, 'public')
const OUT = path.join(HERE, 'out')
const PORT = Number(process.env.PORT || 3098)
const HOST = process.env.HOST || '127.0.0.1'
fs.mkdirSync(OUT, { recursive: true })

// The three files FLUX.2 [klein] needs. Names are the SDK constant names, which getModelInfo takes.
const FILES = [
  { name: 'FLUX_2_KLEIN_4B_Q4_0', src: FLUX_2_KLEIN_4B_Q4_0, label: 'Image model' },
  { name: 'QWEN3_4B_Q4_K_M', src: QWEN3_4B_Q4_K_M, label: 'Text encoder' },
  { name: 'FLUX_2_KLEIN_4B_VAE', src: FLUX_2_KLEIN_4B_VAE, label: 'Decoder' }
]
const TOTAL_BYTES = FILES.reduce((n, f) => n + f.src.expectedSize, 0)

// 768 x 768 in 4 steps: 11 s on an M5 Max, and the distilled model needs no more steps than that.
const GEN = { width: 768, height: 768, steps: 4, guidance: 3.5, cfg_scale: 1 }

const state = { modelId: null, phase: 'checking', error: null, download: null, lastSeconds: null }
let loading = null

async function missingFiles () {
  const out = []
  for (const f of FILES) {
    const info = await getModelInfo({ name: f.name })
    if (!info.isCached) out.push(f)
  }
  return out
}

function ensureModel () {
  if (state.modelId) return Promise.resolve(state.modelId)
  if (loading) return loading
  state.phase = 'loading'
  loading = loadModel({
    modelSrc: FLUX_2_KLEIN_4B_Q4_0,
    modelType: 'sdcpp-generation',
    modelConfig: { device: 'gpu', threads: 4, llmModelSrc: QWEN3_4B_Q4_K_M, vaeModelSrc: FLUX_2_KLEIN_4B_VAE }
  }).then((id) => {
    state.modelId = id
    state.phase = 'ready'
    console.log('[image-gen] model ready')
    return id
  }).catch((err) => {
    state.phase = 'error'
    state.error = 'The model did not load. Restart the app, and check there is about 8 GB of free memory.'
    console.error('[image-gen] load failed:', err?.message || err)
    loading = null
    throw err
  })
  return loading
}

async function downloadAll () {
  // Nothing to fetch once the model is in memory or on its way there.
  if (state.modelId || ['downloading', 'loading', 'ready'].includes(state.phase)) return
  state.phase = 'downloading'
  state.error = null
  try {
    const missing = await missingFiles()
    let done = FILES.filter((f) => !missing.includes(f)).reduce((n, f) => n + f.src.expectedSize, 0)
    for (const f of missing) {
      await downloadAsset({
        assetSrc: f.src,
        onProgress: (p) => {
          state.download = { label: f.label, received: done + (p.downloaded || 0), total: TOTAL_BYTES }
        }
      })
      done += f.src.expectedSize
    }
    state.download = null
    await ensureModel()
  } catch (err) {
    state.download = null
    // A failed load already set its own phase and message; only a failed download lands here.
    if (state.phase === 'error') return
    state.phase = 'needs-download'
    state.error = 'The download stopped. Check the connection and press Download again: it resumes where it stopped.'
    console.error('[image-gen] download failed:', err?.message || err)
  }
}

// One generation at a time. Visitors wait in line instead of getting an error.
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

async function generate (req, res, body) {
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, 300) : ''
  const style = Object.hasOwn(STYLES, body.style) ? body.style : 'none'
  if (!prompt) return json(res, 400, { error: 'Write what you want to see first.' })
  if (blocked(prompt)) return json(res, 422, { error: 'Try a different idea. This demo keeps images family friendly.' })
  if (state.phase === 'error') return json(res, 503, { error: state.error || 'The model did not load.' })
  if (!state.modelId && state.phase !== 'loading' && state.phase !== 'ready') {
    return json(res, 409, { error: 'The model is not downloaded yet.' })
  }

  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
  const send = (event, data) => { if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) }
  let gone = false
  res.on('close', () => { gone = true })

  send('queued', { ahead: running ? waiting.length + 1 : 0 })
  const ok = await acquire()
  if (!ok) { send('fail', { error: 'Too many people are waiting. Try again in a minute.' }); return res.end() }
  if (gone) { release(); return }

  const t0 = Date.now()
  try {
    const modelId = await ensureModel()
    const seed = crypto.randomInt(1, 2 ** 31 - 1)
    const { progressStream, outputs } = diffusion({ modelId, prompt: styled(prompt, style), seed, ...GEN })
    send('start', { estimate: state.lastSeconds })
    for await (const { step, totalSteps } of progressStream) send('step', { step, total: totalSteps })
    const [png] = await outputs
    const id = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
    fs.writeFileSync(path.join(OUT, `${id}.png`), png)
    const seconds = Math.round((Date.now() - t0) / 100) / 10
    state.lastSeconds = seconds
    send('done', { url: `/out/${id}.png`, seconds })
    console.log(`[image-gen] ${seconds}s, style=${style}`)
  } catch (err) {
    console.error('[image-gen] generation failed:', err?.message || err)
    send('fail', { error: 'That image did not render. Try again.' })
  } finally {
    release()
    res.end()
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
    if (p === '/api/status') {
      return json(res, 200, {
        phase: state.phase, error: state.error, download: state.download,
        totalBytes: TOTAL_BYTES, lastSeconds: state.lastSeconds, styles: Object.keys(STYLES), ideas: IDEAS
      })
    }
    const outMatch = /^\/out\/([a-z0-9]+-[a-f0-9]{8})\.png$/.exec(p)
    if (outMatch) return sendFile(res, path.join(OUT, `${outMatch[1]}.png`))
    if (/^\/(assets\/)?[A-Za-z0-9._-]+$/.test(p) && !p.includes('..')) return sendFile(res, path.join(PUBLIC, p))
    return json(res, 404, { error: 'Not found' })
  }

  if (req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'Forbidden' })
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return json(res, 415, { error: 'JSON only' })
    let body
    try { body = await readBody(req) } catch { return json(res, 400, { error: 'Bad request' }) }
    if (p === '/api/download') { downloadAll(); return json(res, 202, { ok: true }) }
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
    const missing = await missingFiles()
    if (missing.length) {
      state.phase = 'needs-download'
      console.log(`[image-gen] ${missing.length} model file(s) missing: open the page and press Download`)
    } else {
      ensureModel().catch(() => {})
    }
  } catch (err) {
    state.phase = 'error'
    state.error = 'Could not read the model cache.'
    console.error('[image-gen] model check failed:', err?.message || err)
  }
})

process.on('unhandledRejection', (err) => console.error('[image-gen] unhandled:', err?.message || err))
