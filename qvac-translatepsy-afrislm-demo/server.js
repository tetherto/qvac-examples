// AFRI TRANSLATE - server
// ---------------------------------------------------------------------------
// Scan a document or paste text, then translate between English and the 19
// Sub-Saharan African languages TranslatePsy-AfriSLM was fine-tuned on. Two models,
// and the second one is optional:
//
//   translator  TranslatePsy-AfriSLM, a Hugging Face GGUF loaded by URL. Required.
//   reader      a registry vision model (VisionPsy-Nano). Only for the scan tab.
//
// AfriSLM does not read images, which is why scanning needs the reader in front of
// it. Everything runs locally and nothing is uploaded.
//
// The onboarding is the interesting part: before anything is downloaded the app asks
// the SDK what this machine can hold (`assessModelFit`, SDK 0.19) and recommends one
// model rather than presenting six.
// ---------------------------------------------------------------------------

import http from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { sdk } from './lib/sdk.js'
import {
  VARIANTS, variantById, variantUrl, variantCached, READERS, readerById, availableReaders,
  machineBudget, assessReaders, assessVariants, recommend
} from './lib/models.js'
import { FINE_TUNED, HELD_OUT, OTHER, nameFor, buildPrompt, splitForTranslation } from './lib/translate.js'
import { readDocument } from './lib/ocr.js'
import { detect } from './lib/detect.js'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 3065)
const UP = path.join(DIR, 'uploads')
fs.mkdirSync(UP, { recursive: true })

let EXAMPLES = { languages: {} }
try { EXAMPLES = JSON.parse(fs.readFileSync(path.join(DIR, 'fixtures', 'test-sentences.json'), 'utf8')) } catch {}

const state = {
  sdkInfo: null,
  mod: null,
  fit: null,          // { budget, variants, recommended, readers, method }
  translator: null,   // { variantId, modelId, params, quant, loadedMs }
  reader: null,       // { readerId, modelId, label }
  busy: null
}

// One model worker, so one queue. Unloads included: overlapping worker operations is
// how a recipe ends up hanging with nothing to read.
let chain = Promise.resolve()
function serialize (label, fn) {
  const run = chain.then(async () => {
    state.busy = label
    push({ t: 'busy', label })
    try { return await fn() } finally {
      state.busy = null
      push({ t: 'busy', label: null })
    }
  })
  chain = run.catch(() => {})
  return run
}

const clients = new Set()
function push (event) {
  const line = `data: ${JSON.stringify(event)}\n\n`
  for (const res of clients) { try { res.write(line) } catch {} }
}

/**
 * Download an asset and report progress, before anything is loaded.
 *
 * `loadModel` downloads implicitly and says nothing while it does, which is why the
 * onboarding used to sit on the word "downloading" for three gigabytes.
 * `downloadAsset` takes the same source (a registry src, an https URL or a local
 * path) and streams `{ downloaded, total, percentage }`.
 *
 * It streams a LOT: measured at 74,658 events in 53 seconds for a 1.08 GB file,
 * about 1,400 a second. Pushing those straight down the event stream would flood the
 * page, so they are throttled to five a second plus a guaranteed final one.
 */
async function downloadWithProgress (mod, assetSrc, label, index, count) {
  let last = 0
  let seen = { downloaded: 0, total: 0 }
  push({ t: 'download', label, index, count, percentage: 0, downloaded: 0, total: 0 })
  await mod.downloadAsset({
    assetSrc,
    onProgress: (p) => {
      seen = { downloaded: p.downloaded, total: p.total }
      const now = Date.now()
      if (now - last < 200) return
      last = now
      push({ t: 'download', label, index, count, percentage: p.percentage, downloaded: p.downloaded, total: p.total })
    }
  })
  push({ t: 'download', label, index, count, percentage: 100, downloaded: seen.total || seen.downloaded, total: seen.total, done: true })
}

async function ensureSdk () {
  if (!state.mod) {
    const s = await sdk()
    state.mod = s.mod
    state.sdkInfo = { cliVersion: s.cliVersion, sdkVersion: s.sdkVersion, sdkRange: s.sdkRange }
  }
  return state.mod
}

/** Step 1 of the onboarding: what can this machine hold, before any download. */
async function checkMachine () {
  const mod = await ensureSdk()
  const budget = await serialize('checking this machine', () => machineBudget(mod))
  const readers = await serialize('checking the reader models', () => assessReaders(mod))
  // Fall back to a plain reading of system memory only when the SDK cannot answer.
  const fallback = os.totalmem() - Math.min(8e9, Math.max(1.5e9, os.totalmem() * 0.3))
  const comparable = budget ? budget.availableAfterReserveBytes : fallback
  const variants = assessVariants(comparable)
  state.fit = {
    budget,
    comparableBytes: comparable,
    variants,
    recommended: recommend(variants),
    readers,
    // Two different kinds of answer in one screen, so the screen says which is which.
    method: budget
      ? 'budget and reader verdicts from the SDK assessModelFit; the AfriSLM estimate is computed here because those GGUFs are not registry models'
      : 'assessModelFit is unavailable on this SDK, so every number here is a local estimate',
    machine: {
      platform: process.platform, arch: process.arch, cores: os.cpus().length,
      cpu: (os.cpus()[0] || {}).model || 'unknown', totalBytes: os.totalmem()
    }
  }
  push({ t: 'fit', fit: state.fit })
  return state.fit
}

async function loadTranslator (variantId) {
  const mod = await ensureSdk()
  const v = variantById(variantId)
  if (!v) throw new Error(`no AfriSLM variant called ${variantId}`)
  return serialize(`downloading AfriSLM ${v.params} ${v.quant}`, async () => {
    if (state.translator && state.translator.variantId === variantId) return state.translator
    if (state.translator) {
      await mod.unloadModel({ modelId: state.translator.modelId })
      state.translator = null
    }
    const t0 = Date.now()
    // Already on disk means no download call at all. `downloadAsset` would return
    // instantly at 100 percent, but flashing a full progress bar at someone is a
    // worse answer than not pretending there was a download.
    if (!variantCached(v)) {
      await downloadWithProgress(mod, variantUrl(v), `AfriSLM ${v.params} ${v.quant}`, 1, 1)
    } else {
      push({ t: 'cached', label: `AfriSLM ${v.params} ${v.quant}` })
    }
    const modelId = await mod.loadModel({
      modelSrc: variantUrl(v),
      modelType: 'llamacpp-completion',
      // reasoning_budget 0 because the base model is Qwen3.5 and will otherwise put
      // a think block in the middle of a translation.
      modelConfig: { device: 'gpu', ctx_size: 2048, reasoning_budget: 0 }
    })
    state.translator = { variantId, modelId, params: v.params, quant: v.quant, loadedMs: Date.now() - t0 }
    push({ t: 'translator', translator: state.translator })
    return state.translator
  })
}

/** Step 2, optional: the reader, only if this person wants to scan paper. */
async function loadReader (readerId) {
  const mod = await ensureSdk()
  const r = readerById(readerId) || availableReaders(mod)[0]
  if (!r) throw new Error('no reader model is available in this SDK')
  return serialize(`downloading ${r.label}`, async () => {
    if (state.reader && state.reader.readerId === r.id) return state.reader
    if (state.reader) {
      await mod.unloadModel({ modelId: state.reader.modelId })
      state.reader = null
    }
    const t0 = Date.now()
    // Two files, and the projector is a third of the download: reporting only the
    // first would stall the bar at 100 percent with work still to do. Each file is
    // checked separately, because a machine can easily hold one and not the other.
    for (const [i, name, label] of [[1, r.model, r.label], [2, r.projection, `${r.label}, vision part`]]) {
      let cached = false
      try { const info = await mod.getModelInfo({ name }); cached = !!(info && info.isCached) } catch {}
      if (cached) push({ t: 'cached', label })
      else await downloadWithProgress(mod, mod[name].src, label, i, 2)
    }
    const modelId = await mod.loadModel({
      modelSrc: mod[r.model],
      modelType: 'llamacpp-completion',
      modelConfig: { device: 'gpu', ctx_size: 4096, projectionModelSrc: mod[r.projection], reasoning_budget: 0 }
    })
    state.reader = { readerId: r.id, modelId, label: r.label, loadedMs: Date.now() - t0 }
    push({ t: 'reader', reader: state.reader })
    return state.reader
  })
}

async function translate ({ text, source, target }) {
  const mod = await ensureSdk()
  if (!state.translator) throw new Error('no translator is loaded yet')
  const detected = source === 'auto' ? detect(text) : null
  const fromName = source === 'auto' ? (detected.name || 'English') : nameFor(source)
  const tgtName = nameFor(target)
  const chunks = splitForTranslation(text)
  const out = []
  for (let i = 0; i < chunks.length; i++) {
    const piece = chunks[i]
    const t0 = Date.now()
    const res = await serialize(`translating ${i + 1} of ${chunks.length}`, async () => {
      const run = mod.completion({
        modelId: state.translator.modelId,
        history: buildPrompt(fromName, tgtName, piece),
        stream: false,
        // Every paragraph independent: a shared cache makes the model carry on from
        // the previous paragraph instead of translating this one.
        kvCache: false,
        generationParams: { predict: 512, temp: 0, reasoning_budget: 0 }
      })
      return await run.final
    })
    out.push({ source: piece, translated: (res.contentText || '').trim(), ms: Date.now() - t0 })
    push({ t: 'partial', index: i, total: chunks.length, translated: out[i].translated })
  }
  return { chunks: out, detected, from: fromName, to: tgtName }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' }
const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type })
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
}
const readBody = (req, limit = 40e6) => new Promise((resolve, reject) => {
  const parts = []
  let size = 0
  req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('that file is too large')); req.destroy(); return } parts.push(c) })
  req.on('end', () => resolve(Buffer.concat(parts)))
  req.on('error', reject)
})

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  try {
    if (url.pathname === '/api/state') {
      await ensureSdk()
      return send(res, 200, {
        sdk: state.sdkInfo,
        fit: state.fit,
        translator: state.translator,
        reader: state.reader,
        readersAvailable: availableReaders(state.mod).map((r) => ({ id: r.id, label: r.label, bytes: r.bytes, note: r.note, recommended: !!r.recommended })),
        languages: { fineTuned: FINE_TUNED, heldOut: HELD_OUT, other: OTHER },
        exampleLanguages: Object.keys(EXAMPLES.languages || {}),
        busy: state.busy
      })
    }

    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      res.write(': connected\n\n')
      clients.add(res)
      req.on('close', () => clients.delete(res))
      return
    }

    if (url.pathname === '/api/check' && req.method === 'POST') return send(res, 200, await checkMachine())

    if (url.pathname === '/api/load' && req.method === 'POST') {
      const { variantId } = JSON.parse((await readBody(req)).toString() || '{}')
      return send(res, 200, { ok: true, translator: await loadTranslator(variantId) })
    }

    if (url.pathname === '/api/reader' && req.method === 'POST') {
      const { readerId } = JSON.parse((await readBody(req)).toString() || '{}')
      return send(res, 200, { ok: true, reader: await loadReader(readerId) })
    }

    if (url.pathname === '/api/translate' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString() || '{}')
      if (!String(body.text || '').trim()) return send(res, 400, { error: 'nothing to translate' })
      return send(res, 200, await translate({ text: body.text, source: body.source || 'auto', target: body.target || 'en' }))
    }

    if (url.pathname === '/api/detect' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString() || '{}')
      // No model needed: the source language is known before anything is downloaded.
      return send(res, 200, detect(String(body.text || '')))
    }

    if (url.pathname === '/api/examples') {
      const code = url.searchParams.get('lang')
      const entry = (EXAMPLES.languages || {})[code]
      return send(res, 200, entry ? { ...entry, code } : { code, name: nameFor(code), samples: [] })
    }

    if (url.pathname === '/api/scan' && req.method === 'POST') {
      if (!state.reader) return send(res, 400, { error: 'scanning needs the reader model, which has not been downloaded' })
      const name = (req.headers['x-filename'] || 'scan.png').toString().replace(/[^\w.\-]+/g, '_')
      const bytes = await readBody(req)
      if (!bytes.length) return send(res, 400, { error: 'empty upload' })
      const file = path.join(UP, `${crypto.randomBytes(5).toString('hex')}-${name}`)
      await fsp.writeFile(file, bytes)
      const text = await serialize('reading the page', () => readDocument({
        mod: state.mod, modelId: state.reader.modelId, imagePath: file
      }))
      return send(res, 200, { text, file: path.basename(file) })
    }

    if (url.pathname.startsWith('/uploads/')) {
      const file = path.join(UP, path.basename(decodeURIComponent(url.pathname.slice(9))))
      if (!fs.existsSync(file)) return send(res, 404, { error: 'not found' })
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' })
      return fs.createReadStream(file).pipe(res)
    }

    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
    const file = path.join(DIR, 'public', path.normalize(rel).replace(/^(\.\.[/\\])+/, ''))
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' })
      return fs.createReadStream(file).pipe(res)
    }
    return send(res, 404, { error: 'not found' })
  } catch (e) {
    return send(res, 500, { error: e.message })
  }
})

server.listen(PORT, async () => {
  console.log(`\nTranslatePsy-AfriSLM demo  http://localhost:${PORT}`)
  try {
    await ensureSdk()
    console.log(`  SDK ${state.sdkInfo.sdkVersion} via @qvac/cli ${state.sdkInfo.cliVersion}`)
    console.log(`  assessModelFit: ${typeof state.mod.assessModelFit === 'function' ? 'available' : 'not in this SDK, local estimates only'}`)
    console.log(`  readers in this SDK: ${availableReaders(state.mod).map((r) => r.id).join(', ') || 'none'}`)
    console.log(`  example sentences: ${Object.keys(EXAMPLES.languages || {}).length} languages`)
  } catch (e) {
    console.log('  SDK not ready:', e.message)
  }
})
