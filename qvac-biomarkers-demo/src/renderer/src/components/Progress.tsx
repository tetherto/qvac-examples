// A bar with a label, used wherever the model is working.
//
// `percent` of null means indeterminate: a slim sliding sliver, not a bar
// pretending to advance. Once the reply starts streaming there is a real
// character count behind the number, so the bar earns its keep.

export function Progress({
  label,
  percent,
  inline = false
}: {
  label: string
  percent: number | null
  /** Compact, borderless: for a row in a list rather than a panel. */
  inline?: boolean
}): React.JSX.Element {
  const known = percent != null
  return (
    <div className={inline ? 'progress inline' : 'progress'}>
      <div className="progress-head">
        <span className="ellipsis">{label}</span>
        {known && <span className="progress-pct">{Math.round(percent)}%</span>}
      </div>
      <div className="progress-track">
        <div
          className={known ? 'progress-fill' : 'progress-fill indeterminate'}
          style={known ? { width: `${Math.max(2, Math.min(100, percent))}%` } : undefined}
        />
      </div>
    </div>
  )
}
