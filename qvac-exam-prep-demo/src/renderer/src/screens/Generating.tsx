// 04 Generating: real progress, every set-aside draft named, no spoilers.
// Also the two ways a run can end short: an error (04b), or material too
// thin for the count asked (04c). Never filler.

import { useEffect, useState } from 'react'
import { isReady, useApp, type GenView } from '../state'
import { Btn, Eyebrow, clock, duration } from '../ui'

/** Highlights the quoted evidence inside the passage, or the sentence closest to it. */
export function Highlighted({ text, evidence, max }: { text: string; evidence?: string; max?: number }) {
  let body = text.replace(/\s+\n/g, '\n')
  let start = -1
  let end = -1
  if (evidence) {
    const e = evidence.trim().replace(/[.…]+$/, '')
    start = body.toLowerCase().indexOf(e.toLowerCase())
    if (start >= 0) end = start + e.length
    else {
      // Best-overlap sentence: the gate accepted the evidence on word overlap.
      const words = new Set(e.toLowerCase().match(/[a-z0-9_-]{4,}/g) ?? [])
      const sentences = [...body.matchAll(/[^.!?\n]+[.!?]?/g)]
      let best = 0
      for (const m of sentences) {
        const ws = m[0].toLowerCase().match(/[a-z0-9_-]{4,}/g) ?? []
        const hit = ws.filter((w) => words.has(w)).length
        if (hit > best) {
          best = hit
          start = m.index!
          end = m.index! + m[0].length
        }
      }
    }
  }
  if (max && body.length > max) {
    // Keep the highlight in view: trim around it.
    const from = start > max / 2 ? Math.max(0, start - Math.floor(max / 3)) : 0
    const to = Math.min(body.length, from + max)
    const pre = from > 0 ? '…' : ''
    const post = to < body.length ? '…' : ''
    body = pre + body.slice(from, to) + post
    if (start >= 0) {
      start = start - from + pre.length
      end = Math.min(end - from + pre.length, body.length)
    }
  }
  if (start < 0) return <>{body}</>
  return (
    <>
      {body.slice(0, start)}
      <span className="hl">{body.slice(start, end)}</span>
      {body.slice(end)}
    </>
  )
}

function Segments({ target, done, failedAt }: { target: number; done: number; failedAt?: boolean }) {
  return (
    <div className="segments" style={{ gridTemplateColumns: `repeat(${target}, 1fr)` }}>
      {Array.from({ length: target }, (_, i) => (
        <span key={i} className={i < done ? 'seg-done' : i === done ? (failedAt ? 'seg-failed' : 'seg-now') : ''} />
      ))}
    </div>
  )
}

/** The writing screen: how many are ready, how long it has taken, and two ways out. */
function Running({ gen }: { gen: GenView }) {
  const { choices, cancelGen, keepGen, sit, statuses, settings } = useApp()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const target = gen.config.questionCount
  const n = gen.accepted.length
  const elapsed = (now - gen.startedAt) / 1000
  const loading = gen.phase === 'starting' || statuses[gen.config.modelKey]?.phase === 'loading'
  // Estimate from this run once two questions are in; before that, from the
  // last run on this model, if there was one. Never a made-up number.
  const firstAt = gen.feed.length ? gen.feed[gen.feed.length - 1].at : 0
  const rate = n >= 2 && firstAt ? (now - firstAt) / 1000 / (n - 1) : settings.secondsPerQuestion[gen.config.modelKey] ?? 0
  const left = rate ? Math.max(0, rate * (target - n) - (n ? 0 : elapsed)) : 0
  const model = choices.find((c) => c.key === gen.config.modelKey)
  const status = loading ? 'Loading the model into memory…' : n === 0 ? 'Writing the first questions…' : n < target ? 'Writing and checking…' : 'Finishing…'

  const start = async (): Promise<void> => {
    const exam = await keepGen()
    if (exam) await sit(exam)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') void cancelGen()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cancelGen])

  return (
    <div className="screen center">
      <div style={{ width: 640, display: 'flex', flexDirection: 'column', gap: 28 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span className={`dot ${loading ? 'dot-warming' : 'dot-live'}`} />
            <Eyebrow style={{ marginBottom: 0 }}>
              {gen.config.title ?? 'Practice paper'} · {model?.label} · on this machine
            </Eyebrow>
          </div>
          <div className="big-num" style={{ fontSize: 72 }}>
            {n}
            <span style={{ color: 'var(--fg-3)' }}>/{target}</span>
          </div>
          <div className="mono" style={{ fontSize: 15, color: 'var(--fg-2)', marginTop: 10 }}>
            questions ready
          </div>
        </div>
        <Segments target={target} done={n} />
        <div className="gen-stats" style={{ marginTop: -16 }}>
          <span>{status}</span>
          <span style={{ flex: 1 }} />
          <span>
            Elapsed <b>{clock(elapsed * 1000)}</b>
          </span>
          {left > 0 && (
            <span>
              About <b>{duration(left)}</b> left
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Btn variant="primary" disabled={!n} onClick={() => void start()}>
            {n ? `Start with ${n}` : 'Start'}
          </Btn>
          <Btn variant="quiet" kbd="Esc" onClick={() => void cancelGen()}>
            Cancel
          </Btn>
        </div>
      </div>
    </div>
  )
}

function plainError(msg: string): string {
  if (/memory|alloc|kv cache|oom/i.test(msg)) return 'The model ran out of memory.'
  if (/no usable material/i.test(msg)) return 'Nothing in the material matches that focus.'
  if (/not.*download|ENOENT|not found/i.test(msg)) return "The model isn't on this machine yet."
  return 'Generation stopped.'
}

function Failed({ gen }: { gen: GenView }) {
  const { keepGen, sit, startGen, cancelGen, choices, statuses, setSettings, go } = useApp()
  const n = gen.accepted.length
  const target = gen.config.questionCount
  const order = ['fast', 'balanced', 'best'] as const
  const smaller = order
    .slice(0, order.indexOf(gen.config.modelKey))
    .reverse()
    .map((k) => choices.find((c) => c.key === k)!)
    .find((c) => c && isReady(statuses[c.key]))
  const memory = /memory|alloc|kv cache|oom/i.test(gen.error ?? '')
  return (
    <div className="screen center">
      <div style={{ width: 600, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <Segments target={target} done={n} failedAt />
        <div>
          <Eyebrow color="var(--fg-3)" style={{ marginBottom: 12 }}>
            Generation stopped at question {n + 1}
          </Eyebrow>
          <h1 className="h1" style={{ lineHeight: 1.2, margin: '0 0 14px' }}>
            {plainError(gen.error ?? '')}
          </h1>
          <p className="lead">
            {memory ? 'Other apps may be using RAM. ' : ''}
            {n ? `Your ${n} finished question${n === 1 ? ' is' : 's are'} kept.` : 'No question had finished yet.'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Btn variant="primary" onClick={() => void startGen(gen.config)}>
            Try again
          </Btn>
          {n > 0 && (
            <Btn
              onClick={async () => {
                const exam = await keepGen()
                if (exam) await sit(exam)
              }}
            >
              Take the {n} now
            </Btn>
          )}
          {smaller ? (
            <Btn
              variant="quiet"
              onClick={async () => {
                await setSettings({ modelKey: smaller.key })
                await startGen({ ...gen.config, modelKey: smaller.key })
              }}
            >
              Use {smaller.label} instead · {(smaller.bytes / 1e9).toFixed(1)} GB
            </Btn>
          ) : (
            <Btn
              variant="quiet"
              onClick={() => {
                void cancelGen()
                go({ name: 'setup', preset: gen.config })
              }}
            >
              Change the setup
            </Btn>
          )}
        </div>
        <div className="details">
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--fg-2)', marginBottom: 4 }}>
            <span>Details</span>
            <button type="button" className="link-btn" onClick={() => void navigator.clipboard.writeText(gen.error ?? '')}>
              Copy
            </button>
          </div>
          {gen.error}
          <br />
          model: {gen.config.modelKey} · {n} of {target} accepted · {gen.rejected} set aside
        </div>
      </div>
    </div>
  )
}

function Finished({ gen }: { gen: GenView }) {
  const { sit, clearGen, go } = useApp()
  const done = gen.done!
  const exam = done.exam
  const n = exam.questions.length
  const start = (): void => {
    clearGen()
    void sit(exam)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter' && n) start()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!n) {
    return (
      <div className="screen center">
        <div style={{ width: 600, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <h1 className="h1">No question passed the checks.</h1>
          <p className="lead">{done.shortBy?.reason}</p>
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn
              variant="primary"
              onClick={() => {
                clearGen()
                go({ name: 'setup', preset: gen.config })
              }}
            >
              Change the setup
            </Btn>
            <Btn variant="quiet" onClick={() => void window.api.gen.revealLog()}>
              Show the log
            </Btn>
          </div>
        </div>
      </div>
    )
  }

  const short = done.shortBy
  const thin = (done.topics ?? []).filter((t) => t.sections > 0)
  const leanest = thin[0]
  return (
    <div className="screen center">
      <div style={{ width: 640, display: 'flex', flexDirection: 'column', gap: 26 }}>
        <div>
          <Eyebrow style={{ marginBottom: 12 }}>
            Ready · {n} questions · {duration(done.seconds)}
          </Eyebrow>
          <h1 className="h1" style={{ lineHeight: 1.2, margin: '0 0 14px' }}>
            {short ? `${n} good questions, not ${done.target}.` : `${n} questions, all checked.`}
          </h1>
          <p className="lead">{short ? "No filler. Here's where it ran short:" : 'Each one was checked against your material.'}</p>
        </div>
        {short && thin.length > 0 && (
          <div className="card" style={{ padding: '6px 20px' }}>
            {thin.slice(0, 5).map((t, i) => (
              <div key={t.topic} className="thin-row" style={{ borderBottom: i < Math.min(thin.length, 5) - 1 ? '0.5px solid var(--border-2)' : 'none' }}>
                <span className="mono" style={{ fontSize: 13 }}>
                  {t.topic}
                </span>
                <span className="mono" style={{ fontSize: 12, color: 'var(--fg-3)' }}>
                  {t.sections} section{t.sections === 1 ? '' : 's'}
                </span>
                <span className="mono" style={{ fontSize: 12, color: 'var(--fg-2)', textAlign: 'right' }}>
                  {t.questions} question{t.questions === 1 ? '' : 's'}
                </span>
              </div>
            ))}
          </div>
        )}
        {short && <p style={{ fontSize: 13, color: 'var(--fg-3)', margin: 0 }}>{short.reason}</p>}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Btn variant="primary" kbd="↵" onClick={start}>
            {short ? `Start the ${n}-question exam` : 'Start the exam'}
          </Btn>
          {short && leanest && (
            <Btn
              onClick={() => {
                clearGen()
                go({ name: 'library' })
              }}
            >
              Add material on {leanest.topic}
            </Btn>
          )}
          {short && gen.config.topics?.length ? (
            <Btn
              variant="quiet"
              onClick={() => {
                clearGen()
                go({ name: 'setup', preset: { ...gen.config, topics: undefined } })
              }}
            >
              Widen topic focus
            </Btn>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function Generating() {
  const { gen } = useApp()
  if (!gen) return null
  if (gen.phase === 'error') return <Failed gen={gen} />
  if (gen.phase === 'done' && gen.done) return <Finished gen={gen} />
  return <Running gen={gen} />
}

