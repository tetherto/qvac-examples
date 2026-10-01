// One render, start to finish, in the Bare runtime.
//
// `@qvac/audiogen-ggml` is a Bare native addon (`binding.js` is `require.addon()`),
// so it cannot be required from Node. The server therefore writes a job as JSON and
// spawns `bare engine/worker.js <job.json>`. Newline-delimited JSON events go to
// stdout; everything else, including the 119 lines of model paths the Metal kernel
// compiler writes, goes to stderr and from there to out/engine.log. That split is
// what keeps a home directory out of the UI.
//
// One process per render is deliberate. The weights stay in the OS page cache, so a
// warm load of the 11.8 GB MiniMax pair costs about a second, and killing the child
// is a cancel that cannot leave a half-loaded engine behind.

const {
  AudioGen,
  ENGINE_MINIMAX,
  ENGINE_ACESTEP,
  RepaintMode
} = require('@qvac/audiogen-ggml')
const { audiogenBackendName, audiogenGpuFallbackReason } = require('@qvac/audiogen-ggml')
const fs = require('bare-fs')
const process = require('bare-process')

const emit = (event) => { console.log(JSON.stringify(event)) }

/**
 * Interleaved stereo float samples for the addon.
 *
 * The bytes are COPIED rather than viewed. bare-fs can hand back a Buffer that is a
 * view into a pool, and a Float32Array needs its byteOffset to be a multiple of 4:
 * viewing a pooled buffer throws "start offset should be a multiple of 4" on some
 * reads and not others, which is the worst kind of bug to chase.
 */
function readFloatPcm (file, label) {
  const bytes = new Uint8Array(fs.readFileSync(file))
  if (bytes.byteLength % 4 !== 0) throw new Error(`${label}: ${file} is not whole 32-bit samples`)
  const pcm = new Float32Array(bytes.buffer, 0, bytes.byteLength / 4)
  // The addon rejects a non-finite or out-of-range sample outright. ffmpeg can leave a
  // hot master a hair above 1.0, so clamp and say how much was touched rather than
  // failing the render on the last decimal of someone's loud reference track.
  let clamped = 0
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i]
    if (!Number.isFinite(v)) { pcm[i] = 0; clamped++; continue }
    if (v > 1) { pcm[i] = 1; clamped++ } else if (v < -1) { pcm[i] = -1; clamped++ }
  }
  if (clamped > 0) emit({ t: 'note', message: `${label}: ${clamped} sample(s) clamped into [-1, 1]` })
  return pcm
}

/** Peak and RMS in dBFS, so a silent take is never offered as a result. */
function measure (pcmBytes) {
  const n = Math.floor(pcmBytes.byteLength / 2)
  const view = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, n * 2)
  let peak = 0
  let sum = 0
  for (let i = 0; i < n; i++) {
    const s = view.getInt16(i * 2, true) / 32768
    const a = s < 0 ? -s : s
    if (a > peak) peak = a
    sum += s * s
  }
  const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity)
  const rms = n > 0 ? Math.sqrt(sum / n) : 0
  return {
    peakDb: Number.isFinite(db(peak)) ? Math.round(db(peak) * 10) / 10 : null,
    rmsDb: Number.isFinite(db(rms)) ? Math.round(db(rms) * 10) / 10 : null,
    silent: db(rms) < -60,
    // A repaint measured at exactly 0 dBFS on this machine: the engine does not
    // normalize, so a regenerated range can arrive at full scale. Worth saying,
    // because it is the difference between a master and a master to redo.
    clipped: peak >= 0.9999
  }
}

async function main () {
  const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
  const engine = job.engine === 'minimax' ? ENGINE_MINIMAX : ENGINE_ACESTEP

  const gen = new AudioGen({ engine, files: job.files, config: job.config || {} })

  const t0 = Date.now()
  await gen.load()
  emit({ t: 'loaded', ms: Date.now() - t0 })

  let response
  if (job.mode === 'edit') {
    const source = {
      pcm: readFloatPcm(job.sourcePcm, 'source'),
      sampleRate: 48000,
      channels: 2
    }
    // Chained in the order the desk lists them, because that is the order the engine
    // executes them in. Reordering the stack in the UI reorders the render.
    let session = gen.edit(source)
    for (const op of job.operations || []) {
      if (op.type === 'repaint') {
        session = session.repaint({
          caption: op.caption,
          lyrics: op.lyrics || '[Instrumental]',
          start: op.start,
          ...(op.end === null || op.end === undefined ? {} : { end: op.end }),
          mode: RepaintMode[op.mode] || RepaintMode.Balanced,
          ...(op.strength === undefined ? {} : { strength: op.strength })
        })
      } else {
        session = session.edit({
          from: { caption: op.fromCaption, lyrics: op.fromLyrics || '[Instrumental]' },
          to: { caption: op.toCaption, lyrics: op.toLyrics || '[Instrumental]' },
          ...(op.nMin === undefined ? {} : { nMin: op.nMin }),
          ...(op.nMax === undefined ? {} : { nMax: op.nMax }),
          ...(op.nAvg === undefined ? {} : { nAvg: op.nAvg })
        })
      }
    }
    response = await session.run(job.opts.seed === undefined ? {} : { seed: job.opts.seed })
  } else {
    const opts = { ...job.opts }
    if (job.referencePcm) opts.referenceAudio = readFloatPcm(job.referencePcm, 'reference')
    if (job.sourcePcm) opts.sourceAudio = readFloatPcm(job.sourcePcm, 'source')
    response = await gen.run(job.caption, opts)
  }

  const chunks = []
  let sampleRate = 0
  let channels = 0
  for await (const item of response.iterate()) {
    if (item.progress) {
      emit({ t: 'progress', stage: item.progress.stage, step: item.progress.step, total: item.progress.total })
    } else if (item.outputArray) {
      chunks.push(Buffer.from(item.outputArray.buffer, item.outputArray.byteOffset, item.outputArray.byteLength))
      sampleRate = item.sampleRate
      channels = item.channels
    }
  }
  const stats = await response.await()
  if (chunks.length === 0) throw new Error('the engine returned no audio')

  const pcm = Buffer.concat(chunks)
  const written = []
  for (const format of job.formats && job.formats.length ? job.formats : ['wav']) {
    const encoded = AudioGen.encode(pcm, format, { sampleRate, channels })
    const file = `${job.out}.${encoded.extension}`
    fs.writeFileSync(file, encoded.data)
    written.push({ format: encoded.format, file, mimeType: encoded.mimeType, bytes: encoded.data.byteLength })
  }

  emit({
    t: 'done',
    files: written,
    sampleRate,
    channels,
    level: measure(pcm),
    stats: {
      audioDurationMs: stats.audioDurationMs ?? null,
      totalTimeMs: stats.totalTimeMs ?? null,
      realTimeFactor: stats.realTimeFactor ?? null,
      // The backend the engine RESOLVED to. A useGPU run that fell back to the CPU is
      // only detectable here, and the reason says which half of the acquisition failed.
      backend: audiogenBackendName(stats.backendId) || 'cpu',
      backendDevice: stats.backendDevice ?? null,
      gpuFallback: audiogenGpuFallbackReason(stats.gpuFallbackReason) || null
    }
  })

  await gen.destroy()
}

main().catch((err) => {
  emit({ t: 'error', message: String((err && err.message) || err), code: (err && err.code) || null })
  process.exit(1)
})
