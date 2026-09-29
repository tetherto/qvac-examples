// ============================================================
// Category Detail: the gauge, the arithmetic, the members, the advice.
//
// The "how this score is calculated" panel is the reason this screen
// exists. It prints the formula and then every term that went into it:
// each marker's value, its range, its sub-score and its weight, so the
// number on the gauge can be checked by hand.
// ============================================================

import { useState } from 'react'
import type {
  AppState,
  CategoryScore,
  JobProgress,
  MarkerView,
  RecState,
  RecommendationSet
} from '@shared/types.js'
import { FORMULA_TEXT } from '@shared/scoring.js'
import { Chrome } from '../components/Chrome.js'
import { Disclaimer } from '../components/Disclaimer.js'
import { Gauge, Sparkline, TrendChart, bandColorFor, shortDate } from '../components/Gauge.js'
import { Chevron } from '../components/Icons.js'
import { Recommendations, RegenerateButton } from '../components/Recommendations.js'

const STATUS_LABEL: Record<string, string> = {
  green: 'Optimal',
  yellow: 'Borderline',
  red: 'Needs attention',
  grey: 'Never tested'
}

export function CategoryScreen({
  state,
  score,
  onBack,
  onOpenMarker,
  recState,
  recSet,
  recMessage,
  recProgress,
  onGenerate,
  onRegenerate
}: {
  state: AppState
  score: CategoryScore
  onBack: () => void
  onOpenMarker: (id: string) => void
  recState: RecState
  recSet: RecommendationSet | null
  recMessage?: string
  recProgress?: JobProgress | null
  onGenerate: () => void
  onRegenerate: () => void
}): React.JSX.Element {
  const [explainerOpen, setExplainerOpen] = useState(true)
  const category = state.categories.find((c) => c.name === score.category)
  const trend = state.trends[score.category] ?? []
  const color = score.score == null ? '#7E8E88' : bandColorFor(score.score)
  const members: MarkerView[] = score.terms
    .map((t) => state.markers.find((m) => m.marker.id === t.markerId))
    .filter((v): v is MarkerView => Boolean(v))

  // The trend sentence for the category, computed the same way as a marker's:
  // compare the latest score with the one before it.
  const scored = trend.filter((t) => t.score != null)
  const movement =
    scored.length < 2
      ? null
      : (() => {
          const last = scored[scored.length - 1].score as number
          const prev = scored[scored.length - 2].score as number
          const delta = Math.round((last - prev) * 10) / 10
          if (Math.abs(delta) < 1) return `Holding steady since ${shortDate(scored[scored.length - 2].date)}.`
          return `${delta > 0 ? 'Improving' : 'Slipping'}, ${delta > 0 ? 'up' : 'down'} ${Math.abs(delta)} points since ${shortDate(scored[scored.length - 2].date)}.`
        })()

  const worst = score.terms
    .filter((t) => t.sub != null && t.status !== 'green')
    .sort((a, b) => (a.sub as number) - (b.sub as number))[0]

  // Good news when no tested member needs attention, which is not the same
  // as scoring Optimal, since a category of barely-in-range markers scores
  // Good and still has nothing to fix.
  const allClear = score.tested > 0 && !worst

  return (
    <>
      <Chrome model={state.model} back={{ label: 'All categories', onClick: onBack }} />

      <div className="split">
        <div className="left glow">
          <div style={{ position: 'relative' }}>
            <div className="eyebrow">Category</div>
            <h2 className="page-title" style={{ fontSize: 28, marginBottom: 20 }}>
              {score.category}
            </h2>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <Gauge score={score.score} band={score.band} size={200} />
            </div>
            <p className="subtle" style={{ textAlign: 'center', margin: '16px 0 0', lineHeight: 1.5 }}>
              {movement ?? 'One test date so far. A score, not yet a trend.'}
              {worst ? ` ${worst.name} is the main drag.` : ''}
            </p>
            <p className="subtle" style={{ margin: '14px 0 0', lineHeight: 1.5 }}>
              {category?.description}
            </p>

            <div className="explainer">
              <button onClick={() => setExplainerOpen((v) => !v)}>
                <span style={{ fontFamily: 'var(--font-display)' }}>How this score is calculated</span>
                <Chevron size={14} color="#16E3C1" className={`chev ${explainerOpen ? 'open' : ''}`} />
              </button>
              {explainerOpen && (
                <div className="body">
                  <p>{FORMULA_TEXT}</p>
                  {score.terms.map((t) => (
                    <div key={t.markerId} className="term">
                      <span className="label">
                        {t.name}
                        {t.sub == null ? ' · not tested' : ` · weight ${Math.round(t.weight * 100)}%`}
                      </span>
                      <span
                        style={{
                          color:
                            t.sub == null
                              ? 'var(--muted-empty)'
                              : t.status === 'green'
                                ? 'var(--ok)'
                                : t.status === 'yellow'
                                  ? 'var(--warn)'
                                  : 'var(--bad)'
                        }}
                      >
                        {t.sub == null ? '-' : `${t.sub} / 100`}
                      </span>
                    </div>
                  ))}
                  <div className="term" style={{ borderTop: '1px solid var(--qvac-border)', marginTop: 8, paddingTop: 8 }}>
                    <span className="label" style={{ color: 'var(--qvac-white)' }}>
                      Average of {score.tested} tested
                    </span>
                    <span style={{ color }}>{score.score ?? '-'} / 100</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="right">
          <div className="panel" style={{ padding: '20px 22px 14px', marginBottom: 24 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 14 }}>Score trend</span>
            {scored.length >= 2 ? (
              <TrendChart
                values={trend.map((t) => t.score)}
                dates={trend.map((t) => t.date)}
                // The band to be inside is Optimal, not a middle window: a
                // score above 85 is the best outcome, so shading 50-85 would
                // draw the good news as an overshoot.
                range={{ low: 85, high: 100 }}
                height={220}
                pointColorFor={bandColorFor}
              />
            ) : (
              <div style={{ padding: '30px 0', textAlign: 'center' }}>
                <Sparkline values={trend.map((t) => t.score)} color={color} />
                <p className="subtle" style={{ marginTop: 10 }}>
                  A trend needs at least two test dates.
                </p>
              </div>
            )}
            <p className="subtle" style={{ fontSize: 12, margin: '4px 0 6px', textAlign: 'center' }}>
              The shaded band is Optimal, 85 and above. Dots carry the band colour, so they read
              the same way as the gauge.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <h3 className="section-title" style={{ fontSize: 18 }}>
              Member markers
            </h3>
            <span className="subtle">
              {score.inRange} of {score.total} in range
            </span>
          </div>
          <div style={{ border: '1px solid var(--qvac-border)', borderRadius: 10, overflow: 'hidden', marginBottom: 24 }}>
            {members.map((v) => (
              <button key={v.marker.id} className="member-row" onClick={() => onOpenMarker(v.marker.id)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <span className={`dot ${v.status}`} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 15 }}>{v.marker.name}</div>
                    <div className="subtle" style={{ fontSize: 12 }}>
                      Expected {v.range.low}-{v.range.high} {v.marker.unit}
                    </div>
                  </div>
                </div>
                <div className={`status-pill ${v.status}`} style={{ fontSize: 12, padding: '4px 10px' }}>
                  {STATUS_LABEL[v.status]}
                </div>
                <div style={{ textAlign: 'right', minWidth: 92 }}>
                  <span
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontWeight: 700,
                      fontSize: 16,
                      color:
                        v.status === 'green'
                          ? 'var(--ok)'
                          : v.status === 'yellow'
                            ? 'var(--warn)'
                            : v.status === 'red'
                              ? 'var(--bad)'
                              : 'var(--muted-empty)'
                    }}
                  >
                    {v.latest ?? '-'}
                  </span>{' '}
                  <span className="subtle" style={{ fontSize: 12 }}>
                    {v.marker.unit}
                  </span>
                </div>
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 className="section-title" style={{ fontSize: 18 }}>
              Ways to move this score
            </h3>
            <RegenerateButton state={recState} onClick={onRegenerate} />
          </div>

          {allClear && recState === 'none' ? (
            <div className="empty-state glow" style={{ borderStyle: 'solid', borderColor: 'var(--ok-line)' }}>
              <div className="head">Everything&rsquo;s in range</div>
              <p style={{ marginBottom: 0 }}>
                No marker in this category needs attention. Keep doing what you&rsquo;re doing.
              </p>
            </div>
          ) : (
            <Recommendations
              state={recState}
              set={recSet}
              message={recMessage}
            progress={recProgress}
              modelLabel={state.model.label}
              subjectLabel={`your ${score.category} markers`}
              onGenerate={onGenerate}
              onRegenerate={onRegenerate}
            />
          )}

          <Disclaimer />
        </div>
      </div>
    </>
  )
}
