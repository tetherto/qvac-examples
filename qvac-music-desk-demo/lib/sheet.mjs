// QVAC MUSIC DESK - the expander
// ---------------------------------------------------------------------------
// Turns a sentence like "music for my exploration game, mystical, full of
// secrets, voices that rise in power" into the song sheet the engine wants: a
// prose caption, lyrics with structure tags, a tempo, a key, a length.
//
// WHY THIS EXISTS WHEN THE ENGINE HAS simpleMode
//
// ACE-Step's own LM does the same job with `simpleMode: true`, for free, with no
// extra model. Two measured reasons that is not enough on its own:
//
//   1. It does not return what it composed. `AudiogenStats` carries duration,
//      timing and backend, and nothing else, so there is no caption to show and
//      nothing to edit. You reseed and hope.
//   2. It overrides the length. Measured on this machine: a plain call asked for
//      8 s and produced 7.2 s; simpleMode asked for 8 s and produced 28.2 s,
//      asked for 16 s and produced 36.2 s, repeatably per seed. Anyone who needs
//      thirty seconds for a video cannot get it from simpleMode.
//
// So simpleMode stays, as the Surprise me button, and this writes the sheet you
// can read and argue with. Both write the SAME object, which is what stops the
// desk becoming two products.
//
// The system prompt is not my taste. Every rule in it comes from the ACE-Step
// authors' own prompting guide (docs/en/Tutorial.md in ace-step/ACE-Step-1.5).
// ---------------------------------------------------------------------------

import { SECTIONS, COLOUR_TAGS, CHIPS } from './vocab.mjs'
import { countTags, TAG_TARGET } from './caption.mjs'

/**
 * Words that name a sound source or a genre, drawn from the desk's own chip
 * vocabulary plus the obvious families. Used to CHECK that a caption says what
 * is playing, because a caption of pure mood is the failure that produced a
 * drum beat on a request for an ambient temple bed.
 */
const SOUND_WORDS = (function () {
  const fromChips = CHIPS
    .filter(([group]) => group === 'Genre' || group === 'Instruments' || group === 'Voice')
    .flatMap(([, words]) => words)
    .flatMap((w) => w.split(/\s+/))
  const extra = ['orchestra', 'orchestral', 'strings', 'cello', 'cellos', 'violin', 'viola',
    'piano', 'guitar', 'bass', 'drums', 'drum', 'percussion', 'synth', 'synthesizer', 'pad',
    'choir', 'vocal', 'vocals', 'voice', 'voices', 'flute', 'clarinet', 'oboe', 'bassoon',
    'trumpet', 'trombone', 'horn', 'tuba', 'harp', 'organ', 'cymbal', 'gong', 'chimes',
    'bells', 'marimba', 'kalimba', 'sitar', 'oud', 'banjo', 'mandolin', 'accordion',
    'saxophone', 'sax', 'rhodes', 'wurlitzer', 'mellotron', 'theremin', 'drone', 'ambient',
    'orchestration', 'woodwind', 'woodwinds', 'brass', 'timpani', 'taiko', 'shaker',
    'rock', 'jazz', 'blues', 'funk', 'soul', 'metal', 'punk', 'reggae', 'ska', 'house',
    'techno', 'trance', 'dubstep', 'garage', 'ambient', 'classical', 'baroque', 'romantic',
    'cinematic', 'orchestral', 'electronic', 'acoustic', 'folk', 'country', 'gospel',
    'hip', 'hop', 'trap', 'drill', 'grime', 'salsa', 'cumbia', 'bossa', 'samba', 'tango',
    'afrobeat', 'highlife', 'soundtrack', 'score', 'underscore']
  return new Set([...fromChips, ...extra].map((w) => w.toLowerCase().replace(/[^a-z]/g, '')).filter(Boolean))
})()

/**
 * The authors' two structural rules about the keyword list, as checks.
 *
 * "Genre always anchors first", and their own examples carry four or five
 * instruments. Both were measured being ignored: the brief "mexican music but
 * played by robot" came back as "robotic, mechanical, industrial, electric
 * guitar, synth, drum machine, spoken word, glitch, 2020s", which opens on an
 * adjective and had dropped Mexico altogether.
 */
const GENRE_WORDS = (function () {
  const fromChips = CHIPS.filter(([g]) => g === 'Genre').flatMap(([, w]) => w)
  const extra = ['banda', 'ranchera', 'tango', 'flamenco', 'polka', 'waltz', 'march', 'opera',
    'edm', 'dance', 'electro', 'industrial', 'new wave', 'shoegaze', 'surf rock', 'ska',
    'grime', 'drill', 'garage', 'baroque', 'romantic', 'soundtrack', 'score', 'underscore',
    'lullaby', 'hymn', 'chant', 'bolero', 'highlife', 'soukous', 'raga', 'gamelan', 'klezmer',
    'zouk', 'kizomba', 'bachata', 'merengue', 'forro', 'fado', 'celtic', 'bluegrass']
  return [...fromChips, ...extra].map((w) => w.toLowerCase())
})()

/**
 * Instrument HEAD NOUNS, not the vocabulary's full phrases. Matching on the
 * phrases missed "electric guitar" because the list holds "distorted electric
 * guitar", and it missed "synthesizer", "distorted guitars" and "heavy bass",
 * all of which name something that plays.
 */
const INSTRUMENT_WORDS = ['guitar', 'guitars', 'bass', 'drum', 'drums', 'percussion', 'piano',
  'rhodes', 'organ', 'accordion', 'harmonium', 'synth', 'synthesizer', 'synths', 'pad', 'strings',
  'cello', 'violin', 'viola', 'harp', 'brass', 'horn', 'trumpet', 'trombone', 'tuba', 'sax',
  'saxophone', 'flute', 'clarinet', 'oboe', 'timpani', 'taiko', 'tabla', 'congas', 'shaker',
  'claps', 'marimba', 'vibraphone', 'glockenspiel', 'bells', 'chimes', 'kalimba', 'sitar', 'koto',
  'banjo', 'mandolin', 'bagpipes', 'harmonica', 'drone', 'choir', 'bajo', '808', '909', 'sub',
  'arpeggio', 'ostinato', 'riff', 'lead', 'pluck', 'keys', 'keyboard', 'gong', 'whistle']

/**
 * When a brief names a place or a tradition, the caption has to carry it. The
 * writing model dropped Mexico entirely from "mexican music but played by
 * robot" and answered "robotic, mechanical, industrial", so the retry is told
 * which words that tradition actually uses.
 */
const CULTURES = [
  { test: /\b(mexic\w*|mariachi|banda|norten\w*|ranchera)\b/i, genres: 'mariachi, banda or norteno', instruments: 'trumpet, accordion, bajo sexto, tuba, brass stabs' },
  { test: /\b(brazil\w*|samba|bossa|forro)\b/i, genres: 'samba or bossa nova', instruments: 'nylon string guitar, cavaquinho, shaker, live percussion' },
  { test: /\b(cuban?|salsa|cumbia|colombian?|reggaeton|latin)\b/i, genres: 'salsa, cumbia or reggaeton', instruments: 'brass stabs, congas, timbales, piano montuno' },
  { test: /\b(spanish|flamenco|andalus\w*)\b/i, genres: 'flamenco', instruments: 'nylon string guitar, hand claps, cajon' },
  { test: /\b(indian?|bollywood|raga|punjab\w*)\b/i, genres: 'raga or bollywood', instruments: 'sitar, tabla, harmonium, bansuri flute' },
  { test: /\b(japan\w*|taiko|anime)\b/i, genres: 'japanese traditional or city pop', instruments: 'taiko drums, koto, shakuhachi flute' },
  { test: /\b(chinese|china|guzheng)\b/i, genres: 'chinese traditional', instruments: 'guzheng, erhu, dizi flute' },
  { test: /\b(irish|celtic|scottish)\b/i, genres: 'celtic folk', instruments: 'fiddle, tin whistle, bodhran, bagpipes' },
  { test: /\b(arab\w*|middle eastern|turkish|persian)\b/i, genres: 'arabic or turkish traditional', instruments: 'oud, qanun, ney flute, darbuka' },
  { test: /\b(african|afrobeat\w*|nigeria\w*|ghana\w*)\b/i, genres: 'afrobeats or highlife', instruments: 'log drum, shaker, palm-wine guitar, talking drum' },
  { test: /\b(jamaican|reggae|dub)\b/i, genres: 'reggae or dub', instruments: 'offbeat guitar skank, bass guitar, organ bubble' },
  { test: /\b(french|chanson|parisian)\b/i, genres: 'chanson', instruments: 'accordion, upright bass, brushed drums' }
]

function firstTagIsGenre (caption) {
  const first = String(caption).split(',')[0].trim().toLowerCase()
  if (!first) return false
  return GENRE_WORDS.some((g) => first === g || first.includes(g))
}

function countInstruments (caption) {
  const c = String(caption).toLowerCase()
  return INSTRUMENT_WORDS.filter((i) => c.includes(i)).length
}

/** Does this caption say what is playing, or only how it feels? */
function namesASound (caption) {
  const words = String(caption).toLowerCase().split(/[^a-z]+/).filter(Boolean)
  return words.some((w) => SOUND_WORDS.has(w))
}

/**
 * A brief describing an atmosphere rather than a groove. Sending `bpm` or
 * `timesignature` for one of these is a statement that the music is metred, and
 * that is what invites a drum beat nobody asked for.
 */
const ATMOSPHERIC = /\b(ambient|ambience|atmospher\w*|drone|texture|textures|soundscape|underscore|bed|pad|pads|score|exploration|explore|exploring|mystical|mystic|ethereal|meditat\w*|calm|serene|floating|dreamlike|background|wandering|contemplativ\w*|atmosphere|nappe|ambiance|planant\w*|contemplatif)\b/i
/** And words that mean there IS a groove, which win when both appear. */
const RHYTHMIC = /\b(beat|beats|groove|groovy|drums?|percussion|rhythm\w*|danc\w*|bpm|tempo|four on the floor|breakbeat|808|kick|snare|hi-?hat|club|banger|uptempo|marching|march|rythme|batterie|percussions?)\b/i

/** The writing model. Small, and already on disk for anyone who has run a QVAC recipe. */
const PREFERRED = ['QWEN3_4B_Q4_K_M', 'QWEN3_1_7B_INST_Q4', 'QWEN3_600M_INST_Q4']

const SYSTEM = `You turn a person's description of the music they want into a song sheet for the
ACE-Step music model. You are not a chat assistant. You return one JSON object and nothing else.

FIRST, DECIDE ABOUT VOICES. THIS IS THE MOST COMMON MISTAKE.
Read the brief for any human voice at all: singing, a singer, vocals, a choir, voices, humming,
chanting, a chant, whispers, harmonies, a lead, a rapper, spoken word, or the same words in
another language such as voix, chant, choeur, chorale, chanteur, voces, coro, stimmen.
If ANY of those appear, then instrumental is false and the lyrics field MUST contain structure
tags and lines. Wordless voices still count as singing: a choir with no words is not instrumental,
it is short syllabic lines with the voice colour tags.
Only set instrumental true when the brief asks for no voices, or says instrumental, or names only
instruments and never a voice.
Never write "vocals" or "choir" in the caption and then set instrumental true. That contradiction
is the failure to avoid.

CAPTION
A comma-separated keyword list, in this order: genre first, then two or three moods, then four or
five specific instruments, then the vocal character, then one or two production words, then an era
if it helps. 8 to 12 keywords. Past 15 they dilute each other.

Prose is the mistake to avoid. Prose spends the budget on words the model cannot use:
"Robotic Mexican folk, with mechanical guitar and electronic accordion, blending traditional
sounds with digital textures" is sixteen words and only four keywords.

THE LIST MUST NAME WHAT IS PLAYING. A caption made only of moods, such as
"mysterious, haunting, ethereal, evoking ancient secrets", tells the model nothing about the
sound, so it falls back on what it has heard most, which is a song with a drum beat.
Always a genre AND at least three real instruments or sound sources.
  weak    mysterious, haunting, ethereal textures, ancient secrets
  strong  dark ambient, cinematic, haunting, patient, sustained analog drone, cello,
          reverb-heavy piano, choir ooh, field recording wind, no vocals, wide stereo, hi-fi

These are the authors' own example lists, for the shape and the density:
  lo-fi hip-hop, boom bap, dusty drums, vinyl crackle, jazz sample, upright bass, rhodes piano,
  muted trumpet, male vocals, rap vocals, laid-back, warm, 90s
  chamber folk, acoustic ballad, intimate, melancholic, hopeful, fingerpicked classical guitar,
  cello, solo violin, upright bass, soft female vocals, subtle harmonies, warm analog, 2010s

Specific beats vague: write "grand piano" not "piano", "fingerpicked acoustic guitar" not "guitar".
If the music should have no drums or no pulse, SAY SO: add "no percussion" or "no drums".
Leaving rhythm unmentioned is not the same as excluding it.
For an instrumental, end the list with "no vocals". A wordless choir is written "choir ooh" and is
allowed alongside "no vocals": that is what the authors do.
NEVER put BPM, tempo, key or time signature in the caption. They have their own fields.
No conflicting descriptors. The authors say it twice: the model is not good at resolving them, so
the instruments in the caption must match the instrumental sections in the lyrics, and a lead
vocal must never appear in a caption that also says no vocals.

LYRICS
Structure tags go here, never in the caption. This field is what the model reads when it plans
the arrangement, and it is the difference between a song and a loop.
Sections you may use: ${SECTIONS.acestep.map((t) => `[${t}]`).join(' ')}
Voice colour: ${COLOUR_TAGS.voice.map((t) => `[${t}]`).join(' ')}
Energy colour: ${COLOUR_TAGS.energy.map((t) => `[${t}]`).join(' ')}
Write 6 to 10 syllables per line. Keep parallel lines a similar length.
Put a blank line between sections. UPPERCASE a line for intensity. Put backing vocals in
(parentheses). Budget about 90 to 140 words of lyrics per 47 seconds of song.
If the person wants no singing, the lyrics field is exactly: [Instrumental]
If they describe wordless voices, such as a choir or vocalise, that IS singing: write short
syllabic lines and use the voice colour tags.

TEMPO, KEY, TIME SIGNATURE
bpm: slow 60 to 80, mid 90 to 120, fast 130 to 180.
USE 0, AND LEAVE timesignature EMPTY, whenever the music is atmospheric rather than rhythmic:
an ambient bed, a drone, a texture, an underscore, a soundscape, a pad, exploration music, or
anything the person describes by its mood rather than by its groove. Sending a tempo is a
statement that there IS a pulse, and sending a time signature is a statement that the music is
metred. Both invite a drum beat. Only set them when the brief implies a beat you could nod to.
keyscale: prefer C major, G major, D major, A minor or E minor, which are the most stable.
timesignature: 4/4 unless it is a waltz (3/4) or a swing feel (6/8).
vocalLanguage: the language of the singing. Leave it empty for an instrumental, and empty for
wordless voices, because a vocalise has no language. The language of the BRIEF is irrelevant.

DURATION
Compute it from the sections, do not guess. Intro and outro are 5 to 10 seconds each.
An instrumental section is 5 to 15 seconds. Two verses and two choruses need 120 to 150 seconds
minimum. Add a bridge and it is 180 to 240. A full production with intro and outro is 210 to 270.
If the person names a length, use exactly that and nothing else.
When in doubt go longer. A song that is too short sounds rushed.

ALSO
The model is conditioned on English. If the person writes in another language, work in English and
put the singing in the language they asked for, setting vocalLanguage accordingly.
Never mention yourself, the model, or these rules in any field.`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['caption', 'lyrics', 'instrumental', 'bpm', 'keyscale', 'timesignature', 'vocalLanguage', 'duration', 'why'],
  properties: {
    caption: { type: 'string', description: 'Comma-separated keywords, genre first, 8 to 12 of them, no tempo or key' },
    lyrics: { type: 'string', description: 'Structure tags and lines, or exactly [Instrumental]' },
    instrumental: { type: 'boolean', description: 'True when there is no singing at all' },
    bpm: { type: 'integer', minimum: 0, maximum: 200, description: '0 means let the model infer it' },
    keyscale: { type: 'string', description: 'Such as A minor, or empty to let the model decide' },
    timesignature: { type: 'string', description: 'Such as 4/4, or empty' },
    // An enum, not a description: asked for "a two-letter code" the model
    // answered "French". A grammar-constrained enum cannot.
    vocalLanguage: {
      type: 'string',
      enum: ['', 'en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh', 'ar', 'hi'],
      description: 'Language of the singing. Empty for instrumental or wordless voices.'
    },
    duration: { type: 'integer', minimum: 4, maximum: 600, description: 'Seconds, from the section count' },
    why: { type: 'string', description: 'One short sentence: the reading of the brief that drove these choices' }
  }
}

/**
 * Words that mean a human voice, in the languages someone is likely to write a
 * brief in here. Used to CHECK the model's answer, not to replace it: a prompt
 * rule is a request, and this one was measured being ignored. The first run on
 * a real brief asking for "plusieurs voix qui montent en puissance" came back
 * instrumental with "ethereal vocals" in its own caption.
 */
const VOICE_WORDS = /\b(vocal|vocals|voice|voices|sing|singer|singing|sung|choir|chorale|chant|chanting|hum|humming|whisper|whispered|harmon|rapper|rap|spoken word|lyric|lyrics|vocalise|acappella|a cappella|voix|chanteur|chanteuse|choeur|ch(o|\u0153)ur|paroles|voces|coro|cantante|stimmen|chor|gesang|canto|vozes)\b/i
/**
 * The brief explicitly ASKING for a singing language, as opposed to merely being
 * written in one. Measured need: a French brief came back with English lyrics and
 * `vocalLanguage: "fr"`, which tells the engine to sing English words in French.
 * Unless the brief asks, the field is left empty and the engine infers it from
 * the lyrics, which is the only thing that cannot contradict them.
 */
const ASKS_LANGUAGE = /\b(in|sung in|vocals? in|lyrics in|sing in|en|chant(?:e|ed)? en|paroles en)\s+(english|spanish|french|german|italian|portuguese|japanese|korean|chinese|mandarin|arabic|hindi|anglais|espagnol|fran(?:c|\u00e7)ais|allemand|italien|portugais|japonais|cor(?:e|\u00e9)en|chinois|arabe)\b/i
const LANGUAGE_CODES = {
  english: 'en', anglais: 'en', spanish: 'es', espagnol: 'es', french: 'fr', 'français': 'fr',
  francais: 'fr', german: 'de', allemand: 'de', italian: 'it', italien: 'it',
  portuguese: 'pt', portugais: 'pt', japanese: 'ja', japonais: 'ja', korean: 'ko',
  'coréen': 'ko', coreen: 'ko', chinese: 'zh', mandarin: 'zh', chinois: 'zh',
  arabic: 'ar', arabe: 'ar', hindi: 'hi'
}

/** And words that mean the opposite, which win when both appear. */
const NO_VOICE_WORDS = /\b(instrumental|no vocals?|without vocals?|no singing|no voice|sans voix|sans paroles|instrumentale?|solo piano only)\b/i

let sdk = null
let modelId = null
let chosen = null
let loadError = null

/** Loads the SDK lazily so the desk still starts when it is not installed. */
async function ensureSdk () {
  if (sdk) return sdk
  sdk = await import('@qvac/sdk')
  return sdk
}

/**
 * Is a writing model already on this machine? The desk never downloads: a
 * 2.5 GB surprise on first click is not an onboarding experience, and the
 * Surprise me door works without any of this.
 */
export async function probe (cachedModelFiles) {
  try {
    const s = await ensureSdk()
    for (const name of PREFERRED) {
      const entry = s[name]
      if (!entry) continue
      if (cachedModelFiles.some((f) => f.endsWith(entry.modelId))) {
        chosen = { name, entry }
        return { available: true, model: name, params: entry.params, sizeBytes: entry.expectedSize }
      }
    }
    const first = PREFERRED.map((n) => s[n]).find(Boolean)
    return {
      available: false,
      why: 'no writing model in ~/.qvac/models',
      couldDownload: first ? { model: PREFERRED[0], sizeBytes: first.expectedSize } : null
    }
  } catch (e) {
    return { available: false, why: `@qvac/sdk not usable here: ${e.message}` }
  }
}

async function ensureLoaded () {
  if (modelId) return modelId
  if (loadError) throw new Error(loadError)
  if (!chosen) throw new Error('no writing model available')
  const s = await ensureSdk()
  try {
    modelId = await s.loadModel({
      modelSrc: chosen.entry,
      modelConfig: {
        // Wide enough for the rules plus a long brief plus a full sheet back.
        ctx_size: 8192,
        device: 'gpu',
        // Near-greedy: this is a translation job, not a creative one. The
        // creativity is the music model's.
        temp: 0.4,
        predict: 1400,
        // Qwen3 is a thinking model and a think block is not a song sheet.
        reasoning_budget: 0
      }
    })
    return modelId
  } catch (e) {
    loadError = `could not load the writing model: ${e.message}`
    throw new Error(loadError)
  }
}

/** Frees the writing model, so the music engine gets the memory back. */
export async function unload () {
  if (!modelId) return
  const s = await ensureSdk()
  const id = modelId
  modelId = null
  try { await s.unloadModel({ modelId: id, clearStorage: false }) } catch { /* going away anyway */ }
}

/**
 * Expands a brief into a sheet.
 *
 * `keep` holds the fields the person has already edited. They are passed to the
 * model as decisions already made, and then written back over whatever it said,
 * because a field someone touched is theirs. That rule is the whole reason the
 * expert door and the friendly door can share one screen.
 */
export async function expand (brief, keep = {}) {
  const s = await ensureSdk()
  const id = await ensureLoaded()

  const fixed = Object.entries(keep)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v.replace(/\n/g, ' / ') : v}`)

  const history = [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: fixed.length
        ? `${brief}\n\nAlready decided, keep these exactly and write everything else around them:\n${fixed.join('\n')}`
        : brief
    }
  ]

  const started = Date.now()
  const run = s.completion({
    modelId: id,
    history,
    stream: false,
    responseFormat: { type: 'json_schema', json_schema: { name: 'song_sheet', schema: SCHEMA } }
  })
  const final = await run.final
  let sheet = parseSheet(final)

  // The voices check. `keep.instrumental` means the person has already decided,
  // so it is never second-guessed.
  const briefWantsVoices = VOICE_WORDS.test(brief) && !NO_VOICE_WORDS.test(brief)
  let retried = false
  if (briefWantsVoices && sheet.instrumental && keep.instrumental === undefined) {
    retried = true
    const again = s.completion({
      modelId: id,
      history: [
        ...history,
        { role: 'assistant', content: JSON.stringify(sheet) },
        {
          role: 'user',
          content: 'That is wrong. The brief asks for voices, so instrumental must be false and ' +
            'the lyrics field must contain structure tags and sung lines. Wordless voices are ' +
            'still singing. Return the corrected JSON object.'
        }
      ],
      stream: false,
      responseFormat: { type: 'json_schema', json_schema: { name: 'song_sheet', schema: SCHEMA } }
    })
    const fixed = parseSheet(await again.final)
    if (!fixed.instrumental) sheet = fixed
  }

  // The schema constrains the shape, not the sense, so the numbers still get checked.
  const out = {
    caption: String(sheet.caption || '').trim(),
    lyrics: sheet.instrumental ? '[Instrumental]' : String(sheet.lyrics || '').trim(),
    instrumental: !!sheet.instrumental,
    bpm: clamp(sheet.bpm, 0, 200, 0),
    keyscale: String(sheet.keyscale || '').trim(),
    timesignature: String(sheet.timesignature || '').trim(),
    vocalLanguage: String(sheet.vocalLanguage || '').trim().toLowerCase(),
    duration: clamp(sheet.duration, 4, 600, 60),
    why: String(sheet.why || '').trim(),
    seconds: Math.round((Date.now() - started) / 100) / 10,
    model: chosen.name,
    notes: []
  }
  if (retried) out.notes.push('Read the brief as instrumental first. Asked again, because it names voices.')
  // Still contradicting itself after the retry: say so on the sheet rather than
  // pretend. The person is looking at the Voices switch and can fix it in a click.
  if (briefWantsVoices && out.instrumental) {
    out.notes.push('Your brief mentions voices but this came back instrumental. Turn Voices on and expand again, or write the lyrics yourself.')
  }
  if (!out.caption) throw new Error('the writing model returned an empty caption')

  // The unit the authors use is the keyword, not the word: 8 to 12, diluting
  // past 15. Counted, never truncated, because cutting a list mid-keyword would
  // change the music for the worse.
  out.captionTags = countTags(out.caption)
  if (out.captionTags > TAG_TARGET.dilute) {
    out.notes.push(`The style carries ${out.captionTags} keywords. The authors' limit is ${TAG_TARGET.dilute}, past which they dilute each other.`)
  }

  // A caption carrying a tempo is the one thing the authors call out, so it is
  // stripped rather than trusted. The number still lives in its own field.
  const before = out.caption
  out.caption = out.caption
    .replace(/,?\s*\b\d{2,3}\s*(bpm|beats per minute)\b/gi, '')
    .replace(/,?\s*\bin\s+[A-G](#|b)?\s+(major|minor)\b/gi, '')
    .replace(/\s{2,}/g, ' ').replace(/\s+,/g, ',').replace(/,\s*$/, '').trim()
  if (out.caption !== before) out.strippedFromCaption = true

  // A caption of pure mood gives the model nothing to play, so it plays what it
  // has heard most, which is a song with a drum beat. Measured: "Mysterious and
  // mystic, with a haunting melody and ethereal textures, evoking a sense of
  // exploration and ancient secrets" produced exactly that on a request for a
  // temple bed. Ask again, naming the gap.
  if (keep.caption === undefined && out.captionTags < 6 && namesASound(out.caption)) {
    const denser = s.completion({
      modelId: id,
      history: [
        ...history,
        { role: 'assistant', content: JSON.stringify(sheet) },
        {
          role: 'user',
          content: `The style has only ${out.captionTags} keywords, which is too thin: the ` +
            'authors\' own examples carry twelve to fourteen. Rewrite the caption as a ' +
            'comma-separated list of 8 to 12 keywords, genre first, then two or three moods, ' +
            'then four or five specific instruments, then the vocal character, then a ' +
            'production word. Keep the same music. Return the corrected JSON object.'
        }
      ],
      stream: false,
      responseFormat: { type: 'json_schema', json_schema: { name: 'song_sheet', schema: SCHEMA } }
    })
    try {
      const fixed = parseSheet(await denser.final)
      const n = countTags(fixed.caption)
      if (fixed.caption && n >= 6 && namesASound(fixed.caption)) {
        out.caption = String(fixed.caption).trim()
        out.captionTags = n
        out.notes.push(`The first style had ${countTags(sheet.caption)} keywords. Asked again for the density the authors publish.`)
      }
    } catch {}
  }

  if (keep.caption === undefined && !namesASound(out.caption)) {
    const again = s.completion({
      modelId: id,
      history: [
        ...history,
        { role: 'assistant', content: JSON.stringify(sheet) },
        {
          role: 'user',
          content: 'The caption names no genre and no instrument, only moods. That makes the ' +
            'model fall back on a generic song with a drum beat. Rewrite it naming at least one ' +
            'genre and at least two actual instruments or sound sources, and say "no percussion" ' +
            'if there should be none. Return the corrected JSON object.'
        }
      ],
      stream: false,
      responseFormat: { type: 'json_schema', json_schema: { name: 'song_sheet', schema: SCHEMA } }
    })
    try {
      const fixed = parseSheet(await again.final)
      if (fixed.caption && namesASound(fixed.caption)) {
        out.caption = String(fixed.caption).trim()
        out.captionWords = out.caption.split(/\s+/).filter(Boolean).length
        out.notes.push('The first caption was all mood and named no instrument, which is what makes this model reach for a drum beat. Asked again.')
      } else {
        out.notes.push('This caption names no genre or instrument, only moods. That is what makes the model default to a song with a beat. Add what is actually playing, for example "low sustained cellos, breathy choir pad, no percussion".')
      }
    } catch {
      out.notes.push('This caption names no genre or instrument, only moods, which invites a drum beat. Add what is actually playing.')
    }
  }

  // Genre first, enough instruments to be a caption rather than a mood, and the
  // tradition the brief named still in there.
  const culture = CULTURES.find((c) => c.test.test(brief))
  const cultureLost = () => {
    if (!culture) return false
    const c = out.caption.toLowerCase()
    return !culture.genres.split(/,| or /).map((x) => x.trim()).filter(Boolean).some((g) => c.includes(g))
  }
  const faults = () => {
    const f = []
    if (!firstTagIsGenre(out.caption)) f.push('does not start with a genre')
    if (countInstruments(out.caption) < 2) f.push('names fewer than two instruments')
    if (cultureLost()) f.push('dropped the tradition the brief named')
    return f
  }

  let wrong = keep.caption === undefined ? faults() : []
  if (wrong.length) {
    const again = s.completion({
      modelId: id,
      history: [
        ...history,
        { role: 'assistant', content: JSON.stringify({ ...sheet, caption: out.caption }) },
        {
          role: 'user',
          content: `Your style list ${wrong.join(', and ')}. The authors require the genre first, ` +
            'then two or three moods, then four or five specific instruments.' +
            (culture ? ` The brief names a tradition: use ${culture.genres} as the genre and ` +
              `instruments from ${culture.instruments}. Keep whatever twist the brief adds on top.` : '') +
            ' Return the corrected JSON object.'
        }
      ],
      stream: false,
      responseFormat: { type: 'json_schema', json_schema: { name: 'song_sheet', schema: SCHEMA } }
    })
    try {
      const fixed = parseSheet(await again.final)
      if (fixed.caption && namesASound(fixed.caption)) {
        const kept = out.caption
        out.caption = String(fixed.caption).trim()
        out.captionTags = countTags(out.caption)
        if (faults().length >= wrong.length) out.caption = kept   // no better, keep the first
        else out.notes.push('Asked again for the genre and the instruments.')
      }
    } catch {}
    // Last resort, and mechanical: if a genre is in the list but not in front,
    // move it. "robotic, eerie, mechanical, industrial" is the right music with
    // the wrong word leading, and the authors' rule is that genre anchors first.
    wrong = faults()
    if (wrong.includes('does not start with a genre')) {
      const tags = out.caption.split(',').map((t) => t.trim()).filter(Boolean)
      const at = tags.findIndex((t) => GENRE_WORDS.some((g) => t.toLowerCase() === g || t.toLowerCase().includes(g)))
      if (at > 0) {
        tags.unshift(tags.splice(at, 1)[0])
        out.caption = tags.join(', ')
        out.notes.push(`Moved "${tags[0]}" to the front: genre anchors the style.`)
        wrong = faults()
      }
    }
    for (const f of wrong) out.notes.push(`The style ${f}.`)
  }

  // An atmospheric brief must not carry a pulse. A tempo says there is one and a
  // time signature says the music is metred; both invite percussion.
  const atmospheric = ATMOSPHERIC.test(brief) && !RHYTHMIC.test(brief)
  if (atmospheric) {
    if (keep.bpm === undefined && out.bpm) {
      out.notes.push(`Dropped the tempo it suggested (${out.bpm} bpm). This reads as atmosphere rather than a groove, and naming a tempo is what asks the model for a beat. Set one yourself if you want a pulse.`)
      out.bpm = 0
    }
    if (keep.timesignature === undefined && out.timesignature) {
      out.timesignature = ''
    }
  }

  // No singing means no singing language. The two together are incoherent and
  // the field was going out set on instrumental takes.
  if (out.instrumental && keep.vocalLanguage === undefined) out.vocalLanguage = ''

  // The language field only survives when the brief actually asked for one.
  if (keep.vocalLanguage === undefined && !out.instrumental) {
    const asked = ASKS_LANGUAGE.exec(brief)
    const code = asked ? LANGUAGE_CODES[asked[2].toLowerCase()] : null
    if (code) {
      out.vocalLanguage = code
    } else if (out.vocalLanguage && out.vocalLanguage !== 'en') {
      // The failure this guards is narrow and was measured: a French brief came
      // back with English lyrics and `fr`, which asks the engine to sing English
      // words in French. `en` is left alone, because the lyrics this model
      // writes are English unless the brief asked otherwise, so `en` agrees with
      // them rather than contradicting them.
      out.notes.push(`Cleared the singing language. It had guessed "${out.vocalLanguage}" from the language you wrote your brief in, but the lyrics above are English. Set it yourself if you want them sung in another language.`)
      out.vocalLanguage = ''
    }
  }

  // Anything the person had already decided wins, always.
  for (const [k, v] of Object.entries(keep)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v
  }
  return out
}

function clamp (v, lo, hi, fallback) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(lo, Math.min(hi, Math.round(n)))
}

/** One JSON object out of a completion, with any reasoning block removed. */
function parseSheet (final) {
  const raw = String(final?.contentText ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error('the writing model did not return a song sheet')
  }
}
