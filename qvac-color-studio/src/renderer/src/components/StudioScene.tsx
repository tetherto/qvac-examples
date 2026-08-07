// ============================================================
// A drawn salon, for the intro screen.
//
// The whole idea of personal colour analysis is physical — someone
// holds cloth under your chin in front of a mirror and you watch
// your face change. Describing that in words takes a paragraph;
// showing it takes a second.
//
// Deliberately a flat illustration, not a photograph or a likeness:
// nobody's face, no brand, nothing that could be mistaken for a
// real person or a real salon. Palette is the design system's.
// ============================================================

const SKIN = '#E0BE9E'
const SKIN_SHADE = '#CFA986'
const HAIR = '#3C332C'
const CAPE = '#CFCBC2'
const CHAIR = '#D6D2C9'
const WALL = '#EFEDE7'
const FLOOR = '#E4E1D9'
const LINE = '#D2CFC7'

/** The cloths on the rail, and the one being held up. */
const RAIL_CLOTHS = [
  { x: 372, len: 62, fill: '#1F4EA8' },
  { x: 394, len: 78, fill: '#0E7C66' },
  { x: 416, len: 54, fill: '#C9971E' },
  { x: 438, len: 70, fill: '#E86A5C' }
]

/** The colour held under the chin — a cool blue, which is what "fit" looks like. */
const DRAPE = '#1F4EA8'

export function StudioScene(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 480 360"
      preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block', width: '100%', height: 'auto', borderRadius: 14 }}
      role="img"
      aria-label="A drawn salon scene: someone seated before a mirror with a blue cloth held under their chin, and more coloured cloths on a rail behind."
    >
      {/* Room */}
      <rect x="0" y="0" width="480" height="360" rx="14" fill={WALL} />
      <rect x="0" y="286" width="480" height="74" fill={FLOOR} />
      <line x1="0" y1="286" x2="480" y2="286" stroke={LINE} strokeWidth="1.5" />

      {/* Mirror */}
      <rect x="30" y="46" width="118" height="240" rx="10" fill="#F7F6F3" stroke={LINE} strokeWidth="2" />
      {/* A sheen, so it reads as glass rather than a doorway. */}
      <path d="M38 214 L138 78 L138 116 L38 252 Z" fill="#FFFFFF" opacity="0.55" />
      <path d="M38 258 L86 200 L86 224 L38 282 Z" fill="#FFFFFF" opacity="0.35" />

      {/* Cloth rail */}
      <line x1="360" y1="60" x2="462" y2="60" stroke="#B9B5AC" strokeWidth="3" strokeLinecap="round" />
      {RAIL_CLOTHS.map((c) => (
        <g key={c.x}>
          <line x1={c.x} y1="60" x2={c.x} y2="70" stroke="#B9B5AC" strokeWidth="2" />
          <rect x={c.x - 9} y="68" width="18" height={c.len} rx="5" fill={c.fill} />
        </g>
      ))}

      {/* Chair back */}
      <rect x="196" y="190" width="98" height="104" rx="16" fill={CHAIR} />

      {/* Cape over the shoulders */}
      <path d="M180 294 C182 244 208 214 245 214 C282 214 308 244 310 294 Z" fill={CAPE} />

      {/* Neck */}
      <rect x="233" y="176" width="24" height="34" rx="10" fill={SKIN_SHADE} />

      {/* Head */}
      <ellipse cx="245" cy="140" rx="35" ry="41" fill={SKIN} />
      <ellipse cx="211" cy="146" rx="6" ry="9" fill={SKIN_SHADE} />
      <ellipse cx="279" cy="146" rx="6" ry="9" fill={SKIN_SHADE} />
      {/* Hair, sitting over the crown */}
      <path
        d="M208 130 C206 96 224 78 245 78 C266 78 284 96 282 130 C276 112 264 102 245 102 C226 102 214 112 208 130 Z"
        fill={HAIR}
      />
      {/* Eyes and mouth, kept to marks — no likeness. */}
      <path d="M230 138 q7 -5 14 0" stroke="#8E6B4E" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <path d="M247 138 q7 -5 14 0" stroke="#8E6B4E" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <path d="M236 164 q9 6 18 0" stroke="#C08774" strokeWidth="3.4" fill="none" strokeLinecap="round" />

      {/* The drape: cloth held up under the chin, which is the whole point. */}
      <path d="M196 196 L294 196 L302 286 L188 286 Z" fill={DRAPE} />
      {/* A fold, so it looks like fabric and not a painted block. */}
      <path d="M245 196 L252 286 L238 286 Z" fill="#FFFFFF" opacity="0.09" />

      {/* Hands holding the top corners of the cloth */}
      <ellipse cx="197" cy="199" rx="12" ry="9" fill={SKIN} transform="rotate(-14 197 199)" />
      <ellipse cx="293" cy="199" rx="12" ry="9" fill={SKIN} transform="rotate(14 293 199)" />

      {/* The "glow" the right colour gives — a soft mint arc beside the face. */}
      <path
        d="M300 108 C322 128 322 158 300 178"
        stroke="#16E3C1"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
        opacity="0.75"
      />
      <path
        d="M314 96 C344 126 344 162 314 192"
        stroke="#16E3C1"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        opacity="0.35"
      />
    </svg>
  )
}
