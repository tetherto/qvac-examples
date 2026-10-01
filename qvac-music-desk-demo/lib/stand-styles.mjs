/**
 * The six styles of the event build, and the composer that turns three picks into a caption.
 *
 * THIS FILE IS THE ONLY COPY. It is imported by the browser (`public/stand.js`, served through
 * the server's /lib route), by the test (`bin/compose-check.mjs`) and by nothing else. An earlier
 * version of this demo kept the card data in the page and a copy in the test, and the two were
 * kept in step by diffing them by hand, which is a drift waiting to happen.
 *
 * Every word below is a term in `./vocab.mjs`, the list this recipe already prompts ACE-Step
 * with, and the slots are the order the ACE-Step authors specify: genre, mood, instruments,
 * production, era. `bin/compose-check.mjs` fails the build if any of that stops being true.
 *
 * No node and no DOM in here, so both sides can load it as-is.
 */
import { TAG_TARGET } from './caption.mjs'
import { CHIPS } from './vocab.mjs'

// The vocabulary, indexed by group, so a typed word can be recognised as a mood or an instrument
// rather than tacked on beside one.
const V = {}
for (const [group, words] of CHIPS) (V[group] = V[group] || []).push(...words)
const lookup = (group) => new Map(V[group].map((w) => [w.toLowerCase(), w]))
const MOODS = lookup('Mood')
const INSTRUMENTS = new Map([...lookup('Instruments'), ...lookup('Voice')])
const PRODUCTION = lookup('Production')
const ERAS = lookup('Era')

/**
 * What a person types at a stand is not the vocabulary's wording. These are the words people
 * actually reach for, mapped to the term the model was prompted with. Everything unmapped is
 * still kept as a keyword, so this list only has to cover the common cases, not every case.
 */
/** Words people type that carry no musical information. Kept out so they do not eat the budget. */
export const STOPWORDS = new Set([
  'music', 'song', 'track', 'sound', 'sounds', 'tune', 'beat', 'a', 'an', 'the', 'some', 'with',
  'and', 'of', 'for', 'please', 'make', 'me', 'my', 'it', 'like', 'very', 'really', 'kind'
])

export const SYNONYMS = {
  sad: 'melancholic', unhappy: 'melancholic', sombre: 'melancholic', somber: 'melancholic',
  happy: 'upbeat', joyful: 'upbeat', cheerful: 'upbeat', fun: 'playful',
  fast: 'driving', quick: 'driving', slow: 'patient', calm: 'patient', chill: 'warm',
  relaxing: 'warm', gentle: 'warm', soft: 'warm', cosy: 'intimate', cozy: 'intimate',
  angry: 'aggressive', heavy: 'aggressive', hard: 'aggressive',
  scary: 'menacing', creepy: 'haunting', spooky: 'haunting', eerie: 'haunting',
  epic: 'grandiose', huge: 'grandiose', big: 'grandiose', proud: 'triumphant',
  romantic: 'intimate', sexy: 'hypnotic', trippy: 'hypnotic', floaty: 'dreamy',
  cold: 'cold', icy: 'cold', bright: 'hopeful', hopeful: 'hopeful',
  rainy: 'melancholic', moody: 'dark', tense: 'tense',
  piano: 'grand piano', guitar: 'fingerpicked acoustic guitar', drums: 'drum kit',
  bass: 'bass guitar', strings: 'warm sustained strings', horns: 'brass stabs',
  sax: 'saxophone', synth: 'analog synth pad', organ: 'hammond organ', choir: 'choir ooh'
}

/**
 * One entry per style card.
 * - `genre`: one primary plus one modifier. Two is the authors' stated limit.
 * - `moods` / `instruments`: five each, offered for this style only, because a taiko drum
 *   belongs in a trailer and not in a jazz trio.
 * - `instruments[1]` is also used as the second instrument in every caption for this style, so
 *   the caption always names two things that play. A style of pure mood returns a drum loop.
 * - `production` and `era` are fixed per style and never asked for: two more decisions at a
 *   stand buys nothing.
 * - `c1` / `c2` are the swatch and the artwork gradient.
 */
export const STYLES = [
  {
    id: 'lofi',
    name: 'Lo-fi beat',
    c1: '#FFC75F',
    c2: '#FF8A5B',
    genre: ['lo-fi hip hop', 'boom bap'],
    production: 'vinyl crackle',
    era: '90s',
    moods: ['nostalgic', 'warm', 'dreamy', 'melancholic', 'groovy'],
    instruments: ['rhodes piano', 'dusty drums', 'upright bass', 'muted trumpet', 'jazz sample']
  },
  {
    id: 'trailer',
    name: 'Epic trailer',
    c1: '#C9A7FF',
    c2: '#9D8BFF',
    genre: ['epic hybrid trailer', 'cinematic orchestral'],
    production: 'cinematic score',
    era: '',
    moods: ['grandiose', 'tense', 'triumphant', 'dark', 'menacing'],
    instruments: ['staccato strings', 'low brass swell', 'taiko drums', 'soft timpani', 'choir ooh']
  },
  {
    id: 'night',
    name: 'Night drive',
    c1: '#6FD8F5',
    c2: '#A38FFF',
    genre: ['synthwave', 'house'],
    production: 'sidechained pads',
    era: '80s',
    moods: ['driving', 'hypnotic', 'euphoric', 'cold', 'dreamy'],
    instruments: ['analog synth pad', '909 drums', 'acid bass', 'pluck synth', 'sub drops']
  },
  {
    id: 'jazz',
    name: 'Jazz trio',
    c1: '#FF9F68',
    c2: '#FF5E7D',
    genre: ['jazz trio', 'bossa nova'],
    production: 'dry and close',
    era: '60s',
    moods: ['intimate', 'playful', 'patient', 'warm', 'melancholic'],
    instruments: ['grand piano', 'upright bass', 'drum kit', 'saxophone', 'vibraphone']
  },
  {
    id: 'boss',
    name: 'Boss fight',
    c1: '#3DDC97',
    c2: '#00B2CA',
    genre: ['chiptune', 'drum and bass'],
    production: 'bright modern master',
    era: '',
    moods: ['aggressive', 'energetic', 'tense', 'driving', 'menacing'],
    instruments: ['square lead synth', '909 drums', 'acid bass', 'brass stabs', 'glockenspiel']
  },
  {
    id: 'salsa',
    name: 'Salsa night',
    c1: '#FF7AC6',
    c2: '#FF4D4D',
    genre: ['salsa', 'cumbia'],
    production: 'wide stereo',
    era: '',
    moods: ['energetic', 'groovy', 'upbeat', 'playful', 'warm'],
    instruments: ['congas', 'brass stabs', 'grand piano', 'bajo sexto', 'live percussion']
  }
]

/** A typed phrase longer than this is not a keyword the model can use. */
export const MAX_WORDS_PER_KEYWORD = 4

/**
 * How many typed words survive as free keywords once the recognised ones have taken their slots.
 * Splitting a sentence word by word otherwise floods the caption: "a very long phrase that nobody
 * should type" contributed six junk keywords and pushed the production and era words out of the
 * budget entirely. Three is enough for "rainy", "night", "wide" and nothing is enough for prose.
 */
export const MAX_FREE_KEYWORDS = 3

/**
 * Three picks plus whatever was typed, in the authors' slot order.
 *
 * The budget is one UNDER the target, because `conformCaption` appends "no vocals" to an
 * instrumental take. Capping at the target instead shipped 13-keyword captions, which the cross
 * product in bin/compose-check.mjs caught on three combinations.
 *
 * @param {object} args
 * @param {object} args.style one entry of STYLES
 * @param {string} [args.mood] defaults to the style's first
 * @param {string} [args.instrument] defaults to the style's first
 * @param {string} [args.typed] comma separated, the visitor's own words
 * @returns {{caption: string, mine: string[], over: number, tooLong: number}}
 */
export function compose ({ style, mood, instrument, typed = '' }) {
  // People type "sad rainy music", not "sad, rainy, music". So a chunk is matched WHOLE first,
  // which keeps real multi-word terms like "grand piano" intact, and only if that fails is it
  // split into words so every word still counts. Typing a phrase and having none of it recognised
  // is what made it look like the prompt was ignored.
  const chunks = String(typed).split(/[,\n]/).map((s) => s.trim()).filter(Boolean)
  const raw = []
  for (const chunk of chunks) {
    const whole = (SYNONYMS[chunk.toLowerCase()] || chunk).toLowerCase()
    const known = MOODS.has(whole) || INSTRUMENTS.has(whole) || PRODUCTION.has(whole) || ERAS.has(whole)
    if (known || chunk.split(/\s+/).length === 1) raw.push(chunk)
    else raw.push(...chunk.split(/\s+/).filter(Boolean))
  }
  // Two different reasons to drop a word, counted separately: the screen says "too long" for one
  // and says nothing for the other, and reporting a filler word as too long is a lie on screen.
  const tooLong = raw.filter((s) => s.split(/\s+/).length > MAX_WORDS_PER_KEYWORD)
  const kept = raw.filter((s) => s.split(/\s+/).length <= MAX_WORDS_PER_KEYWORD &&
    !STOPWORDS.has(s.toLowerCase()))

  // A typed word that names a mood REPLACES the picked mood instead of sitting next to it.
  // Typing "sad" with the mood on "energetic" used to send both, and a caption that asks for two
  // opposite things is the failure the ACE-Step authors name twice: the model is not good at
  // resolving conflicts, so it picks one and the person thinks their words were ignored.
  let moodPick = mood || style.moods[0]
  let instPick = instrument || style.instruments[0]
  let prodPick = style.production
  let eraPick = style.era
  const took = { mood: null, instrument: null, production: null, era: null }
  const mine = []
  for (const word of kept) {
    const k = word.toLowerCase()
    const canon = SYNONYMS[k] || k
    const c = canon.toLowerCase()
    if (MOODS.has(c)) { moodPick = MOODS.get(c); took.mood = MOODS.get(c); continue }
    if (INSTRUMENTS.has(c)) { instPick = INSTRUMENTS.get(c); took.instrument = INSTRUMENTS.get(c); continue }
    if (PRODUCTION.has(c)) { prodPick = PRODUCTION.get(c); took.production = PRODUCTION.get(c); continue }
    if (ERAS.has(c)) { eraPick = ERAS.get(c); took.era = ERAS.get(c); continue }
    mine.push(word)
  }
  const ignored = Math.max(0, mine.length - MAX_FREE_KEYWORDS)
  const free = mine.slice(0, MAX_FREE_KEYWORDS)

  const parts = [
    ...style.genre,
    moodPick,
    instPick,
    style.instruments[1],
    ...free,
    prodPick,
    eraPick
  ].filter(Boolean)
  const budget = TAG_TARGET.high - 1
  return {
    caption: parts.slice(0, budget).join(', '),
    // `mine` is what stayed a free keyword; `took` is what was recognised and put in a slot.
    // Both are highlighted in the prompt, because both came from the person.
    mine: free,
    took,
    ignored,
    fromTyped: [...free, ...Object.values(took).filter(Boolean)],
    over: Math.max(0, parts.length - budget),
    tooLong: tooLong.length
  }
}

/** The caption for a restyle: the target style's own words, nothing carried over. */
export function restyleCaption (style) {
  return compose({ style }).caption
}
