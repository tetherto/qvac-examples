// Past exams: every paper, newest first, with its latest sitting.
// Empty state (09e) and the "pick up where you left off" card (09f).

import { grade } from '../../../core/grade'
import type { Attempt, Exam } from '../../../core/types'
import { useApp } from '../state'
import { Bar, Btn, DIFFICULTY_LABEL, Eyebrow, clock } from '../ui'

const api = window.api

/** 09f: an unfinished sitting, shown on the past-exams screen and at launch. */
export function ResumeCard({ exam, attempt }: { exam: Exam; attempt: Attempt }) {
  const { go } = useApp()
  const answered = exam.questions.filter((q) => (attempt.answers[q.id] ?? []).length).length
  return (
    <div className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Eyebrow color="var(--fg-3)" style={{ marginBottom: 0 }}>
        {exam.title ?? 'Practice paper'} · No. {exam.number} · paused
      </Eyebrow>
      <div className="mono" style={{ fontSize: 18, fontWeight: 700 }}>
        Pick up where you left off?
      </div>
      <Bar pct={(answered / exam.questions.length) * 100} height={3} />
      <div className="mono" style={{ fontSize: 12, color: 'var(--fg-3)' }}>
        {answered} of {exam.questions.length} answered{attempt.flagged.length ? ` · ${attempt.flagged.length} flagged` : ''} · {clock(attempt.elapsedMs)} elapsed
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Btn variant="primary" size="sm" onClick={() => go({ name: 'taking', attemptId: attempt.id })}>
          Resume
        </Btn>
        <Btn variant="quiet" size="sm" onClick={() => void api.exams.discardAttempt(attempt.id)} style={{ color: 'var(--fg-3)' }}>
          Discard
        </Btn>
      </div>
    </div>
  )
}

export function Exams() {
  const { exams, attempts, go, sit } = useApp()
  const open = attempts.filter((a) => !a.finishedAt).map((a) => ({ a, e: exams.find((x) => x.id === a.examId) })).filter((x): x is { a: Attempt; e: Exam } => !!x.e)

  if (!exams.length) {
    return (
      <div className="screen center">
        <div className="card" style={{ padding: '28px 24px', width: 400, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10,1fr)', gap: 4 }}>
            {Array.from({ length: 10 }, (_, i) => (
              <span key={i} style={{ height: 6, borderRadius: 2, border: '1px solid var(--border-strong)' }} />
            ))}
          </div>
          <div className="mono" style={{ fontSize: 18, fontWeight: 700 }}>
            No exams yet.
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--fg-2)', margin: 0 }}>Scores and trends will appear here.</p>
          <Btn onClick={() => go({ name: 'setup' })} style={{ width: 'max-content' }}>
            Set up an exam
          </Btn>
        </div>
      </div>
    )
  }

  const rows = [...exams].sort((x, y) => (y.number ?? 0) - (x.number ?? 0))
  return (
    <div className="screen scroll" style={{ padding: '44px 56px', gap: 28 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 24 }}>
        <div style={{ flex: 1 }}>
          <Eyebrow style={{ marginBottom: 10 }}>Past exams</Eyebrow>
          <h1 className="h1">Your papers</h1>
        </div>
        <Btn variant="primary" onClick={() => go({ name: 'setup' })}>
          New exam
        </Btn>
      </div>
      {open.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
          {open.map(({ a, e }) => (
            <ResumeCard key={a.id} exam={e} attempt={a} />
          ))}
        </div>
      )}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="exam-grid src-head">
          <span>Paper</span>
          <span>Material</span>
          <span>Setup</span>
          <span>Last score</span>
          <span />
        </div>
        {rows.map((e) => {
          const sittings = attempts.filter((a) => a.examId === e.id && a.finishedAt).sort((x, y) => y.finishedAt!.localeCompare(x.finishedAt!))
          const last = sittings[0]
          const g = last ? grade(e, last) : null
          const paused = attempts.some((a) => a.examId === e.id && !a.finishedAt)
          return (
            <div key={e.id} className="exam-grid src-row">
              <div>
                <div className="mono" style={{ fontSize: 14, fontWeight: 700 }}>
                  No. {e.number}
                </div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2 }}>
                  {new Date(e.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                </div>
              </div>
              <div className="ellipsis" style={{ fontSize: 14 }}>
                {e.title}
              </div>
              <div className="mono" style={{ fontSize: 12, color: 'var(--fg-2)' }}>
                {e.questions.length} q · {DIFFICULTY_LABEL[e.config.difficulty]} · {e.config.mode}
              </div>
              <div className="mono" style={{ fontSize: 13 }}>
                {g ? (
                  <>
                    <b>
                      {g.right}/{g.total}
                    </b>
                    <span style={{ color: 'var(--fg-3)' }}>{sittings.length > 1 ? ` · ${sittings.length} sittings` : ''}</span>
                  </>
                ) : (
                  <span style={{ color: 'var(--fg-3)' }}>{paused ? 'In progress' : 'Not taken'}</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                {last && (
                  <Btn size="sm" variant="quiet" onClick={() => go({ name: 'results', attemptId: last.id })}>
                    Results
                  </Btn>
                )}
                <Btn size="sm" onClick={() => void sit(e)}>
                  {paused ? 'Resume' : last ? 'Retake' : 'Start'}
                </Btn>
                <button type="button" className="link-btn on-hover" onClick={() => void api.exams.remove(e.id)}>
                  Delete
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
