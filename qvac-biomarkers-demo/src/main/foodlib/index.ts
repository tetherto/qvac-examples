// ============================================================
// foodlib/: the Food Library.
//
// A source the user adds becomes facts in the same shape as the shipped
// knowledge base, so the recommendation engine reads both through one code
// path and neither gets special treatment. What it does NOT get is the
// vetted badge: every fact carries its origin, and a card generated from a
// user source says which source it came from.
//
// The extraction runs on-device, under a JSON Schema whose marker ids are
// an enum of the 56 markers we know, so a source cannot introduce advice
// about a marker the app has never heard of.
// ============================================================

import { randomUUID } from 'node:crypto'
import type { ContextGraph, Direction, FoodSource, GroundedFact, Marker } from '../../shared/types.js'
import { generate, isResident, modelInfo, type DownloadProgress } from '../qvac.js'
import { fetchPage } from './fetch.js'
import { readPdf } from './pdftext.js'

/**
 * Facts per source. Five rather than eight: each one now carries a quote, and
 * eight of them overran the reply budget and came back as truncated JSON.
 */
const MAX_FACTS = 5
const MAX_TLDR = 4

/** As in ai/index.ts: measured, used only to scale the bar. */
const EXPECTED_CHARS = 2200

/** Loose comparison, so a quote is not rejected over whitespace or case. */
function normalise(t: string): string {
  return t
    .toLowerCase()
    .replace(/[\s\u00a0]+/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    // Fold subscripts and superscripts: a PDF writes "vitamin D3" as "D₃",
    // and a quote should not be rejected because the model typed the digit.
    .replace(/[\u2080-\u2089]/g, (c) => String(c.charCodeAt(0) - 0x2080))
    .replace(/[\u2070\u00b9\u00b2\u00b3\u2074-\u2079]/g, (c) =>
      ({ '\u2070': '0', '\u00b9': '1', '\u00b2': '2', '\u00b3': '3' })[c] ??
      String(c.charCodeAt(0) - 0x2070)
    )
    .trim()
}

/** The nutrient's name without any parenthetical aside, for matching. */
function nutrientCore(nutrient: string): string {
  return normalise(nutrient.replace(/\([^)]*\)/g, ' '))
}

const SYSTEM = [
  'You read a nutrition or medical article and pull out what it says about',
  'food and blood markers. You are building a reference card, not giving advice.',
  '',
  'Rules:',
  '1. Only record what the text actually says. If it does not link a nutrient',
  '   to a blood marker, record no fact for that marker.',
  '2. `nutrient` is a SUBSTANCE IN THE FOOD: a vitamin, a mineral, a fat, a',
  '   protein. It is never a blood marker and never a hormone the body makes.',
  '   "vitamin D" and "magnesium" are nutrients. "TSH" and "cortisol" are not.',
  '3. START WITH THE OBVIOUS ONE. If the text is mainly about a nutrient that',
  '   is itself one of the markers below, your FIRST fact must link that',
  '   nutrient to its own marker. An article about the vitamin D in salmon is',
  '   first and foremost about the Vitamin D marker (id D), whatever else',
  '   vitamin D goes on to affect. Record the subject before the consequences.',
  '4. `foods` must be foods the text names. Do not add foods from your own',
  '   knowledge, even if they are correct.',
  '5. `helpsWhen` is the PROBLEM this fact helps with, not the direction the',
  '   nutrient pushes the marker. Worked example: magnesium-rich food helps a',
  '   person whose magnesium is DEFICIENT, so helpsWhen is "marker_is_too_low".',
  '   Cutting salt helps a person whose sodium is TOO HIGH, so that one is',
  '   "marker_is_too_high". Ask yourself: whose result is wrong, and which way?',
  '6. THE TEXT MUST LINK THEM ITSELF. We look for a single sentence naming',
  '   both the nutrient and the marker, and throw the fact away when there is',
  '   none. So do not record a marker the article never discusses, however',
  '   sure you are of the biology. If the page is about vitamin D and never',
  '   says "cortisol", there is no cortisol fact to record.',
  '7. `rationale` is one short clause, drawn from the text.',
  '8. The tldr bullets summarise the text in the author\'s terms.',
  '9. Recording nothing is a valid answer for an article that is off-topic.'
].join('\n')

function schemaFor(markers: Marker[]): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      tldr: { type: 'array', maxItems: MAX_TLDR, items: { type: 'string' } },
      facts: {
        type: 'array',
        maxItems: MAX_FACTS,
        items: {
          type: 'object',
          properties: {
            markerId: { type: 'string', enum: markers.map((m) => m.id) },
            // Named for what it means. As plain `direction: low | high` the
            // model inverted it on nearly every fact, reading it as "which way
            // this nutrient moves the marker" and filing magnesium-rich food
            // under magnesium-too-HIGH. That is not a wording nit: stored the
            // wrong way round it would tell someone with too much of something
            // to eat more of it.
            helpsWhen: { type: 'string', enum: ['marker_is_too_low', 'marker_is_too_high'] },
            nutrient: { type: 'string' },
            foods: { type: 'array', maxItems: 6, items: { type: 'string' } },
            rationale: { type: 'string' }
          },
          // No `evidence` field. Asked to copy a phrase word for word, MedPsy
          // paraphrased instead, and every fact then failed the on-page check
          // including the correct one. So the app finds the sentence itself
          // (see `supportingSentence`), which is both more reliable and
          // genuinely verbatim by construction.
          required: ['markerId', 'helpsWhen', 'nutrient', 'foods', 'rationale'],
          additionalProperties: false
        }
      }
    },
    required: ['tldr', 'facts'],
    additionalProperties: false
  }
}

/** The marker list the model is choosing from, as names it can recognise. */
function markerMenu(markers: Marker[]): string {
  return markers.map((m) => `${m.id} = ${m.name} (${m.descriptor})`).join('\n')
}

interface RawFact {
  markerId: string
  helpsWhen: string
  nutrient: string
  foods: string[]
  rationale: string
}

/**
 * Finds one sentence in the source that mentions BOTH the nutrient and the
 * marker, so the quote beside a proposed fact is real text from the page and
 * actually connects the two things the fact claims are connected.
 *
 * Requiring both is what stops the marker being sprayed. Asked to read a page
 * about vitamin D, MedPsy will happily file the same nutrient against
 * cortisol, TSH and magnesium, markers the document never mentions. A
 * nutrient-only check passes all of those, because "vitamin D" is on every
 * other line. A sentence naming both passes only the links the author made.
 *
 * Returns null when no such sentence exists, and the fact is dropped.
 */
function supportingSentence(
  text: string,
  nutrient: string,
  markerName: string,
  foods: string[]
): string | null {
  const nut = nutrientCore(nutrient)
  const mark = nutrientCore(markerName)
  if (nut.length < 3 || mark.length < 2) return null

  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 30 && x.length <= 320)

  const both = sentences.filter((x) => {
    const n = normalise(x)
    return n.includes(nut) && n.includes(mark)
  })
  if (both.length === 0) return null

  // Of those, prefer one that also names a food, since that is the sentence a
  // reader would want to see.
  const foodCores = foods.map((f) => normalise(f)).filter((f) => f.length >= 3)
  const withFood = both.find((x) => {
    const n = normalise(x)
    return foodCores.some((f) => n.includes(f))
  })
  return withFood ?? both[0]
}

async function extract(
  title: string,
  text: string,
  markers: Marker[],
  onProgress?: (p: DownloadProgress) => void,
  onJob?: (label: string, percent: number | null) => void
): Promise<{ tldr: string[]; facts: Omit<GroundedFact, 'origin' | 'sourceId' | 'sourceTitle'>[] }> {
  const user = [
    `Source title: ${title}`,
    '',
    'Blood markers you may reference, by id:',
    markerMenu(markers),
    '',
    'The text:',
    '---',
    text,
    '---',
    `Give up to ${MAX_TLDR} tldr bullets and up to ${MAX_FACTS} facts.`
  ].join('\n')

  onJob?.(isResident() ? 'Reading it on-device' : `Loading ${modelInfo.label}`, null)
  const raw = await generate(
    [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: user }
    ],
    schemaFor(markers),
    'food_source',
    onProgress,
    (chars) => onJob?.('Pulling out the facts', Math.min(95, (chars / EXPECTED_CHARS) * 100))
  )

  let parsed: { tldr?: string[]; facts?: RawFact[] }
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('The model could not summarise that source. Try regenerating.')
  }

  const known = new Set(markers.map((m) => m.id))

  // The grounding guard for sources: a fact only survives if the page really
  // discusses the nutrient it names, and the sentence proving that is pulled
  // out of the page rather than supplied by the model. Same idea as the
  // food-name check on recommendations: the model may choose and summarise,
  // but a claim has to be traceable to text somebody else wrote.
  const dropped: string[] = []

  const facts = (parsed.facts ?? [])
    // The grammar should have handled these; checking anyway costs nothing
    // and means a schema change can never quietly widen what gets stored.
    .filter((f) => known.has(f.markerId))
    .filter((f) => f.helpsWhen === 'marker_is_too_low' || f.helpsWhen === 'marker_is_too_high')
    .filter((f) => Array.isArray(f.foods) && f.foods.length > 0)
    .map((f) => {
      const markerName = markers.find((m) => m.id === f.markerId)?.name ?? f.markerId
      const quote = supportingSentence(text, f.nutrient ?? '', markerName, f.foods ?? [])
      if (!quote) {
        dropped.push(`${f.markerId}: no sentence links ${f.nutrient} to ${markerName}`)
        return null
      }
      return {
        markerId: f.markerId,
        direction: (f.helpsWhen === 'marker_is_too_low' ? 'low' : 'high') as Direction,
        nutrient: f.nutrient.trim(),
        foods: f.foods.map((x) => x.trim()).filter(Boolean).slice(0, 6),
        evidence: quote,
        rationale: (f.rationale ?? '').trim()
      }
    })
    .filter((f): f is NonNullable<typeof f> => f !== null)
    .filter((f) => f.nutrient.length > 0)

  if (dropped.length > 0) console.log(`[foodlib] dropped ${dropped.length}: ${dropped.join('; ')}`)

  return { tldr: (parsed.tldr ?? []).map((t) => t.trim()).filter(Boolean).slice(0, MAX_TLDR), facts }
}

/** A source row created immediately, so the UI can show "Linking…" at once. */
export function pendingSource(kind: 'url' | 'pdf', title: string, domain: string): FoodSource {
  return {
    id: randomUUID(),
    kind,
    title,
    domain,
    addedAt: new Date().toISOString(),
    state: 'processing',
    tldr: [],
    facts: []
  }
}

/**
 * Reads a source and returns the patch to apply.
 *
 * Never throws: a source that fails is kept in the list with `state:
 * 'failed'` and the reason, because silently dropping something the user
 * added is worse than showing why it did not work.
 */
export async function processSource(
  source: FoodSource,
  input: { url?: string; filePath?: string },
  markers: Marker[],
  onProgress?: (p: DownloadProgress) => void,
  onJob?: (label: string, percent: number | null) => void
): Promise<Partial<FoodSource>> {
  try {
    onJob?.(source.kind === 'url' ? 'Fetching the page' : 'Reading the PDF', null)
    const read =
      source.kind === 'url'
        ? await fetchPage(input.url ?? '')
        : await readPdf(input.filePath ?? '')

    const { tldr, facts } = await extract(read.title, read.text, markers, onProgress, onJob)

    if (facts.length === 0) {
      return {
        title: read.title,
        domain: read.domain,
        state: 'linked',
        tldr,
        facts: [],
        error: 'Read it, but found nothing that links a food to one of the 56 markers.'
      }
    }

    return {
      title: read.title,
      domain: read.domain,
      // Read, not trusted. Every fact starts unaccepted and influences
      // nothing until a person says yes.
      state: 'review',
      tldr,
      facts: facts.map((f) => ({
        ...f,
        origin: 'user-source' as const,
        sourceId: source.id,
        sourceTitle: read.title,
        accepted: false
      })),
      error: undefined
    }
  } catch (err) {
    return { state: 'failed', error: (err as Error).message }
  }
}

/** Builds the graph the Food Library draws, from what was actually extracted. */
export function contextGraph(sources: FoodSource[], markers: Marker[], selectedId?: string): ContextGraph {
  // The map shows what is actually in use, so a fact awaiting review is not
  // drawn as though it were already informing anything.
  const nutrientList: string[] = []
  const markerList: string[] = []
  const sourceToNutrient: [number, number][] = []
  const nutrientToMarker: [number, number][] = []
  const nameOf = new Map(markers.map((m) => [m.id, m.name]))

  sources.forEach((source, si) => {
    for (const fact of source.facts.filter((f) => f.accepted === true)) {
      let ni = nutrientList.indexOf(fact.nutrient)
      if (ni === -1) {
        nutrientList.push(fact.nutrient)
        ni = nutrientList.length - 1
      }
      let mi = markerList.indexOf(fact.markerId)
      if (mi === -1) {
        markerList.push(fact.markerId)
        mi = markerList.length - 1
      }
      if (!sourceToNutrient.some(([a, b]) => a === si && b === ni)) sourceToNutrient.push([si, ni])
      if (!nutrientToMarker.some(([a, b]) => a === ni && b === mi)) nutrientToMarker.push([ni, mi])
    }
  })

  return {
    sources: sources.map((s) => ({
      id: s.id,
      label: s.title,
      state: s.state,
      selected: s.id === selectedId
    })),
    nutrients: nutrientList.map((label) => ({ label })),
    markers: markerList.map((id) => ({ id, label: nameOf.get(id) ?? id })),
    sourceToNutrient,
    nutrientToMarker
  }
}
