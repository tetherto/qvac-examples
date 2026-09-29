// The eight category cards. The gauge is the signature moment, so it gets
// the middle of the card and nothing competes with it.
import type { AppState } from '@shared/types.js'
import { Chrome, type Tab } from '../components/Chrome.js'
import { Gauge, Sparkline, bandColorFor } from '../components/Gauge.js'
import { Disclaimer } from '../components/Disclaimer.js'

export function CategoriesScreen({
  state,
  tab,
  onTab,
  onOpenCategory,
  onImport,
  onFoodLibrary,
  onProfile,
  onAsk
}: {
  state: AppState
  tab: Tab
  onTab: (t: Tab) => void
  onOpenCategory: (name: string) => void
  onImport: () => void
  onFoodLibrary: () => void
  onProfile: () => void
  onAsk: () => void
}): React.JSX.Element {
  return (
    <>
      <Chrome
        tab={tab}
        onTab={onTab}
        model={state.model}
        onImport={onImport}
        onFoodLibrary={onFoodLibrary}
        onProfile={onProfile}
        onAsk={onAsk}
      />
      <div className="scroll">
        <div className="pad">
          <div style={{ marginBottom: 20 }}>
            <h2 className="page-title" style={{ fontSize: 26 }}>
              Eight health themes
            </h2>
            <p className="subtle" style={{ margin: '6px 0 0' }}>
              Each scored 0-100 from the markers that make it up. Open one to see the arithmetic.
            </p>
          </div>

          <div className="cat-grid">
            {state.scores.map((score) => {
              const trend = state.trends[score.category] ?? []
              const color = score.score == null ? '#7E8E88' : bandColorFor(score.score)
              return (
                <button
                  key={score.category}
                  className="cat-card hoverable glow"
                  onClick={() => onOpenCategory(score.category)}
                >
                  <div className="name">{score.category}</div>
                  <Gauge score={score.score} band={score.band} size={132} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, height: 28 }}>
                    <Sparkline values={trend.map((t) => t.score)} color={color} />
                  </div>
                  <div className="foot">
                    {score.tested === 0
                      ? 'no member marker tested yet'
                      : `${score.inRange} of ${score.total} markers in range`}
                  </div>
                </button>
              )
            })}
          </div>

          <div style={{ marginTop: 26 }}>
            <Disclaimer />
          </div>
        </div>
      </div>
    </>
  )
}
