// Every icon the app uses, in one file. Line icons on a 24x24 grid, stroked
// rather than filled, matching the design.

interface P {
  size?: number
  color?: string
  className?: string
}

function svg(path: React.JSX.Element, { size = 16, color = 'currentColor', className }: P): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {path}
    </svg>
  )
}

export const Download = (p: P): React.JSX.Element =>
  svg(<path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" />, p)
export const Chip = (p: P): React.JSX.Element =>
  svg(
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <rect x="9" y="9" width="6" height="6" />
    </>,
    p
  )
export const Lock = (p: P): React.JSX.Element =>
  svg(
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </>,
    p
  )
export const Book = (p: P): React.JSX.Element =>
  svg(
    <>
      <path d="M4 5a2 2 0 012-2h12a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2z" />
      <path d="M8 3v18M12 8h4M12 12h4" />
    </>,
    p
  )
export const Search = (p: P): React.JSX.Element =>
  svg(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4-4" />
    </>,
    p
  )
export const Chevron = (p: P): React.JSX.Element => svg(<path d="M6 9l6 6 6-6" />, p)
export const ChevronLeft = (p: P): React.JSX.Element => svg(<path d="M15 18l-6-6 6-6" />, p)
export const ChevronRight = (p: P): React.JSX.Element => svg(<path d="M9 6l6 6-6 6" />, p)
export const Pencil = (p: P): React.JSX.Element =>
  svg(<path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />, p)
export const Trash = (p: P): React.JSX.Element =>
  svg(<path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3" />, p)
export const Refresh = (p: P): React.JSX.Element => svg(<path d="M21 12a9 9 0 11-3-6.7M21 4v4h-4" />, p)
export const Sparkle = (p: P): React.JSX.Element =>
  svg(
    <path d="M12 3v3m0 12v3m9-9h-3M6 12H3m14.5-6.5l-2 2m-7 7l-2 2m11 0l-2-2m-7-7l-2-2" />,
    p
  )
export const Check = (p: P): React.JSX.Element => svg(<path d="M5 13l4 4L19 7" />, p)
export const Warning = (p: P): React.JSX.Element =>
  svg(<path d="M12 8v5m0 3h.01M10.3 3.9L2.4 18a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />, p)
export const Close = (p: P): React.JSX.Element => svg(<path d="M6 6l12 12M18 6L6 18" />, p)
export const Link = (p: P): React.JSX.Element =>
  svg(
    <path d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1" />,
    p
  )
export const Chain = (p: P): React.JSX.Element =>
  svg(<path d="M9 17H7A5 5 0 017 7h2m6 0h2a5 5 0 010 10h-2M8 12h8" />, p)
export const FileText = (p: P): React.JSX.Element =>
  svg(
    <>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6M9 15h6M9 12h2" />
    </>,
    p
  )
export const Plus = (p: P): React.JSX.Element => svg(<path d="M12 5v14M5 12h14" />, p)
export const Male = (p: P): React.JSX.Element =>
  svg(
    <>
      <circle cx="10" cy="14" r="6" />
      <path d="M14.5 9.5L20 4M15 4h5v5" />
    </>,
    p
  )
export const Female = (p: P): React.JSX.Element =>
  svg(
    <>
      <circle cx="12" cy="8" r="6" />
      <path d="M12 14v7M9 18h6" />
    </>,
    p
  )
export const Person = (p: P): React.JSX.Element =>
  svg(
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M5 21a7 7 0 0114 0" />
    </>,
    p
  )
