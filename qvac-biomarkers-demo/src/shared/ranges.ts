// ============================================================
// Effective ranges: baseline, or personalized when we have a real rule.
//
// The honest bit: `data/range-adjustments.json` covers twelve markers,
// because those are the ones where a published interval genuinely moves
// with gender or age. Everything else keeps its baseline. Nothing is
// stretched to make the table look fuller, and the UI always says which
// of the two you are looking at.
// ============================================================

import type { AgeGroup, Gender, Marker, Profile, Range } from './types.js'

export interface AdjustmentRule {
  gender: Gender | 'any'
  /** Age group names, or ['*'] for every age. */
  ageGroups: string[]
  range: Range
  note?: string
}

export interface AdjustmentEntry {
  source: string
  sourceUrl: string
  why?: string
  note?: string
  rules: AdjustmentRule[]
}

export interface AdjustmentTable {
  adjustments: Record<string, AdjustmentEntry>
}

export interface EffectiveRange {
  range: Range
  personalized: boolean
  /** Populated only when personalized: the sentence the UI shows. */
  note?: string
}

export const AGE_GROUPS: AgeGroup[] = ['18-29', '30-39', '40-49', '50-59', '60+']

/**
 * Resolves the range to judge a value against.
 *
 * First matching rule wins, so a table can list the specific case before
 * the general one. A profile with no gender and no age group can never
 * match a rule, which is why a fresh install shows baseline everywhere.
 */
export function effectiveRange(
  marker: Marker,
  profile: Profile | null,
  table: AdjustmentTable | null
): EffectiveRange {
  const baseline: EffectiveRange = { range: marker.range, personalized: false }
  if (!profile || !table) return baseline

  const entry = table.adjustments[marker.id]
  if (!entry) return baseline

  for (const rule of entry.rules) {
    const genderOk = rule.gender === 'any' || rule.gender === profile.gender
    const ageOk =
      rule.ageGroups.includes('*') ||
      (profile.ageGroup != null && rule.ageGroups.includes(profile.ageGroup))
    if (!genderOk || !ageOk) continue

    const who = [
      rule.gender === 'any' ? null : rule.gender,
      rule.ageGroups.includes('*') ? null : `age ${rule.ageGroups.join(', ')}`
    ]
      .filter(Boolean)
      .join(', ')

    const parts = [
      `Personalized for ${who || 'your profile'}: ${rule.range.low}-${rule.range.high} ${marker.unit}`,
      `Baseline is ${marker.range.low}-${marker.range.high} ${marker.unit}.`,
      entry.why,
      rule.note,
      entry.note,
      `Source: ${entry.source}`
    ].filter(Boolean)

    return { range: rule.range, personalized: true, note: parts.join(' ') }
  }

  return baseline
}

/**
 * True when this marker COULD be personalized but the profile is too thin
 * to match. Lets the profile screen say what filling it in would buy.
 */
export function personalizable(markerId: string, table: AdjustmentTable | null): boolean {
  return Boolean(table && table.adjustments[markerId])
}
