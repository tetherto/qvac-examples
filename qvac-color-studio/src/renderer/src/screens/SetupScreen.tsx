// First run only: the models come down once, then the app is offline
// for good. ~2.9 GB, most of it the diffusion model.

import type { ModelsProgress } from '@shared/types'

interface Props {
  progress: ModelsProgress
  onEnter: () => void
  onRetry: () => void
}

export function SetupScreen({ progress, onEnter, onRetry }: Props): React.JSX.Element {
  const done = progress.phase === 'ready'
  const failed = progress.phase === 'error'

  return (
    <div className="screen screen--center">
      {!failed && (
        <div className="spinner" style={{ marginBottom: 30, opacity: done ? 0.25 : 1 }} />
      )}

      <div className="eyebrow" style={{ marginBottom: 16 }}>
        FIRST-TIME SETUP
      </div>
      <h1 className="heading">Setting up on-device AI</h1>
      <p className="note" style={{ margin: '16px 0 36px' }}>
        A one-time download. After this, Color Studio works fully offline.
      </p>

      <div className="progress">
        <div className="progress__track">
          <div
            className="progress__fill"
            style={{ width: `${Math.min(100, Math.max(0, progress.percent))}%` }}
          />
        </div>
        <div className="progress__meta">
          <span>{progress.label}</span>
          <span>
            {progress.mbTotal > 0 ? `${progress.mbDone} / ${progress.mbTotal} MB` : '—'}
          </span>
        </div>
      </div>

      {failed && (
        <>
          <p className="error-line" style={{ marginTop: 28 }}>
            {progress.error ?? 'Something went wrong.'}
          </p>
          {/*
            A stalled peer-to-peer download is the usual cause, and picking up
            where it left off normally works — already-fetched bytes are
            cached, so a retry is cheap.
          */}
          <button className="btn" onClick={onRetry} style={{ marginTop: 22 }}>
            Try again
          </button>
        </>
      )}

      {done && (
        <button
          className="btn"
          onClick={onEnter}
          style={{ marginTop: 36, animation: 'cs-fade .4s var(--ease)' }}
        >
          Enter Studio
        </button>
      )}
    </div>
  )
}
