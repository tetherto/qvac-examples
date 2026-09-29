// ============================================================
// The context map: which source taught us about which nutrient, and which
// marker that nutrient bears on.
//
// Ported from the design's `contextGraph`, but drawn from real data: the
// nodes and edges come from what the model actually extracted, so an empty
// library draws an empty map rather than a decorative one.
// ============================================================

import type { ContextGraph as Graph } from '@shared/types.js'

// The source labels are right-anchored at SOURCE_X, so SOURCE_X is also the
// space they have to live in. At 78 a long title ran off the left edge of the
// viewBox, which is the clipped "oltpharmac…" pill. Each lane now has a
// declared budget and text is trimmed to fit it.
const SOURCE_X = 150
const NUTRIENT_X = 330
const MARKER_X = 500
const WIDTH = 660
const ROW = 46
const TOP = 34

/**
 * Characters that fit a lane, at 11.5px Geist.
 *
 * Geist is proportional, so there is no exact per-glyph width the way there was
 * with the monospace face this graph was drawn against. 6.5 is deliberately
 * wider than Geist's average advance at this size: clipping a label one
 * character early is invisible (it already ends in an ellipsis), while
 * clipping one character late runs the text into the next column.
 */
const CHAR = 6.5
const SOURCE_CHARS = Math.floor((SOURCE_X - 16) / CHAR)
const NUTRIENT_CHARS = Math.floor((MARKER_X - NUTRIENT_X - 26) / CHAR)
const MARKER_CHARS = Math.floor((WIDTH - MARKER_X - 20) / CHAR)

function laneY(index: number, count: number, height: number): number {
  if (count <= 1) return height / 2
  const usable = height - TOP * 2
  return TOP + (usable * index) / (count - 1)
}

export function ContextGraph({ graph }: { graph: Graph }): React.JSX.Element {
  const rows = Math.max(graph.sources.length, graph.nutrients.length, graph.markers.length, 1)
  const height = Math.max(160, Math.min(360, TOP * 2 + (rows - 1) * ROW))

  if (graph.sources.length === 0) {
    return (
      <div style={{ padding: '38px 0', textAlign: 'center', color: 'var(--qvac-muted)', fontSize: 13 }}>
        Add a source and the map will show how it connects to the nutrients and markers QVAC
        reasons over.
      </div>
    )
  }

  // A source that is still being read has no nutrients and no markers yet, so
  // the graph would be one lonely dot and a lot of empty space. Say what is
  // happening instead of drawing a map of nothing.
  if (graph.nutrients.length === 0) {
    const reading = graph.sources.some((s) => s.state === 'processing')
    const failed = graph.sources.every((s) => s.state === 'failed')
    return (
      <div style={{ padding: '38px 0', textAlign: 'center', color: 'var(--qvac-muted)', fontSize: 13 }}>
        {reading
          ? 'Reading your source on-device. The map fills in once it finds a link.'
          : failed
            ? 'That source could not be read, so there is nothing to map yet.'
            : 'Nothing in your sources links a food to one of the 56 markers yet.'}
      </div>
    )
  }

  const sy = (i: number): number => laneY(i, graph.sources.length, height)
  const ny = (i: number): number => laneY(i, graph.nutrients.length, height)
  const my = (i: number): number => laneY(i, graph.markers.length, height)

  const curve = (x1: number, y1: number, x2: number, y2: number): string => {
    const mid = (x1 + x2) / 2
    return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`
  }

  const selectedIndex = graph.sources.findIndex((s) => s.selected)

  return (
    <svg viewBox={`0 0 ${WIDTH} ${height}`} width="100%" height={height} style={{ display: 'block' }}
      role="img" aria-label="How your saved sources connect to nutrients and markers">
      {graph.sourceToNutrient.map(([s, n], i) => (
        <path
          key={`sn${i}`}
          d={curve(SOURCE_X, sy(s), NUTRIENT_X, ny(n))}
          fill="none"
          stroke={s === selectedIndex ? 'rgba(22,227,193,0.5)' : 'rgba(22,227,193,0.14)'}
          strokeWidth={s === selectedIndex ? 1.6 : 1}
        />
      ))}
      {graph.nutrientToMarker.map(([n, m], i) => {
        const lit = graph.sourceToNutrient.some(([s, nn]) => nn === n && s === selectedIndex)
        return (
          <path
            key={`nm${i}`}
            d={curve(NUTRIENT_X, ny(n), MARKER_X, my(m))}
            fill="none"
            stroke={lit ? 'rgba(22,227,193,0.5)' : 'rgba(22,227,193,0.14)'}
            strokeWidth={lit ? 1.6 : 1}
          />
        )
      })}

      {graph.nutrients.map((n, i) => (
        <g key={`n${i}`}>
          <circle cx={NUTRIENT_X} cy={ny(i)} r={5} fill="#16E3C1" />
          <Label
            x={NUTRIENT_X + 10}
            y={ny(i)}
            text={n.label}
            max={NUTRIENT_CHARS}
            anchor="start"
            color="#16E3C1"
          />
        </g>
      ))}
      {graph.sources.map((s, i) => (
        <g key={s.id}>
          <circle
            cx={SOURCE_X}
            cy={sy(i)}
            r={5}
            fill={s.state === 'linked' ? '#ECF1EE' : s.state === 'processing' ? '#E8C34A' : '#F26D6D'}
            stroke={s.selected ? '#16E3C1' : undefined}
            strokeWidth={s.selected ? 1.5 : 0}
          />
          <Label
            x={SOURCE_X - 10}
            y={sy(i)}
            text={s.label}
            max={SOURCE_CHARS}
            anchor="end"
            color={s.selected ? '#ECF1EE' : '#A0B2AC'}
          />
        </g>
      ))}
      {graph.markers.map((m, i) => (
        <g key={m.id}>
          <rect x={MARKER_X - 4.5} y={my(i) - 4.5} width={9} height={9} rx={2} fill="#7E8E88" />
          <Label
            x={MARKER_X + 12}
            y={my(i)}
            text={m.label}
            max={MARKER_CHARS}
            anchor="start"
            color="#ECF1EE"
          />
        </g>
      ))}
    </svg>
  )
}

/** A pill-backed label, so text stays readable where edges cross behind it. */
function Label({
  x,
  y,
  text,
  max,
  anchor,
  color
}: {
  x: number
  y: number
  text: string
  /** Characters this lane can hold. Longer text is trimmed, never clipped. */
  max: number
  anchor: 'start' | 'end'
  color: string
}): React.JSX.Element {
  const clipped = text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text
  const w = clipped.length * CHAR + 12
  const bx = anchor === 'end' ? x - w : x
  return (
    <>
      <rect x={bx} y={y - 9} width={w} height={18} rx={4} fill="#0D0E0D" stroke="rgba(160,178,172,0.18)" strokeWidth={1} />
      <text
        x={anchor === 'end' ? x - 6 : x + 6}
        y={y + 4}
        textAnchor={anchor}
        fontFamily="Geist, system-ui, sans-serif"
        fontSize={11.5}
        fill={color}
      >
        {clipped}
      </text>
    </>
  )
}
