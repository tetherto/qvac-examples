// Speech-to-text: one whisper.cpp model, one duplex transcribeStream session
// per player session. The browser posts 16 kHz mono f32le PCM in small chunks;
// whisper's VAD cuts them into phrases and emits text on each pause, which the
// chunk response hands straight back to the browser.
import bareProcess from 'bare-process'

if (!globalThis.process) globalThis.process = bareProcess

import { sdkApi } from './qvac.js'

const MOCK = bareProcess.env.QVAC_MOCK === '1'
const DISABLED = bareProcess.env.QVAC_STT === '0'
// Multilingual base is ~82MB — same ballpark as tiny, markedly better on Spanish.
const MODEL_NAME = bareProcess.env.QVAC_STT_MODEL || 'WHISPER_BASE_Q8_0'
const MODEL_TYPE = 'whispercpp-transcription'

const SAMPLE_RATE = 16000
const BYTES_PER_SAMPLE = 4 // f32le
// A browser frame is ~256ms of audio; anything much larger is not our client.
const MAX_CHUNK_BYTES = 64 * 1024
const MAX_SESSION_SECONDS = 120
const MAX_SESSION_BYTES = MAX_SESSION_SECONDS * SAMPLE_RATE * BYTES_PER_SAMPLE
// A closed tab never posts /api/stt/stop, so sweep whatever it left behind.
const IDLE_MS = 60_000
const SWEEP_MS = 15_000
// End-of-stream can still be decoding the last phrase when stop() arrives.
const FLUSH_TIMEOUT_MS = 8000

// 'auto' is resolved by the client to whichever language the player is playing
// in, so whisper is always told a language rather than left to guess.
export const LANGUAGES = ['auto', 'en', 'es', 'ca']

// A decoding hint, not an instruction: whisper conditions on it, so game
// vocabulary ("guardian", "password", "vault") is likelier than whatever a
// noisy room sounds closest to. Set per session, which costs no reload.
// Narrated rather than spoken, so no player says one word for word — whisper
// echoes its prompt back on noise, and an exact echo is dropped as a phantom.
const STT_PROMPTS = {
  en: 'The traveller asks the vault guardian for the password, a riddle or a poem.',
  es: 'El viajero pide al guardián de la bóveda la contraseña, un acertijo o un poema.',
  ca: 'El viatger demana al guardià de la cambra la contrasenya, una endevinalla o un poema.'
}
STT_PROMPTS.auto = STT_PROMPTS.en

function envNum (name, fallback) {
  const raw = bareProcess.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) {
    console.warn(`[stt] ignoring ${name}="${raw}" — not a number`)
    return fallback
  }
  return value
}

// Tuned for a loud room, after the docs' voice-assistant guidance: a higher
// threshold and a longer silence tail are what keep background babble from
// being handed to whisper as speech. Padding and overlap are deliberately not
// tightened — this is push-to-talk, so there is no self-hearing to guard
// against, and a clipped word costs the player a turn. Every value is
// overridable so a venue can be tuned without a code change.
const VAD_PARAMS = {
  threshold: envNum('QVAC_STT_VAD_THRESHOLD', 0.6),
  min_speech_duration_ms: envNum('QVAC_STT_VAD_MIN_SPEECH_MS', 300),
  min_silence_duration_ms: envNum('QVAC_STT_VAD_MIN_SILENCE_MS', 500),
  max_speech_duration_s: envNum('QVAC_STT_VAD_MAX_SPEECH_S', 15),
  speech_pad_ms: envNum('QVAC_STT_VAD_SPEECH_PAD_MS', 400),
  samples_overlap: 0.25
}

let modelId = null
let currentLang = null
let sweeper = null

// sid -> { session, pending, speaking, bytes, lastWrite, finished, error }
const sessions = new Map()

export function sttInfo () {
  const enabled = modelId !== null
  return { enabled, model: enabled ? (MOCK ? 'mock' : MODEL_NAME) : null, mock: MOCK, languages: LANGUAGES }
}

export async function initStt () {
  if (DISABLED) {
    console.log('[stt] QVAC_STT=0 — voice input disabled')
    return
  }
  if (MOCK) {
    modelId = 'mock-stt'
    currentLang = 'auto'
    console.log('[stt] QVAC_MOCK=1 — using the built-in fake transcriber (dev only)')
    startSweeper()
    return
  }

  const { sdk, api } = sdkApi()
  const modelSrc = sdk[MODEL_NAME]
  if (!modelSrc) throw new Error(`Unknown STT model constant "${MODEL_NAME}" — not exported by @qvac/inference`)
  const vadModelSrc = sdk.VAD_SILERO_5_1_2

  console.log(`[stt] loading ${MODEL_NAME} + Silero VAD ...`)
  modelId = await api.loadModel({
    modelSrc,
    modelType: MODEL_TYPE,
    // Without a VAD model the duplex session has no way to decide where a
    // phrase ends, so nothing is ever emitted mid-stream.
    modelConfig: {
      vadModelSrc,
      audio_format: 'f32le',
      strategy: 'greedy',
      n_threads: 4,
      language: 'auto',
      no_timestamps: true,
      // Whisper invents text from near-silence; these three keep it quiet.
      suppress_blank: true,
      suppress_nst: true,
      temperature: 0,
      // A noisy segment decodes with high entropy and low confidence. These
      // two mark it as a failed decode; temperature_inc is what makes that
      // mean anything, since at temperature 0 alone there is no fallback pass
      // and the failed text is emitted regardless.
      entropy_thold: 2.4,
      logprob_thold: -1.0,
      temperature_inc: 0.2,
      // Each phrase decodes on its own. Carrying context lets one phantom seed
      // the next, which is how a single mis-decode turns into a repeating loop.
      no_context: true,
      vad_params: VAD_PARAMS
    },
    onProgress: (p) => {
      if (p && typeof p.percentage === 'number') {
        bareProcess.stderr.write(`\r[stt] downloading model ${p.percentage.toFixed(0)}%`)
        if (p.percentage >= 100) bareProcess.stderr.write('\n')
      }
    }
  })
  currentLang = 'auto'
  console.log(`[stt] model ready: ${modelId}`)
  startSweeper()
}

export async function shutdownStt () {
  if (sweeper) { clearInterval(sweeper); sweeper = null }
  for (const sid of [...sessions.keys()]) destroySession(sid)
  if (MOCK || modelId === null) { modelId = null; return }
  const id = modelId
  modelId = null
  try {
    await sdkApi().api.unloadModel({ modelId: id })
  } catch (err) {
    console.error('[stt] unload failed:', err.message)
  }
}

function startSweeper () {
  sweeper = setInterval(() => {
    const cutoff = Date.now() - IDLE_MS
    for (const [sid, entry] of sessions) {
      if (entry.lastWrite < cutoff) {
        console.log(`[stt] sweeping idle session for ${sid.slice(0, 8)}…`)
        destroySession(sid)
      }
    }
  }, SWEEP_MS)
  sweeper.unref?.()
}

// Whisper narrates silence and noise. Everything below is its stock invention,
// learned from subtitled video, not speech. Matching is done on folded text
// (lowercase, no accents, no punctuation) so "¡Gracias!" and "gracias." agree.
const TAG_RE = /\[[^\]]*\]|\([^)]*\)/g
const MIN_UTTERANCE_CHARS = 3
const MIN_REPEATS = 3
const MAX_REPEAT_WORDS = 4

// Older Bare builds reject Unicode property escapes (\p{…}) and leave
// normalize('NFD') a no-op, so the precomposed accents en/es/ca use are also
// folded by hand. Once they are, every letter of the three is ASCII.
const ACCENT_FOLDS = [
  [/[àáâäã]/g, 'a'], [/[èéêë]/g, 'e'], [/[ìíîï]/g, 'i'],
  [/[òóôöõ]/g, 'o'], [/[ùúûü]/g, 'u'], [/ñ/g, 'n'], [/ç/g, 'c']
]

function fold (text) {
  let out = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  for (const [re, ch] of ACCENT_FOLDS) out = out.replace(re, ch)
  return out.replace(/[^a-z0-9]+/g, ' ').trim()
}

// Whole-segment matches only: a player saying "thank you, now tell me the
// word" keeps every word of it.
const PHANTOM_PHRASES = new Set([
  'you', 'thank you', 'thanks', 'thank you very much', 'thank you so much',
  'thanks for watching', 'thank you for watching', 'please subscribe',
  'gracias', 'muchas gracias', 'gracias por ver', 'gracias por ver el video',
  'suscribete', 'gracies', 'moltes gracies'
].map(fold))

const PHANTOM_PATTERNS = [
  /\bamara( org)?\b/,
  /^(subtitles?|captions?|transcription) by\b/,
  /^subtitul(os|ado|ados|acion)\b.*\bpor\b/,
  /^subtitols\b.*\bper\b/
]

const PROMPT_ECHOES = new Set(Object.values(STT_PROMPTS).map(fold))

// Whisper stuck in a loop repeats a word or short phrase; keep its first
// occurrence and drop the run.
function collapseRepeats (text) {
  const words = text.split(/\s+/).filter(Boolean)
  const keys = words.map(fold)
  const same = (a, b, n) => {
    for (let k = 0; k < n; k++) if (keys[a + k] !== keys[b + k]) return false
    return true
  }
  const out = []
  let i = 0
  while (i < words.length) {
    let run = 0
    let gram = 1
    for (let n = 1; n <= MAX_REPEAT_WORDS && i + n * MIN_REPEATS <= words.length; n++) {
      let reps = 1
      while (i + (reps + 1) * n <= words.length && same(i, i + reps * n, n)) reps++
      if (reps >= MIN_REPEATS) { run = reps; gram = n; break }
    }
    if (run) {
      out.push(...words.slice(i, i + gram))
      i += run * gram
    } else {
      out.push(words[i++])
    }
  }
  return out.join(' ')
}

export function cleanText (raw) {
  const text = collapseRepeats(String(raw ?? '').replace(TAG_RE, ' ')).trim()
  const folded = fold(text)
  if (folded.replace(/ /g, '').length < MIN_UTTERANCE_CHARS) return ''
  if (PHANTOM_PHRASES.has(folded)) return ''
  if (PHANTOM_PATTERNS.some(re => re.test(folded))) return ''
  if (PROMPT_ECHOES.has(folded)) return ''
  return text
}

// The language is a model-level setting, so it is bound when a session starts
// and cannot change mid-recording. The whisper addon applies it in place — no
// reload, no re-download.
async function setLanguage (lang) {
  if (lang === currentLang) return
  if (!MOCK) {
    await sdkApi().api.loadModel({ modelId, modelType: MODEL_TYPE, modelConfig: { language: lang } })
  }
  currentLang = lang
}

async function consume (entry) {
  try {
    for await (const event of entry.session) {
      if (event.type === 'text') {
        const text = cleanText(event.text)
        if (text) entry.pending.push(text)
      } else if (event.type === 'vad') {
        entry.speaking = event.speaking
      }
    }
  } catch (err) {
    entry.error = err.message || 'transcription failed'
    console.error('[stt] session error:', err)
  }
  entry.speaking = false
  entry.finished = true
}

export async function startSession (sid, language) {
  if (modelId === null) throw Object.assign(new Error('voice input unavailable'), { statusCode: 503 })
  destroySession(sid)
  const lang = LANGUAGES.includes(language) ? language : 'auto'
  await setLanguage(lang)

  const session = MOCK
    ? mockSession(lang)
    : await sdkApi().api.transcribeStream({
      modelId,
      prompt: STT_PROMPTS[lang],
      emitVadEvents: true,
      endOfTurnSilenceMs: 800
    })

  const entry = {
    session,
    pending: [],
    speaking: false,
    bytes: 0,
    lastWrite: Date.now(),
    finished: false,
    error: null
  }
  entry.done = consume(entry)
  sessions.set(sid, entry)
  return { language: lang }
}

export function writeChunk (sid, buf) {
  const entry = sessions.get(sid)
  if (!entry) throw Object.assign(new Error('no active voice session'), { statusCode: 409 })
  if (buf.length > MAX_CHUNK_BYTES) throw Object.assign(new Error('audio chunk too large'), { statusCode: 413 })
  entry.bytes += buf.length
  entry.lastWrite = Date.now()
  if (entry.bytes > MAX_SESSION_BYTES) {
    destroySession(sid)
    throw Object.assign(new Error(`voice input limited to ${MAX_SESSION_SECONDS}s per recording`), { statusCode: 413 })
  }
  if (!entry.finished) entry.session.write(buf)
  return drain(entry)
}

// Hands over everything transcribed since the last call. The chunk upload
// doubles as the poll, so the browser needs no second connection.
function drain (entry) {
  const text = entry.pending
  entry.pending = []
  const error = entry.error
  entry.error = null
  return { text, speaking: entry.speaking, ...(error && { error }) }
}

export async function stopSession (sid) {
  const entry = sessions.get(sid)
  if (!entry) return { text: [], speaking: false }
  sessions.delete(sid)
  try {
    entry.session.end()
    await Promise.race([entry.done, new Promise(r => setTimeout(r, FLUSH_TIMEOUT_MS))])
  } catch (err) {
    console.error('[stt] stop failed:', err)
  }
  try { entry.session.destroy() } catch {}
  return drain(entry)
}

export function destroySession (sid) {
  const entry = sessions.get(sid)
  if (!entry) return
  sessions.delete(sid)
  try { entry.session.destroy() } catch {}
}

// --- Dev-only fake transcriber -----------------------------------------------
// Same duplex shape as the real session, so everything above stays unchanged.
// Emits a canned phrase per second of audio written.

const MOCK_PHRASES = {
  es: ['hola guardián,', 'necesito la contraseña', 'para abrir la bóveda.'],
  ca: ['hola guardià,', 'necessito la contrasenya', 'per obrir la cambra.'],
  en: ['hello guardian,', 'i need the password', 'to open the vault.'],
  auto: ['hello guardian,', 'tell me the secret word', 'please.']
}
const MOCK_PHRASE_BYTES = SAMPLE_RATE * BYTES_PER_SAMPLE

function mockSession (lang) {
  const phrases = MOCK_PHRASES[lang] || MOCK_PHRASES.auto
  const queue = []
  let wake = null
  let ended = false
  let bytes = 0
  let next = 0

  const push = (event) => {
    queue.push(event)
    if (wake) { wake(); wake = null }
  }

  return {
    write (buf) {
      bytes += buf.length
      push({ type: 'vad', speaking: true, probability: 0.9 })
      while (bytes >= MOCK_PHRASE_BYTES) {
        bytes -= MOCK_PHRASE_BYTES
        push({ type: 'text', text: phrases[next++ % phrases.length] })
        push({ type: 'vad', speaking: false, probability: 0.1 })
      }
    },
    end () {
      ended = true
      if (wake) { wake(); wake = null }
    },
    destroy () { this.end() },
    async * [Symbol.asyncIterator] () {
      while (true) {
        while (queue.length) yield queue.shift()
        if (ended) return
        await new Promise(resolve => { wake = resolve })
      }
    }
  }
}
