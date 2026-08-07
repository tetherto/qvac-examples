// ============================================================
// The twelve drape colours — the fixed vocabulary of the app.
//
// These names are the join key between three places: the swatch
// list in the UI, the `colors[]` array the vision model returns,
// and the `recommendedPalette` / `avoid` lists. Change a name here
// and you must change the prompt too, or the join breaks.
// ============================================================

import type { Analysis } from './types.js'

export interface Swatch {
  name: string
  /** Approximate hex, used for both the tray chip and the drape band. */
  hex: string
  group: 'cool' | 'warm'
  /** Very light swatches need an outline or they vanish on white. */
  needsOutline?: boolean
}

export const COOL_SWATCHES: Swatch[] = [
  { name: 'True Blue', hex: '#1F4EA8', group: 'cool' },
  { name: 'Emerald', hex: '#0E7C66', group: 'cool' },
  { name: 'Fuchsia', hex: '#B5178E', group: 'cool' },
  { name: 'Icy Pink', hex: '#E9A7C4', group: 'cool' },
  { name: 'Pure White', hex: '#F7F7F5', group: 'cool', needsOutline: true },
  { name: 'Cool Grey/Silver', hex: '#A9B0B5', group: 'cool' }
]

export const WARM_SWATCHES: Swatch[] = [
  { name: 'Coral', hex: '#E86A5C', group: 'warm' },
  { name: 'Tomato Red', hex: '#D93A26', group: 'warm' },
  { name: 'Mustard/Gold', hex: '#C9971E', group: 'warm' },
  { name: 'Olive', hex: '#7A7A2E', group: 'warm' },
  { name: 'Peach', hex: '#F0A57A', group: 'warm' },
  { name: 'Cream/Ivory', hex: '#F2E7CF', group: 'warm', needsOutline: true }
]

export const PALETTE: Swatch[] = [...COOL_SWATCHES, ...WARM_SWATCHES]

export const PALETTE_NAMES: string[] = PALETTE.map((s) => s.name)

export function swatchByName(name: string): Swatch | undefined {
  return PALETTE.find((s) => s.name === name)
}

/** Dot colours for the three ratings, and the words we put next to them. */
export const RATING_DOT: Record<'green' | 'yellow' | 'red', string> = {
  green: '#1FB58F',
  yellow: '#C9A227',
  red: '#C2453C'
}

/**
 * What the user reads. One scale, three rungs — "Fit / Moderate fit / No fit".
 *
 * These deliberately borrow no colour words. The internal rating keys are
 * green/yellow/red because that is what the dots are, but a screen full of
 * colours called Emerald, Tomato Red and Icy Pink cannot also label its
 * verdicts "green" and "red" without the two readings colliding in the
 * reader's head. "Avoid" was the odd one out of the old set: an instruction
 * where the other two were descriptions.
 */
export const RATING_LABEL: Record<'green' | 'yellow' | 'red', string> = {
  green: 'Fit',
  yellow: 'Moderate fit',
  red: 'No fit'
}

/**
 * The colour the full look should be rendered in: the model's top
 * recommendation, else the first green, else — if nothing scored green —
 * the first swatch of the group matching the undertone.
 *
 * Lives in `shared` because the renderer picks the colour and passes the
 * name to `generateFullLook`.
 */
export function bestColorName(analysis: Analysis): string {
  const top =
    analysis.recommendedPalette[0] ?? analysis.colors.find((c) => c.rating === 'green')?.name
  if (top) return top

  const group = analysis.undertone === 'warm' ? 'warm' : 'cool'
  return (PALETTE.find((s) => s.group === group) ?? PALETTE[0]).name
}
