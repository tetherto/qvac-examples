// ============================================================
// The overview: a briefing, not an index.
//
// The first version of this screen was a card per marker, fifty-four of
// them, each with its own range bar and sparkline. Every card was defensible
// and the screen as a whole was useless: fifty charts is not a summary, it
// is the table again with more ink. Browsing every marker is what the Table
// tab is for, and it does it better.
//
// So this screen answers four questions and stops:
//
//   how bad is it        the headline
//   what is worst        five rows, sorted by how far past the bound
//   what is getting      the drift list, which is the one thing you
//   worse                cannot read off a single result sheet
//   where is the         the category bars
//   weakness
//
// Each answer is one click from its detail. Nothing here is a chart for the
// sake of one.
// ============================================================

import { useMemo } from 'react'
import type { AppState, CategoryScore, MarkerView } from '@shared/types.js'
import { bandFor, groupOf } from '@shared/scoring.js'
import { Chrome, type Tab } from '../components/Chrome.js'
import { ChevronRight, Sparkle } from '../components/Icons.js'
import { bandColorFor, RangeBar, shortDate } from '../components/Gauge.js'

/** How many rows the attention list shows before it defers to the Table tab. */
const TOP_N = 5
/** How many drifting markers are worth naming before the list becomes noise. */
const DRIFT_N = 4

export function OverviewScreen({
  state,
  tab,
  onTab,
  onOpenMarker,
  onOpenCategory,
  onAsk,
  onImport,
  onFoodLibrary,
  onProfile
}: {
  state: AppState
  tab: Tab
  onTab: (t: Tab) => void
  onOpenMarker: (markerId: string) => void
  onOpenCategory: (category: string) => void
  onAsk: () => void
  onImport: () => void
  onFoodLibrary: () => void
  onProfile: () => void
}): React.JSX.Element {
  const { attention, drifting, counts } = useMemo(() => {
    const c = { attention: 0, inRange: 0, never: 0 }
    for (const m of state.markers) {
      const g = groupOf(m.status)
      if (g === 'unoptimized') c.attention++
      else if (g === 'optimized') c.inRange++
      else c.never++
    }
    return {
      counts: c,
      attention: state.markers
        .filter((m) => groupOf(m.status) === 'unoptimized')
        .sort((a, b) => deviation(b) - deviation(a)),
      // In range, but heading out of it. Worth its own section precisely
      // because nothing is red yet, so nothing else on the screen shows it.
      drifting: state.markers.filter(
        (m) => m.status === 'green' && m.trend.improving === false && m.trend.direction !== 'flat'
      )
    }
  }, [state.markers])

  const tested = counts.attention + counts.inRange

  return (
    <>
      <Chrome
        tab={tab}
        onTab={onTab}
        model={state.model}
        onAsk={onAsk}
        onImport={onImport}
        onFoodLibrary={onFoodLibrary}
        onProfile={onProfile}
      />
      <div className="overview">
        <section className="ov-hero">
          <div className="ov-hero-main">
            <h2>
              <b className={counts.attention > 0 ? 'bad' : 'ok'}>{counts.attention}</b> of {tested}{' '}
              tested markers {counts.attention === 1 ? 'is' : 'are'} outside your range
            </h2>
            <p className="subtle">
              {state.lastImport
                ? `${state.lastImport.file}, imported ${shortDate(state.lastImport.at)}`
                : 'No import yet'}
              {counts.never > 0 && ` · ${counts.never} markers never tested`}
            </p>
          </div>
          <button className="btn accent big" onClick={onAsk}>
            <Sparkle size={16} color="#0D0E0D" />
            Ask {state.model.label}
          </button>
        </section>

        <div className="ov-cols">
          <section className="ov-block">
            <div className="ov-block-head">
              <h3>Furthest out of range</h3>
              {attention.length > TOP_N && (
                <button className="link" onClick={() => onTab('table')}>
                  all {attention.length} <ChevronRight size={12} color="#16E3C1" />
                </button>
              )}
            </div>
            {attention.length === 0 ? (
              <p className="ov-none">Nothing is outside its range.</p>
            ) : (
              <div className="ov-rows">
                {attention.slice(0, TOP_N).map((m) => (
                  <AttentionRow key={m.marker.id} m={m} onOpen={() => onOpenMarker(m.marker.id)} />
                ))}
              </div>
            )}
          </section>

          <aside className="ov-side">
            <section className="ov-block">
              <h3>Where the weakness is</h3>
              <div className="ov-cats">
                {state.scores.map((s) => (
                  <CategoryBar key={s.category} s={s} onOpen={() => onOpenCategory(s.category)} />
                ))}
              </div>
            </section>

            <section className="ov-block">
              <h3>The rest</h3>
              <div className="ov-rest">
                <button className="rest-row" onClick={() => onTab('table')}>
                  <span className="rest-n ok">{counts.inRange}</span>
                  <span className="rest-label">inside their range</span>
                  <span className="rest-note">nothing to do</span>
                </button>
                <button className="rest-row" onClick={() => onTab('table')}>
                  <span className="rest-n none">{counts.never}</span>
                  <span className="rest-label">never tested</span>
                  <span className="rest-note">add to your next panel</span>
                </button>
              </div>
            </section>

            {drifting.length > 0 && (
              <section className="ov-block">
                <h3>In range, but heading out</h3>
                <div className="ov-drift">
                  {drifting.slice(0, DRIFT_N).map((m) => (
                    <button
                      key={m.marker.id}
                      className="drift-row"
                      onClick={() => onOpenMarker(m.marker.id)}
                    >
                      <span className="drift-name">{m.marker.name}</span>
                      <span className="drift-note">
                        {m.trend.direction}
                        {m.trend.since ? ` since ${shortDate(m.trend.since)}` : ''}
                      </span>
                    </button>
                  ))}
                  {drifting.length > DRIFT_N && (
                    <div className="subtle sm">and {drifting.length - DRIFT_N} more</div>
                  )}
                </div>
              </section>
            )}
          </aside>
        </div>
      </div>
    </>
  )
}

/**
 * One marker that needs looking at.
 *
 * The range bar earns its place on these five rows and did not on all
 * fifty-four: here the whole point is HOW FAR out the dot sits, and the
 * percentage next to it is the same number in words.
 */
function AttentionRow({ m, onOpen }: { m: MarkerView; onOpen: () => void }): React.JSX.Element {
  const low = (m.latest as number) < m.range.low
  const color = m.status === 'red' ? '#F26D6D' : '#E8C34A'
  const worsening = m.trend.improving === false
  return (
    <button className={`arow ${m.status}`} onClick={onOpen}>
      <div className="arow-top">
        <span className="arow-name">{m.marker.name}</span>
        <span className="arow-value" style={{ color }}>
          {m.latest}
          <em>{m.marker.unit}</em>
        </span>
      </div>
      <RangeBar value={m.latest} low={m.range.low} high={m.range.high} color={color} />
      <div className="arow-foot">
        <span>
          {Math.round(deviation(m) * 100)}% {low ? 'below' : 'above'} {low ? m.range.low : m.range.high}
          <em> · range {m.range.low}-{m.range.high}</em>
        </span>
        {worsening && <span className="arow-worse">still {m.trend.direction}</span>}
      </div>
    </button>
  )
}

function CategoryBar({ s, onOpen }: { s: CategoryScore; onOpen: () => void }): React.JSX.Element {
  const score = s.score
  const color = score == null ? '#7E8E88' : bandColorFor(score)
  return (
    <button className="cbar" onClick={onOpen}>
      <span className="cbar-name">{s.category}</span>
      <span className="cbar-track">
        <span className="cbar-fill" style={{ width: `${score ?? 0}%`, background: color }} />
      </span>
      <span className="cbar-n" style={{ color }}>
        {score == null ? '–' : Math.round(score)}
      </span>
      <span className="cbar-band">{score == null ? 'not tested' : bandFor(score)}</span>
    </button>
  )
}

/**
 * How far past the violated bound, as a fraction of the bound itself. The
 * same measure `subScore` uses, so this list is ordered the way the scores
 * are computed rather than by a second opinion.
 */
function deviation(m: MarkerView): number {
  if (m.latest == null) return 0
  if (m.latest >= m.range.low && m.latest <= m.range.high) return 0
  const bound = m.latest < m.range.low ? m.range.low : m.range.high
  const scale = Math.abs(bound) > 0 ? Math.abs(bound) : Math.abs(m.range.high - m.range.low) || 1
  return Math.abs(m.latest - bound) / scale
}
