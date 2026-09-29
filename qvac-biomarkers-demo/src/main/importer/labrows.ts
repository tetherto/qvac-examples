// ============================================================
// Reading a lab report ROW by ROW, whatever produced the rows.
//
// A lab report is a table: an analyte name, a result, a unit, a reference
// range. Two sources give us those rows as plain lines, left to right:
//
//   - the text layer of a digital PDF, regrouped by position (pdf.ts), and
//   - on-device OCR of a scan or a photo, regrouped by bounding box (ocr.ts).
//
// Nothing below knows which one it was. Three rules keep a wrong number out
// of a health record, which is the one failure that matters here:
//
//  1. THE NAME MUST BE KNOWN. It is matched against the marker library through
//     an explicit alias list ("HEMOGLOBIN (HGB)" is Hemoglobin). An analyte we
//     do not carry is reported, never guessed at.
//  2. THE UNIT MUST BE ONE WE KNOW FOR THAT MARKER, and is converted when the
//     lab uses another scale: neutrophils in x10^3/uL are stored as cells/uL,
//     times 1000. An unknown unit is skipped and reported.
//  3. THE VALUE MUST BE PLAUSIBLE: within a factor of ten of the reference
//     range, or three when the unit could not be read. An OCR misread that
//     drops a decimal point ("4.91" read as "491") fails this test.
// ============================================================

import type { Marker, Reading } from '../../shared/types.js'

// ---- Names ---------------------------------------------------------------

/**
 * Extra names per marker id, in normalised form (see normaliseLabel). The
 * marker's own library name is always accepted too. Longest match wins, so
 * "mean corpuscular hemoglobin concentration" is MCHC even though it starts
 * with the MCH alias.
 */
const ALIASES: Record<string, string[]> = {
  RBC: ['red blood cells (rbc)', 'red blood cells', 'red blood cell count', 'erythrocytes', 'rbc'],
  Hb: ['hemoglobin (hgb)', 'hemoglobin', 'haemoglobin', 'hgb', 'hb'],
  HCT: ['hematocrit (hct)', 'hematocrit', 'haematocrit', 'hct'],
  MCV: ['mean corpuscular volume', 'mcv'],
  MCH: ['mean corpuscular hemoglobin', 'mean corpuscular haemoglobin', 'mch'],
  MCHC: ['mean corpuscular hemoglobin concentration', 'mean corpuscular haemoglobin concentration', 'mchc'],
  RDW: ['red blood cell distribution width', 'rdw-cv', 'rdw'],
  WBC: ['white blood cells (wbc)', 'white blood cells', 'white blood cell count', 'leukocytes', 'wbc'],
  PLT: ['platelets (plt)', 'platelets', 'platelet count', 'plt'],
  MPV: ['mean platelet volume', 'mpv'],
  Glu: ['glucose', 'fasting glucose', 'glucose fasting'],
  Chol: ['total cholesterol', 'cholesterol total', 'cholesterol'],
  HDL: ['hdl-cholesterol', 'hdl cholesterol', 'cholesterol hdl', 'hdl-c', 'hdl'],
  LDL: ['ldl-cholesterol', 'ldl cholesterol', 'cholesterol ldl', 'ldl-c', 'ldl'],
  CHOL_NHDL: ['non-hdl cholesterol', 'non-hdl-cholesterol'],
  Tg: ['triglycerides', 'triglyceride'],
  AST: ['transaminase ast', 'aspartate aminotransferase', 'aspartate transaminase', 'ast', 'sgot'],
  ALT: ['transaminase alt', 'alanine aminotransferase', 'alanine transaminase', 'alt', 'sgpt'],
  GGT: [
    'γ-glutamyltransferase', 'γ-glutamyltranferase', 'y-glutamyltransferase', 'y-glutamyltranferase',
    'gamma-glutamyltransferase', 'gamma-gt', 'γ-gt', 'y-gt', 'ggt'
  ],
  Fer: ['ferritin'],
  CRP: ['c-reactive protein', 'crp'],
  hsCRP: ['hs-crp', 'high-sensitivity crp', 'crp high sensitivity'],
  TSH: ['thyroid-stimulating hormone', 'thyroid stimulating hormone', 'tsh'],
  // OCR reads the 1 of A1c as a capital I or a lower-case L.
  HgbA1c: ['hemoglobin a1c', 'glycated hemoglobin', 'hba1c', 'hbaic', 'hbalc'],
  D: ['vitamin d', '25-oh vitamin d', '25-hydroxy vitamin d'],
  B12: ['vitamin b12', 'cobalamin'],
  TIBC: ['total iron binding capacity', 'iron binding capacity', 'tibc'],
  TS: ['transferrin saturation', 'iron saturation', 'tsat']
}

/**
 * A white-cell differential prints two results on one row, a percentage and
 * an absolute count. The unit decides which marker each one is.
 */
const DIFFERENTIALS: Record<string, { names: string[]; pct: string; count: string }> = {
  neutrophils: { names: ['neutrophil granulocytes', 'neutrophils', 'neutrophil'], pct: 'NEUT_PCT', count: 'NEUT' },
  lymphocytes: { names: ['lymphocytes', 'lymphocyte'], pct: 'LYMPHS_PCT', count: 'LYMPHS' },
  monocytes: { names: ['monocytes', 'monocyte'], pct: 'MONOS_PCT', count: 'MONOS' },
  eosinophils: { names: ['eosinophil granulocytes', 'eosinophils', 'eosinophil'], pct: 'EOS_PCT', count: 'EOS' },
  basophils: { names: ['basophil granulocytes', 'basophils', 'basophil'], pct: 'BASOS_PCT', count: 'BASOS' }
}

/** Metrics that never appear on a lab report; kept out of the name index. */
const NOT_LAB = new Set(['BMI', 'SLEEP', 'RHR', 'SPO2'])

/**
 * Lower case, dotted leaders and asterisks removed, the specimen dropped
 * ("(Serum)"), one space before an opening bracket and none after it.
 */
export function normaliseLabel(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/(\s*\.){2,}/g, ' ')
    .replace(/\((?:serum|plasma|blood|whole blood|urine)\)/g, ' ')
    .replace(/[*:!,]/g, ' ')
    .replace(/\s*\(\s*/g, ' (')
    .replace(/\s*\)/g, ')')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

type Target = { kind: 'marker'; marker: Marker } | { kind: 'diff'; pct: Marker; count: Marker }

interface NameIndex {
  entries: { name: string; target: Target }[]
}

export function buildNameIndex(markers: Marker[]): NameIndex {
  const byId = new Map(markers.map((m) => [m.id, m]))
  const entries: { name: string; target: Target }[] = []
  for (const marker of markers) {
    if (NOT_LAB.has(marker.id) || marker.id.endsWith('_PCT')) continue
    if (Object.values(DIFFERENTIALS).some((d) => d.count === marker.id)) continue
    const names = new Set([normaliseLabel(marker.name), ...(ALIASES[marker.id] ?? [])])
    for (const name of names) entries.push({ name, target: { kind: 'marker', marker } })
  }
  for (const d of Object.values(DIFFERENTIALS)) {
    const pct = byId.get(d.pct)
    const count = byId.get(d.count)
    if (!pct || !count) continue
    for (const name of d.names) entries.push({ name, target: { kind: 'diff', pct, count } })
  }
  entries.sort((a, b) => b.name.length - a.name.length)
  return { entries }
}

/** The target whose name the label starts with, on a word boundary. */
function matchLabel(label: string, index: NameIndex): { target: Target; name: string } | null {
  for (const { name, target } of index.entries) {
    if (!label.startsWith(name)) continue
    // Only a space or a bracket may follow: "cholesterol/hdl ratio" and
    // "iron binding capacity" are other analytes, not cholesterol or iron.
    const next = label.charAt(name.length)
    if (next === '' || next === ' ' || next === '(') return { target, name }
  }
  return null
}

// ---- Numbers and units ---------------------------------------------------

/** A result number standing on its own: 4.91, 13,5, 150,000, <0.5. */
const NUMBER = /^([<>≤≥]?)(\d+(?:[.,]\d+)?)$/

function toNumber(body: string): number {
  // "150,000" is a thousands separator; "13,5" is a European decimal comma.
  if (/^\d{1,3},\d{3}$/.test(body)) return Number(body.replace(',', ''))
  return Number(body.replace(',', '.'))
}

/** Flags labs print next to a result. They carry no value. */
const FLAG = /^(?:h|l|hh|ll|high|low|a|\*|!|↑|↓)$/i

/**
 * One spelling per unit, whatever the lab or the OCR wrote. OCR reads the
 * zero of "x10^3" as a capital O and the one as a lower-case L, and loses
 * the slash of "mg/dL" often enough to be worth undoing.
 */
export function canonicalUnit(raw: string): string {
  let u = raw.trim().replace(/μ/g, 'µ')
  u = u.replace(/^[x×]\s*[1lI][0oO]\s*(?:\^|e|E|\*)\s*/, 'x10^')
  // The exponent itself: a capital G is a misread 6, a lower-case g a 9.
  u = u.replace(/^x10\^G/, 'x10^6').replace(/^x10\^g/, 'x10^9')
  // "cells/uL" with its slash read as an L.
  u = u.replace(/^cells[lI|]([uµ]L)$/i, 'cells/$1')
  u = u.replace(/(\d)\s*[lI]\s*[uµ]L$/, '$1/uL')
  u = u.toLowerCase().replace(/\s+/g, '').replace(/µ/g, 'u')
  const fixes: Record<string, string> = {
    mgdl: 'mg/dl', gdl: 'g/dl', uil: 'u/l', 'u/i': 'u/l', 'iu/l': 'u/l', ul: 'u/l',
    'hiu/ml': 'uiu/ml', 'uui/ml': 'uiu/ml', 'miu/l': 'uiu/ml', 'mu/l': 'uiu/ml',
    'ug/l': 'ng/ml', 'x10e6/ul': 'x10^6/ul', 'x10e3/ul': 'x10^3/ul', 'x10^12/l': 'x10^6/ul',
    'x10^9/l': 'x10^3/ul', 'k/ul': 'x10^3/ul', 'thousands/ul': 'x10^3/ul', 'million/ul': 'x10^6/ul',
    'm/ul': 'x10^6/ul', 'cells/ul': '/ul', '/mm3': '/ul', 'fl.': 'fl'
  }
  // "µIU" read as "HIU", "ulU" or "uIU".
  u = u.replace(/^[hu][il1|]u\/(m?l)$/, 'uiu/$1')
  return fixes[u] ?? u
}

/** Units that carry no slash, caret or percent sign. */
const BARE_UNITS = new Set(['fl', 'pg', 'u/l', 'um3'])

/**
 * Whether a token reads as a unit at all, before we ask which one. A word is
 * not a unit: "Page 1 from 4" must not become a value of 1 in "from".
 */
function looksLikeUnit(token: string): boolean {
  if (NUMBER.test(token) || FLAG.test(token) || token.length > 14) return false
  const u = canonicalUnit(token)
  return BARE_UNITS.has(u) || /[/%^]/.test(u)
}

/** Row labels that are report furniture, never analytes. */
const NOT_ANALYTE = /^(?:page|order|method|report|visit|validation|sampling|accredited|ref|reference|result)\b/

/**
 * Accepted units per library unit, as a factor that converts the lab's value
 * into the library's scale. The library unit itself always has factor 1.
 */
const CONVERSIONS: Record<string, Record<string, number>> = {
  // Library label, canonicalised -> { lab unit: factor }
  'x10e6/ul': { 'x10^6/ul': 1 },
  'thousands/ul': { 'x10^3/ul': 1, '/ul': 0.001 },
  'cells/ul': { '/ul': 1, 'x10^3/ul': 1000 },
  'g/dl': { 'g/dl': 1, 'g/l': 0.1 },
  '%': { '%': 1, 'l/l': 100 },
  fl: { fl: 1, um3: 1 },
  pg: { pg: 1 },
  'u/l': { 'u/l': 1, 'ukat/l': 60 },
  'ng/ml': { 'ng/ml': 1 },
  'mg/l': { 'mg/l': 1, 'mg/dl': 10 },
  // TSH is printed in uIU/mL, which is the same number as mIU/L. The library
  // label says uIU/L; its reference range is the mIU/L one.
  'uiu/l': { 'uiu/ml': 1 }
}

/** mmol/L factors for the analytes where European labs use them. */
const MOLAR: Record<string, number> = { Glu: 18.016, Chol: 38.67, HDL: 38.67, LDL: 38.67, CHOL_NHDL: 38.67, Tg: 88.57 }

function factorFor(marker: Marker, unit: string): number | null {
  const lib = canonicalUnit(marker.unit)
  if (unit === lib) return 1
  const table = CONVERSIONS[lib] ?? CONVERSIONS[marker.unit.toLowerCase().replace(/µ/g, 'u')]
  if (table && unit in table) return table[unit]
  if (lib === 'mg/dl' && unit === 'mmol/l' && MOLAR[marker.id]) return MOLAR[marker.id]
  if (lib === 'mg/dl' && unit === 'g/l') return 100
  return null
}

function plausible(marker: Marker, value: number, unitWasRead: boolean): boolean {
  const { low, high } = marker.range as { low?: number | null; high?: number | null }
  const k = unitWasRead ? 10 : 3
  if (low != null && low > 0 && value < low / k) return false
  if (high != null && high > 0 && value > high * k) return false
  return value >= 0
}

// ---- Dates ---------------------------------------------------------------

const DATE_LABEL = /(sampling|collection|collected|specimen|drawn|pr[ée]l[èe]vement)/i
const DMY = /\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\b/
const ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/

function isoFrom(text: string): { iso: string; dayFirstGuess: boolean } | null {
  const t = text.replace(/\/{2,}/g, '/')
  const iso = ISO.exec(t)
  if (iso) return { iso: `${iso[1]}-${iso[2]}-${iso[3]}`, dayFirstGuess: false }
  const m = DMY.exec(t)
  if (!m) return null
  let [a, b] = [Number(m[1]), Number(m[2])]
  const year = m[3]
  let guess = false
  if (a <= 12 && b > 12) [a, b] = [b, a] // month first, the US order
  else if (a <= 12 && b <= 12) guess = true // ambiguous: read day first
  if (b < 1 || b > 12 || a < 1 || a > 31) return null
  return { iso: `${year}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`, dayFirstGuess: guess }
}

/** The collection date: a labelled one if the report has it, else the first date. */
export function findReportDate(rows: string[]): { iso: string; note?: string } | null {
  const labelled = rows.find((r) => DATE_LABEL.test(r) && isoFrom(r))
  const row = labelled ?? rows.find((r) => isoFrom(r))
  if (!row) return null
  const found = isoFrom(row)!
  const notes: string[] = []
  if (!labelled) notes.push('No sampling date label found, so the first date on the report was used.')
  if (found.dayFirstGuess) notes.push(`The date ${found.iso} was read as day/month/year.`)
  return { iso: found.iso, note: notes.join(' ') || undefined }
}

// ---- Rows ----------------------------------------------------------------

export interface RowsResult {
  readings: Reading[]
  unknownMarkers: string[]
  unreadable: number
  notes: string[]
}

/** Splits "5.26x10^3/uL" and ":49.6" into their parts; keeps "x10^3/uL" whole. */
function tokens(row: string): string[] {
  const out: string[] = []
  for (const raw of row.replace(/(\s*\.){2,}/g, ' ').split(/\s+/)) {
    const t = raw.replace(/^[:;]+|[:;,]+$/g, '')
    if (!t) continue
    const glued = /^([<>≤≥]?\d+(?:[.,]\d+)?)([a-zA-Zµμ%/][^\s]*)$/.exec(t)
    if (glued && !/^\d/.test(glued[2])) out.push(glued[1], glued[2])
    else out.push(t)
  }
  return out
}

/**
 * Reads every row that names a known marker. `date` is the collection date
 * the caller already found; `source` only changes the wording of the notes.
 */
export function parseLabRows(rows: string[], markers: Marker[], date: string): RowsResult {
  const index = buildNameIndex(markers)
  const readings: Reading[] = []
  const seen = new Set<string>()
  const unknownMarkers: string[] = []
  const notes: string[] = []
  let unreadable = 0

  const keep = (marker: Marker, value: number, unitWasRead: boolean, label: string): void => {
    if (seen.has(marker.id)) return
    if (!plausible(marker, value, unitWasRead)) {
      unreadable++
      notes.push(`${label}: ${value} is implausible for ${marker.name}, so it was left out. Check the report.`)
      return
    }
    seen.add(marker.id)
    readings.push({ markerId: marker.id, date, value: Math.round(value * 1000) / 1000 })
  }

  for (const row of rows) {
    const toks = tokens(row)
    const first = toks.findIndex((t) => NUMBER.test(t))
    if (first <= 0) continue
    const label = normaliseLabel(toks.slice(0, first).join(' '))
    if (!label || /\d{1,2}\/\d{1,2}\//.test(row)) continue

    // Every (number, unit) pair after the label, skipping flags; a number
    // with no unit after it is a reference bound or a unit OCR did not read.
    const pairs: { value: number; censored: boolean; unit: string | null }[] = []
    for (let i = first; i < toks.length; i++) {
      const m = NUMBER.exec(toks[i])
      if (!m) continue
      let j = i + 1
      while (j < toks.length && FLAG.test(toks[j])) j++
      const unit = j < toks.length && looksLikeUnit(toks[j]) ? canonicalUnit(toks[j]) : null
      pairs.push({ value: toNumber(m[2]), censored: m[1] !== '', unit })
    }
    const withUnit = pairs.filter((p) => p.unit)

    const matched = matchLabel(label, index)
    if (!matched) {
      // Worth reporting only if it looks like a result: a number with a unit.
      if (withUnit.length && label.length <= 60 && !NOT_ANALYTE.test(label) && !unknownMarkers.includes(label))
        unknownMarkers.push(label)
      continue
    }

    let target = matched.target
    if (target.kind === 'diff') {
      // Some labs print the differential as two rows, "Lymphocyte count" and
      // "Lymphocyte percentage". The word after the name then says which, and
      // the row is read like any single result.
      const rest = label.slice(matched.name.length)
      if (/percent|%|pct/.test(rest)) target = { kind: 'marker', marker: target.pct }
      else if (/count|absolute|abs\b|#/.test(rest)) target = { kind: 'marker', marker: target.count }
    }
    if (target.kind === 'diff') {
      for (const p of withUnit) {
        if (p.censored) continue
        if (p.unit === '%') keep(target.pct, p.value, true, label)
        else {
          const f = factorFor(target.count, p.unit!)
          if (f != null) keep(target.count, p.value * f, true, label)
        }
      }
      continue
    }

    const marker = target.marker

    // A MISSING VALUE must not become the reference bound. OCR drops a lone
    // digit often enough ("Ferritin 9 L ng/mL 20 - 345" read without its 9),
    // and the first number left is then the range: 20. Two tells give it away:
    // the unit sits before any number, or the only numbers are a low and a
    // high bound with no unit after them.
    const unitBeforeValue = toks.slice(0, first).some((t) => looksLikeUnit(t))
    const numbers = pairs.map((p) => p.value)
    const rangeOnly =
      withUnit.length === 0 &&
      (numbers.length === 2 ? numbers[0] < numbers[1] : toks[first + 1] === '-' || toks[first + 1] === '–')
    if (unitBeforeValue || rangeOnly) {
      unreadable++
      notes.push(`${marker.name}: the result itself could not be read, only its reference range, so it was left out.`)
      continue
    }

    const result = withUnit[0] ?? pairs[0]
    if (!result) continue
    if (result.censored) {
      unreadable++
      notes.push(`${marker.name} was reported as a bound (below or above the test's limit), not a value, so it was left out.`)
      continue
    }
    if (!result.unit) {
      notes.push(`${marker.name}: no unit could be read, so ${marker.unit} was assumed.`)
      keep(marker, result.value, false, label)
      continue
    }
    const factor = factorFor(marker, result.unit)
    if (factor == null) {
      unreadable++
      notes.push(`${marker.name} is in ${result.unit}, a unit this app does not convert, so it was left out.`)
      continue
    }
    keep(marker, result.value * factor, true, label)
  }

  return { readings, unknownMarkers, unreadable, notes }
}
