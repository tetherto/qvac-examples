// 07 Review, one question at a time. A wrong answer opens its source: the
// passage, the heading trail, the file and the page. A right answer takes
// one line. "This question isn't right" takes a question out of the score.

import { useEffect, useRef, useState } from 'react'
import { grade, isRight } from '../../../core/grade'
import { topicPath } from '../../../core/topics'
import type { Attempt, DudReason, Passage, Question } from '../../../core/types'
import { useApp } from '../state'
import { Btn, DIFFICULTY_LABEL, Icon, Rich, fileName, trail } from '../ui'
import { Highlighted } from './Generating'
import { sourceLabel } from './Taking'

const api = window.api

const DUD: { key: DudReason; label: string }[] = [
  { key: 'wrong_key', label: 'The marked answer is wrong' },
  { key: 'several_fit', label: 'More than one answer fits' },
  { key: 'not_in_material', label: "It isn't in my material" },
  { key: 'unclear', label: 'Unclear wording' }
]

const shape = (q: Question): string => (q.type === 'multi' ? 'pick all that apply' : q.type === 'truefalse' ? 'true or false' : 'pick one')

function FlagMenu({ attempt, q }: { attempt: Attempt; q: Question }) {
  const [open, setOpen] = useState(false)
  const marked = attempt.duds[q.id]
  const save = (duds: Attempt['duds']): void => {
    void api.exams.saveAttempt({ ...attempt, duds, updatedAt: new Date().toISOString() })
    setOpen(false)
  }
  if (marked) {
    return (
      <span className="mono" style={{ fontSize: 11, color: 'var(--fg-3)', display: 'flex', gap: 10, alignItems: 'center' }}>
        <Icon name="flag" size={13} />
        Left out of your score: {DUD.find((d) => d.key === marked)?.label.toLowerCase()}
        <button
          type="button"
          className="link-btn accent"
          onClick={() => {
            const { [q.id]: _gone, ...rest } = attempt.duds
            save(rest)
          }}
        >
          Undo
        </button>
      </span>
    )
  }
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" className={`flag-btn${open ? ' flag-btn-on' : ''}`} onClick={() => setOpen(!open)}>
        <Icon name="flag" size={13} />
        This question isn't right
      </button>
      {open && (
        <div className="popover" style={{ right: 0, bottom: 46, width: 340 }}>
          <div className="mono" style={{ fontSize: 14, fontWeight: 700 }}>
            Thanks. What's off?
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {DUD.map((d) => (
              <button type="button" key={d.key} className="popover-item" onClick={() => save({ ...attempt.duds, [q.id]: d.key })}>
                {d.label}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--fg-3)', margin: 0 }}>Removed from your score. Stays on this machine.</p>
        </div>
      )}
    </div>
  )
}

function SourcePanel({ q, passage, onCollapse }: { q: Question; passage: Passage; onCollapse: () => void }) {
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    void api.source.exists(passage).then((ok) => setMissing(!ok))
  }, [passage])
  const t = topicPath(passage.headingTrail)
  const open = async (): Promise<void> => {
    const r = await api.source.open(passage)
    if (r.missing) setMissing(true)
  }
  return (
    <div className="source-pane">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="eyebrow" style={{ marginBottom: 0 }}>
          Where this comes from
        </span>
        <button type="button" className="link-btn" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }} onClick={onCollapse}>
          Collapse <b style={{ color: 'var(--fg-2)' }}>S</b>
        </button>
      </div>
      <div className="mono" style={{ fontSize: 14, color: 'var(--fg-2)', lineHeight: 1.5 }}>
        {passage.headingTrail.slice(0, -1).map((s, i) => (
          <span key={i}>
            {s} <span style={{ color: 'var(--fg-3)' }}>›</span>{' '}
          </span>
        ))}
        <span style={{ color: 'var(--fg-1)', fontWeight: 700 }}>{passage.headingTrail.at(-1)}</span>
      </div>
      <div className="passage quoted scroll" style={{ minHeight: 0, flex: '0 1 auto' }}>
        <Highlighted text={passage.text} evidence={q.evidence} />
      </div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--fg-3)' }}>
        Highlighted: the sentence this question was written from
      </div>
      <div style={{ flex: 1 }} />
      {missing ? (
        <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="mono" style={{ fontSize: 13, color: 'var(--fg-2)' }}>
            {trail(t)}
          </div>
          <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--fg-2)', margin: 0 }}>File moved. The passage was saved, so review still works.</p>
          <button
            type="button"
            className="link-btn accent"
            style={{ width: 'max-content' }}
            onClick={async () => {
              if (await api.library.locate(passage.sourceId)) setMissing(false)
            }}
          >
            Locate the file…
          </button>
        </div>
      ) : (
        <div className="file-card">
          <Icon name={passage.sourceType === 'url' ? 'globe' : 'fileText'} size={20} width={1.6} color="var(--fg-2)" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="mono ellipsis" style={{ fontSize: 13 }}>
              {passage.sourceType === 'url' ? passage.sourceRef.replace(/^https?:\/\//, '') : fileName(passage.sourceRef)}
            </div>
            <div className="mono" style={{ fontSize: 12, color: 'var(--fg-3)' }}>
              {passage.pageNumber ? `page ${passage.pageNumber} · ` : ''}
              {t.at(-1)}
            </div>
          </div>
          <Btn variant="accent" size="sm" onClick={() => void open()}>
            {passage.sourceType === 'url' ? 'Open page' : passage.pageNumber ? `Open at p. ${passage.pageNumber}` : 'Open file'}
            <Icon name="external" size={12} width={2} />
          </Btn>
        </div>
      )}
    </div>
  )
}

function AnswerCard({ kind, label, texts }: { kind: 'wrong' | 'right' | 'skip'; label: string; texts: string[] }) {
  return (
    <div className={`answer-card answer-${kind}`}>
      <span className="answer-label">{label}</span>
      {texts.map((t, i) => (
        <span key={i} style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--fg-1)' }}>
          <Rich text={t} codeSize={13} />
        </span>
      ))}
    </div>
  )
}

export function Review({ attemptId, filter, index }: { attemptId: string; filter: 'reread' | 'all'; index: number }) {
  const { exams, attempts, go } = useApp()
  const attempt = attempts.find((a) => a.id === attemptId)
  const exam = exams.find((e) => e.id === attempt?.examId)
  const [showSource, setShowSource] = useState<boolean | null>(null)
  const rightRef = useRef(false)

  const list = attempt && exam ? (filter === 'reread' ? grade(exam, attempt).toReread : exam.questions.map((q) => q.id)) : []
  // A question marked faulty leaves the reread list; keep it on screen until the user moves on.
  const i = Math.min(index, Math.max(0, list.length - 1))
  const q = exam?.questions.find((x) => x.id === list[i])
  const nav = (n: number, f = filter): void => {
    setShowSource(null)
    go({ name: 'review', attemptId, filter: f, index: n })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey) return
      if (e.key === 'ArrowRight' && i < list.length - 1) nav(i + 1)
      if (e.key === 'ArrowLeft' && i > 0) nav(i - 1)
      if (e.key.toLowerCase() === 's') setShowSource((v) => !(v ?? !rightRef.current))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!attempt || !exam) return <div className="screen center">This paper is no longer here.</div>
  const g = grade(exam, attempt)
  const passage = q ? exam.passages?.[q.sourceChunkId] : undefined
  const picked = q ? attempt.answers[q.id] ?? [] : []
  const right = q ? isRight(q, picked) : false
  rightRef.current = right
  const sourceOpen = showSource ?? !right
  const qNo = q ? exam.questions.indexOf(q) + 1 : 0
  const textOf = (ids: string[]): string[] => (q ? q.options.filter((o) => ids.includes(o.id)).map((o) => o.text) : [])

  const header = (
    <div className="review-bar">
      <span className="mono" style={{ fontSize: 13, fontWeight: 700 }}>
        Review · {exam.title ?? `paper ${exam.number}`}
      </span>
      <div className="seg seg-sm">
        <button type="button" className={filter === 'reread' ? 'seg-on' : ''} onClick={() => nav(0, 'reread')}>
          To reread · {g.toReread.length}
        </button>
        <button type="button" className={filter === 'all' ? 'seg-on' : ''} onClick={() => nav(0, 'all')}>
          All · {exam.questions.length}
        </button>
      </div>
      <span style={{ flex: 1 }} />
      {filter === 'reread' && list.length <= 14 && (
        <div style={{ display: 'flex', gap: 4 }}>
          {list.map((id, k) => (
            <button type="button" key={id} className={`num-chip${k === i ? ' num-chip-on' : ''}`} onClick={() => nav(k)}>
              {exam.questions.findIndex((x) => x.id === id) + 1}
            </button>
          ))}
        </div>
      )}
      <span className="mono" style={{ fontSize: 12, color: 'var(--fg-3)' }}>
        {list.length ? `${i + 1} of ${list.length}` : ''}
      </span>
      <Btn variant="quiet" size="sm" onClick={() => go({ name: 'results', attemptId })}>
        Results
      </Btn>
    </div>
  )

  if (!q) {
    return (
      <div className="screen" style={{ padding: 0 }}>
        {header}
        <div className="screen center">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'flex-start' }}>
            <div className="mono" style={{ fontSize: 18, fontWeight: 700 }}>
              Nothing to reread.
            </div>
            <Btn onClick={() => nav(0, 'all')}>Review all {exam.questions.length}</Btn>
          </div>
        </div>
      </div>
    )
  }

  const meta = `Question ${qNo} · ${DIFFICULTY_LABEL[exam.config.difficulty]} · ${shape(q)}`
  const footer = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, position: 'relative' }}>
      <Btn size="sm" disabled={i === 0} onClick={() => nav(i - 1)}>
        ← Previous
      </Btn>
      <Btn variant="primary" size="sm" disabled={i >= list.length - 1} onClick={() => nav(i + 1)}>
        {filter === 'reread' ? 'Next to reread →' : 'Next →'}
      </Btn>
      <span style={{ flex: 1 }} />
      <FlagMenu attempt={attempt} q={q} />
    </div>
  )

  if (sourceOpen && passage) {
    return (
      <div className="screen" style={{ padding: 0 }}>
        {header}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: 0 }}>
          <div className="scroll" style={{ padding: '32px 40px 24px', display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="label">{meta}</span>
              {right && (
                <span className="label" style={{ color: 'var(--qvac-acqua)', display: 'flex', gap: 6, alignItems: 'center' }}>
                  <Icon name="check" size={12} width={3} />
                  You got this
                </span>
              )}
            </div>
            <p style={{ fontSize: 18, lineHeight: 1.55, margin: 0 }}>
              <Rich text={q.stem} codeSize={15} />
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {right ? (
                <AnswerCard kind="right" label="Your answer · correct" texts={textOf(picked)} />
              ) : (
                <>
                  {picked.length ? <AnswerCard kind="wrong" label="You answered" texts={textOf(picked)} /> : <AnswerCard kind="skip" label="You skipped this" texts={[]} />}
                  <AnswerCard kind="right" label={q.correct.length > 1 ? 'Correct answers' : 'Correct answer'} texts={textOf(q.correct)} />
                </>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="label">Why</div>
              <p style={{ fontSize: 15, lineHeight: 1.65, color: 'var(--fg-2)', margin: 0 }}>
                <Rich text={q.explanation} codeSize={13} />
              </p>
            </div>
            <div style={{ flex: 1 }} />
            {footer}
          </div>
          <SourcePanel q={q} passage={passage} onCollapse={() => setShowSource(false)} />
        </div>
      </div>
    )
  }

  return (
    <div className="screen" style={{ padding: 0 }}>
      {header}
      <div style={{ flex: 1, padding: '40px 0 28px', display: 'flex', justifyContent: 'center', minHeight: 0 }}>
        <div style={{ width: 720, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="label">{meta}</span>
            {right ? (
              <span className="label" style={{ color: 'var(--qvac-acqua)', display: 'flex', gap: 6, alignItems: 'center' }}>
                <Icon name="check" size={12} width={3} />
                You got this
              </span>
            ) : (
              <span className="label" style={{ color: 'var(--status-danger)' }}>
                {picked.length ? 'Missed' : 'Skipped'}
              </span>
            )}
          </div>
          <p style={{ fontSize: 19, lineHeight: 1.55, margin: 0 }}>
            <Rich text={q.stem} codeSize={16} />
          </p>
          {textOf(right ? picked : q.correct).map((t, k) => (
            <div key={k} className="answer-line">
              <Icon name="check" size={16} width={2.5} color="var(--qvac-acqua)" />
              <span className={/\s/.test(t) ? undefined : 'mono'} style={{ fontSize: /\s/.test(t) ? 15 : 14 }}>
                <Rich text={t} codeSize={13} />
              </span>
              <span style={{ flex: 1 }} />
              <span className="label" style={{ fontSize: 10 }}>
                {right ? 'Your answer · correct' : 'Correct answer'}
              </span>
            </div>
          ))}
          <p style={{ fontSize: 15, lineHeight: 1.65, color: 'var(--fg-2)', margin: 0 }}>
            <Rich text={q.explanation} codeSize={13} />
          </p>
          {passage && (
            <button type="button" className="source-line" onClick={() => setShowSource(true)}>
              <Icon name="chevronRight" size={12} width={2} color="var(--fg-3)" />
              <span style={{ color: 'var(--fg-3)' }}>Source</span>
              <span className="ellipsis" style={{ color: 'var(--fg-2)' }}>
                {trail(topicPath(passage.headingTrail))}
              </span>
              <span style={{ flex: 1 }} />
              <span style={{ color: 'var(--qvac-acqua)' }}>{sourceLabel(passage)} ↗</span>
            </button>
          )}
          <div style={{ flex: 1 }} />
          {footer}
        </div>
      </div>
    </div>
  )
}
