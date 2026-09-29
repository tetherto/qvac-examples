// ============================================================
// Status and trend: the one place a value meets its range.
//
// Nothing here reads an imported file. Whether a marker is in range,
// borderline or out of range is DERIVED, every time, from the value and
// the effective (baseline or personalized) range. A CSV column claiming
// "status" or "optimized" is ignored by the importer on purpose: the whole
// point of the app is that it does this arithmetic itself.
// ============================================================

import type { Range, Status, Trend } from './types.js'

/**
 * How close to a bound still counts as "borderline", as a fraction of the
 * range width.
 *
 * 10% matches the design's own chart: its `pointColor` paints a dot yellow
 * when the value sits in the outer tenth of the band. Table dots and chart
 * dots have to agree or the app looks broken, so there is exactly one
 * constant and both read it.
 */
export const BORDERLINE_FRACTION = 0.1

/**
 * green:  comfortably inside the range
 * yellow: inside, but within BORDERLINE_FRACTION of a bound
 * red:    outside the range
 * grey:   never tested / unreadable
 */
export function statusFor(value: number | null | undefined, range: Range): Status {
  if (value == null || !Number.isFinite(value)) return 'grey'
  if (value < range.low || value > range.high) return 'red'

  const span = range.high - range.low
  // A zero-width range has no interior, so "inside" is the whole story.
  if (span <= 0) return 'green'

  const margin = span * BORDERLINE_FRACTION
  const nearLow = value - range.low < margin
  const nearHigh = range.high - value < margin
  return nearLow || nearHigh ? 'yellow' : 'green'
}

/** Which way a marker is off, or null when it is inside its range. */
export function directionFor(value: number | null, range: Range): 'low' | 'high' | null {
  if (value == null || !Number.isFinite(value)) return null
  if (value < range.low) return 'low'
  if (value > range.high) return 'high'
  return null
}

/**
 * The direction the recommendation engine should work on.
 *
 * A borderline-but-inside value has no `directionFor`, yet it is exactly the
 * case the app wants advice for. So a yellow marker is treated as leaning
 * towards whichever bound it is hugging.
 */
export function advisoryDirection(value: number | null, range: Range): 'low' | 'high' | null {
  const hard = directionFor(value, range)
  if (hard) return hard
  if (value == null || statusFor(value, range) !== 'yellow') return null
  const span = range.high - range.low
  if (span <= 0) return null
  return value - range.low < span * BORDERLINE_FRACTION ? 'low' : 'high'
}

// ---- Trend ---------------------------------------------------------------

/**
 * What counts as "no real movement", on two scales at once.
 *
 * The range width alone is not enough, and ferritin is the proof. Its
 * reference range is 20 to 345, so 3% of the width is 9.75 ng/mL, and the
 * sample's ferritin fell 18 to 9: half the marker gone, and under a
 * width-only rule that reads as "held steady". The value itself is the second
 * scale, and the threshold is the SMALLER of the two, so a marker sitting far
 * below a wide range is judged against where it actually is.
 *
 * This is the same mistake `subScore` avoids by measuring against the violated
 * bound rather than the range width. A wide range makes a low value's movement
 * look like rounding error on both.
 *
 * 10% of the value is the floor because a routine assay's own variation runs a
 * few per cent: under a tenth, "it moved" is not a claim worth making. Above
 * it, the sentence is handed to the model as truth, so it had better be true.
 */
const FLAT_FRACTION = 0.03
const FLAT_RELATIVE = 0.1

/**
 * Reads the series and says what it is doing, in code.
 *
 * The model is NEVER asked to work out the direction of travel. It is told.
 * A 4B model given six numbers and asked "is this rising?" gets it wrong
 * often enough to matter, and it is arithmetic, so code should do it.
 *
 * `dates` and `values` are parallel and oldest-first; `values[i]` is null
 * where that date was not tested.
 */
export function trendFor(
  values: (number | null)[],
  dates: string[],
  range: Range,
  markerName: string
): Trend {
  const points = values
    .map((v, i) => ({ v, date: dates[i] }))
    .filter((p): p is { v: number; date: string } => p.v != null && Number.isFinite(p.v))

  if (points.length === 0) {
    return {
      direction: 'unknown',
      since: null,
      improving: null,
      sentence: `${markerName} has never been tested.`
    }
  }

  const latest = points[points.length - 1]
  const status = statusFor(latest.v, range)
  const where =
    status === 'red'
      ? latest.v < range.low
        ? 'below the normal range'
        : 'above the normal range'
      : status === 'yellow'
        ? 'close to the edge of the normal range'
        : 'inside the normal range'

  if (points.length === 1) {
    return {
      direction: 'unknown',
      since: latest.date,
      improving: null,
      sentence: `${markerName} sits ${where}, from a single test on ${latest.date}. One reading is a point, not a trend.`
    }
  }

  const span = range.high - range.low || Math.abs(latest.v) || 1

  // Walk backwards while each step keeps moving the same way. That start
  // date is the honest answer to "since when", rather than the first date
  // in the file.
  const step = (a: number, b: number): 'rising' | 'falling' | 'flat' => {
    const flat = Math.min(span * FLAT_FRACTION, Math.max(Math.abs(a), Math.abs(b)) * FLAT_RELATIVE)
    return b - a > flat ? 'rising' : a - b > flat ? 'falling' : 'flat'
  }

  const lastStep = step(points[points.length - 2].v, latest.v)
  let startIndex = points.length - 2
  while (startIndex > 0 && step(points[startIndex - 1].v, points[startIndex].v) === lastStep) {
    startIndex--
  }
  const since = points[startIndex].date

  if (lastStep === 'flat') {
    return {
      direction: 'flat',
      since,
      improving: null,
      sentence: `${markerName} is ${where} and has held steady since ${since}.`
    }
  }

  // "Improving" means heading towards the range, not simply going up.
  const off = directionFor(latest.v, range)
  const improving =
    off === 'low' ? lastStep === 'rising' : off === 'high' ? lastStep === 'falling' : null

  const movement = lastStep === 'rising' ? 'rising' : 'falling'
  const tail =
    improving === true
      ? `, and moving back towards the range`
      : improving === false
        ? `, and moving further out of range`
        : ''

  return {
    direction: lastStep,
    since,
    improving,
    sentence: `${markerName} is ${where} and has been ${movement} since ${since}${tail}.`
  }
}
