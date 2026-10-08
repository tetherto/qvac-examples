// Small shared pieces: icons, buttons, labels, bars, and formatting.
// Shapes and sizes follow the app's design, on the QVAC design-system tokens.

import type { CSSProperties, ReactNode } from 'react'

// ---- Icons (stroke icons, 24-unit viewBox, as drawn in the design) -------

const PATHS: Record<string, ReactNode> = {
  library: (
    <>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </>
  ),
  plus: <path d="M5 12h14M12 5v14" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  sliders: (
    <>
      <path d="M20 7h-9M14 17H5" />
      <circle cx="17" cy="17" r="3" />
      <circle cx="7" cy="7" r="3" />
    </>
  ),
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronRight: <path d="m9 18 6-6-6-6" />,
  upload: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M17 8l-5-5-5 5" />
      <path d="M12 3v12" />
    </>
  ),
  download: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </>
  ),
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </>
  ),
  file: (
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
      <path d="M14 2v5h6" />
    </>
  ),
  fileText: (
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
      <path d="M14 2v5h6" />
      <path d="M8 13h8M8 17h5" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  flag: (
    <>
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <path d="M4 22v-7" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  wifiOff: (
    <>
      <path d="M2 2l20 20" />
      <path d="M8.5 16.5a5 5 0 0 1 7 0" />
      <path d="M5 12.86a10 10 0 0 1 5.17-2.69" />
      <path d="M12 20h.01" />
    </>
  ),
  lock: (
    <>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
  external: <path d="M7 7h10v10M7 17 17 7" />
}

export function Icon({ name, size = 16, color = 'currentColor', width = 1.75, style }: { name: keyof typeof PATHS | string; size?: number; color?: string; width?: number; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={{ fill: 'none', stroke: color, strokeWidth: width, strokeLinecap: 'round', strokeLinejoin: 'round', flex: 'none', ...style }}>
      {PATHS[name]}
    </svg>
  )
}

export function PauseGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden style={{ fill: 'currentColor' }}>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  )
}

export function Mark({ height = 20 }: { height?: number }) {
  return <img src="/assets/qvac-mark.svg" alt="" style={{ height, width: 'auto' }} />
}

// ---- Buttons and labels ---------------------------------------------------

type Variant = 'primary' | 'outline' | 'quiet' | 'subtle' | 'danger' | 'accent'

export function Btn({
  variant = 'outline',
  size,
  children,
  kbd,
  disabled,
  onClick,
  style,
  title,
  block
}: {
  variant?: Variant
  size?: 'sm' | 'lg'
  children: ReactNode
  kbd?: string
  disabled?: boolean
  onClick?: () => void
  style?: CSSProperties
  title?: string
  block?: boolean
}) {
  return (
    <button type="button" className={`btn btn-${variant}${size ? ` btn-${size}` : ''}${block ? ' btn-block' : ''}`} disabled={disabled} onClick={onClick} style={style} title={title}>
      {children}
      {kbd && <span className="kbd">{kbd}</span>}
    </button>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>
}

export function Eyebrow({ children, color, style }: { children: ReactNode; color?: string; style?: CSSProperties }) {
  return (
    <div className="eyebrow" style={{ color, ...style }}>
      {children}
    </div>
  )
}

export function Label({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="label" style={style}>
      {children}
    </div>
  )
}

export function Dot({ kind }: { kind: 'live' | 'warming' | 'ring' | 'ring-dim' | 'ring-amber' | 'off' }) {
  return <span className={`dot dot-${kind}`} />
}

export function Bar({ pct, height = 2, glow, color }: { pct: number; height?: number; glow?: boolean; color?: string }) {
  return (
    <div className="bar" style={{ height, borderRadius: height }}>
      <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color, boxShadow: glow ? '0 0 12px rgba(24,227,193,0.5)' : undefined }} />
    </div>
  )
}

export function Spinner({ size = 12, color = 'var(--qvac-acqua)' }: { size?: number; color?: string }) {
  return <span className="spinner" style={{ width: size, height: size, borderColor: color, borderRightColor: 'transparent' }} />
}

/** Renders `backticked` spans as code, the way stems and options use them. */
export function Rich({ text, codeSize }: { text: string; codeSize?: number }) {
  const parts = text.split(/(`[^`]+`)/g)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('`') && p.endsWith('`') && p.length > 2 ? (
          <code key={i} className="inline-code" style={{ fontSize: codeSize }}>
            {p.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  )
}

// ---- Formatting -------------------------------------------------------------

export function gb(bytes: number, digits = 1): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(digits)} GB`
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`
  return `${bytes} B`
}

export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  const r = s % 60
  return r ? `${m} min ${r} s` : `${m} min`
}

export function clock(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function trail(t: string[], sep = ' › '): string {
  return t.join(sep)
}

/** "docs.example.com/guide/getting-started" from a URL. */
export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

export const DIFFICULTY_LABEL = { recall: 'Recall', applied: 'Applied', scenario: 'Scenario' } as const
export const TYPE_LABEL = { single: 'single answer', multi: 'multiple answers', truefalse: 'true or false' } as const
