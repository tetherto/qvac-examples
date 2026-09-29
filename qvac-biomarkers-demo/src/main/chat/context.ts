// ============================================================
// chat/context.ts: the facts the model is allowed to answer from.
//
// Built entirely in code from the store. The model is never asked to read a
// file, do arithmetic, or decide what is out of range: it gets a finished
// briefing and its whole job is to talk about it.
//
// THE COMPLETENESS RULE
//
// The out-of-range list must be COMPLETE, never a sample. That is not
// tidiness, it is a measured failure. Given "24 of 54 markers are outside
// range" as a sentence plus seven example markers, MedPsy 4B answered "how
// many of my markers are out of range" with "5 markers are out of range".
// It counted the ones it could see and ignored the total it had been told.
// Given all twelve instead, it answered "12" three times out of three.
//
// Which is the model's own weakest dimension showing up exactly where the
// HealthBench numbers say it will (Health Data Tasks 60.7). The fix is not
// a better prompt, it is not leaving anything to count.
// ============================================================

import type { CategoryScore, MarkerView, Profile } from '../../shared/types.js'
import { normalizeNumber } from './guard.js'

/**
 * Above this many out-of-range markers the list is trimmed to the worst
 * ones, and the briefing SAYS it was trimmed. A panel that wide is unusual,
 * but a context that silently drops rows would put us straight back into the
 * miscounting the completeness rule exists to prevent.
 */
const MAX_LISTED = 30

export interface ChatContext {
  /** The briefing, verbatim, as it goes into the system turn. */
  text: string
  /**
   * Every number that appears in it, so the guard can tell a value the model
   * is quoting back from an amount it is prescribing.
   */
  cited: Set<string>
}

export function buildContext(
  views: MarkerView[],
  scores: CategoryScore[],
  profile: Profile,
  lastTestDate: string | null
): ChatContext {
  const tested = views.filter((v) => v.latest != null)
  const off = tested
    .filter((v) => v.status === 'red' || v.status === 'yellow')
    .sort((a, b) => deviation(b) - deviation(a))
  const listed = off.slice(0, MAX_LISTED)

  const lines: string[] = []

  const who = [
    profile.ageGroup ? `age ${profile.ageGroup}` : null,
    profile.gender ?? null
  ].filter(Boolean)
  if (who.length > 0) lines.push(`The person is ${who.join(', ')}.`)

  lines.push(
    `They have had ${tested.length} markers tested` +
      (lastTestDate ? `, most recently on ${lastTestDate}` : '') +
      `. ${off.length} of those ${off.length === 1 ? 'is' : 'are'} outside its reference range.`
  )

  if (listed.length > 0) {
    lines.push(
      off.length > listed.length
        ? `The ${listed.length} furthest outside, worst first (${off.length - listed.length} milder ones are not listed):`
        : `Here are all ${listed.length}, worst first. There are no others:`
    )
    for (const v of listed) lines.push(`- ${markerLine(v)}`)
  } else {
    lines.push('Every tested marker is inside its reference range.')
  }

  // In range but heading out. Nothing else in the app surfaces this, and it
  // is the one thing a person cannot read off a single result sheet.
  const drifting = tested.filter(
    (v) => v.status === 'green' && v.trend.improving === false && v.trend.direction !== 'flat'
  )
  if (drifting.length > 0) {
    lines.push(`Inside range but moving towards the edge: ${drifting.map((v) => v.marker.name).join(', ')}.`)
  }

  const scored = scores.filter((s) => s.score != null)
  if (scored.length > 0) {
    lines.push(
      'Category scores out of 100, computed by the app, not by you: ' +
        scored.map((s) => `${s.category} ${s.score}`).join(', ') + '.'
    )
  }

  const untested = views.length - tested.length
  if (untested > 0) {
    lines.push(`${untested} markers in the app's library have never been tested for this person.`)
  }

  const text = lines.join('\n')
  return { text, cited: numbersIn(text) }
}

/** "Ferritin 9 ng/mL, range 20-345, LOW, falling since Jun 2023." */
function markerLine(v: MarkerView): string {
  const bits = [
    `${v.marker.name} ${v.latest} ${v.marker.unit}`,
    `range ${v.range.low}-${v.range.high}`,
    (v.latest as number) < v.range.low ? 'LOW' : 'HIGH',
    `${Math.round(deviation(v) * 100)}% past that bound`
  ]
  if (v.trend.sentence) bits.push(v.trend.sentence)
  if (v.personalized) bits.push('range adjusted for their profile')
  return bits.join(', ')
}

/**
 * How far past the violated bound, as a fraction of the bound. The same
 * measure `subScore` uses, so the order here matches the colours on screen.
 */
function deviation(v: MarkerView): number {
  if (v.latest == null) return 0
  const bound = v.latest < v.range.low ? v.range.low : v.range.high
  if (v.latest >= v.range.low && v.latest <= v.range.high) return 0
  const scale = Math.abs(bound) > 0 ? Math.abs(bound) : Math.abs(v.range.high - v.range.low) || 1
  return Math.abs(v.latest - bound) / scale
}

function numbersIn(text: string): Set<string> {
  const out = new Set<string>()
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) out.add(normalizeNumber(m[0]))
  return out
}
