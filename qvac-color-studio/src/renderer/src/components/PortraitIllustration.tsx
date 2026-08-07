// ============================================================
// The stand-in portrait, ported straight from the design file's
// `Portrait.dc.html`.
//
// It appears where there is no photo yet — the intro, and the
// retake prompt. Once a real still exists the app shows that
// instead; this is scene-setting, never a stand-in for the
// user's own face.
// ============================================================

interface Props {
  /** Colour of the garment shape below the neck. */
  garmentFill?: string
  /** Show the dashed oval that helps the user line their face up. */
  guide?: boolean
}

export function PortraitIllustration({
  garmentFill = '#C9C6BF',
  guide = false
}: Props): React.JSX.Element {
  return (
    <div className="portrait">
      <svg
        viewBox="0 0 360 440"
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block', width: '100%', height: 'auto' }}
        aria-hidden="true"
      >
        <rect x="0" y="0" width="360" height="440" fill="#E9E4DD" />
        <ellipse cx="180" cy="138" rx="92" ry="106" fill="#3C332C" />
        <rect x="154" y="205" width="52" height="80" rx="20" fill="#C7A488" />
        <path d="M14 440 C14 340 104 296 180 296 C256 296 346 340 346 440 Z" fill={garmentFill} />
        <ellipse cx="180" cy="152" rx="76" ry="90" fill="#D9B79A" />
        <ellipse cx="104" cy="158" rx="12" ry="18" fill="#D0AC8E" />
        <ellipse cx="256" cy="158" rx="12" ry="18" fill="#D0AC8E" />
        <path d="M148 130 q15 -10 30 -1" stroke="#B6906F" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M182 129 q15 -9 30 1" stroke="#B6906F" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M150 152 q13 8 27 0" stroke="#9c7657" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M183 152 q13 8 27 0" stroke="#9c7657" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M178 158 q-7 15 -1 21" stroke="#B6906F" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <path d="M162 196 q18 13 36 0" stroke="#C98F79" strokeWidth="6" fill="none" strokeLinecap="round" />
      </svg>
      {guide && <div className="portrait__guide" />}
    </div>
  )
}
