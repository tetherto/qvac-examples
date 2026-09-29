// ============================================================
// What just came in, as a screen you dismiss rather than a toast you miss.
//
// This used to be a six-second notification over the bottom of the results.
// Importing a health record is the one moment where the person genuinely
// needs to check the machine understood the file: how many values landed,
// on what date, and above all WHAT WAS SKIPPED. A line that disappears while
// you are still reading it is not a confirmation.
//
// Every count here comes from the importer's own report. Nothing is rounded
// and nothing is left out, including the unflattering numbers.
// ============================================================

import type { ImportReport } from '@shared/types.js'
import { Check, Close, Warning } from './Icons.js'
import { shortDate } from './Gauge.js'

export function ImportSummary({
  report,
  firstImport,
  onClose
}: {
  report: ImportReport
  firstImport: boolean
  onClose: () => void
}): React.JSX.Element {
  const total = report.added + report.updated
  const nothing = total === 0

  // Everything the file contained that did NOT become a reading. Shown
  // together, because "54 values added" means little without it.
  const skipped: { label: string; detail?: string }[] = []
  if (report.unknownMarkers.length > 0) {
    skipped.push({
      label: `${report.unknownMarkers.length} ${report.unknownMarkers.length === 1 ? 'line' : 'lines'} not recognised as a marker`,
      detail: report.unknownMarkers.slice(0, 6).join(', ')
    })
  }
  if (report.unreadable > 0) {
    skipped.push({ label: `${report.unreadable} values could not be read as a number` })
  }
  if (report.ignoredColumns.length > 0) {
    skipped.push({
      label: `${report.ignoredColumns.length} columns ignored on purpose`,
      detail: report.ignoredColumns.slice(0, 6).join(', ')
    })
  }

  return (
    <div className="scrim" onClick={onClose}>
      <div className="import-card" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn import-x" onClick={onClose} title="Close">
          <Close size={15} color="#7E8E88" />
        </button>

        <div className={`import-mark ${nothing ? 'none' : 'ok'}`}>
          {nothing ? <Warning size={26} color="#E8C34A" /> : <Check size={26} color="#0D0E0D" />}
        </div>

        {nothing ? (
          <>
            <h2>Nothing new to add</h2>
            <p className="lead">
              Every value in <b>{report.file}</b> was already on record, unchanged. Nothing was
              duplicated and nothing was lost.
            </p>
          </>
        ) : (
          <>
            <h2>
              <b>{report.added}</b> {report.added === 1 ? 'value' : 'values'} added
              {report.updated > 0 && (
                <>
                  , <b>{report.updated}</b> updated
                </>
              )}
            </h2>
            <p className="lead">
              from <b>{report.file}</b>
            </p>
          </>
        )}

        <div className="import-facts">
          <div className="ifact">
            <span className="ifact-n">{report.dates.length}</span>
            <span className="ifact-l">
              {report.dates.length === 1 ? 'test date' : 'test dates'}
              <em>{describeDates(report.dates)}</em>
            </span>
          </div>
          {skipped.map((s) => (
            <div className="ifact skipped" key={s.label}>
              <span className="ifact-n">·</span>
              <span className="ifact-l">
                {s.label}
                {s.detail && <em>{s.detail}</em>}
              </span>
            </div>
          ))}
        </div>

        {report.notes && report.notes.length > 0 && (
          <div className="import-note">
            <Warning size={14} color="#E8C34A" />
            <span>{report.notes.join(' ')}</span>
          </div>
        )}

        <button className="btn primary big" onClick={onClose}>
          {firstImport ? 'See my results' : 'Done'}
        </button>
      </div>
    </div>
  )
}

/**
 * The dates, without ever contradicting the count next to them.
 *
 * Listing the first three under a "4 test dates" heading reads as a bug, so
 * anything longer than a short list becomes a span instead. The dates arrive
 * oldest first.
 */
function describeDates(dates: string[]): string {
  if (dates.length === 0) return 'no dated results'
  if (dates.length <= 3) return dates.map(shortDate).join(', ')
  return `${shortDate(dates[0])} to ${shortDate(dates[dates.length - 1])}`
}
