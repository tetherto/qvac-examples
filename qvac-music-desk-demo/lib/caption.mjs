import { CHIPS } from './vocab.mjs'

/**
 * The caption, conformed to the rules the ACE-Step 1.5 authors state.
 *
 * From docs/en/Tutorial.md in ace-step/ACE-Step-1.5 and their published example
 * tag sets:
 *
 * - The caption is a comma-separated keyword list. Genre anchors the front,
 *   then mood, instruments, vocal character, production, era. Natural language
 *   is accepted too, but prose spends its budget on words the model cannot use:
 *   "Robotic Mexican folk, with mechanical guitar and electronic accordion,
 *   blending traditional sounds with digital textures" is sixteen words and
 *   four keywords.
 * - **5 to 12 keywords.** Past 15 they dilute each other.
 * - Specific beats vague: "grand piano" over "piano".
 * - Tempo, key and time signature NEVER go in the caption. They are parameters.
 * - Conflicts are the failure mode the authors name twice: "models are not good
 *   at resolving conflicts". A lead vocal named in an instrumental request is
 *   one, and so is "no vocals" in a request that has lyrics.
 * - A wordless choir is NOT a conflict: their own cinematic example carries
 *   "choir ooh" and "no vocals" in the same caption.
 *
 * This module is the mechanism for those rules, because a rule that lives only
 * in a system prompt is a rule that gets ignored.
 */

/** The recommended keyword count, shown in the UI as a target. */
export const TAG_TARGET = { low: 5, high: 12, dilute: 15 }

/**
 * "Avoid stacking: limit to one primary genre plus one modifier maximum." So a
 * list that opens "mariachi, mexican, eerie, mechanical, banda, norteno" keeps
 * the first two genres and drops the third, which is the one competing with
 * them rather than adding to them.
 */
const GENRES = new Set(CHIPS.filter(([g]) => g === 'Genre').flatMap(([, w]) => w).map((w) => w.toLowerCase()))
const MAX_GENRES = 2

/** Tempo, key and time signature: parameters, not caption words. */
const META = /(\b\d{2,3}\s*bpm\b|\bbpm\s*\d{2,3}\b|\bin\s+[A-G][#b]?\s+(major|minor)\b|\b[A-G][#b]?\s+(major|minor)\b|\b\d\s*\/\s*\d\b|\btempo\b)/i

/** A named singer or lead line, which an instrumental take must not ask for. */
const LEAD_VOCAL = /(lead vocal|male vocals?|female vocals?|rap vocals?|spoken word|whispered vocal|gang vocals?|child vocals?|\bsinger\b|\bsinging\b|\bsung\b|falsetto|belting|ad-lib|harmonies)/i

/** A choir that sings words. Instrumentally, the authors write "choir ooh". */
const WORD_CHOIR = /(layered choir|gospel choir|choir)/i

const NO_VOCALS = /^(no vocals?|instrumental|without vocals?)$/i

/**
 * @param {string} caption raw text from the sheet
 * @param {{instrumental: boolean}} opts
 * @returns {{caption: string, tags: string[], notes: string[]}}
 */
export function conformCaption (caption, opts = {}) {
  const instrumental = !!opts.instrumental
  const notes = []
  let tags = String(caption || '').split(',').map((t) => t.trim()).filter(Boolean)

  const seen = new Set()
  tags = tags.filter((t) => {
    const k = t.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  tags = tags.filter((t) => {
    if (!META.test(t)) return true
    notes.push(`"${t}" moved out of the style, it has its own field`)
    return false
  })

  if (instrumental) {
    tags = tags
      .filter((t) => !NO_VOCALS.test(t))
      .filter((t) => {
        if (!LEAD_VOCAL.test(t)) return true
        notes.push(`dropped "${t}", this take is instrumental`)
        return false
      })
      .map((t) => {
        if (!WORD_CHOIR.test(t) || /choir ooh/i.test(t)) return t
        notes.push(`"${t}" became "choir ooh", wordless`)
        return 'choir ooh'
      })
    tags.push('no vocals')
  } else {
    tags = tags.filter((t) => {
      if (!NO_VOCALS.test(t)) return true
      notes.push(`dropped "${t}", this take has voices`)
      return false
    })
  }

  let genres = 0
  tags = tags.filter((t) => {
    if (!GENRES.has(t.toLowerCase())) return true
    genres += 1
    if (genres <= MAX_GENRES) return true
    notes.push(`dropped the third genre "${t}", two is the authors' limit`)
    return false
  })

  if (tags.length > TAG_TARGET.dilute) {
    notes.push(`${tags.length} keywords, past ${TAG_TARGET.dilute} they dilute`)
  }

  return { caption: tags.join(', '), tags, notes }
}

/** How many keywords a caption carries, for the counter next to the field. */
export function countTags (caption) {
  return String(caption || '').split(',').map((t) => t.trim()).filter(Boolean).length
}
