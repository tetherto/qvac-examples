// The twelve swatches, in two labelled groups.
//
// Clicking one never calls a model: the whole analysis arrived in a single
// pass, so a click just recolours the band and swaps the commentary.

import { COOL_SWATCHES, RATING_DOT, RATING_LABEL, WARM_SWATCHES, type Swatch } from '@shared/palette'
import type { Analysis, Rating } from '@shared/types'

interface Props {
  analysis: Analysis
  selectedName: string
  onSelect: (name: string) => void
  onStartOver: () => void
}

function ratingFor(analysis: Analysis, name: string): Rating {
  return analysis.colors.find((c) => c.name === name)?.rating ?? 'yellow'
}

/** Best fit at the top of each group, worst at the bottom. */
const RATING_ORDER: Record<Rating, number> = { green: 0, yellow: 1, red: 2 }

/**
 * Sorts a group by how well it suits the person, keeping the warm/cool
 * split intact — the two groups are the point of the tray, so they never
 * mix. Within a group, ties keep the palette's own order, which is what
 * makes the list stable between renders.
 */
function byFit(analysis: Analysis, swatches: Swatch[]): Swatch[] {
  return [...swatches].sort(
    (a, b) => RATING_ORDER[ratingFor(analysis, a.name)] - RATING_ORDER[ratingFor(analysis, b.name)]
  )
}

function Group({
  label,
  swatches,
  analysis,
  selectedName,
  onSelect
}: {
  label: string
  swatches: Swatch[]
} & Pick<Props, 'analysis' | 'selectedName' | 'onSelect'>): React.JSX.Element {
  return (
    <>
      <div className="tray__group-label">{label}</div>
      <div className="tray__group">
        {byFit(analysis, swatches).map((swatch) => {
          const rating = ratingFor(analysis, swatch.name)
          const selected = swatch.name === selectedName
          return (
            <button
              key={swatch.name}
              className="swatch"
              onClick={() => onSelect(swatch.name)}
              aria-pressed={selected}
            >
              <span
                className={`swatch__chip${swatch.needsOutline ? ' chip--outlined' : ''}`}
                style={{ background: swatch.hex }}
              />
              <span className="swatch__name">{swatch.name}</span>
              <span
                className="dot"
                style={{ background: RATING_DOT[rating] }}
                title={RATING_LABEL[rating]}
              />
              {selected && <span className="swatch__ring" />}
            </button>
          )
        })}
      </div>
    </>
  )
}

export function SwatchTray({
  analysis,
  selectedName,
  onSelect,
  onStartOver
}: Props): React.JSX.Element {
  const activeLabel = RATING_LABEL[ratingFor(analysis, selectedName)]

  return (
    <div className="tray">
      <div className="tray__legend">
        {(['green', 'yellow', 'red'] as Rating[]).map((rating) => {
          const label = RATING_LABEL[rating]
          return (
            <span
              key={rating}
              className={`legend-item${label === activeLabel ? ' legend-item--on' : ''}`}
            >
              <span className="dot" style={{ background: RATING_DOT[rating] }} />
              {label}
            </span>
          )
        })}
      </div>

      <div className="tray__scroll">
        <Group
          label="COOL TONES"
          swatches={COOL_SWATCHES}
          analysis={analysis}
          selectedName={selectedName}
          onSelect={onSelect}
        />
        <Group
          label="WARM TONES"
          swatches={WARM_SWATCHES}
          analysis={analysis}
          selectedName={selectedName}
          onSelect={onSelect}
        />
      </div>

      <div className="tray__footer">
        <button className="link-quiet" onClick={onStartOver}>
          Start over
        </button>
      </div>
    </div>
  )
}
