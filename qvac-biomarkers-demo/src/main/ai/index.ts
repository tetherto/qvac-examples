// ============================================================
// ai/: grounded, validated, cached recommendations.
//
// The one idea worth taking from this file: THE MODEL PERSONALIZES, IT
// NEVER SUPPLIES FACTS. Food and nutrient names come from the knowledge
// base, and they are held there by three separate mechanisms, each of which
// would be enough on its own:
//
//   1. The prompt says so (ai/prompt.ts).
//   2. The JSON Schema pins `food` and `nutrient` to enums built from the
//      facts we handed over, and the SDK turns that schema into a grammar,
//      so the model cannot emit an off-list token.
//   3. `validate()` below re-reads every sentence afterwards and drops any
//      that names a food we did not authorise. Dropped items are reported,
//      not hidden.
//
// Belt, braces, and a second pair of braces. A health app is the wrong
// place to trust a 4B model's self-restraint.
// ============================================================

import type {
  Category,
  Direction,
  FoodSource,
  GroundedFact,
  MarkerView,
  RecKind,
  Recommendation,
  RecommendationSet
} from '../../shared/types.js'
import type { KnowledgeBase } from '../library.js'
import { generate, isResident, modelInfo, type DownloadProgress } from '../qvac.js'
import { categoryPrompt, markerPrompt } from './prompt.js'

/** The design lays recommendations out two-up, so four or six look best. */
export const MAX_PICKS = 5

/**
 * Roughly how long a finished reply runs, in characters, measured from real
 * MedPsy 4B output. Used ONLY to turn the streaming character count into a
 * bar, and the bar is held at 95% until the run actually ends, so it never
 * claims to be finished before it is. The character count itself is exact.
 */
const EXPECTED_CHARS = 900

// ---- Gathering the allowed facts -----------------------------------------

/**
 * Every fact the model may use for one (marker, direction), vetted first.
 *
 * A Food Library source contributes facts exactly like the shipped file
 * does (same shape, same guard) but keeps its origin, so a card can say
 * where it came from and a reader can tell vetted from user-added.
 */
export function factsFor(
  markerId: string,
  direction: Direction,
  kb: KnowledgeBase,
  sources: FoodSource[]
): GroundedFact[] {
  const vetted: GroundedFact[] = (kb.entries[markerId]?.[direction] ?? []).map((f) => ({
    ...f,
    markerId,
    direction,
    origin: 'vetted' as const
  }))

  // `accepted === true` and nothing else. A fact still in review, or one that
  // was rejected, must not influence a single word of the advice.
  const fromSources: GroundedFact[] = sources
    .filter((s) => s.state === 'linked' || s.state === 'review')
    .flatMap((s) =>
      s.facts.filter(
        (f) => f.accepted === true && f.markerId === markerId && f.direction === direction
      )
    )

  return [...vetted, ...fromSources]
}

/** Changes whenever the allowed facts change, so the cache key can follow. */
export function fingerprint(facts: GroundedFact[]): string {
  const parts = facts.map((f) => `${f.origin}:${f.nutrient}:${f.foods.join(',')}`).sort()
  // A short, stable, non-cryptographic digest. It only has to change when
  // the input changes, not resist an attacker.
  let h = 0
  const s = parts.join('|')
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return `${facts.length}-${(h >>> 0).toString(36)}`
}

// ---- The schema ----------------------------------------------------------

/**
 * Builds the response schema for one call.
 *
 * `food` and `nutrient` are enums of exactly what we provided. This is the
 * structural half of the grounding guarantee: the model is generating
 * under a grammar, so "salmon" cannot appear unless salmon was on the list.
 */
function schemaFor(facts: GroundedFact[], maxPicks: number): Record<string, unknown> {
  const nutrients = [...new Set(facts.map((f) => f.nutrient))]
  const foods = [...new Set(facts.flatMap((f) => f.foods))]
  return {
    type: 'object',
    properties: {
      interpretation: { type: 'string' },
      picks: {
        type: 'array',
        maxItems: maxPicks,
        items: {
          type: 'object',
          properties: {
            nutrient: { type: 'string', enum: nutrients },
            food: { type: 'string', enum: foods },
            kind: { type: 'string', enum: ['FOOD', 'LIFESTYLE'] },
            text: { type: 'string' }
          },
          required: ['nutrient', 'food', 'kind', 'text'],
          additionalProperties: false
        }
      }
    },
    required: ['interpretation', 'picks'],
    additionalProperties: false
  }
}

interface RawPick {
  nutrient: string
  food: string
  kind: string
  text: string
}

// ---- Presentation --------------------------------------------------------

/**
 * A lifestyle item is one whose nutrient is labelled as such in the
 * knowledge base, or whose "food" is an instruction rather than an
 * ingredient. The design tags the two differently, and the tag drives the
 * card colour.
 */
const INSTRUCTION = /^(limit|reduce|avoid|increase|consistent|progressive|\d)/i

function kindFor(fact: GroundedFact, food: string): RecKind {
  if (/\(lifestyle\)/i.test(fact.nutrient)) return 'LIFESTYLE'
  if (INSTRUCTION.test(food.trim())) return 'LIFESTYLE'
  return 'FOOD'
}

/** The fallback sentence, used when the model's own phrasing fails validation. */
function template(kind: RecKind, food: string, nutrient: string): string {
  const clean = nutrient.replace(/\s*\((lifestyle|absorption aid)\)/i, '').trim()
  if (kind === 'LIFESTYLE') {
    // No "helps with X" tail. The knowledge base labels the sun entry's
    // nutrient "sunlight", which turned the card into "sun exposure, helps
    // with sunlight". The nutrient is already on the card's provenance line,
    // so the action can just stand on its own.
    const action = food.trim().replace(/\.$/, '')
    return `${action.charAt(0).toUpperCase()}${action.slice(1)}.`
  }
  // "which is high in" needs the food's number to agree, and the knowledge base
  // holds both ("liver", "oysters"). Detecting plurals from spelling is a
  // losing game (greens, hummus), so the sentence is phrased to not care.
  return `Consider more ${food}, a source of ${clean}.`
}

// ---- Validation ----------------------------------------------------------

/**
 * The third guard. Takes the model's sentences and the facts it was allowed
 * to use, and returns only what survives.
 *
 * Three checks:
 *   - the sentence must not prescribe a quantity or a schedule, because this
 *     app has no basis for one (see DOSAGE);
 *   - the sentence must actually mention the food it claims to be about,
 *     otherwise we replace the prose with the template rather than show a
 *     sentence we cannot trace;
 *   - the sentence must not name a food from anywhere ELSE in the knowledge
 *     base. That is the drift case: a model that knows spinach is iron-rich
 *     slipping spinach into advice about vitamin D.
 */
function validate(
  picks: RawPick[],
  facts: GroundedFact[],
  everyKnownFood: string[]
): { recommendations: Recommendation[]; dropped: string[] } {
  const allowedFoods = new Set(facts.flatMap((f) => f.foods.map((x) => x.toLowerCase())))

  // Which foods count as evidence of drift. Two exclusions, both learned the
  // hard way:
  //
  //   - anything that reads as an instruction rather than an ingredient
  //     ("limit liver/organ meats", "consistent 7-9h sleep") is not a food a
  //     sentence can wander onto;
  //   - anything whose text sits INSIDE an allowed food. "liver" appears in
  //     the knowledge base under ferritin-high, and "cod liver oil" is a
  //     legitimate vitamin D food. Without this, recommending cod liver oil
  //     is flagged as drift onto liver.
  const offLimits = everyKnownFood
    .map((f) => f.toLowerCase())
    .filter((f) => !allowedFoods.has(f))
    .filter((f) => !INSTRUCTION.test(f))
    .filter((f) => ![...allowedFoods].some((allowed) => allowed.includes(f)))

  // Two facts can carry the same nutrient name: the built-in entry for
  // "vitamin D" plus one a user's source contributed. So the nutrient tells us
  // whether a pick is allowed, and the FOOD tells us which fact it came from.
  // Keying provenance off the nutrient instead would print "built-in" on a
  // food a user's own source supplied, which is the one thing this feature
  // exists to get right.
  const nutrients = new Set(facts.map((f) => f.nutrient))
  const factByFood = new Map<string, GroundedFact>()
  for (const fact of facts) {
    for (const food of fact.foods) {
      const key = `${fact.nutrient}\u0000${food.toLowerCase()}`
      if (!factByFood.has(key)) factByFood.set(key, fact)
    }
  }

  const recommendations: Recommendation[] = []
  const dropped: string[] = []
  const seen = new Set<string>()

  for (const pick of picks) {
    if (!nutrients.has(pick.nutrient)) {
      dropped.push(`"${pick.nutrient}" is not one of the nutrients we provided`)
      continue
    }

    // Both `nutrient` and `food` are enums, so each is on the list, but the
    // grammar cannot express "and the food must belong to THAT nutrient", and
    // in practice the model does cross them (MedPsy filed the midday-sun item
    // under "vitamin D" rather than under "sunlight (lifestyle)").
    //
    // Dropping that would throw away sound advice over a mislabelling. So:
    // if the food is authorised under some other provided fact, re-file it
    // there and say so. Only a food that appears under NO provided fact is
    // dropped, which keeps the guarantee intact, since the guarantee is
    // about foods, not about labels.
    let fact = factByFood.get(`${pick.nutrient}\u0000${pick.food.toLowerCase()}`)
    if (!fact) {
      const elsewhere = facts.find((f) =>
        f.foods.some((x) => x.toLowerCase() === pick.food.toLowerCase())
      )
      if (!elsewhere) {
        dropped.push(`"${pick.food}" is not one of the foods we provided`)
        continue
      }
      // A repair, not a refusal. The reader does not need to know which
      // nutrient key a food was filed under, that is our bookkeeping, and
      // printing it on screen was noise dressed up as transparency.
      console.log(`[ai] re-filed "${pick.food}" under ${elsewhere.nutrient}`)
      fact = elsewhere
    }
    // One card per food. A model asked for five picks from three facts will
    // happily repeat itself.
    const key = pick.food.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    const kind = kindFor(fact, pick.food)
    const modelText = (pick.text ?? '').trim()
    // A FOOD card must name its food, or we cannot trace the sentence. A
    // LIFESTYLE "food" is an instruction like "10-20 min midday sun exposure",
    // and no natural sentence repeats that verbatim: insisting on it threw
    // away every lifestyle sentence the model wrote and printed the raw
    // instruction instead. The drift check below still applies to both, and
    // that is the check that guards food facts.
    const traceable =
      kind === 'LIFESTYLE' || modelText.toLowerCase().includes(pick.food.toLowerCase())
    const strayFood = offLimits.find((f) => new RegExp(`\\b${escapeRegExp(f)}\\b`, 'i').test(modelText))

    let text: string
    if (strayFood) {
      // Also a repair: the food is authorised, only the sentence strayed, and
      // we replaced it with one we can trace.
      console.log(`[ai] rewrote a sentence that wandered onto "${strayFood}"`)
      text = template(kind, pick.food, pick.nutrient)
    } else if (DOSAGE.test(modelText)) {
      console.log(`[ai] rewrote a sentence that prescribed a quantity: "${modelText}"`)
      text = template(kind, pick.food, pick.nutrient)
    } else if (!traceable || modelText.length < 12 || modelText.length > 180) {
      text = template(kind, pick.food, pick.nutrient)
    } else {
      text = modelText
    }

    recommendations.push({
      kind,
      text,
      nutrient: fact.nutrient,
      food: kind === 'FOOD' ? pick.food : null,
      origin: fact.origin,
      sourceTitle: fact.sourceTitle
    })
  }

  return { recommendations, dropped }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * A quantity or a dosing schedule in the sentence.
 *
 * Rule 2 of the system prompt says no dosages, and MedPsy ignores it: asked
 * about ferritin it wrote "Eat 3-4 ounces of lean red meat daily" and
 * "Include oysters 2-3 times weekly". Both are numbers this app has no basis
 * for. It knows a marker is low; it does not know the reader's weight, their
 * diet, their medication or what their doctor already told them.
 *
 * So a sentence carrying a number like that loses its prose and keeps its
 * fact, exactly as a sentence that wandered onto the wrong food does. The
 * card still says "eat more lentils", which is the part we can stand behind.
 */
const DOSAGE =
  /\b\d+([.,]\d+)?\s*(?:-|to)?\s*\d*\s*(mg|mcg|µg|g|kg|oz|ounces?|lbs?|pounds?|cups?|tbsp|tablespoons?|tsp|teaspoons?|ml|l|litres?|liters?|iu|servings?|portions?|slices?|pieces?|eggs?|glasses?)\b|\b\d+\s*(?:-|to)?\s*\d*\s*(?:times?|x)\s*(?:a|per)?\s*(?:daily|weekly|monthly|day|week|month)\b|\b(?:once|twice|thrice)\s+(?:(?:a|per)\s+)?(?:daily|weekly|monthly|day|week|month)\b/i

/** Every food name anywhere in the knowledge base, for the drift check. */
export function allKnownFoods(kb: KnowledgeBase, sources: FoodSource[]): string[] {
  const out = new Set<string>()
  for (const byDirection of Object.values(kb.entries)) {
    for (const facts of Object.values(byDirection)) {
      for (const f of facts ?? []) for (const food of f.foods) out.add(food)
    }
  }
  // Every food the app has ever heard of, accepted or not: this list is the
  // drift check, and a sentence straying onto a food from a REJECTED fact is
  // exactly as wrong as one straying anywhere else.
  for (const s of sources) for (const f of s.facts) for (const food of f.foods) out.add(food)
  return [...out]
}

// ---- The two entry points ------------------------------------------------

interface RunOptions {
  facts: GroundedFact[]
  everyKnownFood: string[]
  subject: string
  /** Progress for the UI: a label and, once writing starts, a real number. */
  onJob?: (label: string, percent: number | null) => void
  /**
   * The sentence we already put on the screen. Asked not to repeat it, the
   * model sometimes does anyway, so we check rather than trust, and show
   * nothing rather than the same sentence twice.
   */
  echoOf?: string
  onProgress?: (p: DownloadProgress) => void
}

/** Loose enough to catch a reworded echo, strict enough to keep a real sentence. */
function isEcho(candidate: string, original?: string): boolean {
  if (!original) return false
  const flatten = (t: string): string =>
    t
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  const a = flatten(candidate)
  const b = flatten(original)
  if (a.length === 0) return true
  return a === b || a.includes(b) || b.includes(a)
}

async function run(
  history: ReturnType<typeof markerPrompt>,
  { facts, everyKnownFood, subject, echoOf, onProgress, onJob }: RunOptions
): Promise<RecommendationSet> {
  // Loading 2.7 GB into the GPU is the slow part of a cold run, and there is
  // no percentage to be had for it, so say what is happening instead of
  // drawing a bar that does not move.
  onJob?.(isResident() ? 'Reading your results' : `Loading ${modelInfo.label}`, null)

  const raw = await generate(
    history,
    schemaFor(facts, MAX_PICKS),
    'recommendations',
    onProgress,
    (chars) => onJob?.('Writing suggestions', Math.min(95, (chars / EXPECTED_CHARS) * 100))
  )
  onJob?.('Checking every suggestion', 100)

  let parsed: { interpretation?: string; picks?: RawPick[] }
  try {
    parsed = JSON.parse(raw)
  } catch {
    // The grammar should make this impossible. If it happens we say so
    // rather than showing half a sentence.
    throw new Error('The model returned something we could not read. Try regenerating.')
  }

  const { recommendations, dropped } = validate(parsed.picks ?? [], facts, everyKnownFood)

  const written = (parsed.interpretation ?? '').trim()
  const interpretation = isEcho(written, echoOf) ? '' : written

  return {
    subject,
    interpretation,
    recommendations,
    generatedAt: new Date().toISOString(),
    modelLabel: modelInfo.label,
    dropped
  }
}

export function recommendForMarker(
  view: MarkerView,
  direction: Direction,
  facts: GroundedFact[],
  neighbours: MarkerView[],
  everyKnownFood: string[],
  onProgress?: (p: DownloadProgress) => void,
  onJob?: (label: string, percent: number | null) => void
): Promise<RecommendationSet> {
  return run(markerPrompt(view, direction, facts, neighbours, MAX_PICKS), {
    facts,
    everyKnownFood,
    subject: view.marker.id,
    echoOf: view.trend.sentence,
    onProgress,
    onJob
  })
}

export function recommendForCategory(
  category: Category,
  score: number,
  band: string,
  offRange: MarkerView[],
  facts: GroundedFact[],
  everyKnownFood: string[],
  onProgress?: (p: DownloadProgress) => void,
  onJob?: (label: string, percent: number | null) => void
): Promise<RecommendationSet> {
  return run(
    categoryPrompt(category.name, category.description, score, band, offRange, facts, MAX_PICKS),
    {
      facts,
      everyKnownFood,
      subject: `category:${category.name}`,
      onProgress,
      onJob
    }
  )
}
