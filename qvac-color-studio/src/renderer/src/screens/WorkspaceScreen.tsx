// ============================================================
// The room where the work happens: verdict pinned on top, the
// twelve swatches on the left, the draped photo beside them, and
// the model's reading on that colour filling the right.
//
// Note what is NOT here: any model call driven by a swatch click.
// The whole analysis arrived in one pass, so this screen is pure
// canvas work and cached text.
// ============================================================

import { useMemo } from 'react'
import { ReadingBar } from '../components/ReadingBar'
import { SwatchTray } from '../components/SwatchTray'
import { compositeDrape, type Still } from '../lib/drape'
import type { DrapeGeometry } from '../lib/faceMesh'
import { RATING_DOT, RATING_LABEL, swatchByName } from '@shared/palette'
import type { Analysis } from '@shared/types'

interface Props {
  analysis: Analysis
  still: Still
  geometry: DrapeGeometry
  selectedName: string
  onSelect: (name: string) => void
  onStartOver: () => void
}

export function WorkspaceScreen({
  analysis,
  still,
  geometry,
  selectedName,
  onSelect,
  onStartOver
}: Props): React.JSX.Element {
  const selected = analysis.colors.find((c) => c.name === selectedName) ?? analysis.colors[0]
  const swatch = swatchByName(selected.name)

  // Recomposite only when the photo, the geometry or the colour changes —
  // not on every unrelated render.
  const drapedUrl = useMemo(
    () => (swatch ? compositeDrape(still, geometry, swatch.hex) : null),
    [still, geometry, swatch]
  )

  return (
    <div className="screen">
      <div className="workspace">
        <ReadingBar analysis={analysis} />

        <div className="working">
          <SwatchTray
            analysis={analysis}
            selectedName={selected.name}
            onSelect={onSelect}
            onStartOver={onStartOver}
          />

          {/* The photo, draped in whichever colour is selected. */}
          <div className="stage">
            <div className="stage__photo">
              <div className="portrait">
                <img
                  className="portrait__media"
                  src={drapedUrl ?? still.url}
                  alt={`Your photo draped in ${selected.name}`}
                />
              </div>
              <div className="portrait__chip">
                <span className="dot" style={{ background: RATING_DOT[selected.rating] }} />
                <span>{RATING_LABEL[selected.rating]}</span>
              </div>
            </div>
          </div>

          {/* What the model made of that colour on this face. */}
          <div className="reading-panel">
            <div className="reading-panel__head">
              <div className="micro-label">ON YOUR SKIN</div>
              <div className="reading-panel__name">{selected.name}</div>
              <div className="reading-panel__verdict">
                <span className="dot" style={{ background: RATING_DOT[selected.rating] }} />
                <span>{RATING_LABEL[selected.rating]}</span>
              </div>
            </div>

            {/* Scrolls rather than clips: a 2B model writes long sentences,
                and a truncated verdict is worse than a scrollbar. */}
            <div className="reading-panel__body">
              <p className="reading-panel__text">{selected.commentary}</p>
            </div>

            <div className="reading-panel__foot">
              <div className="micro-label">WHY THIS SEASON</div>
              <p className="reading-panel__why">{analysis.why}</p>
              <p className="reading-panel__caveat">
                An estimate from a small on-device model — trust your own eye over it.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
