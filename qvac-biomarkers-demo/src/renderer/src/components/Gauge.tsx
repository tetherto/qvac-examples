// ============================================================
// The score gauge, the sparkline and the trend chart.
//
// All three are ported from the design's own canvas script rather than
// re-invented, down to the 225°-to-495° sweep and the 8%-of-size stroke,
// so the shipped app draws the same shapes the design did. Plain SVG, no
// charting library: three small functions of numbers to path strings.
// ============================================================

import type { Band, Range, Status } from '@shared/types.js'
import { bandFor, BAND_COLOR } from '@shared/scoring.js'
import { BORDERLINE_FRACTION } from '@shared/status.js'

const STATUS_COLOR: Record<Status, string> = {
  green: '#16E3C1',
  yellow: '#E8C34A',
  red: '#F26D6D',
  grey: '#7E8E88'
}

/** An arc from a0 to a1 degrees, clockwise, 0° at twelve o'clock. */
function arc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p = (deg: number): [number, number] => {
    const a = ((deg - 90) * Math.PI) / 180
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  }
  const s = p(a0)
  const e = p(a1)
  const large = a1 - a0 > 180 ? 1 : 0
  return `M ${s[0].toFixed(2)} ${s[1].toFixed(2)} A ${r} ${r} 0 ${large} 1 ${e[0].toFixed(2)} ${e[1].toFixed(2)}`
}

export function bandColorFor(score: number): string {
  return BAND_COLOR[bandFor(score)]
}

export function Gauge({
  score,
  size = 132,
  band
}: {
  score: number | null
  size?: number
  band?: Band | null
}): React.JSX.Element {
  const cx = size / 2
  const cy = size / 2
  const r = size * 0.4
  const sw = size * 0.07

  if (score == null) {
    return (
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="No score yet">
        <path d={arc(cx, cy, r, 225, 495)} fill="none" stroke="rgba(160,178,172,0.14)" strokeWidth={sw} strokeLinecap="round" />
        <text
          x={cx}
          y={cy + size * 0.04}
          textAnchor="middle"
          fontFamily="Geist, system-ui, sans-serif"
          fontWeight={700}
          fontSize={size * 0.22}
          fill="#4A544F"
        >
          -
        </text>
        <text
          x={cx}
          y={cy + size * 0.21}
          textAnchor="middle"
          fontFamily="Geist, system-ui, sans-serif"
          fontWeight={600}
          fontSize={size * 0.085}
          fill="#7E8E88"
          letterSpacing="1.5px"
        >
          NOT TESTED
        </text>
      </svg>
    )
  }

  const label = band ?? bandFor(score)
  const color = BAND_COLOR[label]

  // The band label sits INSIDE the arc, and "NEEDS WORK" is twice the length of
  // "FAIR": at the design's tracking it ran into the arc on both sides.
  //
  // The space available is not a guess. The label's baseline sits at
  // `cy + size * 0.21`, and the arc's inner edge is a circle of radius
  // `r - sw / 2`, so the clear width at that height is the chord of that
  // circle. Shrink the type to fit it, with a tenth held back as air.
  const labelY = size * 0.21
  const inner = r - sw / 2
  const halfChord = Math.sqrt(Math.max(0, inner * inner - labelY * labelY))
  const labelMax = halfChord * 2 * 0.9
  const labelBase = size * 0.085
  const labelTracking = 1.5
  // Geist 600 runs about 0.58em per character at these sizes.
  const labelWidth = label.length * labelBase * 0.58 + (label.length - 1) * labelTracking
  const labelFit = labelWidth > labelMax ? labelMax / labelWidth : 1
  const labelSize = labelBase * labelFit
  const end = 225 + 270 * (score / 100)

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      role="img"
      aria-label={`Score ${score} out of 100, ${label}`}
    >
      <path d={arc(cx, cy, r, 225, 495)} fill="none" stroke="rgba(160,178,172,0.14)" strokeWidth={sw} strokeLinecap="round" />
      {/* A soft wide pass under the arc gives it the design's glow. */}
      <path d={arc(cx, cy, r, 225, end)} fill="none" stroke={color} strokeWidth={sw + 7} strokeLinecap="round" opacity={0.16} />
      <path d={arc(cx, cy, r, 225, end)} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <text
        x={cx}
        y={cy + size * 0.04}
        textAnchor="middle"
        fontFamily="Geist, system-ui, sans-serif"
        fontWeight={700}
        fontSize={size * 0.28}
        fill="#ECF1EE"
      >
        {Math.round(score)}
      </text>
      <text
        x={cx}
        y={cy + size * 0.21}
        textAnchor="middle"
        fontFamily="Geist, system-ui, sans-serif"
        fontWeight={600}
        fontSize={labelSize}
        fill={color}
        letterSpacing={`${(labelTracking * labelFit).toFixed(2)}px`}
      >
        {label.toUpperCase()}
      </text>
    </svg>
  )
}

export function Sparkline({
  values,
  color
}: {
  values: (number | null)[]
  color: string
}): React.JSX.Element | null {
  const points = values.filter((v): v is number => v != null)
  if (points.length < 2) return null

  const w = 90
  const h = 28
  const pad = 3
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const X = (i: number): number => pad + (w - 2 * pad) * (i / (points.length - 1))
  const Y = (v: number): number => pad + (h - 2 * pad) * (1 - (v - min) / span)
  const d = points.map((v, i) => `${i ? 'L' : 'M'} ${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ')
  const last = points.length - 1

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
      <circle cx={X(last)} cy={Y(points[last])} r={2.6} fill={color} />
    </svg>
  )
}

/** The dot colour rule from the design: outer tenth of the band is yellow. */
function pointColor(v: number, range: Range): string {
  if (v < range.low || v > range.high) return STATUS_COLOR.red
  const span = range.high - range.low
  if (span <= 0) return STATUS_COLOR.green
  const f = (v - range.low) / span
  return f < BORDERLINE_FRACTION || f > 1 - BORDERLINE_FRACTION
    ? STATUS_COLOR.yellow
    : STATUS_COLOR.green
}

/**
 * The marker trend: the normal range as a shaded band with dashed edges,
 * the series over it, a coloured dot and value per point.
 */
export function TrendChart({
  values,
  dates,
  range,
  height = 260,
  pointColorFor
}: {
  values: (number | null)[]
  dates: string[]
  range: Range
  height?: number
  /**
   * Overrides the dot colour. A marker is judged on being INSIDE its range,
   * so the default paints anything outside red. A category score is the
   * opposite: 90 out of 100 is the best news there is, so the score trend
   * passes the band colour instead. Without this, an Optimal score was drawn
   * in the colour the app uses for "needs attention".
   */
  pointColorFor?: (value: number) => string
}): React.JSX.Element {
  const w = 1000
  // Wide enough for a four-digit bound like 7800 at 11px mono.
  const padL = 64
  const padR = 26
  const padT = 26
  const padB = 40
  const iw = w - padL - padR
  const ih = height - padT - padB

  const pairs = values
    .map((v, i) => ({ v, date: dates[i] }))
    .filter((p): p is { v: number; date: string } => p.v != null)

  if (pairs.length === 0) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--qvac-muted)', fontSize: 14 }}>
        No readings yet for this marker.
      </div>
    )
  }

  const all = pairs.map((p) => p.v).concat([range.low, range.high])
  let ymin = Math.min(...all)
  let ymax = Math.max(...all)
  const span = ymax - ymin || 1
  ymin -= span * 0.2
  ymax += span * 0.14

  const X = (i: number): number => padL + (pairs.length > 1 ? iw * (i / (pairs.length - 1)) : iw / 2)
  const Y = (v: number): number => padT + ih * (1 - (v - ymin) / (ymax - ymin))
  const bandTop = Y(range.high)
  const bandBot = Y(range.low)
  const line = pairs.map((p, i) => `${i ? 'L' : 'M'} ${X(i).toFixed(1)} ${Y(p.v).toFixed(1)}`).join(' ')

  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} style={{ display: 'block' }} role="img"
      aria-label={`Trend across ${pairs.length} test dates, with the normal range shaded`}>
      <rect x={padL} y={bandTop} width={iw} height={bandBot - bandTop} fill="rgba(22,227,193,0.09)" />
      <line x1={padL} y1={bandTop} x2={padL + iw} y2={bandTop} stroke="rgba(22,227,193,0.4)" strokeWidth={1} strokeDasharray="4 4" />
      <line x1={padL} y1={bandBot} x2={padL + iw} y2={bandBot} stroke="rgba(22,227,193,0.4)" strokeWidth={1} strokeDasharray="4 4" />
      <text x={padL - 8} y={bandTop + 4} textAnchor="end" fontFamily="Geist, system-ui, sans-serif" fontSize={11} fill="#7E8E88">
        {range.high}
      </text>
      <text x={padL - 8} y={bandBot + 4} textAnchor="end" fontFamily="Geist, system-ui, sans-serif" fontSize={11} fill="#7E8E88">
        {range.low}
      </text>
      <path d={line} fill="none" stroke="rgba(236,241,238,0.5)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {pairs.map((p, i) => {
        const c = pointColorFor ? pointColorFor(p.v) : pointColor(p.v, range)
        const first = i === 0
        const last = i === pairs.length - 1
        // Anchor the end labels inward. Centred on the first point they sit
        // half on top of the range-bound number printed on the axis, which is
        // how "22" and "18.5" ended up overprinting each other.
        const anchor = first && pairs.length > 1 ? 'start' : last && pairs.length > 1 ? 'end' : 'middle'
        const nudge = anchor === 'start' ? 6 : anchor === 'end' ? -6 : 0
        return (
          <g key={p.date}>
            <circle cx={X(i)} cy={Y(p.v)} r={8} fill={c} opacity={0.18} />
            <circle cx={X(i)} cy={Y(p.v)} r={4.5} fill={c} stroke="#141514" strokeWidth={2} />
            <text
              x={X(i) + nudge}
              y={Y(p.v) - 14}
              textAnchor={anchor}
              fontFamily="Geist, system-ui, sans-serif"
              fontWeight={700}
              fontSize={13}
              fill={c}
            >
              {p.v}
            </text>
            <text
              x={X(i) + nudge}
              y={height - 12}
              textAnchor={anchor}
              fontFamily="Geist, system-ui, sans-serif"
              fontSize={12}
              fill="#7E8E88"
            >
              {shortDate(p.date)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** "2025-09-18" -> "Sep 2025", which is how the design labels its axes. */
export function shortDate(iso: string): string {
  const [y, m] = iso.split('-')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[Number(m) - 1] ?? m} ${y}`
}

export { STATUS_COLOR }

/**
 * Where a value sits against its reference range, as a bar.
 *
 * This is the one picture the whole app is about: a number is meaningless until
 * you see it against the interval it is judged by. The axis deliberately extends
 * PAST the range so an out-of-range value still has somewhere to sit, otherwise
 * every abnormal marker would pin to the same end and they would all look equal.
 */
export function RangeBar({
  value,
  low,
  high,
  color
}: {
  value: number | null
  low: number
  high: number
  color: string
}): React.JSX.Element {
  const span = high - low || 1
  // A quarter of the range of headroom on each side, measured from whichever
  // is further out, the bound or the value. Padding from the bound alone left
  // any value past `high + pad` pinned to 100%, which drew the dot half off
  // the end of the bar and made 88% over look identical to 200% over.
  const pad = span * 0.25
  const min = Math.min(low, value ?? low) - pad
  const max = Math.max(high, value ?? high) + pad
  const domain = max - min || 1
  const pct = (n: number): number => ((n - min) / domain) * 100

  return (
    <div className="rangebar" aria-hidden="true">
      <div className="rb-track" />
      <div className="rb-band" style={{ left: `${pct(low)}%`, width: `${pct(high) - pct(low)}%` }} />
      {value != null && (
        <div className="rb-dot" style={{ left: `${pct(value)}%`, background: color }} />
      )}
    </div>
  )
}
