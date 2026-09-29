// ============================================================
// The chat panel: the one place in the app a person types freely.
//
// It is deliberately a panel and not a screen. The results stay on screen
// behind it, because an answer about ferritin is worth much more next to
// the ferritin row than on a page of its own.
//
// The redaction notice under an answer is a feature, not an apology. The
// model does occasionally reach for a dosage, the guard stops it, and
// saying so is more honest than a reply that quietly has a hole in it.
// ============================================================

import { useEffect, useRef, useState } from 'react'
import type { ModelChip } from '@shared/types.js'
import { QUICK_QUESTIONS, type ChatTurn } from '@shared/chat.js'
import { Close, Lock, Sparkle } from './Icons.js'

export function ChatPanel({
  model,
  onClose
}: {
  model: ModelChip
  onClose: () => void
}): React.JSX.Element {
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  useEffect(() => input.current?.focus(), [])

  // Follow the answer down as it arrives.
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns, streaming])

  const send = async (question: string): Promise<void> => {
    const q = question.trim()
    if (!q || busy) return
    setDraft('')
    setBusy(true)
    // Snapshot BEFORE the question is appended: the main process wants the
    // conversation so far, and adds the new question itself.
    const history = turns
    setTurns((t) => [...t, { role: 'user', text: q }])
    setStreaming('')

    let text = ''
    const off = window.biomarkers.onChatDelta((chunk) => {
      text += chunk
      setStreaming(text)
    })
    try {
      const result = await window.biomarkers.askChat(q, history)
      setTurns((t) => [
        ...t,
        result.ok
          ? {
              role: 'assistant',
              text: result.answer.text,
              redacted: result.answer.redacted,
              seconds: result.answer.seconds
            }
          : { role: 'assistant', text: '', error: result.message }
      ])
    } finally {
      off()
      setStreaming(null)
      setBusy(false)
      input.current?.focus()
    }
  }

  return (
    <div className="chat-scrim" onClick={onClose}>
      <aside className="chat-panel" onClick={(e) => e.stopPropagation()}>
        <header className="chat-head">
          <Sparkle size={15} color="#16E3C1" />
          <div className="chat-title">
            <b>Ask {model.label}</b>
            <span>runs on this machine</span>
          </div>
          <button className="icon-btn" onClick={onClose} title="Close">
            <Close size={15} color="#7E8E88" />
          </button>
        </header>

        <div className="chat-body" ref={scroller}>
          {turns.length === 0 && streaming === null && (
            <div className="chat-intro">
              <p>
                {model.label} reads the results already on screen. It never sees anything else,
                and nothing leaves this machine.
              </p>
              <div className="chat-chips">
                {QUICK_QUESTIONS.map((q) => (
                  <button key={q} className="chip-btn" onClick={() => send(q)} disabled={busy}>
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((t, i) => (
            <Turn key={i} turn={t} />
          ))}

          {streaming !== null && (
            <div className="bubble assistant">
              {streaming.length === 0 ? (
                <span className="chat-wait">Thinking on this machine…</span>
              ) : (
                <Markdown text={streaming} />
              )}
            </div>
          )}
        </div>

        <footer className="chat-foot">
          <textarea
            ref={input}
            value={draft}
            rows={2}
            placeholder="Ask about your results"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send(draft)
              }
            }}
          />
          <div className="chat-foot-row">
            <span className="chat-privacy">
              <Lock size={12} color="#16E3C1" /> On-device. Not medical advice.
            </span>
            <button className="btn accent" onClick={() => send(draft)} disabled={busy || !draft.trim()}>
              {busy ? 'Answering…' : 'Ask'}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  )
}

function Turn({ turn }: { turn: ChatTurn }): React.JSX.Element {
  if (turn.role === 'user') return <div className="bubble user">{turn.text}</div>
  if (turn.error) return <div className="bubble assistant error">{turn.error}</div>
  return (
    <div className="bubble assistant">
      <Markdown text={turn.text} />
      <div className="chat-meta">
        {turn.seconds != null && <span>{turn.seconds}s on this machine</span>}
        {turn.redacted != null && turn.redacted > 0 && (
          <span className="redacted">
            {turn.redacted} {turn.redacted === 1 ? 'sentence' : 'sentences'} withheld: this demo
            never shows an amount to take. Ask your doctor.
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * The little markdown MedPsy actually emits, taken from its real output:
 * ### headings, - bullets, 1. numbered items, **bold** and *emphasis*.
 * Written by hand rather than pulled in, because the alternative to twenty
 * lines here is a dependency that turns model output into HTML, which is the
 * last thing a health app should be doing.
 */
function Markdown({ text }: { text: string }): React.JSX.Element {
  const lines = text.split('\n')
  return (
    <>
      {lines.map((line, i) => {
        const heading = /^\s*#{1,6}\s+(.*)$/.exec(line)
        const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
        const numbered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line)
        if (heading) return <div key={i} className="md-h">{inline(heading[1])}</div>
        if (bullet) return <div key={i} className="md-li"><span className="md-dot">·</span><span>{inline(bullet[1])}</span></div>
        if (numbered) return <div key={i} className="md-li"><span className="md-dot">{numbered[1]}.</span><span>{inline(numbered[2])}</span></div>
        if (line.trim() === '') return <div key={i} className="md-gap" />
        return <p key={i} className="md-p">{inline(line)}</p>
      })}
    </>
  )
}

/**
 * Bold and emphasis. Emphasis is rendered UPRIGHT, not italic: this app never
 * slants type, so `*note*` loses its asterisks and keeps its weight rather
 * than becoming the one italic run in the product.
 */
function inline(s: string): React.JSX.Element {
  const parts = s.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*)/g)
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**')) return <b key={i}>{p.slice(2, -2)}</b>
        if (p.startsWith('*') && p.endsWith('*') && p.length > 2) return <span key={i} className="md-em">{p.slice(1, -1)}</span>
        return <span key={i}>{p}</span>
      })}
    </>
  )
}
