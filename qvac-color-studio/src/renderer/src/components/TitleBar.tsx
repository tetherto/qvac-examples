// The title strip from the design, made real: the window drags by it,
// and on macOS it leaves room for the traffic lights rather than drawing
// three fake dots.

const isMac = navigator.userAgent.includes('Mac')

export function TitleBar(): React.JSX.Element {
  return (
    <div className={`titlebar${isMac ? ' titlebar--mac' : ''}`}>
      <div className="titlebar__brand">
        <img className="titlebar__logo" src="/assets/logo.svg" alt="QVAC" />
        <span className="titlebar__rule" />
        <span className="titlebar__name">COLOR STUDIO</span>
      </div>
      <div className="titlebar__spacer" />
      <span className="titlebar__badge">
        <span className="dot-live" />
        PRIVATE · ON-DEVICE
      </span>
    </div>
  )
}
