// What personal colour analysis is, in plain words, plus the promise that
// nothing leaves the machine. No brand names, no salon claims.

import { StudioScene } from '../components/StudioScene'

interface Props {
  onStart: () => void
}

export function IntroScreen({ onStart }: Props): React.JSX.Element {
  return (
    <div className="screen">
      <div className="intro">
        <div>
          <div className="eyebrow" style={{ marginBottom: 20 }}>
            PERSONAL COLOR ANALYSIS
          </div>
          <h1 className="heading heading--lg">
            Find the colors that make you <strong>glow</strong>.
          </h1>
          <p className="lede">
            Hold a color under your chin and your face changes. The right tones make you look{' '}
            <em>brighter and more rested</em>; the wrong ones <em>wash you out</em>. Color Studio
            reads yours from your camera and finds <mark>your best palette</mark>.
          </p>
          <div className="privacy-line" style={{ marginTop: 24 }}>
            <span className="dot-live" />
            Runs fully on your device. Nothing is uploaded.
          </div>
          <div style={{ marginTop: 40 }}>
            <button className="btn" onClick={onStart}>
              Start
            </button>
          </div>
        </div>
        <div className="intro__art">
          <StudioScene />
          <p className="intro__caption">
            In a salon, a stylist holds cloth under your chin and you watch your face change in the
            mirror. Color Studio does the same thing on screen.
          </p>
        </div>
      </div>
    </div>
  )
}
