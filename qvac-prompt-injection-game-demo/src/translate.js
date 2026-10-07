// Translation both ways between the player's language and English, through the
// QVAC NMT engine.
//
// The guardian reasons and writes only in English: every guard, classifier and
// coach prompt in this app is English, and keeping generation there is what
// keeps them meaningful. So the game is English in the middle and the player's
// language at both ends — the message is translated in before the first guard
// reads it, and the reply is translated out after the last one has, which
// means nothing downstream of a guard is ever re-read by one.
//
// Bergamot is a per-direction model of ~32MB, loaded the first time a
// direction is actually asked for, so an English run downloads nothing.
import bareProcess from 'bare-process'

if (!globalThis.process) globalThis.process = bareProcess

import { sdkApi } from './qvac.js'

const MOCK = bareProcess.env.QVAC_MOCK === '1'
const DISABLED = bareProcess.env.QVAC_TRANSLATE === '0'
const MODEL_TYPE = 'nmtcpp-translation'

// The languages a player can pick. English is the language the guardian
// thinks in, so it is never translated in either direction.
export const PLAYER_LANGUAGES = ['en', 'es', 'ca']

// One Bergamot model per direction, written the way it is keyed: "from>to".
const MODELS = {
  'en>es': 'BERGAMOT_EN_ES',
  'en>ca': 'BERGAMOT_EN_CA',
  'es>en': 'BERGAMOT_ES_EN',
  'ca>en': 'BERGAMOT_CA_EN'
}

export function isPlayerLanguage (lang) {
  return PLAYER_LANGUAGES.includes(lang)
}

// English on either end of a direction makes it a no-op, and so does the kill
// switch.
function needsModel (dir) {
  return !DISABLED && !!MODELS[dir]
}

export function translationInfo () {
  return { enabled: !DISABLED, mock: MOCK, languages: PLAYER_LANGUAGES }
}

// direction -> Promise<modelId>. Holding the promise rather than the id means
// two turns racing on the same direction share one load instead of starting
// two.
const models = new Map()

function modelFor (dir) {
  if (!models.has(dir)) {
    models.set(dir, loadFor(dir).catch(err => {
      // A failed load must not poison the direction forever.
      models.delete(dir)
      throw err
    }))
  }
  return models.get(dir)
}

async function loadFor (dir) {
  const { sdk, api } = sdkApi()
  const name = MODELS[dir]
  const modelSrc = sdk[name]
  if (!modelSrc) throw new Error(`Unknown NMT model constant "${name}" — not exported by @qvac/inference`)
  const [from, to] = dir.split('>')

  console.log(`[nmt] loading ${name} ...`)
  const modelId = await api.loadModel({
    modelSrc,
    // The plugin resolves Bergamot's vocab companions from the model itself,
    // so the direction is all it needs from us.
    modelConfig: { engine: 'Bergamot', from, to },
    onProgress: (p) => {
      if (p && typeof p.percentage === 'number') {
        bareProcess.stderr.write(`\r[nmt] downloading ${name} ${p.percentage.toFixed(0)}%`)
        if (p.percentage >= 100) bareProcess.stderr.write('\n')
      }
    }
  })
  console.log(`[nmt] model ready: ${modelId}`)
  return modelId
}

export async function shutdownTranslators () {
  const pending = [...models.values()]
  models.clear()
  for (const p of pending) {
    try {
      const modelId = await p
      await sdkApi().api.unloadModel({ modelId })
    } catch (err) {
      console.error('[nmt] unload failed:', err.message)
    }
  }
}

// Level names, prizes and static hints are the same handful of strings on every
// request, so caching turns them into one translation per run.
const MAX_CACHE = 500
const cache = new Map()

function cacheGet (key) {
  return cache.get(key)
}

function cacheSet (key, value) {
  cache.set(key, value)
  // Map iterates in insertion order, so the first key is the oldest.
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value)
}

// A second translate call while one is in flight kills the first ("stale job
// replaced by new run"), and a state request alone asks for a dozen strings.
// Like the completion model next door, requests queue.
let chain = Promise.resolve()

function enqueue (fn) {
  const job = chain.then(fn, fn)
  chain = job.catch(() => {})
  return job
}

function run (text, dir) {
  if (MOCK) return Promise.resolve(`[${dir.split('>')[1]}] ${text}`)
  return enqueue(async () => {
    const modelId = await modelFor(dir)
    const result = sdkApi().api.translate({ modelId, text, modelType: MODEL_TYPE, stream: false })
    return String(await result.text ?? '').trim()
  })
}

function escapeRe (s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// A token NMT has no translation for and copies through untouched. It only has
// to survive one round trip; if it does not, the caller falls back.
const SENTINEL = 'QVACWORD'

function countOf (text, needle) {
  return text.split(new RegExp(escapeRe(needle), 'gi')).length - 1
}

// The password is the one string that must cross unchanged — on level 1 the
// reply *is* the password. Hide it behind a sentinel so the sentence still
// translates as a whole, then put it back.
async function translateKeeping (text, dir, keep) {
  const parts = text.split(new RegExp(`(${escapeRe(keep)})`, 'gi'))
  if (parts.length === 1) return run(text, dir)

  const masked = parts.map((p, i) => (i % 2 ? SENTINEL : p)).join('')
  const translated = await run(masked, dir)
  const hits = countOf(translated, SENTINEL)
  if (hits > 0 && hits === countOf(masked, SENTINEL)) {
    // Odd indices are the matches, in the casing the guardian actually used.
    let n = 0
    return translated.replace(new RegExp(escapeRe(SENTINEL), 'gi'), () => parts[(n++ * 2) + 1])
  }

  // The sentinel did not come back intact. Translate the prose around the word
  // instead: choppier, but the player still reads the password.
  const out = []
  for (let i = 0; i < parts.length; i++) {
    out.push(i % 2 || !parts[i].trim() ? parts[i] : await run(parts[i], dir))
  }
  return out.join('')
}

// The single entry point for everything the player reads. `keep` is a word that
// must survive verbatim (the level password). Falls back to the English source
// on any failure — a readable English sentence beats an error in the chat.
export async function translateForPlayer (text, lang, keep) {
  const source = String(text ?? '')
  const dir = `en>${lang}`
  if (!source.trim() || !needsModel(dir)) return source

  const key = `${dir}\n${source}`
  const hit = cacheGet(key)
  if (hit !== undefined) return hit

  let out
  try {
    out = keep ? await translateKeeping(source, dir, keep) : await run(source, dir)
  } catch (err) {
    console.error('[nmt] translation failed:', err.message)
    return source
  }
  if (!out.trim()) return source
  cacheSet(key, out)
  return out
}

// The single entry point for everything the guardian reads. The player writes
// in their own language; every prompt, blocklist and classifier behind this
// point is English.
//
// Unlike the outbound path this one throws rather than falling back. A reply
// that failed to translate is still a readable English sentence, but a message
// that failed to translate would be handed to walls that cannot read it and to
// a guardian that would have to translate it silently, mid-turn, where nothing
// can see it. The caller refunds the try instead.
//
// Nothing is cached: every message is new, and a cache of them would be a
// store of attack text for the life of the process.
export async function translateForGuardian (text, lang) {
  const source = String(text ?? '')
  const dir = `${lang}>en`
  // Mock mode has no engine behind it, so the game plays in English either way
  // and a mock tag in the guardian's input would only confuse the guards.
  if (MOCK || !source.trim() || !needsModel(dir)) return source

  const out = await run(source, dir)
  if (!out.trim()) throw new Error(`empty translation ${dir}`)
  return out
}
