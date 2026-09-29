// ============================================================
// The table: the home screen and the master grid.
//
// Rows are markers, columns are test dates, and the latest column carries
// the status colour. The three groups (Unoptimized / Optimized / Never
// tested) are COMPUTED at render time from each row's status, never read
// from the file that was imported.
// ============================================================

import { useMemo, useState } from 'react'
import type { AppState, MarkerView, Status } from '@shared/types.js'
import { groupOf } from '@shared/scoring.js'
import { Chrome, type Tab } from '../components/Chrome.js'
import { Chevron, Pencil, Search, Trash } from '../components/Icons.js'
import { shortDate } from '../components/Gauge.js'

type Sort = 'status' | 'name' | 'category'

const GROUPS = [
  { key: 'unoptimized', title: 'UNOPTIMIZED', dot: 'red', note: 'Sorted by severity' },
  { key: 'optimized', title: 'OPTIMIZED', dot: 'green', note: 'In range, nothing to do' },
  { key: 'never', title: 'NEVER TESTED', dot: 'grey', note: 'Add to your next panel' }
] as const

const SEVERITY: Record<Status, number> = { red: 0, yellow: 1, green: 2, grey: 3 }

/**
 * How many date columns the grid shows. The design draws three; the layout
 * holds up to six. Beyond that the fixed columns would overflow the window,
 * so the table shows the most recent six and the marker screen keeps the
 * whole series, nothing is lost, and the header says how many are hidden.
 */
const MAX_COLUMNS = 6

/**
   * Marker, then the range it is judged against, then the dates newest-first.
   * The range column earns its place: reading a value against a range you
   * have to find in a subtitle is work, and it is the comparison the whole
   * table exists to make.
   */
function columns(dateCount: number): string {
  const earlier = Math.max(0, dateCount - 1)
  return `minmax(200px, 1fr) 148px 132px ${'108px '.repeat(earlier)}44px`
}

export function TableScreen({
  state,
  tab,
  onTab,
  onOpenMarker,
  onImport,
  onFoodLibrary,
  onProfile,
  onAsk,
  onSetCell
}: {
  state: AppState
  tab: Tab
  onTab: (t: Tab) => void
  onOpenMarker: (markerId: string) => void
  onImport: () => void
  onFoodLibrary: () => void
  onProfile: () => void
  onAsk: () => void
  onSetCell: (markerId: string, date: string, value: number | null) => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [onlyAttention, setOnlyAttention] = useState(false)
  const [sort, setSort] = useState<Sort>('status')
  // Collapsed to begin with. Fifty-six rows on arrival is a wall; three
  // headers with counts is a summary you can act on.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    unoptimized: true,
    optimized: true,
    never: true
  })
  const [editing, setEditing] = useState<{ markerId: string; date: string } | null>(null)

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    let rows = state.markers
    if (q) {
      rows = rows.filter(
        (v) =>
          v.marker.name.toLowerCase().includes(q) ||
          v.marker.id.toLowerCase().includes(q) ||
          v.marker.descriptor.toLowerCase().includes(q) ||
          v.marker.categories.some((c) => c.toLowerCase().includes(q))
      )
    }

    const compare = (a: MarkerView, b: MarkerView): number => {
      if (sort === 'name') return a.marker.name.localeCompare(b.marker.name)
      if (sort === 'category') {
        const ca = a.marker.categories[0] ?? 'zzz'
        const cb = b.marker.categories[0] ?? 'zzz'
        return ca.localeCompare(cb) || a.marker.name.localeCompare(b.marker.name)
      }
      // Status: worst first, then the further out of range, then by name.
      const s = SEVERITY[a.status] - SEVERITY[b.status]
      if (s !== 0) return s
      return a.marker.name.localeCompare(b.marker.name)
    }

    const out: Record<string, MarkerView[]> = { unoptimized: [], optimized: [], never: [] }
    for (const v of rows) out[groupOf(v.status)].push(v)
    for (const key of Object.keys(out)) out[key].sort(compare)
    return out
  }, [state.markers, query, sort])

  const noProfile = state.profile.gender == null && state.profile.ageGroup == null
  const needsCount = state.markers.filter((v) => groupOf(v.status) === 'unoptimized').length
  const testedCount = state.markers.filter((v) => v.status !== 'grey').length
  const visibleGroups = onlyAttention ? GROUPS.filter((g) => g.key === 'unoptimized') : GROUPS
  // Newest first: the number you came to read should not be at the far end
  // of a horizontal scan. `state.dates` is oldest-first everywhere else, so
  // the reversal lives here and the values are reversed to match.
  const shownDates = state.dates.slice(-MAX_COLUMNS).reverse()
  const hiddenDates = state.dates.length - shownDates.length
  const gridTemplate = columns(shownDates.length)

  return (
    <>
      <Chrome
        tab={tab}
        onTab={onTab}
        model={state.model}
        onImport={onImport}
        onFoodLibrary={onFoodLibrary}
        onProfile={onProfile}
        onAsk={onAsk}
      />

      <div className="summary">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div className={`count-tile ${needsCount > 0 ? 'bad' : 'ok'}`}>{needsCount}</div>
          <div>
            <div className="title">
              {needsCount === 1 ? 'marker needs attention' : 'markers need attention'}
            </div>
            <div className="sub">
              out of {testedCount} tested. {needsCount > 0 ? 'Review the highlighted rows below.' : 'Everything is in range.'}
            </div>
          </div>
        </div>
        <div className="divider" />
        <div>
          <div className="sub">Last import</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 15 }}>
            {state.lastImport ? new Date(state.lastImport.at).toLocaleDateString() : '-'}
          </div>
        </div>
        {noProfile && (
          <>
            <div className="divider" />
            <div>
              <div className="sub">Ranges</div>
              <button
                className="link"
                style={{ fontSize: 14 }}
                onClick={onProfile}
                title="Twelve of the 56 markers have a published range that moves with gender or age"
              >
                Standard · personalise →
              </button>
            </div>
          </>
        )}
        <div className="spacer" />
        <div className="search">
          <Search size={15} color="#7E8E88" />
          <input
            placeholder="Search markers"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button
          className={`toggle ${onlyAttention ? 'on' : ''}`}
          onClick={() => setOnlyAttention((v) => !v)}
        >
          <span className="track">
            <span />
          </span>
          Only needs attention
        </button>
        <select className="sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="status">Sort: Status</option>
          <option value="name">Sort: Name</option>
          <option value="category">Sort: Category</option>
        </select>
      </div>

      <div className="scroll">
        <div className="grid-head" style={{ gridTemplateColumns: gridTemplate }}>
          <span>
            MARKER
            {hiddenDates > 0 && (
              <span style={{ color: 'var(--muted-dim)', letterSpacing: 0 }}>
                {' '}
                · {hiddenDates} earlier {hiddenDates === 1 ? 'date' : 'dates'} on the marker screen
              </span>
            )}
          </span>
          <span className="range-head">EXPECTED RANGE</span>
          {shownDates.map((d, i) => (
            <span key={d} className={`date ${i === 0 ? 'latest' : ''}`}>
              {shortDate(d)}
            </span>
          ))}
          <span />
        </div>

        {visibleGroups.map((group) => {
          const rows = grouped[group.key]
          const open = !collapsed[group.key]
          return (
            <div key={group.key}>
              <button
                className="section-head"
                onClick={() => setCollapsed((c) => ({ ...c, [group.key]: open }))}
              >
                {/* Points down when the section is open, up when it is shut. */}
                <Chevron size={12} color="#7E8E88" className={`chev ${open ? '' : 'up'}`} />
                <span className={`dot ${group.dot}`} />
                <span className="name">{group.title}</span>
                <span className="count">({rows.length})</span>
                <span className="note">{group.note}</span>
              </button>
              {open &&
                rows.map((v) => (
                  <Row
                    key={v.marker.id}
                    view={v}
                    dates={shownDates}
                    values={v.values.slice(-shownDates.length).reverse()}
                    template={gridTemplate}
                    editing={editing}
                    onEdit={setEditing}
                    onOpen={() => onOpenMarker(v.marker.id)}
                    onSetCell={onSetCell}
                  />
                ))}
              {open && rows.length === 0 && (
                <div style={{ padding: '18px 26px', color: 'var(--qvac-muted)', fontSize: 13 }}>
                  Nothing here{query ? ' matches your search' : ''}.
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

function Row({
  view,
  dates,
  values,
  template,
  editing,
  onEdit,
  onOpen,
  onSetCell
}: {
  view: MarkerView
  /** The date columns actually on screen, newest first. */
  dates: string[]
  /** `view.values` sliced to match `dates`. */
  values: (number | null)[]
  template: string
  editing: { markerId: string; date: string } | null
  onEdit: (e: { markerId: string; date: string } | null) => void
  onOpen: () => void
  onSetCell: (markerId: string, date: string, value: number | null) => void
}): React.JSX.Element {
  const { marker, range, status, personalizedNote } = view
  // Newest is now column zero.
  const latestIndex = 0

  return (
    <div className="grid-row" style={{ gridTemplateColumns: template }} onClick={onOpen} role="button">
      <div className="marker-cell">
        <span className={`dot ${status}`} />
        <div style={{ minWidth: 0 }}>
          <div className="name">{marker.name}</div>
          <div className="meta">{marker.descriptor}</div>
        </div>
      </div>

      <div className="range-cell" title={personalizedNote ?? 'Standard reference range'}>
        {range.low}-{range.high} <span className="unit">{marker.unit}</span>
      </div>

      {dates.map((date, i) => {
        const value = values[i]
        const isLatest = i === latestIndex
        const isEditing = editing?.markerId === marker.id && editing.date === date
        const cellStatus = isLatest && value != null ? status : null
        return (
          <div
            key={date}
            className={`value-cell ${isLatest ? 'latest' : ''} ${value == null ? 'empty' : ''} ${cellStatus ?? ''}`}
            onDoubleClick={(e) => {
              e.stopPropagation()
              onEdit({ markerId: marker.id, date })
            }}
            title="Double-click to edit"
          >
            {isEditing ? (
              <input
                autoFocus
                defaultValue={value ?? ''}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  const raw = e.target.value.trim()
                  const next = raw === '' ? null : Number(raw)
                  if (raw !== '' && !Number.isFinite(next)) {
                    onEdit(null)
                    return
                  }
                  if (next !== value) onSetCell(marker.id, date, next)
                  onEdit(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  if (e.key === 'Escape') onEdit(null)
                }}
              />
            ) : (
              (value ?? '-')
            )}
          </div>
        )
      })}

      <div className="cell-edit">
        <button
          className="icon-btn"
          title="Edit the latest value"
          onClick={(e) => {
            e.stopPropagation()
            onEdit({ markerId: marker.id, date: dates[latestIndex] })
          }}
        >
          <Pencil size={15} />
        </button>
        <button
          className="icon-btn"
          title="Delete the latest value"
          onClick={(e) => {
            e.stopPropagation()
            onSetCell(marker.id, dates[latestIndex], null)
          }}
        >
          <Trash size={15} />
        </button>
      </div>
    </div>
  )
}
