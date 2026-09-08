// Translation, in the exact shape the model was trained for.
//
// The prompt below is verbatim from the model card, including the trailing space in
// the system message and the "\n\nTranslation:" suffix. A translation model is far
// more sensitive to its template than a chat model: reword this and quality drops
// without any error to tell you why. Language names are written out in full
// ("Swahili", not "sw") because that is what the training data used.

/** The 19 languages the model was fine-tuned on, plus English, its pivot. */
export const FINE_TUNED = [
  { code: 'en', name: 'English' },
  { code: 'af', name: 'Afrikaans' },
  { code: 'am', name: 'Amharic' },
  { code: 'ha', name: 'Hausa' },
  { code: 'ig', name: 'Igbo' },
  { code: 'rw', name: 'Kinyarwanda' },
  { code: 'ln', name: 'Lingala' },
  { code: 'lg', name: 'Luganda' },
  { code: 'mg', name: 'Malagasy' },
  { code: 'ny', name: 'Nyanja' },
  { code: 'om', name: 'Oromo' },
  { code: 'sn', name: 'Shona' },
  { code: 'so', name: 'Somali' },
  { code: 'st', name: 'Southern Sotho' },
  { code: 'sw', name: 'Swahili' },
  { code: 'tn', name: 'Tswana' },
  { code: 'wo', name: 'Wolof' },
  { code: 'xh', name: 'Xhosa' },
  { code: 'yo', name: 'Yoruba' },
  { code: 'zu', name: 'Zulu' }
]

/**
 * The 8 languages the model never saw in fine-tuning. The paper reports it still
 * improves on its own backbone for every one of them, which is a transfer result and
 * not a support claim. Kept separate in the UI for exactly that reason.
 */
export const HELD_OUT = [
  { code: 'ak', name: 'Akan' },
  { code: 'bm', name: 'Bambara' },
  { code: 'kg', name: 'Kituba' },
  { code: 'mos', name: 'Moore' },
  { code: 'pcm', name: 'Nigerian Pidgin' },
  { code: 'nso', name: 'Sepedi' },
  { code: 'apd', name: 'Sudanese Arabic' },
  { code: 'tzm', name: 'Tamazight' }
]

/**
 * Languages that are neither, offered because the model keeps its backbone's other
 * languages (the Asia-Europe mix exists in training to prevent exactly the
 * forgetting that would break these). Never advertised as supported: French in
 * particular is not a training pair, since every pair was English to an African
 * language.
 */
export const OTHER = [
  { code: 'fr', name: 'French' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ar', name: 'Arabic' },
  { code: 'es', name: 'Spanish' }
]

export const ALL = [...FINE_TUNED, ...HELD_OUT, ...OTHER]
export const nameFor = (code) => (ALL.find((l) => l.code === code) || {}).name || code
export const tierFor = (code) =>
  FINE_TUNED.some((l) => l.code === code) ? 'fine-tuned'
    : HELD_OUT.some((l) => l.code === code) ? 'zero-shot'
      : 'not supported'

export function buildPrompt (sourceLang, targetLang, text) {
  return [
    {
      role: 'system',
      content: `You are a professional ${sourceLang} to ${targetLang} translator. ` +
        `Your goal is to accurately convey the meaning and nuances of the original ${sourceLang} text ` +
        `while adhering to ${targetLang} grammar, vocabulary, and cultural sensitivities. ` +
        `Produce only the ${targetLang} translation, without any additional explanations or commentary. `
    },
    {
      role: 'user',
      content: `Please translate the following ${sourceLang} text into ${targetLang}: ${text}.\n\nTranslation:`
    }
  ]
}

/**
 * One paragraph at a time.
 *
 * The GGUF evaluations used a 2,048-token context and the model card warns against
 * very long documents, so a scanned page is translated paragraph by paragraph rather
 * than in one call. It also means the reader sees the first paragraph while the rest
 * is still running, which on a phone is the difference between usable and not.
 */
export function splitForTranslation (text, maxChars = 700) {
  const paras = String(text).split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean)
  const out = []
  for (const block of splitHeadings(paras)) {
    const p = block
    if (p.length <= maxChars) { out.push(p); continue }
    // Break on sentence ends, never mid-sentence: a half sentence translates badly
    // and there is no way for the reader to tell that is what happened.
    let buf = ''
    for (const s of p.split(/(?<=[.!?])\s+/)) {
      if ((buf + ' ' + s).trim().length > maxChars && buf) { out.push(buf.trim()); buf = s } else { buf += ' ' + s }
    }
    if (buf.trim()) out.push(buf.trim())
  }
  return out
}

/**
 * A heading is not part of the paragraph under it.
 *
 * A scanned page arrives as lines, and a heading, a reference number and a date all
 * sit on their own short lines with no full stop. Handed to the model inside one
 * block they come back welded to the next sentence: "RIVERSIDE COMMUNITY
 * CLINICSashen kula da marasa lafiya" is what that looks like. So a short line with
 * no sentence-ending punctuation becomes its own chunk, and prose is left alone.
 */
function splitHeadings (paras) {
  const out = []
  for (const para of paras) {
    const lines = para.split(/\n+/).map((l) => l.trim()).filter(Boolean)
    if (lines.length < 2) { out.push(para); continue }
    let buf = []
    for (const line of lines) {
      const short = line.length < 60
      const unpunctuated = !/[.!?]$/.test(line)
      if (short && unpunctuated) {
        if (buf.length) { out.push(buf.join(' ')); buf = [] }
        out.push(line)
      } else {
        buf.push(line)
      }
    }
    if (buf.length) out.push(buf.join(' '))
  }
  return out
}

/** The model's own language identification, constrained to the list it knows. */
export function buildDetectPrompt (text) {
  const names = FINE_TUNED.map((l) => l.name).join(', ')
  return [
    { role: 'system', content: 'You identify the language of a text. Answer with the language name only, nothing else.' },
    { role: 'user', content: `Which language is this text written in? Choose exactly one name from this list: ${names}.\n\nText: ${text}\n\nLanguage:` }
  ]
}
