// Two dead ends share this screen, because the way out of both is the same —
// take the photo again:
//
//   'noFace' — the face mesh found nothing, so there is no chin to drape
//              against and no point spending a model call.
//   'failed' — the vision model itself could not finish.
//
// The wording changes between them. Telling someone we could not find their
// face when the real problem was ours is just misleading.

import { PortraitIllustration } from '../components/PortraitIllustration'

export type RetakeReason = 'noFace' | 'failed'

interface Props {
  reason: RetakeReason
  onRetake: () => void
  /** The underlying error, when there is one worth showing. */
  detail?: string | null
}

const COPY: Record<RetakeReason, { title: string; body: string }> = {
  noFace: {
    title: 'We couldn’t find a face',
    body: 'Let’s retake — center your face in soft, even light.'
  },
  failed: {
    title: 'That reading didn’t finish',
    body: 'Something went wrong on our side, not yours. Try again.'
  }
}

export function NoFaceScreen({ reason, onRetake, detail }: Props): React.JSX.Element {
  const { title, body } = COPY[reason]

  return (
    <div className="screen screen--center">
      <div style={{ width: 300, marginBottom: 24, filter: 'grayscale(.4)', opacity: 0.8 }}>
        <PortraitIllustration guide />
      </div>
      <h1 className="heading heading--sm">{title}</h1>
      <p className="note" style={{ maxWidth: 300, margin: '12px 0 26px' }}>
        {body}
      </p>
      {detail && (
        <p className="error-line" style={{ marginBottom: 22 }}>
          {detail}
        </p>
      )}
      <button className="btn" onClick={onRetake}>
        Retake
      </button>
    </div>
  )
}
