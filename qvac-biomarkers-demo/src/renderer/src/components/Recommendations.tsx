// ============================================================
// The recommendations block: idle, generating, ready, nothing-to-say.
//
// Shared by Marker Detail and Category Detail, because the design draws the
// same four states in both places and one implementation means they cannot
// diverge.
// ============================================================

import type { JobProgress, RecState, RecommendationSet } from '@shared/types.js'
import { Progress } from './Progress.js'
import { Refresh, Sparkle } from './Icons.js'

export function Recommendations({
  state,
  set,
  message,
  modelLabel,
  subjectLabel,
  progress,
  onGenerate,
  onRegenerate
}: {
  state: RecState
  set: RecommendationSet | null
  message?: string
  modelLabel: string
  subjectLabel: string
  progress?: JobProgress | null
  onGenerate: () => void
  onRegenerate: () => void
}): React.JSX.Element {
  return (
    <>
      {state === 'idle' && (
        <div className="empty-state">
          <div className="mark">
            <Sparkle size={22} color="#16E3C1" />
          </div>
          <div className="head">Get recommendations</div>
          <p>Ways to move {subjectLabel} back into range, worked out on this device.</p>
          <button className="btn primary" onClick={onGenerate}>
            <Sparkle size={15} color="#0D0E0D" />
            Get recommendations
          </button>
        </div>
      )}

      {state === 'generating' && (
        <div style={{ marginBottom: 20 }}>
          <Progress
            label={progress?.label ?? `${modelLabel} is starting up`}
            percent={progress?.percent ?? null}
          />
          <div className="generating" style={{ marginTop: 12, marginBottom: 0 }}>
            <span className="dot sm green pulse" />
            {modelLabel}, on this device. Nothing is uploaded.
          </div>
        </div>
      )}

      {state === 'none' && (
        <div className="empty-state">
          <div className="mark">
            <Sparkle size={22} color="#16E3C1" />
          </div>
          <div className="head">Nothing to suggest yet</div>
          <p>{message ?? 'No source covers this marker. Add one in the Food Library.'}</p>
        </div>
      )}

      {state === 'error' && (
        <div className="empty-state" style={{ borderColor: 'var(--bad-line)' }}>
          <div className="head">That did not work</div>
          <p>{message ?? 'The model could not finish. Try again.'}</p>
          <button className="btn accent" onClick={onRegenerate}>
            <Refresh size={14} color="#16E3C1" />
            Try again
          </button>
        </div>
      )}

      {state === 'ready' && set && (
        <>
          {set.interpretation && (
            <p style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--qvac-muted)', margin: '0 0 16px' }}>
              {set.interpretation}
            </p>
          )}
          {set.recommendations.length === 0 ? (
            <div className="empty-state">
              <div className="head">Nothing survived checking</div>
              <p>
                Every suggestion named food outside your sources, so none were kept. The guard
                working, not advice.
              </p>
              <button className="btn accent" onClick={onRegenerate}>
                <Refresh size={14} color="#16E3C1" />
                Regenerate
              </button>
            </div>
          ) : (
            <div className="rec-grid">
              {set.recommendations.map((r, i) => (
                <div key={i} className="rec-card">
                  <div className={`tag ${r.kind === 'FOOD' ? 'food' : 'lifestyle'}`}>{r.kind}</div>
                  <p>{r.text}</p>
                  <div className="from">
                    {r.origin === 'vetted'
                      ? `built-in · ${r.nutrient}`
                      : `your source "${r.sourceTitle}" · ${r.nutrient}`}
                  </div>
                </div>
              ))}
            </div>
          )}
          {set.dropped.length > 0 && (
            <p
              style={{
                fontSize: 12,
                color: 'var(--warn)',
                fontFamily: 'var(--font-display)',
                margin: '0 0 16px'
              }}
            >
              Left out {set.dropped.length}{' '}
              {set.dropped.length === 1 ? 'suggestion' : 'suggestions'} that named food outside your
              sources.
            </p>
          )}
        </>
      )}
    </>
  )
}

export function RegenerateButton({
  state,
  onClick
}: {
  state: RecState
  onClick: () => void
}): React.JSX.Element | null {
  if (state !== 'ready') return null
  return (
    <button className="btn" onClick={onClick}>
      <Refresh size={14} color="#16E3C1" />
      Regenerate
    </button>
  )
}
