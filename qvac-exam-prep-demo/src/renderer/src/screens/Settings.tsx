// 08 Settings: the three models, appearance, storage, and reset.

import { useEffect, useState } from 'react'
import type { ModelChoice } from '../../../core/types'
import { isReady, useApp } from '../state'
import { Bar, Btn, Dot, PauseGlyph, gb } from '../ui'
import { MODEL_BLURB, MemoryWarning, size } from './Onboarding'

const api = window.api

function ModelCard({ c }: { c: ModelChoice }) {
  const { settings, setSettings, statuses, choices, resident } = useApp()
  const st = statuses[c.key]
  const chosen = settings.modelKey === c.key
  const p = st?.progress
  const current = choices.find((x) => x.key === settings.modelKey)
  const sub = `${c.name} ${c.quant} · ${size(c)}`

  if (st?.phase === 'downloading' || st?.phase === 'paused') {
    return (
      <div className="model-card" style={{ gap: 10 }}>
        <div className="model-head">
          <Dot kind={st.phase === 'paused' ? 'ring-dim' : 'ring'} />
          <span className="model-name">{c.label}</span>
          <span style={{ flex: 1 }} />
          <span className="mono" style={{ fontSize: 12, color: 'var(--fg-2)' }}>
            {Math.floor(p?.percent ?? 0)}% · {p ? `${(p.downloaded / 1e9).toFixed(2)} of ${((p.total || c.bytes) / 1e9).toFixed(1)} GB` : ''}
          </span>
          <button type="button" className="link-btn" style={{ marginLeft: 8, display: 'flex', gap: 6, alignItems: 'center' }} onClick={() => void (st.phase === 'paused' ? api.models.download(c.key) : api.models.pause(c.key))}>
            {st.phase === 'paused' ? (
              'Resume'
            ) : (
              <>
                <PauseGlyph />
                Pause
              </>
            )}
          </button>
        </div>
        <div style={{ marginLeft: 17 }}>
          <Bar pct={p?.percent ?? 0} height={3} />
        </div>
        <div style={{ fontSize: 12, color: 'var(--fg-3)', paddingLeft: 17 }}>
          {st.phase === 'paused' ? 'Paused. The part downloaded is kept.' : chosen ? 'Downloading. Generating waits for it.' : `Downloading. ${current?.label ?? 'The current model'} stays active until you switch.`}
        </div>
      </div>
    )
  }

  const ready = isReady(st)
  return (
    <div className={`model-card${chosen && ready ? ' model-card-on' : ''}`}>
      <div className="model-head">
        <Dot kind={ready ? (chosen ? 'live' : 'ring') : st?.phase === 'error' ? 'ring-amber' : 'off'} />
        <span className="model-name">{c.label}</span>
        <span style={{ flex: 1 }} />
        {chosen && ready ? (
          <span className="label" style={{ fontSize: 10, color: 'var(--qvac-acqua)' }}>
            {resident === c.key ? 'In use · loaded' : 'In use'}
          </span>
        ) : ready ? (
          <Btn size="sm" variant="outline" onClick={() => void setSettings({ modelKey: c.key })}>
            Use
          </Btn>
        ) : (
          <Btn size="sm" variant="outline" onClick={() => void api.models.download(c.key)}>
            {st?.phase === 'error' ? 'Retry' : 'Download'} · {size(c)}
          </Btn>
        )}
      </div>
      <div style={{ fontSize: 12, color: 'var(--fg-3)', paddingLeft: 17 }} className={ready ? 'mono' : undefined}>
        {ready ? `${sub} · on disk` : st?.phase === 'error' ? st.error : `${MODEL_BLURB[c.key]}${chosen ? ' Chosen: download it to generate.' : ''}`}
      </div>
    </div>
  )
}

export function Settings() {
  const { choices, settings, setSettings, go } = useApp()
  const [storage, setStorage] = useState<{ models: number; library: number; exams: number; dir: string } | null>(null)
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    void api.app.storage().then(setStorage)
  }, [])
  const total = storage ? storage.models + storage.library + storage.exams : 0

  return (
    <div className="screen scroll" style={{ padding: '40px 56px', display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: 40, alignContent: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h1 className="h1" style={{ margin: '0 0 8px' }}>
          Settings
        </h1>
        <div className="label">Model</div>
        {choices.map((c) => (
          <ModelCard key={c.key} c={c} />
        ))}
        <MemoryWarning onUse={() => void setSettings({ modelKey: 'balanced' })} />
        <div className="label" style={{ marginTop: 12 }}>
          Appearance
        </div>
        <div className="seg seg-sm" style={{ width: 'max-content' }}>
          {(
            [
              ['dark', 'Dark'],
              ['light', 'Light'],
              ['system', 'Match system']
            ] as const
          ).map(([k, label]) => (
            <button type="button" key={k} className={settings.theme === k ? 'seg-on' : ''} onClick={() => void setSettings({ theme: k })}>
              {label}
            </button>
          ))}
        </div>
        <div className="label" style={{ marginTop: 12 }}>
          Under the hood
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <button type="button" className="link-btn accent" onClick={() => void api.gen.revealLog()}>
            Show the rejection log
          </button>
          <button type="button" className="link-btn accent" onClick={() => go({ name: 'debug' })}>
            Open the debug screen
          </button>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 54 }}>
        <div className="label">Storage on this machine</div>
        <div className="mono" style={{ fontSize: 36, fontWeight: 700 }}>
          {storage ? gb(total) : '—'}
        </div>
        {storage && total > 0 && (
          <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', gap: 2 }}>
            <span style={{ flex: storage.models, background: 'var(--qvac-acqua)' }} />
            <span style={{ flex: Math.max(storage.library, total * 0.01), background: 'var(--data-blue)' }} />
            <span style={{ flex: Math.max(storage.exams, total * 0.005), background: 'var(--fg-3)' }} />
          </div>
        )}
        <div className="kv kv-legend">
          <div>
            <span>
              <i style={{ background: 'var(--qvac-acqua)' }} />
              Models
            </span>
            <span>{storage ? gb(storage.models, 2) : ''}</span>
          </div>
          <div>
            <span>
              <i style={{ background: 'var(--data-blue)' }} />
              Sources &amp; extracted text
            </span>
            <span>{storage ? gb(storage.library) : ''}</span>
          </div>
          <div>
            <span>
              <i style={{ background: 'var(--fg-3)' }} />
              Exams &amp; results
            </span>
            <span>{storage ? gb(storage.exams) : ''}</span>
          </div>
        </div>
        <div className="mono" style={{ fontSize: 12, color: 'var(--fg-3)', wordBreak: 'break-all' }}>
          {storage?.dir.replace(/^\/Users\/[^/]+/, '~')}{' '}
          <button type="button" className="link-btn accent" style={{ marginLeft: 6, textTransform: 'none', letterSpacing: 0 }} onClick={() => void api.app.revealData()}>
            Show ↗
          </button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>Models live in ~/.qvac/models, shared with other QVAC apps.</div>
        <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16, background: 'transparent' }}>
          <div className="mono" style={{ fontSize: 14, fontWeight: 700 }}>
            Reset all data
          </div>
          <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--fg-3)', margin: 0 }}>Deletes your library, papers and results. No cloud copy, so no undo. Downloaded models stay.</p>
          {confirm ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn
                variant="danger"
                size="sm"
                onClick={async () => {
                  await api.app.reset()
                  await setSettings({})
                  go({ name: 'onboarding' })
                }}
              >
                Delete everything
              </Btn>
              <Btn variant="quiet" size="sm" onClick={() => setConfirm(false)}>
                Cancel
              </Btn>
            </div>
          ) : (
            <Btn variant="danger" size="sm" onClick={() => setConfirm(true)} style={{ width: 'max-content' }}>
              Reset everything…
            </Btn>
          )}
        </div>
      </div>
    </div>
  )
}
