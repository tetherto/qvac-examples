// The verdict, pinned across the top so it stays readable while the user
// plays with swatches. Undertone and season on the left, the palette and
// the colours to skip on the right.

import { RATING_DOT, swatchByName } from '@shared/palette'
import type { Analysis } from '@shared/types'

interface Props {
  analysis: Analysis
}

/** Sentence-cases the undertone for display: "cool" → "Cool". */
function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

export function ReadingBar({ analysis }: Props): React.JSX.Element {
  // Show up to six recommendations — the bar has room for one row.
  const recommended = analysis.recommendedPalette.slice(0, 6)

  return (
    <div className="reading">
      <div className="reading__pin">
        <div className="reading__pin-label">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0C8F76" strokeWidth="2.2" strokeLinecap="round">
            <rect x="4" y="11" width="16" height="9" rx="2" />
            <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
          </svg>
          <span>PINNED</span>
        </div>
        <span className="reading__pin-title">Your analysis</span>
      </div>

      <div className="reading__stats">
        <div className="stat">
          <div className="stat__label">Undertone</div>
          <div className="stat__value">{titleCase(analysis.undertone)}</div>
        </div>
        <div className="stat">
          <div className="stat__label">Season</div>
          <div className="stat__value">{analysis.season}</div>
        </div>
      </div>

      <div className="reading__rule" />

      <div className="reading__block">
        <div className="micro-label">COLORS THAT SUIT YOU</div>
        {recommended.length > 0 ? (
          <div className="chips">
            {recommended.map((name) => {
              const swatch = swatchByName(name)
              return (
                <span
                  key={name}
                  className={`chip${swatch?.needsOutline ? ' chip--outlined' : ''}`}
                  style={{ background: swatch?.hex ?? RATING_DOT.green }}
                  title={name}
                />
              )
            })}
          </div>
        ) : (
          // A small model sometimes rates nothing green. Say so rather than
          // showing an empty row.
          <div className="reading__avoid-text">
            No standout colours this time — the swatches below still read individually.
          </div>
        )}
      </div>

      <div className="reading__rule" />

      <div className="reading__block reading__block--avoid">
        <div className="micro-label">GENTLY SKIP</div>
        <div className="reading__avoid-text">
          {analysis.avoid.length > 0 ? analysis.avoid.join(', ') + '.' : 'Nothing stood out to avoid.'}
        </div>
      </div>
    </div>
  )
}
