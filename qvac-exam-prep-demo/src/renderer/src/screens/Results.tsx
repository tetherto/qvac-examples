// 06 Results: topics first. Each topic with a miss links to the pages to
// reread, from your own material.

import { useEffect } from 'react'
import { grade, splitTopics, summary, verdict, type TopicScore } from '../../../core/grade'
import { topicPath } from '../../../core/topics'
import type { Attempt, Difficulty, Exam, Passage } from '../../../core/types'
import { useApp } from '../state'
import { Btn, DIFFICULTY_LABEL, duration, trail } from '../ui'

const api = window.api

/** One link per sub-topic: "State › Locking · p. 88–91". */
function rereadLinks(exam: Exam, t: TopicScore): { label: string; passage: Passage }[] {
  const groups = new Map<string, Passage[]>()
  for (const id of t.missedIds) {
    const q = exam.questions.find((x) => x.id === id)
    const p = q && exam.passages?.[q.sourceChunkId]
    if (!p) continue
    const key = `${p.sourceId}|${topicPath(p.headingTrail).slice(0, 2).join('/')}`
    groups.set(key, [...(groups.get(key) ?? []), p])
  }
  return [...groups.values()].map((ps) => {
    const p = ps[0]
    if (p.sourceType === 'url') {
      return { label: trail(topicPath(p.headingTrail).slice(-2)), passage: p }
    }
    const pages = ps.map((x) => x.pageNumber).filter((n): n is number => !!n)
    const lo = Math.min(...pages)
    const hi = Math.max(...pages)
    const range = pages.length ? ` · p. ${lo === hi ? lo : `${lo}–${hi}`}` : ''
    return { label: `${trail(topicPath(p.headingTrail).slice(0, 2))}${range}`, passage: p }
  })
}

function Pips({ t, big }: { t: TopicScore; big?: boolean }) {
  const cols = Math.max(5, t.total)
  const ids = t.questionIds
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 4 }}>
      {ids.map((id) => (
        <span key={id} className={t.missedIds.includes(id) ? 'pip-miss' : 'pip-hit'} style={{ height: big ? 22 : 12, borderRadius: big ? 3 : 2 }} />
      ))}
    </div>
  )
}

export function Results({ attemptId }: { attemptId: string }) {
  const { exams, attempts, go } = useApp()
  const attempt = attempts.find((a) => a.id === attemptId)
  const exam = exams.find((e) => e.id === attempt?.examId)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter' && attempt && exam) {
        const g = grade(exam, attempt)
        go({ name: 'review', attemptId, filter: g.toReread.length ? 'reread' : 'all', index: 0 })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!attempt || !exam) return <div className="screen center">This paper is no longer here.</div>
  const g = grade(exam, attempt)
  const { reread, solid } = splitTopics(g)
  const worst = reread[0]

  // Across every finished sitting: by depth, and the trend.
  const finished = attempts
    .filter((a) => a.finishedAt)
    .map((a) => ({ a, e: exams.find((x) => x.id === a.examId) }))
    .filter((x): x is { a: Attempt; e: Exam } => !!x.e)
    .sort((x, y) => x.a.finishedAt!.localeCompare(y.a.finishedAt!))
  const depth = new Map<Difficulty, { right: number; total: number }>()
  for (const { a, e } of finished) {
    const gg = grade(e, a)
    const d = depth.get(gg.difficulty) ?? { right: 0, total: 0 }
    d.right += gg.right
    d.total += gg.total
    depth.set(gg.difficulty, d)
  }
  const trend = finished.slice(-8).map(({ a, e }) => ({ id: a.id, g: grade(e, a), n: e.number }))
  const depthNote = (() => {
    const rows = (['recall', 'applied', 'scenario'] as Difficulty[]).filter((d) => depth.get(d)?.total)
    if (rows.length < 2) return null
    const pct = (d: Difficulty) => depth.get(d)!.right / depth.get(d)!.total
    const sorted = [...rows].sort((x, y) => pct(y) - pct(x))
    return `Best at ${DIFFICULTY_LABEL[sorted[0]].toLowerCase()}. Next: ${DIFFICULTY_LABEL[sorted.at(-1)!].toLowerCase()}.`
  })()

  return (
    <div className="screen" style={{ padding: '40px 48px 32px', gap: 28 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 28 }}>
        <div className="score">
          {g.right}
          <span>/{g.total}</span>
        </div>
        <div style={{ paddingBottom: 2 }}>
          <div className="eyebrow" style={{ color: 'var(--fg-3)', marginBottom: 8 }}>
            {exam.title ?? 'Practice paper'}{exam.title?.includes(String(exam.number)) ? '' : ` · No. ${exam.number}`} · {attempt.mode} · {duration(attempt.elapsedMs / 1000)}
          </div>
          <div className="mono" style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>
            {verdict(g)}
          </div>
          <p style={{ fontSize: 15, lineHeight: 1.55, color: 'var(--fg-2)', margin: 0, maxWidth: 560 }}>
            {summary(g)}
            {g.removed ? ` ${g.removed} question${g.removed === 1 ? '' : 's'} you marked faulty ${g.removed === 1 ? 'is' : 'are'} left out.` : ''}
          </p>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 24, flex: 1, minHeight: 0 }}>
        <div className="scroll" style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          {reread.length > 0 && (
            <div className="card" style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                <span className="label" style={{ color: 'var(--fg-1)' }}>
                  Worth another read
                </span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                  Pages are from your own material
                </span>
              </div>
              {reread.map((t) => (
                <div key={t.topic}>
                  <div className="topic-row">
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 500 }}>{t.topic}</div>
                      {t.subtopics.length > 0 && (
                        <div className="mono ellipsis" style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2 }}>
                          {t.subtopics.slice(0, 3).join(' · ')}
                        </div>
                      )}
                    </div>
                    <Pips t={t} big />
                    <span className="mono" style={{ fontSize: 16, fontWeight: 700, textAlign: 'right' }}>
                      {t.right}/{t.total}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '0 0 12px 220px' }}>
                    {rereadLinks(exam, t).map((l) => (
                      <button type="button" key={l.label} className="reread-link" onClick={() => void api.source.open(l.passage)}>
                        {l.label} ↗
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {solid.length > 0 && (
            <div style={{ padding: '4px 24px', display: 'flex', flexDirection: 'column' }}>
              <div className="label" style={{ padding: '8px 0' }}>
                Solid
              </div>
              {solid.map((t) => (
                <div key={t.topic} className="topic-row" style={{ padding: '10px 0' }}>
                  <div style={{ fontSize: 15 }}>{t.topic}</div>
                  <Pips t={t} />
                  <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg-2)', textAlign: 'right' }}>
                    {t.right}/{t.total}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {g.toReread.length > 0 && (
              <Btn variant="primary" block kbd="↵" style={{ height: 46 }} onClick={() => go({ name: 'review', attemptId, filter: 'reread', index: 0 })}>
                Review the {g.toReread.length} to reread
              </Btn>
            )}
            <Btn variant={g.toReread.length ? 'outline' : 'primary'} block onClick={() => go({ name: 'review', attemptId, filter: 'all', index: 0 })}>
              Review all {exam.questions.length}
            </Btn>
            {worst && (
              <Btn block onClick={() => go({ name: 'setup', preset: { ...exam.config, title: undefined, topics: [worst.topic] } })} title={`A new exam on ${worst.topic} only`}>
                <span className="ellipsis">New exam on {worst.topic}</span>
              </Btn>
            )}
          </div>
          <div className="side-block">
            <div className="label">By depth</div>
            {(['recall', 'applied', 'scenario'] as Difficulty[]).map((d) => {
              const v = depth.get(d)
              return (
                <div key={d} className="depth-row">
                  <span style={{ color: 'var(--fg-2)' }}>{DIFFICULTY_LABEL[d]}</span>
                  <span className="bar" style={{ height: 6 }}>
                    <div style={{ width: v?.total ? `${(v.right / v.total) * 100}%` : 0 }} />
                  </span>
                  <span style={{ textAlign: 'right', color: v?.total ? 'var(--fg-1)' : 'var(--fg-disabled)' }}>{v?.total ? `${v.right}/${v.total}` : '—'}</span>
                </div>
              )
            })}
            <p style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--fg-3)', margin: '4px 0 0' }}>{depthNote ?? 'Across all your papers.'}</p>
          </div>
          {trend.length > 1 && (
            <div className="side-block">
              <div className="label">Over time</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 48 }}>
                {trend.map((t) => (
                  <span key={t.id} style={{ flex: 1, height: `${Math.max(6, (t.g.right / Math.max(1, t.g.total)) * 100)}%`, background: t.id === attemptId ? 'var(--qvac-acqua)' : 'var(--surface-3)', borderRadius: 2 }} />
                ))}
              </div>
              <div className="mono" style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                {trend.map((t) => `${Math.round((t.g.right / Math.max(1, t.g.total)) * 100)}%`).join(' → ')} · last {trend.length} papers
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
