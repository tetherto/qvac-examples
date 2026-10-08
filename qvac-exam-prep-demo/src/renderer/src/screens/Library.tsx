// 02 Library: one big drop target when empty; the source table when not.
// Failures sit in calm grey with one next step, never in red.

import { useState } from 'react'
import type { Source } from '../../../core/types'
import type { SourceRow } from '../../../preload/index'
import { readyRows, sectionCount, useApp } from '../state'
import { Btn, Eyebrow, Icon, Kbd, Spinner, fileName, gb, shortUrl } from '../ui'

const api = window.api

export function sourceName(s: Source): string {
  return s.type === 'url' ? shortUrl(s.ref) : fileName(s.ref)
}

export function SourceIcon({ s, size = 18, dim }: { s: Source; size?: number; dim?: boolean }) {
  return <Icon name={s.type === 'url' ? 'globe' : 'fileText'} size={size} width={1.6} color={dim ? 'var(--fg-3)' : 'var(--fg-2)'} />
}

function addedWhen(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return 'added today'
  return `added ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
}

export function sourceMeta(s: Source): string {
  const kind = { pdf: 'PDF', markdown: 'Markdown', text: 'Text', url: 'Web page' }[s.type]
  if (s.type === 'url') return `${kind} · saved ${new Date(s.addedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} · offline copy`
  const size = s.pages ? `${s.pages} pages` : s.bytes ? gb(s.bytes) : ''
  return [kind, size, addedWhen(s.addedAt)].filter(Boolean).join(' · ')
}

/** The link box with its Fetch button, used on onboarding and the library. */
export function LinkInput({ placeholder = 'Paste a link', height = 44, inlineButton }: { placeholder?: string; height?: number; inlineButton?: boolean }) {
  const { addRefs } = useApp()
  const [url, setUrl] = useState('')
  // Paste one link or a whole list: anything separated by spaces, commas or new lines.
  const fetchIt = (text = url): void => {
    const links = text.split(/[\s,]+/).filter(Boolean).map((u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`))
    if (!links.length) return
    setUrl('')
    void addRefs([...new Set(links)])
  }
  const box = (
    <div className="field" style={{ height, flex: 1, paddingRight: inlineButton ? 6 : undefined }}>
      <Icon name="link" size={15} color="var(--fg-3)" />
      <input
        value={url}
        placeholder={placeholder}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && fetchIt()}
        onPaste={(e) => {
          // A pasted list is fetched at once; an input would flatten its new lines anyway.
          const text = e.clipboardData.getData('text')
          if (text.trim().split(/[\s,]+/).length > 1) {
            e.preventDefault()
            fetchIt(text)
          }
        }}
      />
      {inlineButton && (
        <Btn variant="subtle" size="sm" onClick={() => fetchIt()} disabled={!url.trim()}>
          Fetch
        </Btn>
      )}
    </div>
  )
  if (inlineButton) return box
  return (
    <div style={{ display: 'flex', gap: 8, flex: 1 }}>
      {box}
      <Btn variant="outline" onClick={() => fetchIt()} disabled={!url.trim()} style={{ height, color: 'var(--fg-2)' }}>
        Fetch
      </Btn>
    </div>
  )
}

/** The slim "Drop files, or choose" strip. */
export function DropStrip({ height = 48, compact }: { height?: number; compact?: boolean }) {
  return (
    <button type="button" className="drop-strip" style={{ height }} onClick={() => void api.library.pick()}>
      <Icon name="upload" color="var(--fg-3)" />
      <span style={{ fontSize: compact ? 13 : 14, color: 'var(--fg-3)', whiteSpace: 'nowrap' }}>
        Drop files, or <span className="u">choose</span>
      </span>
      <span style={{ flex: 1 }} />
      {!compact && (
        <span className="mono" style={{ fontSize: 12, color: 'var(--fg-disabled)' }}>
          .pdf .md .txt
        </span>
      )}
    </button>
  )
}

function StatusCell({ row }: { row: SourceRow }) {
  const s = row.source
  if (s.status === 'parsing')
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="mono" style={{ fontSize: 12, color: 'var(--fg-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Spinner color="var(--fg-3)" /> {s.type === 'url' ? 'Fetching' : 'Reading'}
        </span>
        <div className="bar indeterminate" style={{ width: 150 }}>
          <div />
        </div>
      </div>
    )
  if (s.status === 'ready' && row.kept)
    return (
      <span className="mono status-ok">
        <span className="pip" />
        Ready
      </span>
    )
  const label = s.status === 'unsupported_scanned' ? 'Scanned PDF, not supported in this build' : s.status === 'fetch_failed' ? (s.type === 'url' ? "Couldn't fetch this page" : "Couldn't read this file") : 'Nothing usable found'
  return (
    <span className="mono status-off">
      <span className="pip-ring" />
      {label}
    </span>
  )
}

export function shortMessage(s: Source): string {
  if (s.status === 'unsupported_scanned') return 'Images only, no text. Try a text PDF or .md.'
  if (s.status === 'fetch_failed') return s.message?.replace(/^Could not fetch the page: /, '') ?? "Site didn't respond."
  return s.message ?? ''
}

function SourceTable({ rows }: { rows: SourceRow[] }) {
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="src-grid src-head">
        <span />
        <span>Source</span>
        <span>Status</span>
        <span style={{ textAlign: 'right' }}>Extracted</span>
      </div>
      <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 330px)' }}>
        {rows.map((row) => {
          const s = row.source
          const failed = s.status === 'unsupported_scanned' || s.status === 'fetch_failed' || (s.status === 'ready' && !row.kept)
          return (
            <div key={s.id} className="src-grid src-row" style={{ alignItems: failed ? 'start' : 'center' }}>
              <SourceIcon s={s} dim={failed} />
              <div style={{ minWidth: 0 }}>
                <div className="mono ellipsis" style={{ fontSize: 14, color: failed ? 'var(--fg-2)' : 'var(--fg-1)' }} title={s.title}>
                  {sourceName(s)}
                </div>
                {failed ? (
                  <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--fg-3)', marginTop: 4, maxWidth: 440 }}>{shortMessage(s)}</div>
                ) : (
                  <div className="mono" style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2 }}>
                    {s.status === 'parsing' ? (s.type === 'url' ? 'Fetching · the only network step' : 'Reading headings…') : sourceMeta(s)}
                  </div>
                )}
              </div>
              <StatusCell row={row} />
              <div className="src-actions">
                {s.status === 'ready' && row.kept > 0 && (
                  <span className="mono" style={{ fontSize: 13, color: 'var(--fg-1)' }} title={row.dropped ? `${row.dropped} passages left out: contents pages, menus, licences and the like` : undefined}>
                    {row.kept} sections
                  </span>
                )}
                {s.status === 'fetch_failed' && (
                  <button type="button" className="link-btn accent" onClick={() => void api.library.retry(s.id)}>
                    Retry
                  </button>
                )}
                {s.status !== 'parsing' && (
                  <button type="button" className={`link-btn${failed && s.status !== 'fetch_failed' ? '' : ' on-hover'}`} onClick={() => void api.library.remove(s.id)}>
                    Remove
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function Library() {
  const { sources, go, state, statuses, settings } = useApp()
  const ready = readyRows(sources)
  const modelReady = ['downloaded', 'loaded', 'loading'].includes(statuses[settings.modelKey]?.phase ?? '')

  if (!sources.length) {
    return (
      <div className="screen center">
        <div style={{ width: 640, display: 'flex', flexDirection: 'column', gap: 28 }}>
          <div>
            <Eyebrow style={{ marginBottom: 14 }}>Library</Eyebrow>
            <h1 className="h1" style={{ fontSize: 36, lineHeight: 1.15, margin: '0 0 14px' }}>
              Start with what you're studying.
            </h1>
            <p className="lead">Questions come only from your material. Guides, notes, docs: all work.</p>
          </div>
          <button type="button" className="drop-zone" onClick={() => void api.library.pick()}>
            <Icon name="upload" size={32} width={1.4} color="var(--qvac-acqua)" />
            <span style={{ fontSize: 17, color: 'var(--fg-1)' }}>Drop files anywhere in this window</span>
            <span className="mono" style={{ fontSize: 12, color: 'var(--fg-3)' }}>
              .pdf · .md · .txt
            </span>
            <span className="btn btn-outline btn-sm" style={{ marginTop: 6 }}>
              Choose files <Kbd>⌘O</Kbd>
            </span>
          </button>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <LinkInput placeholder="Or paste a link (or a list of links) to docs pages" />
            <span style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--fg-3)' }}>Links are the only online step. The rest is offline.</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="screen" style={{ padding: '44px 56px', gap: 28 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 24 }}>
        <div style={{ flex: 1 }}>
          <Eyebrow style={{ marginBottom: 10 }}>Library</Eyebrow>
          <h1 className="h1">Your material</h1>
        </div>
        <span className="mono" style={{ fontSize: 13, color: 'var(--fg-3)' }}>
          {ready.length} ready · {sectionCount(sources)} sections
        </span>
        <Btn variant="primary" disabled={!ready.length} onClick={() => go({ name: 'setup' })} title={modelReady ? undefined : 'You can set up now; generating waits for the model.'}>
          Set up exam →
        </Btn>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <DropStrip />
        </div>
        <div style={{ flex: 1.2, display: 'flex' }}>
          <LinkInput height={48} inlineButton />
        </div>
      </div>
      <SourceTable rows={sources} />
      <div style={{ flex: 1 }} />
      <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--fg-3)' }}>
        <span>Stored in {state?.dataDir.replace(/^\/Users\/[^/]+/, '~')} · nothing is uploaded</span>
        <span>Only fetching links uses the network</span>
      </div>
    </div>
  )
}
