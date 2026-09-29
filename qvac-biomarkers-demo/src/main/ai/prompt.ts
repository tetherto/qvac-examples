// ============================================================
// Prompt construction, kept separate so you can read it without the
// plumbing around it.
//
// The shape of the ask:
//   system  the rules, including the hard one about facts
//   user    this marker, its value, its range, the trend sentence WE
//           computed, the neighbouring markers as light context, and the
//           numbered list of facts it may use
//
// Two things the model is never asked to do: work out the direction of
// travel (code does that: see shared/status.ts) and name a food (the
// grammar limits it to an enum drawn from the list below).
// ============================================================

import type { GroundedFact, MarkerView } from '../../shared/types.js'
import type { Message } from '../qvac.js'

const SYSTEM = [
  'You help someone read their own blood-test results.',
  '',
  'Rules, in order of importance:',
  '1. USE ONLY THE NUMBERED FACTS PROVIDED. Never mention a food, nutrient,',
  '   supplement or claim that is not in that list. If the list is short, give',
  '   fewer recommendations. Fewer is correct; inventing is not.',
  '2. Write in plain, calm English. No hype, no diagnosis, no dosages.',
  '3. The interpretation is ONE sentence that BUILDS ON the trend we give you.',
  '   Do not recompute the trend and do not contradict it, but do not repeat',
  '   our sentence back either. The reader has already seen it. Say what it',
  '   means for them.',
  '4. Each recommendation names exactly one food from the list and the nutrient',
  '   it came from, in one short sentence.',
  '5. Never tell anyone to stop or start a medicine.',
  ''
].join('\n')

/** Renders the facts as a numbered list, so the model can point at them. */
function factList(facts: GroundedFact[]): string {
  return facts
    .map((f, i) => {
      const provenance = f.origin === 'vetted' ? 'built-in' : `from your source "${f.sourceTitle}"`
      return `${i + 1}. nutrient: ${f.nutrient}\n   foods: ${f.foods.join('; ')}\n   why: ${f.rationale}\n   source: ${provenance}`
    })
    .join('\n')
}

/** Same-category markers, so the model can say something joined-up. */
function neighbourLines(neighbours: MarkerView[]): string {
  if (neighbours.length === 0) return 'none tested yet'
  return neighbours
    .slice(0, 6)
    .map(
      (n) =>
        `- ${n.marker.name}: ${n.latest ?? 'not tested'} ${n.marker.unit} ` +
        `(range ${n.range.low}-${n.range.high}, ${n.status === 'green' ? 'in range' : n.status === 'yellow' ? 'borderline' : n.status === 'red' ? 'out of range' : 'never tested'})`
    )
    .join('\n')
}

export function markerPrompt(
  view: MarkerView,
  direction: 'low' | 'high',
  facts: GroundedFact[],
  neighbours: MarkerView[],
  maxPicks: number
): Message[] {
  const m = view.marker
  const user = [
    `Marker: ${m.name} (${m.descriptor})`,
    `Latest value: ${view.latest} ${m.unit} on ${view.latestDate}`,
    `Normal range: ${m.range.low}-${m.range.high} ${m.unit}${view.personalized ? ' (personalized for this person)' : ''}`,
    `This value is ${direction === 'low' ? 'too low or close to the low end' : 'too high or close to the high end'}.`,
    '',
    `Trend, already computed. Take it as true, and write something that adds to`,
    `it rather than repeating it:`,
    `"${view.trend.sentence}"`,
    '',
    `Other markers in the same category, for context only:`,
    neighbourLines(neighbours),
    '',
    `Facts you may use, and nothing else:`,
    factList(facts),
    '',
    `Write one interpretation sentence, then up to ${maxPicks} recommendations.`,
    `Order them by how much they would help. Prefer food over lifestyle.`
  ].join('\n')

  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: user }
  ]
}

export function categoryPrompt(
  categoryName: string,
  description: string,
  score: number,
  band: string,
  offRange: MarkerView[],
  facts: GroundedFact[],
  maxPicks: number
): Message[] {
  const user = [
    `Category: ${categoryName}`,
    `What it covers: ${description}`,
    `Score: ${score} out of 100 (${band})`,
    '',
    `The markers dragging this score down:`,
    offRange
      .map(
        (v) =>
          `- ${v.marker.name}: ${v.latest} ${v.marker.unit} against ${v.range.low}-${v.range.high}. ${v.trend.sentence}`
      )
      .join('\n') || 'none, every tested marker is in range',
    '',
    `Facts you may use, and nothing else:`,
    factList(facts),
    '',
    `Write one interpretation sentence about the category as a whole, then up to`,
    `${maxPicks} recommendations that would lift the score. Order them by impact.`
  ].join('\n')

  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: user }
  ]
}
