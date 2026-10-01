// QVAC MUSIC DESK - capability probe
// ---------------------------------------------------------------------------
// Prints, as one JSON line, what THIS installed copy of `@qvac/audiogen-ggml`
// accepts. Spawned once by the server at startup and cached.
//
// Why this file exists at all: the desk used to carry a hand-written table of
// what each engine accepts. `package.json` pins the addon with a caret, so 0.3.3
// installed itself over 0.3.2 and the table silently went out of date. Four
// controls the engine had gained were missing from the UI, and one the UI showed
// as locked ("the addon rejects anything but 1") had just been unlocked. A
// second hand-written table would have the same bug next release.
//
// It runs under `bare`, like every other engine call here, because `binding.js`
// is `require.addon()` and Node cannot load it.
//
// Two ways to learn a capability, both used:
//   1. What the addon EXPORTS: output formats, DiT variants, repaint modes.
//   2. What its VALIDATOR refuses: build an engine on paths that do not exist,
//      call run() with one option, and read the rejection. Option validation
//      runs before any file is opened, so no model is loaded and nothing is
//      generated. A rejection that mentions a file means the option passed.
// ---------------------------------------------------------------------------

const A = require('@qvac/audiogen-ggml')
// Bare has no ambient `process`.
const process = require('bare-process')

// Deliberately non-existent: we only ever want the validator, never a load.
const FILES = {
  [A.ENGINE_MINIMAX]: { lmModel: '/nonexistent', synthModel: '/nonexistent' },
  [A.ENGINE_ACESTEP]: {
    textEncModel: '/nonexistent', lmModel: '/nonexistent',
    ditModel: '/nonexistent', vaeModel: '/nonexistent'
  }
}

// One representative value per option. The value only has to be well-formed
// enough to reach the per-engine acceptance check.
const OPTIONS = {
  lyrics: '[Instrumental]',
  seed: 1,
  duration: 8,
  bpm: 120,
  keyscale: 'C major',
  timesignature: '4/4',
  vocalLanguage: 'en',
  augmentCaptionWithMetadata: true,
  maxFrames: 100,
  inferenceSteps: 8,
  cfgScale: 1,
  lmTemperature: 0.85,
  lmTopP: 0.9,
  lmTopK: 40,
  lmCfgScale: 1,
  lmPhase1: true,
  simpleMode: true,
  normalizeLoudness: true,
  dcwEnabled: true,
  dcwScaler: 0.05,
  dcwHighScaler: 0.02,
  guidanceScale: 2,
  referenceAudio: new Float32Array(4),
  audioCoverStrength: 0.5,
  coverNoiseStrength: 0.5
}

/** True when the option got past the per-engine gate. */
async function accepts (engine, opts) {
  let gen
  try {
    gen = new A.AudioGen({ engine, files: FILES[engine] })
  } catch (e) {
    return { ok: false, why: e.message }
  }
  try {
    await gen.run('probe', opts)
    return { ok: true }
  } catch (e) {
    const why = String(e.message).replace('Invalid AudioGen input: ', '')
    // "not loaded" is the pass: every option cleared validation and the engine
    // then asked for the model we deliberately never gave it. Anything else is
    // the engine naming the option it refuses.
    const cleared = /is not loaded|call load\(\) first/i.test(why)
    return cleared ? { ok: true } : { ok: false, why }
  }
}

async function main () {
  const out = {
    // The version is read by the server from package.json on disk: the addon's
    // own `exports` map does not expose it.
    formats: A.OUTPUT_FORMATS,
    ditVariants: A.DIT_VARIANTS,
    defaultDit: A.DEFAULT_DIT_VARIANT,
    repaintModes: Object.keys(A.RepaintMode || {}),
    minimaxFramesPerSecond: A.MINIMAX_FRAMES_PER_SECOND,
    minimaxDefaultMaxFrames: A.MINIMAX_DEFAULT_MAX_FRAMES,
    accepts: { minimax: {}, acestep: {} },
    rejections: { minimax: {}, acestep: {} }
  }

  for (const [key, value] of Object.entries(OPTIONS)) {
    for (const [name, engine] of [['minimax', A.ENGINE_MINIMAX], ['acestep', A.ENGINE_ACESTEP]]) {
      const r = await accepts(engine, { [key]: value })
      out.accepts[name][key] = r.ok
      if (!r.ok) out.rejections[name][key] = r.why
    }
  }

  // The lego track list is not exported, but the engine's own error message is
  // built from it, so the message is the list.
  const lego = await accepts(A.ENGINE_ACESTEP, { taskType: 'lego' })
  const m = /one of ([a-z_|]+)/.exec(lego.why || '')
  out.legoTracks = m ? m[1].split('|') : []
  // When the message asks for sourceAudio instead, the track list came earlier in
  // the chain, so ask again with a source present.
  if (!out.legoTracks.length) {
    const lego2 = await accepts(A.ENGINE_ACESTEP, { taskType: 'lego', sourceAudio: new Float32Array(96000) })
    const m2 = /one of ([a-z_|]+)/.exec(lego2.why || '')
    out.legoTracks = m2 ? m2[1].split('|') : []
  }

  // Editing: refused for MiniMax by name, so ask rather than assume.
  for (const [name, engine] of [['minimax', A.ENGINE_MINIMAX], ['acestep', A.ENGINE_ACESTEP]]) {
    let canEdit = true
    let why = null
    try {
      const gen = new A.AudioGen({ engine, files: FILES[engine] })
      await gen.edit({ pcm: new Float32Array(96000), sampleRate: 48000, channels: 2 })
        .repaint({ caption: 'x', start: 0, end: 0.5 })
        .run({ seed: 1 })
    } catch (e) {
      const msg = String(e.message)
      if (/does not support audio editing/i.test(msg)) { canEdit = false; why = msg }
    }
    out.accepts[name].edit = canEdit
    if (why) out.rejections[name].edit = why.replace('Invalid AudioGen input: ', '')
  }

  process.stdout.write(JSON.stringify(out) + '\n')
}

main().catch((e) => {
  process.stdout.write(JSON.stringify({ error: String(e && e.message) }) + '\n')
})
