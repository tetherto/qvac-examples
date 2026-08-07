// ============================================================
// Turning one small vision model into one trustworthy object.
//
// A 2B model at Q4 mostly does what the prompt asks, and
// sometimes wraps the JSON in prose, closes an array with the
// wrong character, drops a colour, invents a season or misspells
// a swatch. So there are two jobs here:
//
//   1. Ask for JSON and nothing else, listing the exact names.
//   2. Never trust the reply — repair it into a valid `Analysis`.
//
// Repair has a floor, though. If the model said nothing usable at
// all, this file throws rather than hand back twelve neutral
// ratings that look like a real reading. Silently plausible is
// worse than an honest retry.
// ============================================================

import { PALETTE, PALETTE_NAMES } from '../shared/palette.js'
import type { Analysis, ColorVerdict, Rating, Season, Undertone } from '../shared/types.js'

const SEASONS: Season[] = ['Spring', 'Summer', 'Autumn', 'Winter']
const UNDERTONES: Undertone[] = ['warm', 'cool', 'neutral']
const RATINGS: Rating[] = ['green', 'yellow', 'red']

/**
 * The one prompt the app sends.
 *
 * Every clause was measured against the same photo and scored on four things:
 * how many of the twelve came back, how long each comment ran, how many
 * comments repeated each other, and how many colours were rated green. Nine
 * variants; this is the best of them. The findings, most expensive first:
 *
 * 1. THE FREE-TEXT FIELDS IN THE EXAMPLE MUST BE "...", NEVER REAL SENTENCES.
 *    This model reads the example as an answer, not a template. Fill in the
 *    example's `commentary` and it returns that exact sentence and stops after
 *    however many entries the example had — two in, two out. With `"..."` it
 *    has nothing to copy, so it writes its own twelve. The enum fields
 *    (`undertone`, `season`, `rating`) are safe to show filled, since copying
 *    "cool" is copying a valid answer.
 * 2. DO NOT OFFER SAMPLE PHRASES. A bank of well-written example comments,
 *    even grouped by rating, gets pasted verbatim onto ten of the twelve
 *    colours. Removing it took repeated comments from 10/12 to 0/12.
 * 3. Do not send a form of `"?"` blanks either. That scored best of six
 *    variants on a drawn test face, then came back with every `"?"` untouched
 *    on a real photograph.
 * 4. Calibration has to be a RULE, not a preference. "Usually five to seven
 *    suit a person" was ignored — it rated ten of twelve green, including five
 *    warm colours on a cool verdict. Telling it to apply its own undertone
 *    verdict consistently brought that to five, with the warm tones correctly
 *    demoted.
 * 5. Each colour's family is given beside it, or it calls Emerald warm and
 *    reasons from there. That contradiction is now gone entirely.
 * 6. `colors` comes last, after the three short scalar fields. Put the long
 *    array first and it treats finishing the array as finishing the job.
 *
 * Known limitation, measured not guessed: about four of the twelve comments
 * still echo another one, and they are the colours sharing a rating — four
 * warm tones all rated yellow get near-identical sentences. Attempts to fix
 * that with an explicit "colours sharing a rating still need different
 * comments" clause made the model stop emitting the array at all. A 2B model
 * at Q4 has a floor here; the lever would be a better model, not more prompt.
 */
export function buildAnalysisPrompt(): string {
  const roster = PALETTE.map((s, i) => `${i + 1}. ${s.name} (${s.group})`).join('\n')

  return `You are a personal colour analyst looking at one photo of a person.

Judge their skin undertone, then rate how each of these twelve drape colours reads against their face. Each colour's family is in brackets — never contradict it.
${roster}

Ratings: "green" = clearly lifts the face, skin looks clearer and more awake. "yellow" = makes little real difference. "red" = drains, greys or reddens the skin.

Apply your undertone verdict consistently. If the skin reads cool, then most of the warm colours must be yellow or red, and only a few warm ones can be green — and the reverse if it reads warm. A person who suits all twelve does not exist: rate at most six green.

Each comment must be at most 12 words. Name a different visible effect for each colour — the skin, the eyes, the shadows under the jaw. Never write the same comment twice.

"why" is one short sentence describing this person's skin itself — its tone, its depth, how much contrast they have. It is about the face, never about the rules above.

Reply with ONLY JSON, no markdown and no other text, in exactly this shape. The "colors" array must contain all twelve entries, in the order above, using those names exactly, each with your own short comment about this person:

{"undertone":"cool","season":"Winter","why":"...","colors":[{"name":"${PALETTE_NAMES[0]}","rating":"green","commentary":"..."},{"name":"${PALETTE_NAMES[1]}","rating":"red","commentary":"..."}]}`
}

/** Strips fences and prose, leaving the widest `{ … }` span in the reply. */
function isolateJson(text: string): string {
  const cleaned = String(text)
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim()

  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end <= start) return ''
  return cleaned.slice(start, end + 1)
}

/**
 * Rebuilds the reply field by field with regexes, ignoring JSON syntax
 * entirely.
 *
 * This exists because a local model gets the punctuation wrong far more often
 * than it gets the content wrong. A real reply ended:
 *
 *     …making it look brighter and more rested."}"}
 *
 * — a stray quote where the closing `]` belonged. One wrong character, and a
 * strict parse throws away twelve perfectly good ratings and commentaries. So
 * when the parse fails we scrape the values out instead of giving up: the
 * fields are individually well-formed even when the object around them is not.
 */
function salvageJson(text: string): Record<string, unknown> {
  const scalar = (key: string): string | undefined =>
    // `(?:[^"\\]|\\.)*` walks over escaped quotes inside the value.
    new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(text)?.[1]

  const colors: unknown[] = []
  const entry =
    /"name"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"rating"\s*:\s*"([^"]*)"\s*,\s*"commentary"\s*:\s*"((?:[^"\\]|\\.)*)"/g
  for (let m = entry.exec(text); m !== null; m = entry.exec(text)) {
    colors.push({ name: m[1], rating: m[2], commentary: m[3] })
  }

  return {
    undertone: scalar('undertone'),
    season: scalar('season'),
    why: scalar('why'),
    colors
  }
}

/**
 * Pulls the reply apart: a strict parse when the model punctuated correctly,
 * a field-by-field salvage when it did not.
 */
function readReply(text: string): unknown {
  const isolated = isolateJson(text)
  if (!isolated) return null

  try {
    return JSON.parse(isolated)
  } catch {
    const salvaged = salvageJson(isolated)
    const found = Array.isArray(salvaged.colors) ? salvaged.colors.length : 0
    console.log(`[analyze] reply was not valid JSON — salvaged ${found} colours from it`)
    return salvaged
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/** Case-insensitive, whitespace-tolerant match against a fixed list. */
function matchOne<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  const needle = String(value ?? '')
    .trim()
    .toLowerCase()
  return allowed.find((a) => a.toLowerCase() === needle) ?? fallback
}

/** Maps a loose name back onto a real swatch: "true blue" → "True Blue". */
function matchSwatchName(value: unknown): string | null {
  const needle = String(value ?? '')
    .trim()
    .toLowerCase()
  if (!needle) return null

  const exact = PALETTE_NAMES.find((n) => n.toLowerCase() === needle)
  if (exact) return exact

  // "Gold" for "Mustard/Gold", "Silver" for "Cool Grey/Silver", and so on.
  return (
    PALETTE_NAMES.find((n) =>
      n
        .toLowerCase()
        .split('/')
        .some((part) => part.trim() === needle)
    ) ?? null
  )
}

function oneSentence(value: unknown, fallback: string): string {
  let text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return fallback
  // A model that hands back an unfilled placeholder must not have it shown as
  // if it were a reading.
  if (/^[?.…\-\s]*$/.test(text)) return fallback

  if (text.length > 180) text = `${text.slice(0, 177)}…`

  // Tidy the model's own words without changing them: it tends to open in
  // lower case ("cool blue lifts face…") and to skip the full stop. The colour
  // name already sits in the heading above, so sentence case reads better than
  // what the model emits verbatim.
  text = text.charAt(0).toUpperCase() + text.slice(1)
  if (!/[.!?…]$/.test(text)) text += '.'
  return text
}

/**
 * Stand-in commentary for a colour the model did not describe.
 *
 * Deliberately plain, so nobody mistakes it for a reading of their own face —
 * and it distinguishes the two cases that used to look identical. A colour the
 * model rated but did not write about is not the same as a colour the model
 * never mentioned, and saying "no strong reading either way" for the second is
 * a small lie: there was no reading at all.
 */
function describeFallback(rating: Rating, undertone: Undertone, rated: boolean): string {
  if (!rated) return 'The model skipped this one — drape it and judge by eye.'

  const tone = undertone === 'neutral' ? 'skin' : `${undertone} skin`
  switch (rating) {
    case 'green':
      return `Rated a good match for ${tone}. Hold it up and see whether your face looks brighter.`
    case 'red':
      return `Rated a poor match for ${tone}. Look for your face going flat or grey.`
    default:
      return 'Rated neutral — try it and judge by eye.'
  }
}

/**
 * Repairs the model's reply into a complete `Analysis`.
 *
 * Every field has a defined outcome: a bad season becomes the season
 * implied by the undertone, a missing colour becomes a neutral entry,
 * and empty palette lists are rebuilt from the ratings themselves.
 */
export function parseAnalysis(raw: string): Analysis {
  const obj = asRecord(readReply(raw))

  const undertone = matchOne(obj.undertone, UNDERTONES, 'neutral')
  const season = matchOne(
    obj.season,
    SEASONS,
    // A cool reading is far likelier to be Winter than Spring; warm the reverse.
    undertone === 'warm' ? 'Autumn' : undertone === 'cool' ? 'Winter' : 'Summer'
  )

  // Index whatever colour entries we can recognise. `rating` is kept nullable
  // on purpose: "the model said yellow" and "the model said nothing we could
  // read" must stay distinguishable, or an unfilled reply is indistinguishable
  // from a genuinely unremarkable one.
  const byName = new Map<string, { rating: Rating | null; commentary: string }>()
  const rawColors = Array.isArray(obj.colors) ? obj.colors : []
  for (const entry of rawColors) {
    const rec = asRecord(entry)
    const name = matchSwatchName(rec.name)
    if (!name || byName.has(name)) continue

    const given = String(rec.rating ?? '')
      .trim()
      .toLowerCase()
    byName.set(name, {
      rating: RATINGS.find((r) => r === given) ?? null,
      commentary: oneSentence(rec.commentary, '')
    })
  }

  // The palette lists, as the model gave them. These matter for more than
  // display: a model that skips the `colors` array often still gets these
  // right, and then they are the only rating signal we have.
  const listedGood = new Set(
    (Array.isArray(obj.recommendedPalette) ? obj.recommendedPalette : [])
      .map(matchSwatchName)
      .filter((n): n is string => n !== null)
  )
  const listedBad = new Set(
    (Array.isArray(obj.avoid) ? obj.avoid : [])
      .map(matchSwatchName)
      .filter((n): n is string => n !== null)
  )

  // Always exactly twelve, always in our own order.
  const colors: ColorVerdict[] = PALETTE.map((swatch) => {
    const hit = byName.get(swatch.name)

    // Prefer the model's own per-colour rating. Failing that, fall back to
    // the palette lists — being on the recommended list IS a green rating,
    // and reading it that way is what stops the whole tray defaulting to
    // "moderate fit" whenever a model returns lists but no `colors`.
    const listed = listedGood.has(swatch.name)
      ? 'green'
      : listedBad.has(swatch.name)
        ? 'red'
        : null
    const rating: Rating = hit?.rating ?? listed ?? 'yellow'
    const rated = hit?.rating !== null && hit?.rating !== undefined ? true : listed !== null

    return {
      name: swatch.name,
      rating,
      commentary: hit?.commentary || describeFallback(rating, undertone, rated)
    }
  })

  // The floor. A reply that rates two colours and skips ten is not a reading —
  // it is one row of substance and ten rows of filler that look just like it.
  // The model most often does this by copying the example in the prompt and
  // stopping. Better to say so and let the user retry than to dress two
  // answers up as twelve.
  const rated = colors.filter(
    (c) => byName.get(c.name)?.rating != null || listedGood.has(c.name) || listedBad.has(c.name)
  ).length
  if (rated < PALETTE.length / 2) {
    throw new Error(
      `The model only rated ${rated} of ${PALETTE.length} colours. Try the photo again.`
    )
  }

  // Now that every colour has a rating, rebuild the lists from them so the
  // bar at the top and the dots in the tray can never disagree.
  const recommended = colors.filter((c) => c.rating === 'green').map((c) => c.name)
  const avoid = colors.filter((c) => c.rating === 'red').map((c) => c.name)

  // Order the recommendations by the model's own list where it gave one,
  // so "best colour" means something.
  const preferred = (Array.isArray(obj.recommendedPalette) ? obj.recommendedPalette : [])
    .map(matchSwatchName)
    .filter((n): n is string => n !== null)
  const recommendedPalette = [
    ...preferred.filter((n) => recommended.includes(n)),
    ...recommended.filter((n) => !preferred.includes(n))
  ]

  // `why` should describe the person's skin. The model sometimes parrots the
  // prompt's own calibration rule back instead ("Skin tone is cool, so warm
  // colours are yellow or red…"), which reads as nonsense next to a verdict.
  // If the sentence is about the rating vocabulary rather than a face, drop it.
  const derivedWhy = `The skin reads ${undertone}, which puts you in ${season}.`
  const offered = oneSentence(obj.why, '')
  const parrotsTheRules = /\b(green|yellow|red)\b/i.test(offered) || /\brate\b/i.test(offered)

  return {
    undertone,
    season,
    why: !offered || parrotsTheRules ? derivedWhy : offered,
    recommendedPalette,
    avoid,
    colors
  }
}

