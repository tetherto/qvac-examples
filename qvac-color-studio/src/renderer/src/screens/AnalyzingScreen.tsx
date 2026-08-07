// The wait while the vision model reads the still. One model call, so
// there is nothing to report but the fact that it is working.

interface Props {
  stillUrl: string
}

export function AnalyzingScreen({ stillUrl }: Props): React.JSX.Element {
  return (
    <div className="screen screen--center">
      <div style={{ width: 300, marginBottom: 26 }}>
        <div className="portrait">
          <img className="portrait__media" src={stillUrl} alt="Your photo" />
          <div className="portrait__scan" />
        </div>
      </div>
      <h1 className="heading" style={{ fontSize: 24 }}>
        Reading your colors…
      </h1>
      <p className="note note--sm" style={{ maxWidth: 300, marginTop: 10 }}>
        Comparing warm and cool tones on your skin.
      </p>
    </div>
  )
}
