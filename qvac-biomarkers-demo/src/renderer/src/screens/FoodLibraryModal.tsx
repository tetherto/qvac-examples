// ============================================================
// The Food Library.
//
// Where the facts come from. The built-in knowledge base is listed as a
// source in its own right, so the answer to "why did it suggest lentils"
// is always one click away, and anything you add sits alongside it,
// clearly marked as yours and unvetted.
//
// Adding a URL is the one moment this app talks to the network. It sends
// the address and nothing else, only when you click Add, and the note in
// the footer says exactly that.
// ============================================================

import { useEffect, useState } from 'react'
import type { AppState, ContextGraph as Graph, FoodSource, JobProgress } from '@shared/types.js'
import { Progress } from '../components/Progress.js'
import { ContextGraph } from '../components/ContextGraph.js'
import { Book, Chain, ChevronRight, Close, FileText, Link, Plus, Trash } from '../components/Icons.js'

export function FoodLibraryModal({
  state,
  busy,
  jobs,
  onClose,
  onAddUrl,
  onAddPdf,
  onRemove,
  onOpenMarker,
  onSetFact
}: {
  state: AppState
  busy: boolean
  jobs: Record<string, JobProgress>
  onClose: () => void
  onAddUrl: (url: string) => void
  onAddPdf: () => void
  onRemove: (id: string) => void
  onOpenMarker: (id: string) => void
  onSetFact: (sourceId: string, index: number, accepted: boolean) => void
}): React.JSX.Element {
  const [url, setUrl] = useState('')
  const [selected, setSelected] = useState<string | null>(state.sources[0]?.id ?? 'builtin')
  const [graph, setGraph] = useState<Graph | null>(null)

  useEffect(() => {
    let alive = true
    window.biomarkers.sourceGraph(selected ?? undefined).then((g) => {
      if (alive) setGraph(g)
    })
    return () => {
      alive = false
    }
  }, [selected, state.sources])

  const builtinFactCount = state.coveredMarkers.length
  const active = state.sources.find((s) => s.id === selected) ?? null

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal foodlib" style={{ height: 'min(760px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <header>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <Book size={20} color="#16E3C1" />
            <div>
              <h3>Food Library</h3>
              <div className="subtle" style={{ fontSize: 12, marginTop: 2 }}>
                Your local source of truth for food recommendations
              </div>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Close size={18} />
          </button>
        </header>

        <div className="cols">
          <div className="add-col">
            <div className="add-box">
              <div className="head">Add a resource</div>
              <div style={{ display: 'flex', gap: 9 }}>
                <div style={{ flex: 1, position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 12, top: 12, pointerEvents: 'none' }}>
                    <Link size={15} color="#AEBDB7" />
                  </span>
                  <input
                    placeholder="Paste a URL…"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && url.trim() && !busy) {
                        onAddUrl(url.trim())
                        setUrl('')
                      }
                    }}
                    style={{ width: '100%', paddingLeft: 36, fontSize: 14 }}
                  />
                </div>
                <button
                  className="btn primary"
                  style={{ padding: '0 18px' }}
                  disabled={busy || url.trim() === ''}
                  onClick={() => {
                    onAddUrl(url.trim())
                    setUrl('')
                  }}
                >
                  <Plus size={15} color="#0D0E0D" />
                  Add
                </button>
              </div>
              <div className="or">
                <i />
                <span>or</span>
                <i />
              </div>
              <button className="dashed" onClick={onAddPdf} disabled={busy}>
                <FileText size={15} color="#16E3C1" />
                Upload a PDF
              </button>
              <div className="subtle" style={{ fontSize: 11, marginTop: 9, lineHeight: 1.45 }}>
                Text-layer PDFs only. Scans need OCR, which this prototype does not load.
              </div>
            </div>

            <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, color: 'var(--qvac-muted)', letterSpacing: 1, marginBottom: 12 }}>
              RESOURCES ({state.sources.length + 1})
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <button
                className={`source-row ${selected === 'builtin' ? 'on' : ''}`}
                onClick={() => setSelected('builtin')}
              >
                <div className="badge">KB</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ellipsis" style={{ fontFamily: 'var(--font-display)', fontSize: 14 }}>
                    Built-in knowledge base
                  </div>
                  <div className="ellipsis subtle" style={{ fontSize: 12 }}>
                    data/knowledge-base.json · shipped with the app · vetted
                  </div>
                </div>
                <div className="mini-pill ok">
                  <Chain size={11} color="#16E3C1" />
                  {builtinFactCount} markers
                </div>
                <ChevronRight size={13} color={selected === 'builtin' ? '#16E3C1' : '#4A544F'} />
              </button>

              {state.sources.map((s) => (
                <SourceRow
                  key={s.id}
                  source={s}
                  progress={jobs[`source:${s.id}`] ?? null}
                  selected={selected === s.id}
                  onSelect={() => setSelected(s.id)}
                  onRemove={() => {
                    onRemove(s.id)
                    if (selected === s.id) setSelected('builtin')
                  }}
                />
              ))}
            </div>
          </div>

          <div className="map-col">
            <div className="panel sunken glow" style={{ padding: '16px 18px 10px', marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, position: 'relative' }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 14 }}>Context map</span>
                <div style={{ display: 'flex', gap: 14 }}>
                  <Key color="#ECF1EE" label="Source" />
                  <Key color="#16E3C1" label="Nutrient" />
                  <Key color="#7E8E88" label="Marker" square />
                </div>
              </div>
              {graph ? <ContextGraph graph={graph} /> : null}
              <div className="subtle" style={{ fontSize: 11, textAlign: 'center', padding: '2px 0 6px' }}>
                How your saved sources connect to the nutrients and markers QVAC reasons over
              </div>
            </div>

            {selected === 'builtin' ? (
              <BuiltinPanel state={state} onOpenMarker={onOpenMarker} />
            ) : active ? (
              <SourcePanel
                source={active}
                state={state}
                onOpenMarker={onOpenMarker}
                onSetFact={(i, accepted) => onSetFact(active.id, i, accepted)}
              />
            ) : null}
          </div>
        </div>

        <footer>
          <div className="disclaimer" style={{ border: 'none', background: 'none', padding: 0 }}>
            <div className="i">i</div>
            <p>
              Your sources are references, not verified fact. Adding a URL fetches that page.
              Nothing else leaves this device.
            </p>
          </div>
        </footer>
      </div>
    </div>
  )
}

function Key({ color, label, square }: { color: string; label: string; square?: boolean }): React.JSX.Element {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--qvac-muted)' }}>
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: square ? 2 : 999,
          background: color,
          display: 'inline-block'
        }}
      />
      {label}
    </span>
  )
}

function SourceRow({
  source,
  progress,
  selected,
  onSelect,
  onRemove
}: {
  source: FoodSource
  progress: JobProgress | null
  selected: boolean
  onSelect: () => void
  onRemove: () => void
}): React.JSX.Element {
  const badge = source.kind === 'pdf' ? 'PDF' : 'URL'
  const working = source.state === 'processing'
  const accepted = source.facts.filter((f) => f.accepted === true).length
  return (
    <div className={`source-row ${selected ? 'on' : ''}`} onClick={onSelect} role="button">
      <div className="badge">{badge}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="ellipsis" style={{ fontFamily: 'var(--font-display)', fontSize: 14 }}>
          {source.title}
        </div>
        {working ? (
          <div style={{ marginTop: 4 }}>
            <Progress inline label={progress?.label ?? 'Starting'} percent={progress?.percent ?? null} />
          </div>
        ) : (
          <div className="ellipsis subtle" style={{ fontSize: 12 }}>
            {source.domain}
          </div>
        )}
      </div>
      {source.state === 'review' && (
        <div className="mini-pill warn">
          <span className="dot sm" style={{ background: '#E8C34A' }} />
          {source.facts.filter((f) => f.accepted === undefined || f.accepted === false).length} to
          review
        </div>
      )}
      {source.state === 'linked' && (
        <div className={`mini-pill ${accepted > 0 ? 'ok' : 'warn'}`}>
          <Chain size={11} color={accepted > 0 ? '#16E3C1' : '#E8C34A'} />
          {accepted} {accepted === 1 ? 'link' : 'links'}
        </div>
      )}
      {source.state === 'failed' && (
        <div className="mini-pill bad">
          <span className="dot sm" style={{ background: '#F26D6D' }} />
          Failed
        </div>
      )}
      <button
        className="icon-btn"
        title="Remove this source"
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
      >
        <Trash size={13} />
      </button>
    </div>
  )
}

function BuiltinPanel({
  state,
  onOpenMarker
}: {
  state: AppState
  onOpenMarker: (id: string) => void
}): React.JSX.Element {
  const covered = state.markers.filter((m) => state.coveredMarkers.includes(m.marker.id))
  return (
    <div className="panel" style={{ borderColor: 'var(--ok-line)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '16px 18px', borderBottom: '1px solid var(--qvac-border)' }}>
        <div className="badge" style={{ width: 34, height: 34 }}>
          KB
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 15 }}>Built-in knowledge base</div>
          <div className="subtle" style={{ fontSize: 12 }}>
            data/knowledge-base.json · {covered.length} markers covered · vetted, edit it as JSON
          </div>
        </div>
      </div>
      <div style={{ padding: '16px 18px' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, color: 'var(--qvac-muted)', letterSpacing: 1, marginBottom: 10 }}>
          WHAT IT COVERS
        </div>
        <p className="subtle" style={{ margin: '0 0 14px', lineHeight: 1.5 }}>
          This is the only source the model may draw food facts from, unless you add your own. Every
          entry is a nutrient, the foods that carry it, and one line saying why, so a recommendation
          can always be traced back to a line of JSON.
        </p>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, color: 'var(--qvac-muted)', letterSpacing: 0.5, marginBottom: 7 }}>
          INFORMS MARKERS
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {covered.map((m) => (
            <button key={m.marker.id} className="tagline" onClick={() => onOpenMarker(m.marker.id)}>
              <span className={`dot sm ${m.status}`} />
              {m.marker.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function SourcePanel({
  source,
  state,
  onOpenMarker,
  onSetFact
}: {
  source: FoodSource
  state: AppState
  onOpenMarker: (id: string) => void
  onSetFact: (index: number, accepted: boolean) => void
}): React.JSX.Element {
  const live = source.facts.filter((f) => f.accepted === true)
  const nutrients = [...new Set(live.map((f) => f.nutrient))]
  const markerIds = [...new Set(live.map((f) => f.markerId))]
  const pending = source.facts.filter((f) => f.accepted !== true).length

  return (
    <div className="panel" style={{ borderColor: source.state === 'failed' ? 'var(--bad-line)' : 'var(--ok-line)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '16px 18px', borderBottom: '1px solid var(--qvac-border)' }}>
        <div className="badge" style={{ width: 34, height: 34 }}>
          {source.kind === 'pdf' ? 'PDF' : 'URL'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ellipsis" style={{ fontFamily: 'var(--font-display)', fontSize: 15 }}>
            {source.title}
          </div>
          <div className="ellipsis subtle" style={{ fontSize: 12 }}>
            {source.domain} · {live.length} of {source.facts.length} facts in use · read on-device{' '}
            {new Date(source.addedAt).toLocaleDateString()}
          </div>
        </div>
      </div>
      <div style={{ padding: '16px 18px' }}>
        {source.state === 'processing' && (
          <p className="subtle" style={{ margin: 0 }}>
            Reading it on-device…
          </p>
        )}

        {source.error && (
          <p style={{ margin: '0 0 14px', fontSize: 13, lineHeight: 1.5, color: source.state === 'failed' ? 'var(--bad)' : 'var(--warn)' }}>
            {source.error}
          </p>
        )}

        {source.facts.length > 0 && (
          <>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 12,
                color: 'var(--qvac-muted)',
                letterSpacing: 1,
                marginBottom: 4
              }}
            >
              PROPOSED FACTS {pending > 0 && <span style={{ color: 'var(--warn)' }}>· {pending} to review</span>}
            </div>
            <p className="subtle" style={{ fontSize: 12, margin: '0 0 12px', lineHeight: 1.45 }}>
              Reading claims out of prose is the weakest thing this model does, so nothing here
              reaches your recommendations until you accept it. Each one quotes the page.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 18 }}>
              {source.facts.map((f, i) => {
                const marker = state.markers.find((m) => m.marker.id === f.markerId)
                const on = f.accepted === true
                return (
                  <div
                    key={i}
                    className="panel sunken"
                    style={{
                      padding: '12px 14px',
                      borderColor: on ? 'var(--ok-line)' : 'var(--qvac-border)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span className={`dot sm ${marker?.status ?? 'grey'}`} />
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: 13 }}>
                        {marker?.marker.name ?? f.markerId} too {f.direction}
                      </span>
                      <span className="subtle" style={{ fontSize: 12 }}>
                        · {f.nutrient}
                      </span>
                      <span style={{ flex: 1 }} />
                      {on ? (
                        <button
                          className="link"
                          style={{ fontSize: 12, color: 'var(--qvac-muted)' }}
                          onClick={() => onSetFact(i, false)}
                        >
                          Remove
                        </button>
                      ) : (
                        <button
                          className="btn accent"
                          style={{ fontSize: 12, padding: '4px 12px' }}
                          onClick={() => onSetFact(i, true)}
                        >
                          Accept
                        </button>
                      )}
                    </div>
                    <div className="subtle" style={{ fontSize: 12, marginBottom: 6 }}>
                      foods: {f.foods.join(', ')}
                    </div>
                    {f.evidence && (
                      <div
                        style={{
                          fontSize: 12,
                          lineHeight: 1.45,
                          color: 'var(--qvac-white)',
                          borderLeft: '2px solid var(--qvac-border)',
                          paddingLeft: 10
                        }}
                      >
                        &ldquo;{f.evidence}&rdquo;
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}

        {source.tldr.length > 0 && (
          <>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, color: 'var(--qvac-muted)', letterSpacing: 1, marginBottom: 10 }}>
              WHAT QVAC EXTRACTED · TL;DR
            </div>
            <div style={{ marginBottom: 18 }}>
              {source.tldr.map((line, i) => (
                <div key={i} className="tldr-line">
                  <i>›</i>
                  <p>{line}</p>
                </div>
              ))}
            </div>
          </>
        )}

        {live.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, color: 'var(--qvac-muted)', letterSpacing: 0.5, marginBottom: 7 }}>
                COVERS NUTRIENTS
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {nutrients.map((n) => (
                  <span key={n} className="tagline nutrient">
                    {n}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, color: 'var(--qvac-muted)', letterSpacing: 0.5, marginBottom: 7 }}>
                INFORMS MARKERS
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {markerIds.map((id) => {
                  const view = state.markers.find((m) => m.marker.id === id)
                  return (
                    <button key={id} className="tagline" onClick={() => onOpenMarker(id)}>
                      <span className={`dot sm ${view?.status ?? 'grey'}`} />
                      {view?.marker.name ?? id}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
