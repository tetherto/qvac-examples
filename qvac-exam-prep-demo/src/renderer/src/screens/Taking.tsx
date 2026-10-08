// 05 Taking the exam. Round = pick one, square = pick any, keys 1–9.
// Exam mode grades at the end; practice mode checks each answer and shows
// where it came from. Every change is saved, so a paper can be left and
// resumed.

import { useCallback, useEffect, useRef, useState } from 'react'
import { feedbackLine, isRight, optionMarks, type OptionMark } from '../../../core/grade'
import { topicPath } from '../../../core/topics'
import type { Attempt, Exam, Passage, Question } from '../../../core/types'
import { useApp } from '../state'
import { Btn, DIFFICULTY_LABEL, Icon, Mark, Rich, clock, trail } from '../ui'

const api = window.api

export function sourceLabel(p: Passage | undefined): string {
  if (!p) return ''
  if (p.sourceType === 'url') {
    const path = p.sourceRef.replace(/^https?:\/\/[^/]+/, '').replace(/\/$/, '')
    return `…${path.split('/').slice(-2).join('/')}${p.anchor ? `#${p.anchor}` : ''}`
  }
  const name = p.sourceRef.split(/[\\/]/).pop() ?? p.sourceTitle
  return `${name}${p.pageNumber ? ` · p. ${p.pageNumber}` : ''}`
}

/** Options that are code ("./modules/network") read better in mono. */
function looksLikeCode(t: string): boolean {
  return /^`[^`]+`$/.test(t) || (!/\s/.test(t) && /[/._:=-]/.test(t))
}

export function ShapeHint({ q }: { q: Question }) {
  return (
    <span className="label" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      {q.type === 'truefalse' ? null : <span style={{ width: 11, height: 11, borderRadius: q.type === 'multi' ? 2 : '50%', border: '1.5px solid var(--fg-3)', boxSizing: 'border-box' }} />}
      {q.type === 'multi' ? 'Pick all that apply' : q.type === 'truefalse' ? 'True or false' : 'Pick one'}
    </span>
  )
}

function OptionRow({ q, o, i, picked, mark, onPick }: { q: Question; o: { id: string; text: string }; i: number; picked: boolean; mark?: OptionMark; onPick?: () => void }) {
  const multi = q.type === 'multi'
  const code = looksLikeCode(o.text)
  const text = (
    <span className={code ? 'mono' : undefined} style={{ fontSize: code ? 14 : 16, lineHeight: 1.5, color: picked || mark === 'right' || mark === 'missed' || mark === 'wrong' ? 'var(--fg-1)' : 'var(--fg-2)', flex: 1 }}>
      <Rich text={code ? o.text.replace(/^`|`$/g, '') : o.text} codeSize={14} />
    </span>
  )
  if (mark) {
    const label = { right: 'Right', missed: multi ? 'Also right · missed' : 'Right answer', wrong: 'Not this one', none: '' }[mark]
    return (
      <div className={`option option-${mark}`}>
        <span className={`tick tick-${mark}${multi ? '' : ' tick-round'}`}>
          {mark === 'right' && <Icon name="check" size={12} width={3.5} color="var(--fg-on-acqua)" />}
          {mark === 'wrong' && <Icon name="x" size={10} width={3.5} color="var(--status-danger)" />}
        </span>
        {text}
        {label && <span className={`mark-label mark-${mark}`}>{label}</span>}
      </div>
    )
  }
  return (
    <button type="button" className={`option${picked ? ' option-on' : ''}`} onClick={onPick}>
      <span className={`keycap${picked ? ' keycap-on' : ''}`}>{i + 1}</span>
      {multi ? (
        <span className={`box box-lg${picked ? ' box-on' : ''}`}>{picked && <Icon name="check" size={12} width={3.5} color="var(--fg-on-acqua)" />}</span>
      ) : (
        <span className={`radio radio-lg${picked ? ' radio-on' : ''}`} />
      )}
      {text}
    </button>
  )
}

export function Taking({ attemptId }: { attemptId: string }) {
  const { exams, attempts, go, choices, statuses, settings, setShowKeys } = useApp()
  const stored = attempts.find((a) => a.id === attemptId)
  const exam = exams.find((e) => e.id === stored?.examId)
  if (!stored || !exam) return <div className="screen center">This paper is no longer here.</div>
  return <Sitting key={attemptId} exam={exam} initial={stored} go={go} setShowKeys={setShowKeys} modelLabel={choices.find((c) => c.key === settings.modelKey)?.label ?? ''} modelOn={['downloaded', 'loaded', 'loading'].includes(statuses[settings.modelKey]?.phase ?? '')} />
}

function Sitting({ exam, initial, go, setShowKeys, modelLabel, modelOn }: { exam: Exam; initial: Attempt; go: ReturnType<typeof useApp>['go']; setShowKeys: (b: boolean) => void; modelLabel: string; modelOn: boolean }) {
  const [a, setA] = useState<Attempt>(initial)
  const [confirm, setConfirm] = useState(false)
  const mountedAt = useRef(Date.now())
  const [now, setNow] = useState(Date.now())
  const gridRef = useRef<HTMLDivElement>(null)
  const practice = a.mode === 'practice'
  const qs = exam.questions
  const i = Math.min(a.current, qs.length - 1)
  const q = qs[i]
  const picked = a.answers[q.id] ?? []
  const checked = a.checked.includes(q.id)
  const elapsed = a.elapsedMs + (now - mountedAt.current)
  const passage = exam.passages?.[q.sourceChunkId]

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // Save every change, with the time spent so far.
  const latest = useRef(a)
  latest.current = a
  const persist = useCallback((next: Attempt) => {
    const spent = Date.now() - mountedAt.current
    mountedAt.current = Date.now()
    const saved = { ...next, elapsedMs: next.elapsedMs + spent, updatedAt: new Date().toISOString() }
    setA(saved)
    void api.exams.saveAttempt(saved)
    return saved
  }, [])
  useEffect(() => () => void persist(latest.current), [persist])

  const update = (patch: Partial<Attempt>): void => {
    setA((cur) => {
      const next = { ...cur, ...patch }
      void api.exams.saveAttempt({ ...next, elapsedMs: next.elapsedMs + (Date.now() - mountedAt.current), updatedAt: new Date().toISOString() })
      return next
    })
  }

  const pick = (id: string): void => {
    if (practice && checked) return
    const cur = a.answers[q.id] ?? []
    const next = q.type === 'multi' ? (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]) : [id]
    update({ answers: { ...a.answers, [q.id]: next } })
  }
  const goTo = (n: number): void => {
    setConfirm(false)
    update({ current: Math.max(0, Math.min(qs.length - 1, n)) })
  }
  const check = (): void => {
    if (!picked.length || checked) return
    update({ checked: [...a.checked, q.id] })
  }
  const finish = (): void => {
    const done = persist({ ...a, finishedAt: new Date().toISOString() })
    latest.current = done
    go({ name: 'results', attemptId: a.id })
  }
  const unanswered = qs.filter((x) => !(a.answers[x.id] ?? []).length).length
  const tryFinish = (): void => {
    if (!practice && unanswered && !confirm) setConfirm(true)
    else finish()
  }
  const saveAndExit = (): void => {
    latest.current = persist(a)
    go({ name: 'exams' })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement) return
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') return tryFinish()
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const n = Number(e.key)
      if (n >= 1 && n <= q.options.length) return pick(q.options[n - 1].id)
      if (e.key === 'ArrowRight') return goTo(i + 1)
      if (e.key === 'ArrowLeft') return goTo(i - 1)
      if (e.key === 'Enter' && practice) {
        e.preventDefault()
        return checked ? (i === qs.length - 1 ? finish() : goTo(i + 1)) : check()
      }
      if (e.key.toLowerCase() === 'f' && !practice) return update({ flagged: a.flagged.includes(q.id) ? a.flagged.filter((x) => x !== q.id) : [...a.flagged, q.id] })
      if (e.key.toLowerCase() === 'g') return (gridRef.current?.querySelector('button') as HTMLButtonElement | null)?.focus()
      if (e.key.toLowerCase() === 's' && practice && checked && passage) return void api.source.open(passage)
      if (e.key === '?') return setShowKeys(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const progress = practice ? a.checked.length / qs.length : (qs.length - unanswered) / qs.length
  const marks = practice && checked ? optionMarks(q, picked) : null
  const rightCount = a.checked.filter((id) => isRight(qs.find((x) => x.id === id)!, a.answers[id])).length

  return (
    <div className="taking">
      <div className="topbar taking-bar">
        <Mark height={18} />
        <span className="mono ellipsis" style={{ fontSize: 14, fontWeight: 700, maxWidth: 240 }} title={exam.title}>
          {exam.title ?? 'Practice paper'}
        </span>
        <span className={`mode-badge${practice ? ' mode-badge-practice' : ''}`}>{practice ? 'Practice' : 'Exam'}</span>
        <div className="qstrip" ref={gridRef}>
          {qs.map((x, k) => {
            const ans = (a.answers[x.id] ?? []).length > 0
            const done = practice ? a.checked.includes(x.id) : ans
            const flag = a.flagged.includes(x.id)
            const ok = practice && done ? isRight(x, a.answers[x.id]) : null
            return (
              <button type="button" key={x.id} className={`qcell${k === i ? ' qcell-now' : done ? ' qcell-done' : ''}`} onClick={() => goTo(k)} title={flag ? 'Flagged' : undefined}>
                {k + 1}
                {flag && <span className="qflag" />}
                {ok !== null && <span className="qbar" style={{ background: ok ? 'var(--qvac-acqua)' : 'var(--fg-3)' }} />}
              </button>
            )
          })}
        </div>
        <span className="mono" style={{ fontSize: 12, color: 'var(--fg-3)', whiteSpace: 'nowrap' }}>
          {practice ? `${rightCount} right · ${a.checked.length - rightCount} to reread` : `${qs.length - unanswered}/${qs.length} answered${a.flagged.length ? ` · ${a.flagged.length} flagged` : ''}`}
        </span>
        <span style={{ flex: 1 }} />
        {!practice && (
          <span className="mono tnum" style={{ fontSize: 12, color: 'var(--fg-3)' }}>
            {clock(elapsed)}
          </span>
        )}
        <button type="button" className="link-btn" style={{ color: 'var(--fg-2)', whiteSpace: 'nowrap' }} onClick={saveAndExit}>
          Save &amp; exit
        </button>
        <Btn size="sm" onClick={tryFinish} style={{ height: 32 }}>
          Finish
        </Btn>
      </div>
      <div className="progress-line">
        <div style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="question-pane">
        <div className="question-col">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
            <span className="mono" style={{ fontSize: 13, fontWeight: 700 }}>
              Question {i + 1} <span style={{ color: 'var(--fg-3)', fontWeight: 400 }}>of {qs.length}</span>
            </span>
            <ShapeHint q={q} />
            <span className="label">· {DIFFICULTY_LABEL[exam.config.difficulty]}</span>
            <span style={{ flex: 1 }} />
            <span className="mono" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--fg-3)' }}>
              <span className={`dot ${modelOn ? 'dot-live' : 'dot-off'}`} style={{ width: 6, height: 6 }} />
              {modelLabel} · offline
            </span>
          </div>
          <p className="stem">
            <Rich text={q.stem} codeSize={17} />
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: practice && checked ? 8 : 10 }}>
            {q.options.map((o, k) => (
              <OptionRow key={o.id} q={q} o={o} i={k} picked={picked.includes(o.id)} mark={marks?.[o.id]} onPick={() => pick(o.id)} />
            ))}
          </div>
          {marks && (
            <div className="feedback">
              <div className="mono" style={{ fontSize: 16, fontWeight: 700 }}>
                {feedbackLine(q, picked)}
              </div>
              <p style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--fg-2)', margin: 0 }}>
                <Rich text={q.explanation} codeSize={13} />
              </p>
              {passage && (
                <div className="feedback-foot">
                  <span className="ellipsis" style={{ color: 'var(--fg-2)' }}>
                    {trail(topicPath(passage.headingTrail))}
                  </span>
                  <span style={{ flex: 1 }} />
                  <button type="button" className="link-btn accent ellipsis" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400, fontSize: 12, maxWidth: '50%' }} onClick={() => void api.source.open(passage)}>
                    {sourceLabel(passage)} ↗
                  </button>
                </div>
              )}
            </div>
          )}
          <div style={{ flex: 1, minHeight: 20 }} />
          {confirm && (
            <div className="confirm">
              <span style={{ flex: 1 }}>
                {unanswered} question{unanswered === 1 ? '' : 's'} not answered yet. Unanswered counts as wrong.
              </span>
              <Btn size="sm" variant="quiet" onClick={() => setConfirm(false)}>
                Keep going
              </Btn>
              <Btn size="sm" variant="primary" onClick={finish}>
                Finish anyway
              </Btn>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Btn onClick={() => goTo(i - 1)} disabled={i === 0}>
              ← Back
            </Btn>
            {!practice && (
              <Btn variant="quiet" kbd="F" onClick={() => update({ flagged: a.flagged.includes(q.id) ? a.flagged.filter((x) => x !== q.id) : [...a.flagged, q.id] })} style={{ color: a.flagged.includes(q.id) ? 'var(--data-amber)' : undefined }}>
                <Icon name="flag" size={14} />
                {a.flagged.includes(q.id) ? 'Flagged' : 'Flag'}
              </Btn>
            )}
            <span style={{ flex: 1 }} />
            {practice ? (
              checked ? (
                <Btn variant="primary" kbd="→" onClick={() => (i === qs.length - 1 ? finish() : goTo(i + 1))}>
                  {i === qs.length - 1 ? 'See results' : 'Next question'}
                </Btn>
              ) : (
                <Btn variant="primary" kbd="↵" disabled={!picked.length} onClick={check}>
                  Check answer
                </Btn>
              )
            ) : i === qs.length - 1 ? (
              <Btn variant="primary" kbd="⌘↵" onClick={tryFinish}>
                Finish exam
              </Btn>
            ) : (
              <Btn variant="primary" onClick={() => goTo(i + 1)}>
                Next →
              </Btn>
            )}
          </div>
          <div className="hints-line">
            <b>1–{Math.min(9, q.options.length)}</b> {q.type === 'multi' ? 'toggle' : 'choose'} · <b>← →</b> move · {practice ? (
              <>
                <b>↵</b> check · <b>S</b> source
              </>
            ) : (
              <>
                <b>F</b> flag
              </>
            )} · <b>?</b> all keys
          </div>
        </div>
      </div>
    </div>
  )
}

