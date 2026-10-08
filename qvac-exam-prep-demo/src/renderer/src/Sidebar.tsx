// The left rail (design: "EF Sidebar") and the model indicator, which is
// always visible: a lit dot means the chosen model is on disk and ready.

import type { ModelChoice, ModelStatus } from '../../core/types'
import { modelLine, useApp, type Route } from './state'
import { Bar, Dot, Icon, Mark, gb } from './ui'

const api = window.api

export function ModelIndicator({ choice, status, compact }: { choice?: ModelChoice; status?: ModelStatus; compact?: boolean }) {
  if (!choice) return null
  const p = status?.progress
  const pct = p ? Math.round(p.percent) : 0
  const row = (dot: Parameters<typeof Dot>[0]['kind'], title: string, sub: string, action?: { label: string; run: () => void }) => (
    <div className="indicator">
      <Dot kind={dot} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="indicator-title">{title}</div>
        <div className="indicator-sub">{sub}</div>
      </div>
      {action && (
        <button type="button" className="link-btn" onClick={action.run}>
          {action.label}
        </button>
      )}
    </div>
  )
  switch (status?.phase) {
    case 'loaded':
    case 'downloaded':
      return row('live', choice.label, `${modelLine(choice)} · offline`)
    case 'loading':
      return row('warming', 'Loading into memory', `${choice.label} · a few seconds`)
    case 'downloading':
      return (
        <>
          {row('ring', `Downloading · ${pct}%`, p ? `${gb(p.downloaded)} of ${gb(p.total || choice.bytes)}${p.speed ? ` · ${Math.round(p.speed / 1e6)} MB/s` : ''}` : choice.label)}
          {!compact && <Bar pct={p?.percent ?? 0} />}
        </>
      )
    case 'paused':
      return row('ring-dim', `Paused · ${pct}%`, `${p ? gb(p.downloaded) : ''} kept · resume anytime`, { label: 'Resume', run: () => void api.models.download(choice.key) })
    case 'error':
      return row('ring-amber', 'Download stopped', status.error ? status.error.slice(0, 60) : 'The partial file is kept', { label: 'Retry', run: () => void api.models.download(choice.key) })
    default:
      return row('off', 'No model yet', 'Download in Settings')
  }
}

function NavItem({ icon, label, count, active, kbd, onClick }: { icon: string; label: string; count?: number; active: boolean; kbd?: string; onClick: () => void }) {
  return (
    <button type="button" className={`nav${active ? ' nav-active' : ''}`} onClick={onClick}>
      <Icon name={icon} color={active ? 'var(--qvac-acqua)' : 'currentColor'} />
      <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>
      {count !== undefined && <span className="nav-count">{count}</span>}
      {kbd && <span className="nav-kbd">{kbd}</span>}
    </button>
  )
}

export function Sidebar() {
  const { route, go, sources, exams, choices, statuses, settings, gen } = useApp()
  const active = route.name === 'review' || route.name === 'results' ? 'exams' : route.name
  const choice = choices.find((c) => c.key === settings.modelKey)
  const to = (r: Route) => () => go(r)
  return (
    <aside className="sidebar">
      <div className="brand">
        <Mark />
        <span>Exam Prep</span>
      </div>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <NavItem icon="library" label="Library" count={sources.length} active={active === 'library'} onClick={to({ name: 'library' })} />
        <NavItem icon="plus" label={gen ? 'Writing exam' : 'New exam'} kbd="⌘N" active={active === 'setup'} onClick={to({ name: 'setup' })} />
        <NavItem icon="clock" label="Past exams" count={exams.length} active={active === 'exams'} onClick={to({ name: 'exams' })} />
      </nav>
      <div style={{ flex: 1 }} />
      <NavItem icon="sliders" label="Settings" active={active === 'settings'} onClick={to({ name: 'settings' })} />
      <div className="sidebar-foot">
        <ModelIndicator choice={choice} status={statuses[settings.modelKey]} />
      </div>
    </aside>
  )
}
