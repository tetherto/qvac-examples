// ============================================================
// Marker Detail: the number, the trend, the read, the recommendations.
//
// The interpretation sentence above the chart is COMPUTED (shared/status.ts
// works out the direction of travel and since when). The model's own
// sentence appears with the recommendations, where it belongs, it is
// commentary on facts, not the source of them.
// ============================================================

import type { AppState, JobProgress, MarkerView, RecState, RecommendationSet } from '@shared/types.js'
import { Chrome } from '../components/Chrome.js'
import { Disclaimer } from '../components/Disclaimer.js'
import { TrendChart } from '../components/Gauge.js'
import { Book } from '../components/Icons.js'
import { Recommendations, RegenerateButton } from '../components/Recommendations.js'

const STATUS_LABEL: Record<string, string> = {
  green: 'Optimal',
  yellow: 'Borderline',
  red: 'Needs attention',
  grey: 'Never tested'
}

export function MarkerScreen({
  state,
  view,
  recState,
  recSet,
  recMessage,
  recProgress,
  onBack,
  onFoodLibrary,
  onGenerate,
  onRegenerate
}: {
  state: AppState
  view: MarkerView
  recState: RecState
  recSet: RecommendationSet | null
  recMessage?: string
  recProgress?: JobProgress | null
  onBack: () => void
  onFoodLibrary: () => void
  onGenerate: () => void
  onRegenerate: () => void
}): React.JSX.Element {
  const { marker, range, status, latest, trend, personalized, personalizedNote } = view

  return (
    <>
      <Chrome model={state.model} back={{ label: 'Back to table', onClick: onBack }} />

      <div className="scroll">
        <div className="pad">
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24, marginBottom: 26 }}>
            <div style={{ flex: 1 }}>
              <div className="eyebrow">{marker.descriptor}</div>
              <h2 className="page-title" style={{ fontSize: 36 }}>
                {marker.name}
              </h2>
              <div className="subtle" style={{ marginTop: 6 }}>
                {marker.categories.length > 0 ? marker.categories.join(' · ') : 'Not in a scored category'}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="readout">
                <b style={{ color: `var(--${status === 'green' ? 'ok' : status === 'yellow' ? 'warn' : status === 'red' ? 'bad' : 'none'})` }}>
                  {latest ?? '-'}
                </b>
                <span>{marker.unit}</span>
              </div>
              <div className={`status-pill ${status}`} style={{ marginTop: 10 }}>
                <span className={`dot ${status}`} />
                {STATUS_LABEL[status]}
              </div>
              <div className="subtle" style={{ marginTop: 8 }} title={personalizedNote}>
                Expected range {range.low} - {range.high} {marker.unit}
              </div>
            </div>
          </div>

          {personalized && personalizedNote && (
            <div className="panel sunken" style={{ padding: '12px 16px', marginBottom: 20 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, color: 'var(--ok)', marginBottom: 4 }}>
                WHY THIS RANGE
              </div>
              <p className="subtle" style={{ margin: 0, lineHeight: 1.5 }}>
                {personalizedNote}
              </p>
            </div>
          )}

          <div className={`interpretation ${status}`}>
            <p>{trend.sentence}</p>
          </div>

          <div className="panel" style={{ padding: '20px 22px 14px', marginBottom: 28 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 14 }}>
                Trend across test dates
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    width: 20,
                    height: 8,
                    background: 'rgba(22,227,193,.18)',
                    borderTop: '1px dashed rgba(22,227,193,.5)',
                    borderBottom: '1px dashed rgba(22,227,193,.5)',
                    display: 'inline-block'
                  }}
                />
                <span className="subtle" style={{ fontSize: 12 }}>
                  Expected range
                </span>
              </div>
            </div>
            <TrendChart values={view.values} dates={state.dates} range={range} />
          </div>

          <button
            className="panel"
            onClick={onFoodLibrary}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '12px 16px',
              marginBottom: 16,
              width: '100%',
              cursor: 'pointer',
              color: 'inherit',
              textAlign: 'left'
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Book size={16} color="#16E3C1" />
              <span className="subtle">Suggestions come only from your saved sources.</span>
            </span>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, color: 'var(--ok)', whiteSpace: 'nowrap' }}>
              Add a source →
            </span>
          </button>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h3 className="section-title">General recommendations</h3>
              <span className="subtle">{state.model.label}</span>
            </div>
            <RegenerateButton state={recState} onClick={onRegenerate} />
          </div>

          <Recommendations
            state={recState}
            set={recSet}
            message={recMessage}
            progress={recProgress}
            modelLabel={state.model.label}
            subjectLabel={`your ${marker.name.toLowerCase()} trend`}
            onGenerate={onGenerate}
            onRegenerate={onRegenerate}
          />

          <Disclaimer />
        </div>
      </div>
    </>
  )
}
