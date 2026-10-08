// 01 Onboarding: pick a model and add material at the same time, so the
// download is never dead time.

import { useState } from 'react'
import type { ModelChoice, ModelKey } from '../../../core/types'
import { isReady, readyRows, sectionCount, useApp } from '../state'
import { Bar, Btn, Eyebrow, Icon, Label, Mark, PauseGlyph, Spinner, duration } from '../ui'
import { DropStrip, LinkInput, SourceIcon, shortMessage, sourceMeta, sourceName } from './Library'

const api = window.api

export const MODEL_BLURB: Record<ModelKey, string> = {
  fast: 'Quick. Simpler questions. Runs on 8 GB RAM.',
  balanced: 'Good all-rounder.',
  best: 'Sharpest questions. Wants 16 GB RAM.'
}

export const size = (c: ModelChoice): string => `${(c.bytes / 1e9).toFixed(1)} GB`

export function ModelSelect({ value, onChange }: { value: ModelKey; onChange: (k: ModelKey) => void }) {
  const { choices } = useApp()
  const [open, setOpen] = useState(false)
  const cur = choices.find((c) => c.key === value)
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" className="select" onClick={() => setOpen(!open)}>
        <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg-1)' }}>
          {cur?.label}
        </span>
        <span className="mono" style={{ fontSize: 12, color: 'var(--fg-3)' }}>
          {cur && size(cur)}
          {cur?.isDefault ? ' · recommended' : ''}
        </span>
        <span style={{ flex: 1 }} />
        <Icon name="chevronDown" color="var(--fg-3)" style={{ transform: open ? 'rotate(180deg)' : undefined }} />
      </button>
      {open && (
        <div className="menu" style={{ top: 54 }}>
          {choices.map((c) => (
            <button
              type="button"
              key={c.key}
              className={`menu-item${c.key === value ? ' menu-item-on' : ''}`}
              onClick={() => {
                onChange(c.key)
                setOpen(false)
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg-1)' }}>
                  {c.label}
                </span>
                {c.isDefault && <span className="tag-acqua">Recommended</span>}
              </span>
              <span className="mono" style={{ fontSize: 12, color: c.key === value ? 'var(--fg-2)' : 'var(--fg-3)' }}>
                {size(c)}
              </span>
              <span style={{ gridColumn: '1 / -1', fontSize: 13, lineHeight: 1.45, color: c.key === value ? 'var(--fg-2)' : 'var(--fg-3)' }}>
                {c.name} · {MODEL_BLURB[c.key]}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** 09h: the Best model on a machine with less than 16 GB of memory. */
export function MemoryWarning({ onUse, onKeep }: { onUse: () => void; onKeep?: () => void }) {
  const { state, settings, choices } = useApp()
  const ram = state?.system.ramBytes ?? 0
  if (settings.modelKey !== 'best' || !ram || ram >= 15.5 * 2 ** 30) return null
  const best = choices.find((c) => c.key === 'best')
  return (
    <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="mono" style={{ fontSize: 16, fontWeight: 700 }}>
        {best?.label ?? 'Best quality'} may struggle here.
      </div>
      <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--fg-2)', margin: 0 }}>{Math.round(ram / 2 ** 30)} GB RAM here. Balanced will run steadier.</p>
      <div className="mono" style={{ fontSize: 12, color: 'var(--fg-3)' }}>
        Detected: {Math.round(ram / 2 ** 30)} GB RAM{state?.system.cpu ? ` · ${state.system.cpu}` : ''}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Btn variant="primary" size="sm" onClick={onUse}>
          Use Balanced
        </Btn>
        {onKeep && (
          <Btn size="sm" onClick={onKeep}>
            Keep Best
          </Btn>
        )}
      </div>
    </div>
  )
}

function ModelCard() {
  const { choices, statuses, settings, setSettings } = useApp()
  const [picking, setPicking] = useState(false)
  const [keepBest, setKeepBest] = useState(false)
  const key = settings.modelKey
  const choice = choices.find((c) => c.key === key)
  const st = statuses[key]
  const p = st?.progress
  if (!choice) return <div className="card onb-card" />

  const busy = st?.phase === 'downloading' || st?.phase === 'paused'
  if (busy && !picking) {
    const left = p && p.speed > 0 ? (p.total - p.downloaded) / p.speed : 0
    return (
      <div className="card onb-card" style={{ gap: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Label>01 · The model</Label>
          <span className="mono" style={{ fontSize: 12, color: 'var(--fg-3)' }}>
            {choice.name} {choice.quant}
          </span>
        </div>
        <div className="mono" style={{ fontSize: 16, fontWeight: 700 }}>
          {choice.label}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginTop: 8 }}>
          <span className="big-num">{Math.floor(p?.percent ?? 0)}%</span>
          <span className="mono tnum" style={{ fontSize: 14, color: 'var(--fg-2)' }}>
            {p ? `${(p.downloaded / 1e9).toFixed(2)} of ${((p.total || choice.bytes) / 1e9).toFixed(2)} GB` : 'Starting…'}
          </span>
        </div>
        <Bar pct={p?.percent ?? 0} height={6} glow={st.phase === 'downloading'} />
        <div className="stat-row">
          <div>
            <Label style={{ fontSize: 10, marginBottom: 4 }}>Speed</Label>
            <div className="stat">{st.phase === 'paused' ? 'Paused' : p?.speed ? `${(p.speed / 1e6).toFixed(1)} MB/s` : '—'}</div>
          </div>
          <div>
            <Label style={{ fontSize: 10, marginBottom: 4 }}>Time left</Label>
            <div className="stat">{st.phase === 'paused' ? '—' : left ? `~${duration(left)}` : '—'}</div>
          </div>
          <div>
            <Label style={{ fontSize: 10, marginBottom: 4 }}>Once only</Label>
            <div className="stat">Then offline</div>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {st.phase === 'downloading' ? (
            <Btn size="sm" onClick={() => void api.models.pause(key)}>
              <PauseGlyph />
              Pause
            </Btn>
          ) : (
            <Btn variant="primary" size="sm" onClick={() => void api.models.download(key)}>
              Resume
            </Btn>
          )}
          <Btn
            variant="quiet"
            size="sm"
            onClick={() => {
              if (st.phase === 'downloading') void api.models.pause(key)
              setPicking(true)
            }}
          >
            Change model
          </Btn>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>Safe to quit. Resumes later.</span>
        </div>
      </div>
    )
  }

  return (
    <div className="card onb-card" style={{ gap: 16 }}>
      <Label>01 · The model</Label>
      <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--fg-2)', margin: 0 }}>Pick a size. Switch anytime.</p>
      <ModelSelect
        value={key}
        onChange={(k) => {
          void setSettings({ modelKey: k })
          setPicking(false)
        }}
      />
      {!keepBest && <MemoryWarning onUse={() => void setSettings({ modelKey: 'balanced' })} onKeep={() => setKeepBest(true)} />}
      <div style={{ flex: 1 }} />
      {isReady(st) ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="check" color="var(--qvac-acqua)" width={2.5} />
          <span className="mono" style={{ fontSize: 13, color: 'var(--fg-1)' }}>
            On this machine. Works offline from now.
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Btn
            variant="primary"
            onClick={() => {
              setPicking(false)
              void api.models.download(key)
            }}
          >
            {st?.phase === 'error' ? 'Retry download' : st?.phase === 'paused' ? 'Resume' : `Download · ${size(choice)}`}
          </Btn>
          {st?.phase === 'error' && <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>{st.error}</span>}
        </div>
      )}
    </div>
  )
}

function MaterialCard() {
  const { sources, statuses, settings } = useApp()
  const downloading = statuses[settings.modelKey]?.phase === 'downloading'
  if (!sources.length) {
    return (
      <div className="card onb-card" style={{ gap: 16 }}>
        <Label>02 · Your material</Label>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--fg-2)', margin: 0 }}>{downloading ? 'Add notes, guides or docs while the model downloads.' : 'Add notes, guides or docs. Start now.'}</p>
        <button type="button" className="drop-zone" style={{ flex: 1, background: 'transparent', borderRadius: 12 }} onClick={() => void api.library.pick()}>
          <Icon name="upload" size={26} width={1.5} color="var(--fg-3)" />
          <span style={{ fontSize: 15, color: 'var(--fg-1)' }}>Drop files here</span>
          <span className="mono" style={{ fontSize: 12, color: 'var(--fg-3)' }}>
            .pdf · .md · .txt
          </span>
          <span className="btn btn-outline btn-sm" style={{ height: 32, marginTop: 4 }}>
            Choose files
          </span>
        </button>
        <LinkInput placeholder="Paste a link to a docs page" height={40} />
      </div>
    )
  }
  const ready = readyRows(sources)
  return (
    <div className="card onb-card" style={{ gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Label>02 · Your material</Label>
        <span className="mono" style={{ fontSize: 12, color: 'var(--fg-3)' }}>
          {ready.length} ready · {sectionCount(sources)} sections
        </span>
      </div>
      <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--fg-2)', margin: 0 }}>{downloading ? 'Keep adding while the model downloads. More material, better questions.' : 'Add more, or set the paper. More material, better questions.'}</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <DropStrip height={44} compact />
        </div>
        <div style={{ flex: 1.3, display: 'flex' }}>
          <LinkInput height={44} inlineButton />
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', borderTop: '0.5px solid var(--border-2)', overflow: 'auto' }}>
        {sources.map(({ source: s, kept }) => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 0', borderBottom: '0.5px solid var(--border-2)' }}>
            <SourceIcon s={s} size={16} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="mono ellipsis" style={{ fontSize: 13 }}>
                {sourceName(s)}
              </div>
              {s.status === 'parsing' ? (
                <div className="bar indeterminate" style={{ marginTop: 8 }}>
                  <div />
                </div>
              ) : (
                <div className="mono ellipsis" style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                  {s.status === 'ready' && kept ? sourceMeta(s) : shortMessage(s)}
                </div>
              )}
            </div>
            {s.status === 'parsing' ? (
              <span className="mono" style={{ fontSize: 12, color: 'var(--fg-3)', display: 'flex', gap: 8, alignItems: 'center' }}>
                <Spinner color="var(--fg-3)" />
                {s.type === 'url' ? 'Fetching' : 'Reading'}
              </span>
            ) : s.status === 'ready' && kept ? (
              <span className="mono status-ok" style={{ color: 'var(--fg-2)', gap: 6 }}>
                <span className="pip" />
                {kept} sections
              </span>
            ) : (
              <button type="button" className="link-btn" onClick={() => void api.library.remove(s.id)}>
                Remove
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export function Onboarding() {
  const { sources, statuses, settings, setSettings, go } = useApp()
  const st = statuses[settings.modelKey]
  const modelReady = isReady(st)
  const material = readyRows(sources).length > 0
  const busy = st?.phase === 'downloading' || st?.phase === 'paused'
  const p = st?.progress
  const left = p && p.speed > 0 ? (p.total - p.downloaded) / p.speed : 0

  const line = modelReady && material ? 'All set. Set the paper next.' : material ? (st?.phase === 'downloading' && left ? `Material ready. Model in ~${duration(left)}.` : 'Material ready. The model comes next.') : modelReady ? 'Model ready. Add material to start.' : 'Do both at once: material parses while the model downloads.'
  const finish = (r: 'setup' | 'library'): void => {
    void setSettings({ onboarded: true })
    go({ name: r })
  }
  return (
    <div className="onboarding">
      <div className="topbar" style={{ justifyContent: 'space-between' }}>
        <div className="brand" style={{ padding: 0 }}>
          <Mark />
          <span>Exam Prep</span>
        </div>
        <Label>No account · no cloud · no keys</Label>
      </div>
      <div style={{ flex: 1, padding: '44px 72px 32px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <Eyebrow style={{ marginBottom: 12 }}>First run</Eyebrow>
        <h1 className="h1" style={{ fontSize: 34, margin: '0 0 12px' }}>
          Prepare for your next exam.
        </h1>
        <p className="lead" style={{ maxWidth: 640 }}>
          Practice papers from your own notes, written on this computer.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 36 }}>
          <ModelCard />
          <MaterialCard />
        </div>
        {busy || sources.length ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 22 }}>
            <span style={{ fontSize: 14, color: 'var(--fg-2)', flex: 1 }}>{line}</span>
            <Btn variant="quiet" onClick={() => finish('library')}>
              Skip for now
            </Btn>
            <Btn variant="primary" disabled={!material} onClick={() => finish('setup')}>
              Set up exam →
            </Btn>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 24, marginTop: 24 }}>
            {[
              ['wifiOff', 'Works offline', 'Plane, train, anywhere.'],
              ['lock', 'Private', 'Nothing leaves this machine.'],
              ['download', 'Download once', 'No account. No keys.']
            ].map(([icon, title, sub]) => (
              <div key={title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <Icon name={icon} size={18} color="var(--qvac-acqua)" style={{ marginTop: 1 }} />
                <div>
                  <Label style={{ color: 'var(--fg-1)' }}>{title}</Label>
                  <div style={{ fontSize: 13, color: 'var(--fg-3)', marginTop: 3 }}>{sub}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
