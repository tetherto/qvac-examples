// ============================================================
// Webcam preview and capture.
//
// The stream lives and dies with this screen — the camera light
// should go out the moment we leave. Upload is a first-class
// fallback, not a hidden link: plenty of machines have a poor
// camera or none at all.
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { stillFromFile, stillFromVideo, type Still } from '../lib/drape'

interface Props {
  onStill: (still: Still) => void
}

export function CaptureScreen({ onStill }: Props): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false

    navigator.mediaDevices
      .getUserMedia({ video: { width: 1280, height: 720 }, audio: false })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream = s
        if (videoRef.current) videoRef.current.srcObject = s
      })
      .catch(() => {
        if (!cancelled) {
          setError('No camera available. Upload a photo instead.')
        }
      })

    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  async function capture(): Promise<void> {
    const video = videoRef.current
    if (!video || !video.videoWidth || busy) return
    setBusy(true)
    try {
      onStill(await stillFromVideo(video))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not take the photo.')
      setBusy(false)
    }
  }

  async function pickFile(file: File | undefined): Promise<void> {
    if (!file || busy) return
    setBusy(true)
    try {
      onStill(await stillFromFile(file))
    } catch {
      setError('Could not read that image. Try a JPEG or PNG.')
      setBusy(false)
    }
  }

  return (
    <div className="screen screen--center">
      <div className="eyebrow" style={{ marginBottom: 12 }}>
        STEP TWO
      </div>
      <h1 className="heading">Center your face in the frame</h1>

      <div className="frame" style={{ margin: '26px 0 12px' }}>
        <div className="portrait">
          <video
            ref={videoRef}
            className="portrait__media portrait__media--mirrored"
            autoPlay
            playsInline
            muted
          />
          <div className="portrait__guide" />
        </div>
        <span className="frame__corner frame__corner--tl" />
        <span className="frame__corner frame__corner--tr" />
        <span className="frame__corner frame__corner--bl" />
        <span className="frame__corner frame__corner--br" />
      </div>

      <p className="note note--sm" style={{ maxWidth: 320, marginBottom: 26 }}>
        Soft, even light works best. Line up with the guide.
      </p>

      {error && (
        <p className="error-line" style={{ marginBottom: 20 }}>
          {error}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <button className="btn btn--wide" onClick={capture} disabled={busy || !!error}>
          Capture
        </button>
        <button className="link-quiet" onClick={() => fileRef.current?.click()} disabled={busy}>
          Upload a photo instead
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => void pickFile(e.target.files?.[0])}
        />
      </div>
    </div>
  )
}
