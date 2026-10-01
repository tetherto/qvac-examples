// QVAC MUSIC DESK - server
// ---------------------------------------------------------------------------
// A thin local server around `@qvac/audiogen-ggml`. It does four things:
//
//   1. finds the model files on this machine (nothing is ever downloaded)
//   2. turns anything you import into what the addon actually accepts, which is
//      interleaved stereo float PCM at 48 kHz and nothing else
//   3. runs one render at a time as a `bare` child process and streams its stages
//   4. serves the takes back for playback and export
//
// No dependencies. The engine itself is a Bare native addon and cannot be loaded
// from Node, which is why every render is a child process (see engine/worker.js).
// ---------------------------------------------------------------------------

import http from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawn, execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { STARTERS, CHIPS, KEYS, TIME_SIGNATURES, LANGUAGES, COVER_STRENGTHS,
  COMMON_FORMATS, SECTIONS, COLOUR_TAGS, translateTags } from './lib/vocab.mjs'
import * as writer from './lib/sheet.mjs'
import { conformCaption, TAG_TARGET } from './lib/caption.mjs'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 3055)
// This computer only, unless HOST says otherwise (HOST=0.0.0.0 to open it to the network).
const HOST = process.env.HOST || '127.0.0.1'
const OUT = path.join(DIR, 'out')
const LIB = path.join(DIR, 'library')
const PCM_DIR = path.join(OUT, 'pcm')
for (const d of [OUT, LIB, PCM_DIR]) fs.mkdirSync(d, { recursive: true })

// `bare` ships with @qvac/cli. Add the local bin so the server works whether it was
// started by npm (which puts it on PATH) or by a bare `node server.js` (which does not).
process.env.PATH = `${path.join(DIR, 'node_modules', '.bin')}${path.delimiter}${process.env.PATH || ''}`

// ---------------------------------------------------------------------------
// Model discovery
//
// The addon opens local paths and downloads nothing, so the desk has to find the
// files. MiniMax-Music3 is not distributed by QVAC (licence), so its folder is the
// one thing a person may have to point at by hand. ACE-Step, if `audioGen()` has
// ever run on this machine, is already in ~/.qvac/models under hashed filenames,
// which is why every stage is matched on its SUFFIX rather than its whole name.
// ---------------------------------------------------------------------------

const QVAC_MODELS = path.join(os.homedir(), '.qvac', 'models')

/**
 * What the desk can fetch for you, and what it cannot.
 *
 * The four ACE-Step stages are in the QVAC registry, so `downloadAsset` from
 * @qvac/sdk can pull them: the desk checks the cache first and only fetches what
 * is missing. MiniMax-Music3 is NOT ours to distribute (MiniMax-Music3 Community
 * Licence), so it stays a folder you point at.
 *
 * `sdkConstant` is resolved lazily against the installed SDK, so a rename shows
 * up as one missing entry rather than a crash at startup.
 */
const FETCHABLE = {
  textEncModel: 'AUDIOGEN_QWEN3_EMBEDDING_0_6B_Q8_0',
  lmModel: 'AUDIOGEN_ACESTEP_5HZ_LM_0_6B_Q8_0',
  vaeModel: 'AUDIOGEN_VAE_BF16',
  'dit:turbo-q4': 'AUDIOGEN_ACESTEP_V15_TURBO_Q4_K_M',
  'dit:turbo-q8': 'AUDIOGEN_ACESTEP_V15_TURBO_Q8_0',
  'dit:sft': 'AUDIOGEN_ACESTEP_V15_SFT_Q8_0'
}
/** The smallest set that makes the desk work: three stages plus the fast DiT. */
const ESSENTIAL = ['textEncModel', 'lmModel', 'vaeModel', 'dit:turbo-q4']

const ACESTEP_STAGES = {
  textEncModel: 'Qwen3-Embedding-0.6B-Q8_0.gguf',
  lmModel: 'acestep-5Hz-lm-0.6B-Q8_0.gguf',
  vaeModel: 'vae-BF16.gguf'
}
// Only the DiT changes between variants, and Flow-Edit is turbo-only.
const ACESTEP_DITS = {
  'turbo-q4': { file: 'acestep-v15-turbo-Q4_K_M.gguf', flowEdit: true, label: 'turbo Q4_K_M, fastest' },
  'turbo-q8': { file: 'acestep-v15-turbo-Q8_0.gguf', flowEdit: true, label: 'turbo Q8_0, higher precision' },
  sft: { file: 'acestep-v15-sft-Q8_0.gguf', flowEdit: false, label: 'sft Q8_0, 50 steps, no Flow-Edit' }
}

/**
 * Expected byte sizes from the registry, filled at startup.
 *
 * Matching on a filename alone is not enough. An interrupted download leaves a
 * short file in ~/.qvac/models under its final name and with no partial marker,
 * so the desk offered a 208 MB stub of a 2.55 GB DiT as an available variant and
 * the render failed at load. Found by aborting a real download on purpose.
 */
let EXPECTED = {}

/** Short of what the registry says it should be, so not usable. */
function isTruncated (file) {
  const base = path.basename(file).replace(/^[0-9a-f]{16}_/, '')
  const want = EXPECTED[base]
  if (!want) return false
  try {
    // A small tolerance, since a registry size can be a rounded figure.
    return fs.statSync(file).size < want * 0.98
  } catch { return true }
}

function findBySuffix (dirs, suffix) {
  for (const dir of dirs) {
    let entries
    try { entries = fs.readdirSync(dir) } catch { continue }
    const hit = entries.find((f) => f === suffix || f.endsWith(`_${suffix}`) || f.endsWith(`-${suffix}`))
    if (hit) {
      const full = path.join(dir, hit)
      if (isTruncated(full)) continue     // a partial download is not a model
      return full
    }
  }
  return null
}

let mm3Dir = process.env.MM3_DIR || null

function discover () {
  const searchDirs = [
    path.join(DIR, 'models', 'acestep'),
    process.env.ACESTEP_DIR,
    QVAC_MODELS
  ].filter(Boolean)

  const acestep = { files: {}, missing: [], dits: {} }
  for (const [key, file] of Object.entries(ACESTEP_STAGES)) {
    const found = findBySuffix(searchDirs, file)
    if (found) acestep.files[key] = found
    else acestep.missing.push(file)
  }
  for (const [variant, spec] of Object.entries(ACESTEP_DITS)) {
    const found = findBySuffix(searchDirs, spec.file)
    if (found) acestep.dits[variant] = { path: found, ...spec }
  }
  // Anything present but short is named, so the reason is on screen rather than
  // showing up later as a load failure.
  acestep.truncated = []
  for (const dir of searchDirs) {
    let entries
    try { entries = fs.readdirSync(dir) } catch { continue }
    for (const f of entries) {
      const full = path.join(dir, f)
      if (EXPECTED[f.replace(/^[0-9a-f]{16}_/, '')] && isTruncated(full)) {
        acestep.truncated.push(f.replace(/^[0-9a-f]{16}_/, ''))
      }
    }
  }
  acestep.ready = acestep.missing.length === 0 && Object.keys(acestep.dits).length > 0
  if (!Object.keys(acestep.dits).length) acestep.missing.push('one acestep DiT (turbo-Q4_K_M, turbo-Q8_0 or sft-Q8_0)')

  // MiniMax: two GGUFs, matched on the documented prefixes so any quant works.
  const mmCandidates = [mm3Dir, path.join(DIR, 'models', 'minimax'), path.join(os.homedir(), 'mm3-demo', 'models', 'minimax')].filter(Boolean)
  const minimax = { files: {}, missing: [], dir: null }
  for (const dir of mmCandidates) {
    let entries
    try { entries = fs.readdirSync(dir) } catch { continue }
    const lm = entries.find((f) => /^mm3-lm.*\.gguf$/.test(f))
    const synth = entries.find((f) => /^mm3-synth.*\.gguf$/.test(f))
    if (lm && synth) {
      minimax.dir = dir
      minimax.files = { lmModel: path.join(dir, lm), synthModel: path.join(dir, synth) }
      break
    }
  }
  if (!minimax.dir) minimax.missing.push('mm3-lm-<quant>.gguf and mm3-synth-<quant>.gguf')
  minimax.ready = !!minimax.dir
  // Desktop only, and the addon refuses on mobile platforms.
  minimax.supported = ['darwin', 'linux', 'win32'].includes(process.platform)

  const sizeOf = (p) => { try { return fs.statSync(p).size } catch { return 0 } }
  const total = (files) => Object.values(files).reduce((a, p) => a + sizeOf(p), 0)
  return {
    minimax: { ...minimax, bytes: total(minimax.files) },
    acestep: { ...acestep, bytes: total(acestep.files) + (Object.values(acestep.dits)[0] ? sizeOf(Object.values(acestep.dits)[0].path) : 0) }
  }
}

// ---------------------------------------------------------------------------
// Audio in: ffmpeg is the only thing that gets to decide about sample rates
//
// referenceAudio and sourceAudio must be finite normalized interleaved stereo
// Float32 at 48 kHz. The addon does not resample, does not convert channels and
// does not normalize, so an import that is 44.1 kHz mono is not "close enough":
// it is either converted here or it is a wrong-speed render. A MiniMax take is
// itself 44.1 kHz, so feeding one into an ACE-Step edit goes through here too.
// ---------------------------------------------------------------------------

const run = (cmd, args) => new Promise((resolve, reject) => {
  execFile(cmd, args, { maxBuffer: 1 << 26 }, (err, stdout, stderr) => {
    if (err) reject(new Error(`${cmd} failed: ${String(stderr || err.message).split('\n').slice(-4).join(' ')}`))
    else resolve({ stdout, stderr })
  })
})

async function toEnginePcm (inputFile, id) {
  const out = path.join(PCM_DIR, `${id}.f32le`)
  if (fs.existsSync(out)) return out
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', inputFile,
    '-f', 'f32le', '-acodec', 'pcm_f32le', '-ar', '48000', '-ac', '2', out])
  return out
}

async function probe (file) {
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries',
      'format=duration:stream=sample_rate,channels', '-of', 'json', file])
    const j = JSON.parse(stdout)
    const s = (j.streams || [])[0] || {}
    return {
      seconds: j.format && j.format.duration ? Math.round(Number(j.format.duration) * 100) / 100 : null,
      sampleRate: s.sample_rate ? Number(s.sample_rate) : null,
      channels: s.channels ?? null
    }
  } catch { return { seconds: null, sampleRate: null, channels: null } }
}

// ---------------------------------------------------------------------------
// State. One render at a time: the addon admits overlapping runs in order, but a
// second 22 GB model pair on the same GPU is not a feature, it is a stall.
// ---------------------------------------------------------------------------

/**
 * Takes that survived a restart. Each finished render writes `take-<id>.json`
 * next to its audio, so the list can be rebuilt instead of forgotten. A record
 * whose audio has been deleted is skipped rather than shown as a dead card.
 */
function restoreTakes () {
  let names = []
  try { names = fs.readdirSync(OUT) } catch { return [] }
  const takes = []
  const seen = new Set()
  for (const name of names) {
    if (!/^take-[0-9a-f]+\.json$/.test(name)) continue
    try {
      const take = JSON.parse(fs.readFileSync(path.join(OUT, name), 'utf8'))
      const files = (take.files || []).filter((f) => fs.existsSync(f.file || f))
      if (!files.length) continue
      seen.add(take.id)
      takes.push({ ...take, files })
    } catch {}
  }
  // Audio with no record: renders made before takes were persisted, or a
  // record deleted by hand. The job file next to it says what it was, and a
  // card with no statistics still plays.
  for (const name of names) {
    const m = name.match(/^take-([0-9a-f]+)\.(wav|flac|m4a|ogg|opus|aiff|caf|aac|alac|ac3|wma|mp2|pcm)$/)
    if (!m || seen.has(m[1])) continue
    seen.add(m[1])
    const audio = path.join(OUT, name)
    let job = {}
    try { job = JSON.parse(fs.readFileSync(path.join(OUT, `job-${m[1]}.json`), 'utf8')) } catch {}
    takes.push({
      id: m[1],
      engine: job.engine || 'acestep',
      task: job.mode || 'compose',
      mode: job.mode || 'compose',
      caption: job.caption || 'recovered take',
      sheet: null,
      notes: [],
      opts: job.opts || {},
      operations: [],
      files: [{ format: path.extname(name).slice(1), file: audio }],
      recovered: true,
      at: fs.statSync(audio).mtime.toISOString()
    })
  }
  return takes.sort((a, b) => String(b.at).localeCompare(String(a.at)))
}

const state = {
  models: discover(),
  library: [],   // imported audio
  takes: restoreTakes(),
  job: null,     // the live one
  queue: [],     // variations waiting their turn, one engine at a time
  // What the INSTALLED addon accepts, read at startup by engine/caps.cjs rather
  // than hand-written here. The previous hand-written table drifted out of date
  // the moment the caret in package.json resolved to a new patch release.
  caps: null,
  // The optional model that turns a brief into a song sheet. Absent is fine:
  // the Surprise me door and the manual sheet both work without it.
  writer: { available: false, why: 'not probed yet' },
  download: null
}

/**
 * Reads the addon's real capability surface. Runs under `bare` because the addon
 * cannot be required from Node, loads no model and generates nothing: it asks
 * the validator what it refuses.
 */
function readCaps () {
  return new Promise((resolve) => {
    let out = ''
    const child = spawn('bare', [path.join(DIR, 'engine', 'caps.cjs')], {
      cwd: DIR, stdio: ['ignore', 'pipe', 'ignore']
    })
    child.stdout.on('data', (c) => { out += c.toString() })
    child.on('error', () => resolve(null))
    child.on('close', () => {
      const line = out.trim().split('\n').filter(Boolean).pop()
      if (!line) return resolve(null)
      try {
        const caps = JSON.parse(line)
        try {
          caps.addonVersion = JSON.parse(
            fs.readFileSync(path.join(DIR, 'node_modules', '@qvac', 'audiogen-ggml', 'package.json'), 'utf8')
          ).version
        } catch { caps.addonVersion = 'unknown' }
        resolve(caps.error ? null : caps)
      } catch { resolve(null) }
    })
  })
}

/**
 * Every fetchable asset with its size and whether it is already on disk, so the
 * UI can show a real download button instead of a paragraph telling someone to
 * go and find four GGUF files.
 */
async function modelCatalogue () {
  let sdk
  try { sdk = await import('@qvac/sdk') } catch { return { available: false, items: [] } }
  const found = state.models.acestep
  const items = []
  for (const [key, constant] of Object.entries(FETCHABLE)) {
    const entry = sdk[constant]
    if (!entry) continue
    const onDisk = key.startsWith('dit:')
      ? !!found.dits[key.slice(4)]
      : !!found.files[key]
    items.push({
      key,
      constant,
      label: entry.modelId,
      bytes: entry.expectedSize || 0,
      onDisk,
      essential: ESSENTIAL.includes(key)
    })
  }
  // The optional writing model for the Prompt mode expander.
  const w = sdk[WRITER_CONSTANT]
  if (w) {
    let cached = []
    try { cached = fs.readdirSync(QVAC_MODELS) } catch {}
    items.push({
      key: 'writer',
      constant: WRITER_CONSTANT,
      label: w.modelId,
      bytes: w.expectedSize || 0,
      onDisk: cached.some((f) => f.endsWith(w.modelId)),
      essential: false,
      optional: 'brief expander'
    })
  }
  return { available: true, items }
}
const WRITER_CONSTANT = 'QWEN3_4B_Q4_K_M'

/** One asset at a time, reporting bytes as they land. */
async function fetchModels (keys) {
  if (state.download && state.download.running) throw new Error('a download is already running')
  const sdk = await import('@qvac/sdk')
  const cat = await modelCatalogue()
  const wanted = cat.items.filter((i) => keys.includes(i.key) && !i.onDisk)
  if (!wanted.length) return { nothing: true }

  state.download = { running: true, total: wanted.length, done: 0, current: null, percent: 0 }
  push({ t: 'download', download: state.download })

  ;(async () => {
    for (const item of wanted) {
      state.download.current = item.label
      state.download.percent = 0
      push({ t: 'download', download: state.download })
      try {
        await sdk.downloadAsset({
          assetSrc: sdk[item.constant],
          onProgress: (p) => {
            const pct = Math.round(p.percentage || 0)
            if (pct !== state.download.percent) {
              state.download.percent = pct
              push({ t: 'download', download: state.download })
            }
          }
        })
      } catch (e) {
        state.download.running = false
        state.download.error = `${item.label}: ${e.message}`
        push({ t: 'download', download: state.download })
        return
      }
      state.download.done++
      // Re-discover after each one so the UI unlocks as soon as it can work.
      state.models = discover()
      push({ t: 'models', models: state.models })
    }
    state.download.running = false
    state.download.current = null
    let cached = []
    try { cached = fs.readdirSync(QVAC_MODELS) } catch {}
    state.writer = await writer.probe(cached)
    push({ t: 'download', download: state.download })
    push({ t: 'ready', caps: state.caps, writer: state.writer })
  })()

  return { started: wanted.map((i) => i.label) }
}

/**
 * Which engine runs a task. Never a question put to the person.
 *
 * Everything that takes audio in is ACE-Step only, because MiniMax refuses
 * referenceAudio, covers, stems and editing by name. That leaves one genuine
 * choice, plain text to music, and there it is a speed trade rather than a
 * model name: measured on this machine, ACE-Step turbo runs at 0.12 to 0.29
 * times the audio length and MiniMax at 4.37.
 */
/**
 * Which DiT to run. This is the quality axis and the desk used to ignore it: it
 * always loaded turbo-q4, the 4-bit 8-step variant, which the addon's own
 * benchmark doc calls the smallest and fastest and which the authors pair with
 * "sketching". `sft` is 50 steps and the only variant that supports CFG, and
 * the addon calls it the quality reference. Judging the model on turbo-q4 alone
 * was judging its draft mode.
 */
function pickDit (prefer, requested) {
  const have = state.models.acestep.dits || {}
  if (requested && have[requested]) return requested
  if (prefer === 'detailed') {
    if (have.sft) return 'sft'
    if (have['turbo-q8']) return 'turbo-q8'
  }
  if (have['turbo-q4']) return 'turbo-q4'
  return Object.keys(have)[0]
}

function engineFor (task, prefer) {
  const needsAudioIn = ['cover', 'repaint', 'extend', 'flow-edit', 'stem'].includes(task)
  if (needsAudioIn) return 'acestep'
  if (task === 'surprise') return 'acestep'   // simpleMode is ACE-Step's LM stage
  if (prefer === 'minimax' && state.models.minimax.ready && state.models.minimax.supported) return 'minimax'
  return 'acestep'
}

const clients = new Set()
function push (event) {
  const line = `data: ${JSON.stringify(event)}\n\n`
  for (const res of clients) { try { res.write(line) } catch {} }
}

const short = () => crypto.randomBytes(6).toString('hex')

async function resolvePcmRef (ref) {
  if (!ref) return null
  if (ref.kind === 'library') {
    const item = state.library.find((l) => l.id === ref.id)
    if (!item) throw new Error(`no imported audio with id ${ref.id}`)
    return toEnginePcm(item.file, `lib-${item.id}`)
  }
  const take = state.takes.find((t) => t.id === ref.id)
  if (!take) throw new Error(`no take with id ${ref.id}`)
  const wav = (take.files || []).find((f) => f.format === 'wav')
  if (!wav) throw new Error('that take has no wav to read')
  return toEnginePcm(wav.file, `take-${take.id}`)
}

async function runOne (body) {
  if (state.job && state.job.status === 'running') throw new Error('a render is already running')

  const engineKey = body.engine === 'minimax' ? 'minimax' : 'acestep'
  const found = state.models[engineKey]
  if (!found.ready) throw new Error(`${engineKey} models are not on this machine: ${found.missing.join(', ')}`)
  if (engineKey === 'minimax' && !found.supported) throw new Error('MiniMax-Music3 is desktop only')
  if (engineKey === 'minimax' && body.mode !== 'compose') {
    // The addon throws for these; saying so here keeps the reason readable.
    throw new Error('MiniMax-Music3 does not support covers or audio editing. Switch to ACE-Step.')
  }

  const files = { ...found.files }
  if (engineKey === 'acestep') {
    const variant = found.dits[body.ditVariant] || Object.values(found.dits)[0]
    files.ditModel = variant.path
    if (body.mode === 'edit' && (body.operations || []).some((o) => o.type === 'flow-edit') && !variant.flowEdit) {
      throw new Error('Flow-Edit needs a turbo DiT. The loaded DiT is sft.')
    }
  }

  const id = short()
  const job = {
    engine: engineKey,
    files,
    config: {
      useGPU: body.useGPU !== false,
      ...(body.threads ? { threads: Number(body.threads) } : {})
    },
    mode: body.mode || 'compose',
    caption: body.caption || '',
    opts: body.opts || {},
    operations: body.operations || [],
    formats: body.formats && body.formats.length ? body.formats : ['wav'],
    out: path.join(OUT, `take-${id}`)
  }
  if (body.reference) job.referencePcm = await resolvePcmRef(body.reference)
  if (body.source) job.sourcePcm = await resolvePcmRef(body.source)

  // Extending a track: there is no continuation API in the addon, and a repaint range
  // has to sit INSIDE the source. So the source grows first. Silence is appended to the
  // PCM, and the extend becomes a repaint of the new tail, which the engine fills with
  // material conditioned on the music before it.
  //
  // Measured on this machine before shipping it (7.44 s take extended to 15 s):
  // Balanced 0.5 and Conservative both fill the tail at -16.5 dBFS and leave the kept
  // part at its original -20.0 dBFS, with 246 of 64,582 sampled points changed by at
  // most 0.1 percent of full scale. Aggressive with strength 0 regenerates EVERYTHING
  // (124 percent full-scale deltas in the part that was supposed to be kept), which is
  // why the desk does not offer it here.
  if (job.mode === 'edit') {
    const extend = job.operations.find((o) => o.type === 'extend')
    if (extend) {
      if (!job.sourcePcm) throw new Error('extending needs a source track')
      const seconds = Math.max(0.5, Math.min(120, Number(extend.seconds) || 0))
      const srcBytes = fs.statSync(job.sourcePcm).size
      const srcSeconds = srcBytes / 4 / 2 / 48000
      const padded = path.join(PCM_DIR, `pad-${id}.f32le`)
      // Zeros written here rather than through ffmpeg: the sample count has to be exact,
      // and 48 kHz stereo float is 8 bytes per frame with nothing to interpret.
      const zeros = Buffer.alloc(Math.round(seconds * 48000) * 2 * 4)
      await fsp.writeFile(padded, Buffer.concat([await fsp.readFile(job.sourcePcm), zeros]))
      job.sourcePcm = padded
      job.operations = job.operations.map((o) => (o.type === 'extend'
        ? {
            type: 'repaint',
            caption: o.caption,
            lyrics: o.lyrics || '[Instrumental]',
            start: Math.max(0, srcSeconds - 0.04),  // one latent frame of overlap, so the seam is generated
            end: null,
            mode: o.mode === 'Conservative' ? 'Conservative' : 'Balanced',
            strength: o.strength === undefined ? 0.5 : Number(o.strength)
          }
        : o))
      job.extended = { seconds, from: Math.round(srcSeconds * 100) / 100, to: Math.round((srcSeconds + seconds) * 100) / 100 }
    }
  }

  const jobFile = path.join(OUT, `job-${id}.json`)
  await fsp.writeFile(jobFile, JSON.stringify(job, null, 2))

  const log = fs.openSync(path.join(OUT, 'engine.log'), 'a')
  fs.writeSync(log, `\n=== ${new Date().toISOString()} ${id} ${engineKey} ${job.mode} ===\n`)
  // stdout is the event channel, stderr is the noise channel. The Metal kernel
  // compiler writes 119 lines of model paths carrying a home directory, so stderr
  // is never forwarded to the browser.
  const child = spawn('bare', [path.join(DIR, 'engine', 'worker.cjs'), jobFile], {
    cwd: DIR,
    stdio: ['ignore', 'pipe', log]
  })

  state.job = {
    id,
    status: 'running',
    engine: engineKey,
    task: body.task || job.mode,
    variation: body.variation || null,
    mode: job.mode,
    caption: job.caption,
    startedAt: Date.now(),
    stage: null,
    step: 0,
    total: 0,
    loadMs: null,
    notes: []
  }
  // This run's own job record. With a queue, `state.job` may already hold the
  // NEXT variation by the time this child exits, and writing to it from here
  // marked a perfectly healthy render as failed.
  const myJob = state.job
  const isCurrent = () => state.job === myJob
  push({ t: 'job', job: state.job })

  let buffered = ''
  child.stdout.on('data', (chunk) => {
    buffered += chunk.toString()
    const lines = buffered.split('\n')
    buffered = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      let event
      try { event = JSON.parse(line) } catch { continue }
      if (event.t === 'loaded') { myJob.loadMs = event.ms }
      else if (event.t === 'progress') { Object.assign(myJob, { stage: event.stage, step: event.step, total: event.total }) }
      else if (event.t === 'note') { myJob.notes.push(event.message) }
      else if (event.t === 'done') {
        const take = {
          id,
          engine: engineKey,
          task: body.task || job.mode,
          mode: job.mode,
          caption: job.caption,
          // The sheet that produced this take, so "more like this" has something
          // to start from and the person can see what was actually sent.
          sheet: body.sheet || null,
          notes: body.notes || [],
          variation: body.variation || null,
          opts: job.opts,
          operations: job.operations,
          ditVariant: engineKey === 'acestep' ? (body.ditVariant || Object.keys(found.dits)[0]) : null,
          extended: job.extended || null,
          files: event.files,
          sampleRate: event.sampleRate,
          channels: event.channels,
          level: event.level,
          stats: event.stats,
          loadMs: myJob.loadMs,
          wallMs: Date.now() - myJob.startedAt,
          at: new Date().toISOString()
        }
        state.takes.unshift(take)
        // The take record goes to disk next to its audio. In memory only, the
        // list was wiped by every server restart while the wavs stayed behind,
        // orphaned: the app forgot renders the user could still hear.
        try { fs.writeFileSync(path.join(OUT, `take-${id}.json`), JSON.stringify(take)) } catch {}
        myJob.status = 'done'
        push({ t: 'take', take })
        drainQueue()
      } else if (event.t === 'error') {
        myJob.status = 'failed'
        myJob.error = event.message
        push({ t: 'failed', error: event.message })
        // A failed seed does not cancel the batch: the next one may well work.
        drainQueue()
      }
      if (isCurrent()) push({ t: 'job', job: state.job })
    }
  })

  child.on('exit', (code, signal) => {
    // Only ever judge OUR run. A late exit from the previous variation used to
    // land on the one now running and mark it failed.
    if (myJob.status === 'running') {
      myJob.status = signal ? 'cancelled' : 'failed'
      if (!myJob.error && !signal) myJob.error = `the engine exited with code ${code}, see out/engine.log`
      if (isCurrent()) push({ t: 'job', job: state.job })
      // Cancelling means cancelling the batch, not just this seed.
      if (signal) state.queue = []
      else drainQueue()
    }
    try { fs.closeSync(log) } catch {}
  })

  state.job.pid = child.pid
  return state.job
}

// ---------------------------------------------------------------------------
// Tasks, variations, and the queue
//
// The desk no longer asks which engine or which mode. It is given a TASK and a
// song sheet, works out the rest, and renders two to four seeds when asked
// because the ACE-Step authors say to: "Always generate 2-4 versions at once."
// At 0.12x on turbo-q4 three variations of a one-minute idea cost about twenty
// seconds of compute in total, so there is nothing to protect anyone from.
// ---------------------------------------------------------------------------

/** Turns a task-shaped request into the job body the worker already understands. */
function translateRequest (req) {
  const task = req.task || 'compose'
  const engine = engineFor(task, req.prefer === 'vocals' ? 'minimax' : req.prefer)
  const ditVariant = engine === 'acestep' ? pickDit(req.prefer, req.ditVariant) : null
  const sheet = req.sheet || {}
  const adv = req.advanced || {}
  const accepts = (key) => !state.caps || state.caps.accepts[engine][key] !== false

  const opts = {}
  const notes = []

  // Structure tags are rewritten for whichever engine is about to read them,
  // because the two published vocabularies are not the same and an unknown
  // bracket is a line the model may try to sing.
  let lyrics = sheet.instrumental ? '[Instrumental]' : (sheet.lyrics || '').trim() || '[Instrumental]'
  if (task !== 'surprise') {
    const t = translateTags(lyrics, engine)
    lyrics = t.lyrics
    for (const c of t.changes) {
      notes.push(c.to ? `${c.from} became ${c.to}${c.why ? `, ${c.why}` : ''}` : `dropped ${c.from}, ${c.why}`)
    }
  }

  // The caption, put in the shape the authors describe, with every change said
  // out loud. Both doors go through here: the expander writes one and the chips
  // build one, and neither is trusted to have got the rules right.
  let caption = (sheet.caption || '').trim()
  if (task !== 'surprise' && caption) {
    const fixed = conformCaption(caption, { instrumental: !!sheet.instrumental })
    caption = fixed.caption
    for (const n of fixed.notes) notes.push(n)
  }

  const mode = task === 'cover' ? 'cover'
    : ['repaint', 'extend', 'flow-edit'].includes(task) ? 'edit'
      : 'compose'

  if (task === 'surprise') {
    // The engine's own LM writes the caption, the lyrics and every unset field.
    // Duration is deliberately not sent: measured, simpleMode overrides it
    // anyway (asked 8 s, got 28.2 s), so promising a length here would be a lie.
    opts.simpleMode = true
    opts.lmPhase1 = true
    if (sheet.instrumental) opts.lyrics = '[Instrumental]'
  } else if (mode !== 'edit') {
    opts.lyrics = lyrics
    if (task === 'compose' && sheet.duration) opts.duration = Number(sheet.duration)
    if (accepts('bpm') && Number(sheet.bpm)) opts.bpm = Number(sheet.bpm)
    if (accepts('keyscale') && sheet.keyscale) opts.keyscale = sheet.keyscale
    if (accepts('timesignature') && sheet.timesignature) opts.timesignature = sheet.timesignature
    if (accepts('vocalLanguage') && sheet.vocalLanguage) opts.vocalLanguage = sheet.vocalLanguage
  }

  if (task === 'cover') {
    opts.taskType = 'cover-nofsq'
    opts.lyrics = lyrics
    // Was hard-locked to 1 under a comment the addon has since contradicted.
    // These three values are the model authors' own table: 0.3-0.5 for a
    // dramatic genre change, 0.5-0.7 moderate, 0.7-0.9 subtle.
    const pick = COVER_STRENGTHS.find((c) => c.key === req.coverStrength) || COVER_STRENGTHS[1]
    if (accepts('audioCoverStrength')) opts.audioCoverStrength = pick.value
    if (accepts('coverNoiseStrength') && req.coverNoise !== undefined) {
      opts.coverNoiseStrength = Number(req.coverNoise)
    }
  }

  if (task === 'stem') {
    opts.taskType = 'lego'
    opts.track = req.track
    opts.lyrics = lyrics
  }

  // Advanced, only what this engine accepts, only when actually set.
  if (adv.normalizeLoudness === false && accepts('normalizeLoudness')) opts.normalizeLoudness = false
  if (Number(adv.guidanceScale) && accepts('guidanceScale')) opts.guidanceScale = Number(adv.guidanceScale)
  else if (ditVariant === 'sft' && accepts('guidanceScale')) {
    // The authors: CFG is only functional on base and sft, and the default is
    // 7.0. On turbo it is fixed at 1 and setting it does nothing.
    opts.guidanceScale = 7
  }
  if (Number(adv.inferenceSteps) && accepts('inferenceSteps')) opts.inferenceSteps = Number(adv.inferenceSteps)
  if (Number(adv.cfgScale) && accepts('cfgScale')) opts.cfgScale = Number(adv.cfgScale)
  if (Number(adv.lmTemperature) && accepts('lmTemperature')) opts.lmTemperature = Number(adv.lmTemperature)
  if (Number(adv.lmTopP) && accepts('lmTopP')) opts.lmTopP = Number(adv.lmTopP)
  if (adv.augment && accepts('augmentCaptionWithMetadata')) opts.augmentCaptionWithMetadata = true
  if (adv.dcw && accepts('dcwEnabled')) {
    // 0.05 and 0.02 are the engine's own defaults. The old UI defaulted these
    // sliders to 1.00, so ticking the box applied twenty and fifty times the
    // official correction.
    opts.dcwEnabled = true
    opts.dcwScaler = adv.dcwScaler === undefined ? 0.05 : Number(adv.dcwScaler)
    opts.dcwHighScaler = adv.dcwHighScaler === undefined ? 0.02 : Number(adv.dcwHighScaler)
  }

  const operations = []
  if (task === 'repaint') {
    operations.push({
      type: 'repaint',
      caption: req.op.caption || sheet.caption,
      lyrics: req.op.lyrics || '[Instrumental]',
      start: Number(req.op.start),
      end: req.op.end === null || req.op.end === undefined || req.op.end === '' ? null : Number(req.op.end),
      mode: req.op.mode || 'Balanced',
      strength: req.op.strength === undefined ? 0.5 : Number(req.op.strength)
    })
  } else if (task === 'extend') {
    operations.push({
      type: 'extend',
      seconds: Number(req.op.seconds) || 8,
      caption: req.op.caption || sheet.caption,
      lyrics: req.op.lyrics || '[Instrumental]',
      mode: req.op.mode || 'Balanced',
      strength: req.op.strength === undefined ? 0.5 : Number(req.op.strength)
    })
  } else if (task === 'flow-edit') {
    operations.push({
      type: 'flow-edit',
      fromCaption: req.op.fromCaption || sheet.caption,
      fromLyrics: req.op.fromLyrics || '[Instrumental]',
      toCaption: req.op.toCaption,
      toLyrics: req.op.toLyrics || '[Instrumental]',
      nMin: req.op.nMin,
      nMax: req.op.nMax,
      nAvg: req.op.nAvg
    })
  }

  const formats = (req.formats && req.formats.length ? req.formats : COMMON_FORMATS.slice(0, 1))
    .filter((f) => !state.caps || state.caps.formats.includes(f))

  return {
    task,
    engine,
    mode,
    caption: task === 'surprise' ? (req.brief || '').trim() : caption,
    opts,
    operations,
    formats,
    ditVariant,
    useGPU: req.useGPU !== false,
    source: req.source,
    reference: req.reference,
    sheet,
    notes
  }
}

/**
 * Queues one to four renders of the same request, each with its own seed, and
 * starts the first. One engine process at a time, because two at once on a
 * 39 GB machine is how you meet the out-of-memory killer.
 */
async function startRender (req) {
  if (state.job && state.job.status === 'running') throw new Error('a render is already running')
  const base = translateRequest(req)
  const count = Math.max(1, Math.min(4, Number(req.variations) || 1))
  const firstSeed = Number.isFinite(Number(req.seed)) ? Number(req.seed) : Math.floor(Math.random() * 1e9)

  state.queue = []
  for (let i = 0; i < count; i++) {
    const body = { ...base, opts: { ...base.opts, seed: firstSeed + i } }
    body.variation = { index: i + 1, of: count }
    state.queue.push(body)
  }
  const first = state.queue.shift()
  const job = await runOne(first)
  push({ t: 'queue', pending: state.queue.length })
  return job
}

/** Called when a render ends, whatever the reason. */
function drainQueue () {
  if (!state.queue.length) return
  const next = state.queue.shift()
  push({ t: 'queue', pending: state.queue.length })
  runOne(next).catch((e) => {
    state.queue = []
    push({ t: 'failed', error: e.message })
  })
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.wav': 'audio/wav', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.opus': 'audio/opus', '.ogg': 'audio/ogg', '.aiff': 'audio/aiff', '.caf': 'audio/x-caf',
  '.ac3': 'audio/ac3', '.wma': 'audio/x-ms-wma', '.mp2': 'audio/mpeg', '.pcm': 'audio/L16',
  '.json': 'application/json'
}

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type })
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
}

function sendFile (req, res, file) {
  let stat
  try { stat = fs.statSync(file) } catch { return send(res, 404, { error: 'not found' }) }
  // A directory (an empty or dotted name under /api/audio) is not a file to stream.
  if (!stat.isFile()) return send(res, 404, { error: 'not found' })
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'
  // A read error after the headers went out can only end the response, never crash the server.
  const stream = (opts) => fs.createReadStream(file, opts).on('error', () => res.destroy()).pipe(res)
  // Range support, because an <audio> element seeking a 30 MB wav asks for one.
  const range = req.headers.range
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range)
    const start = m && m[1] ? Number(m[1]) : 0
    const end = m && m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1
    if (!m || start > end || start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` })
      return res.end()
    }
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1
    })
    return stream({ start, end })
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' })
  stream()
}

// Bound to this computer, the server answers only to this computer's own names, so a web page
// that rebinds its domain to 127.0.0.1 cannot reach it. With HOST set to a network address the
// check is off, since the point is then to be reached by other names.
const LOOPBACK = ['127.0.0.1', 'localhost', '::1'].includes(HOST)
const OWN_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`])
const hostAllowed = (req) => !LOOPBACK || OWN_HOSTS.has(String(req.headers.host || '').toLowerCase())

// A POST must come from this app's own pages: same origin, and a type a plain HTML form or a
// no-cors fetch cannot send without a preflight (JSON, or the import's x-filename header).
function postAllowed (req, pathname) {
  const origin = req.headers.origin
  if (origin) {
    try { if (new URL(origin).host !== req.headers.host) return false } catch { return false }
  }
  if (pathname === '/api/import') return Boolean(req.headers['x-filename'])
  return String(req.headers['content-type'] || '').startsWith('application/json')
}

const readBody = (req, limit = 1 << 28) => new Promise((resolve, reject) => {
  const parts = []
  let size = 0
  req.on('data', (c) => {
    size += c.length
    if (size > limit) { reject(new Error('body too large')); req.destroy(); return }
    parts.push(c)
  })
  req.on('end', () => resolve(Buffer.concat(parts)))
  req.on('error', reject)
})

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  try {
    if (!hostAllowed(req)) return send(res, 403, { error: 'forbidden' })
    if (req.method === 'POST' && !postAllowed(req, url.pathname)) return send(res, 403, { error: 'forbidden' })
    if (url.pathname === '/api/state') {
      return send(res, 200, {
        models: state.models,
        library: state.library,
        takes: state.takes,
        job: state.job,
        pending: state.queue.length,
        caps: state.caps,
        writer: state.writer,
        download: state.download,
        // The vocabulary lives on the server so there is one copy of it, and so
        // the tag lists the UI offers are the ones the translator knows about.
        vocab: { starters: STARTERS, chips: CHIPS, keys: KEYS, timeSignatures: TIME_SIGNATURES,
          languages: LANGUAGES, coverStrengths: COVER_STRENGTHS, commonFormats: COMMON_FORMATS,
          sections: SECTIONS, colourTags: COLOUR_TAGS, tagTarget: TAG_TARGET },
        machine: { platform: process.platform, arch: process.arch, cpus: os.cpus().length, ramGB: Math.round(os.totalmem() / 1e9) }
      })
    }

    // The brief expander. Fields already edited are sent as `keep` and come back
    // untouched, which is what lets one sheet serve both the person who types a
    // paragraph and the person who knows they want 76 BPM in A minor.
    if (url.pathname === '/api/sheet' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString() || '{}')
      if (!state.writer.available) return send(res, 400, { error: `the brief expander is off: ${state.writer.why}` })
      const brief = String(body.brief || '').trim()
      if (!brief) return send(res, 400, { error: 'write a brief first' })
      try {
        const sheet = await writer.expand(brief, body.keep || {})
        return send(res, 200, { sheet })
      } catch (e) {
        return send(res, 500, { error: e.message })
      }
    }

    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      res.write(': connected\n\n')
      clients.add(res)
      req.on('close', () => clients.delete(res))
      return
    }

    if (url.pathname === '/api/models/catalogue') {
      return send(res, 200, await modelCatalogue())
    }

    if (url.pathname === '/api/models/download' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString() || '{}')
      const keys = Array.isArray(body.keys) ? body.keys : []
      if (!keys.length) return send(res, 400, { error: 'nothing to download' })
      try {
        return send(res, 200, await fetchModels(keys))
      } catch (e) {
        return send(res, 400, { error: e.message })
      }
    }

    if (url.pathname === '/api/models' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString() || '{}')
      // A folder path, typed by the person who owns the weights. MiniMax-Music3 is
      // not ours to distribute, so this field is the whole licence story in the UI.
      // Only a folder inside the home directory: the path comes from a request.
      if (typeof body.mm3Dir === 'string' && body.mm3Dir) {
        const home = os.homedir()
        const dir = path.resolve(body.mm3Dir.replace(/^~(?=\/|$)/, home))
        if (!dir.startsWith(home + path.sep)) return send(res, 400, { error: 'Choose a folder inside your home folder.' })
        mm3Dir = dir
      }
      state.models = discover()
      return send(res, 200, { models: state.models })
    }

    if (url.pathname === '/api/import' && req.method === 'POST') {
      const name = (req.headers['x-filename'] || 'import.wav').toString().replace(/[^\w.\-]+/g, '_')
      const bytes = await readBody(req)
      if (!bytes.length) return send(res, 400, { error: 'empty upload' })
      const id = short()
      const file = path.join(LIB, `${id}-${name}`)
      await fsp.writeFile(file, bytes)
      const info = await probe(file)
      const item = { id, name, file, bytes: bytes.length, ...info, at: new Date().toISOString() }
      // Converted now rather than at render time, so a bad import fails while the
      // person is still looking at the file they picked.
      try {
        await toEnginePcm(file, `lib-${id}`)
        item.engineReady = true
      } catch (e) {
        item.engineReady = false
        item.error = e.message
      }
      state.library.unshift(item)
      push({ t: 'library', item })
      return send(res, 200, { item })
    }

    if (url.pathname === '/api/render' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString() || '{}')
      const job = await startRender(body)
      return send(res, 200, { ok: true, job })
    }

    if (url.pathname === '/api/cancel' && req.method === 'POST') {
      if (state.job && state.job.status === 'running' && state.job.pid) {
        try { process.kill(state.job.pid, 'SIGKILL') } catch {}
        return send(res, 200, { ok: true })
      }
      return send(res, 200, { ok: false, error: 'nothing is running' })
    }

    if (url.pathname.startsWith('/api/audio/')) {
      // Only ever from out/ or library/, and only a basename: a path from the client
      // is a path an attacker can write, so it never reaches the filesystem intact.
      const [, , , which, ...rest] = url.pathname.split('/')
      const base = which === 'library' ? LIB : OUT
      const file = path.join(base, path.basename(decodeURIComponent(rest.join('/'))))
      return sendFile(req, res, file)
    }

    // The event build, on its own route. Same server, same engine, same models: only the front
    // end differs. See public/stand.js.
    // `/stand/` with the trailing slash served the same HTML, but the page's own `stand.css`,
    // `stand.js` and `/lib` imports are RELATIVE, so from `/stand/` they resolved to
    // `/stand/stand.css` and returned 404. Every section starts `hidden` and is shown by the
    // script, so the result was a page that had loaded and showed nothing: a blank screen that
    // reads as "still loading". Redirect instead of serving both spellings.
    if (url.pathname === '/stand/') {
      res.writeHead(301, { Location: '/stand' })
      return res.end()
    }
    if (url.pathname === '/stand') {
      return sendFile(req, res, path.join(DIR, 'public', 'stand.html'))
    }

    // The three lib modules the stand's front end imports. The composer, the vocabulary and the
    // caption rules live in ONE copy that the browser, the server and bin/compose-check.mjs all
    // load, so the tested code is the shipped code. Allowlisted by name, never by path: a name
    // from the client is a name an attacker can write.
    if (url.pathname.startsWith('/lib/')) {
      const LIB_PUBLIC = new Set(['stand-styles.mjs', 'caption.mjs', 'vocab.mjs'])
      const name = path.basename(url.pathname)
      if (!LIB_PUBLIC.has(name)) return send(res, 404, { error: 'not found' })
      return sendFile(req, res, path.join(DIR, 'lib', name))
    }

    // Static UI
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
    const file = path.join(DIR, 'public', path.normalize(rel).replace(/^(\.\.[/\\])+/, ''))
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return sendFile(req, res, file)
    return send(res, 404, { error: 'not found' })
  } catch (e) {
    return send(res, 500, { error: e.message })
  }
})

server.listen(PORT, HOST, async () => {
  const m = state.models
  console.log(`\nQVAC Music Desk  http://localhost:${PORT}`)
  console.log(`  event build      http://localhost:${PORT}/stand`)
  console.log(`  MiniMax-Music3  ${m.minimax.ready ? `ready, ${(m.minimax.bytes / 1e9).toFixed(1)} GB in ${m.minimax.dir}` : `not found (${m.minimax.missing.join(', ')})`}`)
  console.log(`  ACE-Step 1.5    ${m.acestep.ready ? `ready, DiT variants: ${Object.keys(m.acestep.dits).join(', ')}` : `not found (${m.acestep.missing.join(', ')})`}`)

  // Learn the expected sizes before anything trusts a filename, then look again.
  try {
    const sdk = await import('@qvac/sdk')
    for (const constant of Object.values(FETCHABLE)) {
      const e = sdk[constant]
      if (e && e.modelId && e.expectedSize) EXPECTED[e.modelId] = e.expectedSize
    }
    const w = sdk[WRITER_CONSTANT]
    if (w && w.modelId && w.expectedSize) EXPECTED[w.modelId] = w.expectedSize
    state.models = discover()
  } catch { /* no SDK, fall back to matching on the name alone */ }

  state.caps = await readCaps()
  if (state.caps) {
    const refuses = (e) => Object.entries(state.caps.accepts[e]).filter(([, v]) => !v).length
    console.log(`  capabilities    read from addon ${state.caps.addonVersion}: acestep refuses ${refuses('acestep')} options, minimax ${refuses('minimax')}`)
  } else {
    console.log('  capabilities    could not be read, every control is offered and the engine decides')
  }

  let cached = []
  try { cached = fs.readdirSync(QVAC_MODELS) } catch {}
  state.writer = await writer.probe(cached)
  console.log(`  brief expander  ${state.writer.available ? `${state.writer.model}, already on disk` : `off (${state.writer.why})`}`)
  push({ t: 'ready', caps: state.caps, writer: state.writer })
  console.log('  engine stderr goes to out/engine.log\n')
})

// A failure in one request must not take the desk down for everyone.
process.on('unhandledRejection', (err) => console.error('[music-desk] unhandled:', (err && err.message) || err))
