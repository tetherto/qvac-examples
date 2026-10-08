// ============================================================
// The debug screen (build steps 1 to 3).
//
// Not the product UI. It exists to prove the plumbing and to make the
// pipeline inspectable: what each source turned into, which chunks the
// junk filter dropped and why, and every question the gate accepted or
// rejected, live, with the reasons. Reached from Settings.
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import type {
  Chunk,
  Difficulty,
  DroppedChunk,
  GenEvent,
  ModelChoice,
  ModelKey,
  ModelStatus,
  Question,
  QuestionType,
  Rejection
} from '../../../core/types'
import type { SourceRow } from '../../../preload/index'

const api = window.api

function mb(n: number): string {
  return n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${Math.round(n / 1e6)} MB`
}

// ---- Model panel ---------------------------------------------------------

function ModelPanel({ modelKey, setModelKey }: { modelKey: ModelKey; setModelKey: (k: ModelKey) => void }) {
  const [choices, setChoices] = useState<ModelChoice[]>([])
  const [statuses, setStatuses] = useState<Record<string, ModelStatus>>({})
  const [prompt, setPrompt] = useState('In one sentence, what is a practice exam for?')
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void api.models.list().then((r) => {
      setChoices(r.choices)
      setStatuses(Object.fromEntries(r.statuses.map((s) => [s.key, s])))
    })
    const offStatus = api.models.onStatus((s) => setStatuses((prev) => ({ ...prev, [s.key]: s })))
    const offDelta = api.debug.onPingDelta((t) => setReply((r) => r + t))
    return () => {
      offStatus()
      offDelta()
    }
  }, [])

  const s = statuses[modelKey]
  const p = s?.progress

  const runPing = async (): Promise<void> => {
    setReply('')
    setError('')
    setBusy(true)
    try {
      await api.debug.ping(modelKey, prompt)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel">
      <h2 className="eyebrow">1 · Model</h2>
      <label className="field">
        <span>Model</span>
        <select value={modelKey} onChange={(e) => setModelKey(e.target.value as ModelKey)}>
          {choices.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label} · {c.name} {c.quant} · {mb(c.bytes)}
              {c.isDefault ? ' (default)' : ''}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        <span className={`pill phase-${s?.phase ?? 'none'}`}>{s?.phase?.replace('_', ' ') ?? '…'}</span>
        {(s?.phase === 'not_downloaded' || s?.phase === 'paused' || s?.phase === 'error') && (
          <button onClick={() => api.models.download(modelKey)}>{s.phase === 'paused' ? 'Resume' : 'Download'}</button>
        )}
        {s?.phase === 'downloading' && <button onClick={() => api.models.pause(modelKey)}>Pause</button>}
        {(s?.phase === 'downloaded' || s?.phase === 'not_downloaded') && (
          <button onClick={() => api.models.load(modelKey).catch((e: Error) => setError(e.message))}>Load</button>
        )}
        {s?.phase === 'loaded' && <button onClick={() => api.models.unload()}>Unload</button>}
      </div>
      {p && (s?.phase === 'downloading' || s?.phase === 'paused') && (
        <div className="progress">
          <div className="bar">
            <div style={{ width: `${p.percent}%` }} />
          </div>
          <div className="mono small">
            {p.percent.toFixed(1)}% · {mb(p.downloaded)} / {mb(p.total)} · {s.phase === 'paused' ? 'paused' : `${(p.speed / 1e6).toFixed(1)} MB/s`}
          </div>
        </div>
      )}
      {s?.error && <p className="error">{s.error}</p>}

      <h3 className="sub">Round-trip one completion</h3>
      <textarea rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      <button className="primary" disabled={busy} onClick={runPing}>
        {busy ? 'Running…' : 'Ping model'}
      </button>
      {(reply || error) && <pre className="reply">{error || reply}</pre>}
    </section>
  )
}

// ---- Sources panel ---------------------------------------------------------

function SourcesPanel({ rows, onInspect }: { rows: SourceRow[]; onInspect: (id: string) => void }) {
  const [url, setUrl] = useState('')
  return (
    <section className="panel">
      <h2 className="eyebrow">2 · Sources</h2>
      <div className="row">
        <button onClick={() => api.library.pick()}>Add files (.md .txt .pdf)</button>
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          if (url.trim()) void api.library.add([url])
          setUrl('')
        }}
      >
        <input placeholder="https://… a page to study" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button type="submit">Add URL</button>
      </form>
      <ul className="sources">
        {rows.map(({ source, kept, dropped }) => (
          <li key={source.id}>
            <div className="row spread">
              <strong title={source.ref}>{source.title}</strong>
              <span className={`pill status-${source.status}`}>{source.status.replace('_', ' ')}</span>
            </div>
            <div className="mono small dim">
              {source.type} · {kept} chunks kept · {dropped} dropped
            </div>
            {source.message && <p className="note">{source.message}</p>}
            <div className="row">
              {source.status === 'ready' && <button onClick={() => onInspect(source.id)}>Inspect chunks</button>}
              <button className="ghost" onClick={() => api.library.remove(source.id)}>
                Remove
              </button>
            </div>
          </li>
        ))}
        {!rows.length && <li className="dim">No sources yet.</li>}
      </ul>
    </section>
  )
}

function ChunkInspector({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<{ kept: Chunk[]; dropped: DroppedChunk[] } | null>(null)
  const [tab, setTab] = useState<'kept' | 'dropped'>('kept')
  useEffect(() => {
    void api.library.chunks(id).then(setData)
  }, [id])
  const list: (Chunk | DroppedChunk)[] = data ? data[tab] : []
  return (
    <div className="drawer">
      <div className="row spread">
        <div className="row">
          <button className={tab === 'kept' ? 'primary' : ''} onClick={() => setTab('kept')}>
            Kept ({data?.kept.length ?? 0})
          </button>
          <button className={tab === 'dropped' ? 'primary' : ''} onClick={() => setTab('dropped')}>
            Dropped ({data?.dropped.length ?? 0})
          </button>
        </div>
        <button className="ghost" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="chunks">
        {list.map((c) => (
          <article key={c.id} className="chunk">
            <div className="mono small">
              {c.headingTrail.join(' › ') || '(no heading)'}
              {c.pageNumber != null && ` · p.${c.pageNumber}`}
              {c.anchor && ` · #${c.anchor}`} · ~{c.tokenEstimate} tok
              {'dropReason' in c && <span className="pill status-fetch_failed">{c.dropReason}</span>}
            </div>
            <pre>{c.text}</pre>
          </article>
        ))}
      </div>
    </div>
  )
}

// ---- Generate panel --------------------------------------------------------

type FeedItem = { kind: 'q'; q: Question } | { kind: 'r'; r: Rejection } | { kind: 'info'; text: string }

function QuestionCard({ q }: { q: Question }) {
  return (
    <article className="card ok">
      <div className="mono small dim">
        {q.type} · {q.sourceChunkId}
      </div>
      <p className="stem">{q.stem}</p>
      <ol className="options">
        {q.options.map((o) => (
          <li key={o.id} className={q.correct.includes(o.id) ? 'correct' : ''}>
            <span className="mono">{o.id.toUpperCase()}</span> {o.text}
          </li>
        ))}
      </ol>
      <p className="small dim">{q.explanation}</p>
    </article>
  )
}

function RejectionCard({ r }: { r: Rejection }) {
  const [open, setOpen] = useState(false)
  return (
    <article className="card bad" onClick={() => setOpen(!open)}>
      <div className="row spread">
        <span className="mono small">
          REJECTED #{r.promptIndex} · {r.type}
        </span>
        <span className="mono small">{r.reasons.join(', ')}</span>
      </div>
      <div className="small dim">{r.headingTrail.join(' › ')}</div>
      <div className="small">{r.detail}</div>
      {open && <pre className="raw">{r.raw}</pre>}
    </article>
  )
}

function GeneratePanel({ modelKey, rows }: { modelKey: ModelKey; rows: SourceRow[] }) {
  const [count, setCount] = useState(10)
  const [difficulty, setDifficulty] = useState<Difficulty>('applied')
  const [types, setTypes] = useState<QuestionType[]>(['single', 'multi', 'truefalse'])
  const [focus, setFocus] = useState('')
  const [onlyIds, setOnlyIds] = useState<string[]>([])
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ accepted: 0, target: 0, produced: 0, prompts: 0, rejected: 0 })
  const [filter, setFilter] = useState<'all' | 'q' | 'r'>('all')

  useEffect(
    () =>
      api.gen.onEvent((e: GenEvent) => {
        switch (e.type) {
          case 'started':
            setProgress({ accepted: 0, target: e.target, produced: 0, prompts: e.prompts, rejected: 0 })
            setFeed([{ kind: 'info', text: `Started: ${e.prompts} prompts for ${e.target} questions, from a pool of ${e.poolSize} chunks.` }])
            break
          case 'produced':
            setProgress((p) => ({ ...p, produced: p.produced + 1 }))
            break
          case 'accepted':
            setProgress((p) => ({ ...p, accepted: e.accepted }))
            setFeed((f) => [{ kind: 'q', q: e.question }, ...f])
            break
          case 'rejected':
            setProgress((p) => ({ ...p, rejected: p.rejected + 1 }))
            setFeed((f) => [{ kind: 'r', r: e.rejection }, ...f])
            break
          case 'topup':
            setProgress((p) => ({ ...p, prompts: p.prompts + e.prompts }))
            setFeed((f) => [{ kind: 'info', text: `Top-up batch: ${e.prompts} more prompts.` }, ...f])
            break
          case 'done':
            setRunning(false)
            setFeed((f) => [
              {
                kind: 'info',
                text: `Done in ${e.seconds}s: ${e.accepted}/${e.target} questions, ${e.rejected} rejected.${e.shortBy ? ` Short by ${e.shortBy.missing}: ${e.shortBy.reason}` : ''}`
              },
              ...f
            ])
            break
          case 'cancelled':
            setRunning(false)
            setFeed((f) => [{ kind: 'info', text: `Cancelled with ${e.accepted} accepted.` }, ...f])
            break
          case 'error':
            setRunning(false)
            setFeed((f) => [{ kind: 'info', text: `Error: ${e.message}` }, ...f])
            break
        }
      }),
    []
  )

  const ready = rows.filter((r) => r.source.status === 'ready' && r.kept > 0)
  const start = async (): Promise<void> => {
    setRunning(true)
    setFeed([])
    try {
      await api.gen.start({
        questionCount: count,
        difficulty,
        types,
        sourceIds: onlyIds,
        topicFocus: focus,
        mode: 'exam',
        modelKey
      })
    } catch (e) {
      setRunning(false)
      setFeed([{ kind: 'info', text: `Error: ${(e as Error).message}` }])
    }
  }

  const shown = useMemo(() => feed.filter((f) => filter === 'all' || f.kind === filter || f.kind === 'info'), [feed, filter])
  const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  return (
    <section className="panel wide">
      <h2 className="eyebrow">3 · Generate</h2>
      <div className="grid">
        <label className="field">
          <span>Questions</span>
          <input type="number" min={1} max={50} value={count} onChange={(e) => setCount(Number(e.target.value))} />
        </label>
        <label className="field">
          <span>Difficulty</span>
          <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
            <option value="recall">Recall</option>
            <option value="applied">Applied</option>
            <option value="scenario">Scenario</option>
          </select>
        </label>
        <label className="field">
          <span>Topic focus</span>
          <input placeholder="optional, e.g. locking" value={focus} onChange={(e) => setFocus(e.target.value)} />
        </label>
      </div>
      <div className="row">
        {(['single', 'multi', 'truefalse'] as QuestionType[]).map((t) => (
          <label key={t} className="check">
            <input type="checkbox" checked={types.includes(t)} onChange={() => setTypes(toggle(types, t))} /> {t}
          </label>
        ))}
      </div>
      {ready.length > 1 && (
        <div className="row wrap">
          <span className="small dim">Only from:</span>
          {ready.map((r) => (
            <label key={r.source.id} className="check">
              <input type="checkbox" checked={onlyIds.includes(r.source.id)} onChange={() => setOnlyIds(toggle(onlyIds, r.source.id))} />{' '}
              {r.source.title}
            </label>
          ))}
        </div>
      )}
      <div className="row">
        <button className="primary" disabled={running || !ready.length || !types.length} onClick={start}>
          Generate exam
        </button>
        <button disabled={!running} onClick={() => api.gen.cancel()}>
          Cancel
        </button>
        <button className="ghost" onClick={() => api.gen.revealLog()}>
          Show rejection log
        </button>
      </div>
      {progress.target > 0 && (
        <div className="progress">
          <div className="bar">
            <div style={{ width: `${(progress.accepted / progress.target) * 100}%` }} />
          </div>
          <div className="mono small">
            {progress.accepted}/{progress.target} accepted · {progress.rejected} rejected · {progress.produced}/{progress.prompts} replies
          </div>
        </div>
      )}
      <div className="row">
        {(['all', 'q', 'r'] as const).map((f) => (
          <button key={f} className={filter === f ? 'primary' : 'ghost'} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : f === 'q' ? 'Accepted' : 'Rejected'}
          </button>
        ))}
      </div>
      <div className="feed">
        {shown.map((f, i) =>
          f.kind === 'q' ? <QuestionCard key={f.q.id} q={f.q} /> : f.kind === 'r' ? <RejectionCard key={`r${i}`} r={f.r} /> : <p key={`i${i}`} className="info mono small">{f.text}</p>
        )}
      </div>
    </section>
  )
}

export function Debug({ onBack }: { onBack: () => void }) {
  const [modelKey, setModelKey] = useState<ModelKey>('best')
  const [rows, setRows] = useState<SourceRow[]>([])
  const [inspect, setInspect] = useState<string | null>(null)

  useEffect(() => {
    void api.models.list().then((r) => setModelKey(r.resident ?? r.choices.find((c) => c.isDefault)?.key ?? 'best'))
    void api.library.list().then(setRows)
    return api.library.onChanged(setRows)
  }, [])

  return (
    <div className="debug app">
      <header className="top">
        <img src="/assets/qvac-mark.svg" alt="" width={22} height={22} />
        <h1>Exam Prep</h1>
        <span className="pill">debug screen</span>
        <span style={{ flex: 1 }} />
        <button className="ghost" onClick={onBack}>
          Back to the app
        </button>
      </header>
      <main className="cols">
        <div className="col">
          <ModelPanel modelKey={modelKey} setModelKey={setModelKey} />
          <SourcesPanel rows={rows} onInspect={setInspect} />
        </div>
        <GeneratePanel modelKey={modelKey} rows={rows} />
      </main>
      {inspect && <ChunkInspector id={inspect} onClose={() => setInspect(null)} />}
    </div>
  )
}
