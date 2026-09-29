// A one-line note that fades itself out. Used for import results ("12 new
// values, 4 updated") and for errors that are not worth a whole screen.
import { useEffect } from 'react'
import { Check, Close, Warning } from './Icons.js'

export interface ToastMessage {
  text: string
  tone: 'ok' | 'bad'
}

export function Toast({
  message,
  onDismiss
}: {
  message: ToastMessage | null
  onDismiss: () => void
}): React.JSX.Element | null {
  useEffect(() => {
    if (!message) return
    // Errors get longer to read than confirmations.
    const ms = message.tone === 'bad' ? 12_000 : 6_000
    const timer = setTimeout(onDismiss, ms)
    return () => clearTimeout(timer)
  }, [message, onDismiss])

  if (!message) return null
  return (
    <div className={`toast ${message.tone === 'bad' ? 'bad' : ''}`} role="status">
      {message.tone === 'bad' ? <Warning size={16} color="#F26D6D" /> : <Check size={16} color="#16E3C1" />}
      <p>{message.text}</p>
      <button className="icon-btn" onClick={onDismiss} aria-label="Dismiss">
        <Close size={14} />
      </button>
    </div>
  )
}
