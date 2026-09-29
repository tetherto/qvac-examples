// ============================================================
// Category scores: our own formula, and deliberately a simple one.
//
// The whole of the maths is in `subScore` and `scoreCategory` below, and
// the Category Detail screen prints it back to the user term by term. If
// you cannot explain a health score, it should not be on the screen.
//
// Weights are EQUAL across a category's tested markers. The design mocked
// varied weights (Ferritin 30%, Hemoglobin 25%, ...), but picking those
// numbers would mean inventing clinical judgement, so we do not: every
// scored marker carries 1/N and the explainer says so.
// ============================================================

import type {
  Band,
  Category,
  CategoryScore,
  Marker,
  Range,
  ScoreTerm,
  ScoreTrendPoint,
  Status
} from './types.js'
import { statusFor } from './status.js'

/**
 * Band thresholds, taken from the design's gauge (`band()` in the canvas
 * script): under 50 Needs work, under 70 Fair, under 85 Good, else Optimal.
 */
export const BANDS: { max: number; band: Band }[] = [
  { max: 50, band: 'Needs work' },
  { max: 70, band: 'Fair' },
  { max: 85, band: 'Good' },
  { max: Infinity, band: 'Optimal' }
]

export function bandFor(score: number): Band {
  return BANDS.find((b) => score < b.max)!.band
}

/** The design's three status colours, so gauges and dots never disagree. */
export const BAND_COLOR: Record<Band, string> = {
  'Needs work': '#F26D6D',
  Fair: '#E8C34A',
  Good: '#16E3C1',
  Optimal: '#16E3C1'
}

/**
 * IN RANGE gives 70 at either bound rising to 100 dead centre. So a marker
 * scraping the edge of normal is "Fair", not "Optimal", which is the
 * behaviour you want from a health score, and it is why the gauge still
 * moves when every marker is technically in range.
 *
 * OUT OF RANGE falls away from 70 in proportion to how far past the bound
 * the value sits, measured against the bound itself: 27% below the floor
 * scores 70 x (1 - 0.27) = 51. Twice the bound or worse scores 0.
 *
 * Measuring against the bound rather than the range width matters. Ferritin's
 * range is 20-345, so a value of 12 is only 2% of the width below the floor
 * but 40% below the floor itself, and 40% is the number a person cares
 * about. When the violated bound is 0 there is nothing to be a fraction of,
 * so the range width stands in.
 */
export function subScore(value: number | null, range: Range): number | null {
  if (value == null || !Number.isFinite(value)) return null

  const span = range.high - range.low
  const inRange = value >= range.low && value <= range.high

  if (inRange) {
    if (span <= 0) return 100
    const t = (value - range.low) / span // 0 at the floor, 1 at the ceiling
    const centred = 1 - 2 * Math.abs(t - 0.5) // 1 dead centre, 0 at a bound
    return round1(70 + 30 * centred)
  }

  const bound = value < range.low ? range.low : range.high
  const scale = Math.abs(bound) > 0 ? Math.abs(bound) : Math.abs(span) || 1
  const overshoot = Math.min(1, Math.abs(value - bound) / scale)
  return round1(70 * (1 - overshoot))
}

/** The sentence the explainer shows above the term list. */
export const FORMULA_TEXT =
  'Each tested member marker earns a 0-100 sub-score from where its latest value sits: ' +
  '70 at the edge of the normal range rising to 100 dead centre, and falling away from 70 ' +
  'in proportion to how far past the bound it sits when it is out of range. The category ' +
  'score is the plain average of those sub-scores. Every tested marker counts equally. ' +
  'Markers never tested are left out rather than counted as zero.'

/**
 * Scores one category on one set of latest values.
 *
 * `rangeFor` supplies the effective range per marker, so a personalized
 * profile changes scores as well as dots, the two can never drift apart.
 * Untested markers are excluded, not zeroed: scoring an absent test as a
 * failure would punish you for not having paid for it.
 */
export function scoreCategory(
  category: Category,
  markersById: Map<string, Marker>,
  latest: Map<string, number | null>,
  rangeFor: (marker: Marker) => Range
): CategoryScore {
  const terms: ScoreTerm[] = []

  for (const id of category.markers) {
    const marker = markersById.get(id)
    if (!marker) continue // categories.json naming an unknown marker is a data bug, not a crash
    const range = rangeFor(marker)
    const value = latest.get(id) ?? null
    terms.push({
      markerId: id,
      name: marker.name,
      value,
      range,
      status: statusFor(value, range),
      sub: subScore(value, range),
      weight: 0 // filled in below, once we know how many are tested
    })
  }

  const scored = terms.filter((t) => t.sub != null)
  const weight = scored.length > 0 ? 1 / scored.length : 0
  for (const t of terms) t.weight = t.sub == null ? 0 : weight

  const score =
    scored.length === 0
      ? null
      : round1(scored.reduce((sum, t) => sum + (t.sub as number), 0) / scored.length)

  return {
    category: category.name,
    score,
    band: score == null ? null : bandFor(score),
    terms,
    inRange: terms.filter((t) => t.status === 'green' || t.status === 'yellow').length,
    tested: scored.length,
    total: terms.length
  }
}

/**
 * The same score computed on every test date, for the trend chart and the
 * card sparklines. A date where nothing in the category was tested yields
 * null rather than a dip to zero.
 */
export function scoreTrend(
  category: Category,
  markersById: Map<string, Marker>,
  dates: string[],
  valueAt: (markerId: string, date: string) => number | null,
  rangeFor: (marker: Marker) => Range
): ScoreTrendPoint[] {
  return dates.map((date) => {
    const latest = new Map<string, number | null>()
    for (const id of category.markers) latest.set(id, valueAt(id, date))
    return { date, score: scoreCategory(category, markersById, latest, rangeFor).score }
  })
}

/** Counts for the table's group headers. */
export function groupOf(status: Status): 'unoptimized' | 'optimized' | 'never' {
  if (status === 'grey') return 'never'
  return status === 'green' ? 'optimized' : 'unoptimized'
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
