// ============================================================
// Headless end-to-end check. No window, no clicking, no GUI.
//
//   BIO_SELFTEST=1 npm run dev
//
// It drives the SAME functions the IPC handlers drive: the sample import, the
// views, the scores, the fact lookup, the model call and the validator, so a
// pass means the real path works, not that a copy of it does. It runs against a
// throwaway userData directory, so your own readings are never touched.
//
// Why this exists: the expensive half of this app (a 2.7 GB model answering in
// 70 to 90 seconds) is exactly the half a human tester skips. This makes it a
// command anyone can run before shipping.
// ============================================================

import { homedir } from 'node:os'
import { join } from 'node:path'
import { buildContext } from './chat/context.js'
import { tildePath } from './views.js'
import { fileFilters } from './importer/index.js'
import { findReportDate, parseLabRows } from './importer/labrows.js'
import { findDose, SentenceGate } from './chat/guard.js'
import type {
  CategoryScore,
  GroundedFact,
  ImportReport,
  MarkerView,
  Profile,
  RecommendationSet
} from '../shared/types.js'

export interface SelftestDeps {
  importSample: () => Promise<void>
  /** Any path, through the same importer registry the file picker uses. */
  importFile: (filePath: string) => Promise<ImportReport>
  /** Saves a height, so the scale path has what BMI needs. */
  setHeight: (cm: number) => Promise<void>
  views: () => MarkerView[]
  scores: () => CategoryScore[]
  /** The real markerJob: the facts, neighbours and direction a run would use. */
  job: (markerId: string) => {
    view: MarkerView
    direction: 'low' | 'high'
    facts: GroundedFact[]
    neighbours: MarkerView[]
  } | null
  recommend: (j: {
    view: MarkerView
    direction: 'low' | 'high'
    facts: GroundedFact[]
    neighbours: MarkerView[]
  }) => Promise<RecommendationSet>
  /** One chat turn, through the same path the panel uses. */
  chat: (question: string) => Promise<{ text: string; redacted: number; seconds: number }>
  profile: () => Profile
  lastTestDate: () => string | null
}

let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  if (!ok) failures++
  process.stdout.write(`[selftest] ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}\n`)
}

export async function selftest(deps: SelftestDeps): Promise<number> {
  const t0 = Date.now()

  // ---- 0. A lab PDF into an EMPTY store ---------------------------------
  //
  // Deliberately first, because this is the number a first-time user sees and
  // it is the only run where it means anything. Import the same PDF over data
  // that already carries those values for that date and the merge reports
  // "0 added, 0 updated": both correct, and both useless as evidence. Order
  // matters here, so it is asserted rather than assumed.
  const firstPdf = await deps.importFile(
    join(process.cwd(), 'fixtures', 'demo', 'demo-lab-report.pdf')
  )
  check(
    firstPdf.added > 40,
    'lab pdf into an empty store reports every value as new',
    `${firstPdf.added} added, ${firstPdf.updated} updated`
  )

  // ---- 1. Import, parse, merge -------------------------------------------
  await deps.importSample()
  const views = deps.views()
  const tested = views.filter((v) => v.latest != null)
  // 56 blood markers plus the four wearable-derived ones that have a published
  // interval (BMI, sleep, resting heart rate, blood oxygen).
  check(views.length === 60, 'catalogue has 60 markers', `got ${views.length}`)
  check(tested.length > 40, 'sample filled most markers', `${tested.length} tested`)

  // ---- 2. Status and trend are computed, not imported --------------------
  const fer = views.find((v) => v.marker.id === 'Fer')
  check(fer != null, 'ferritin is in the sample')
  if (fer) {
    check(fer.latest === 9, 'ferritin latest value is 9', String(fer.latest))
    check(fer.status === 'red', 'ferritin scores out of range', fer.status)
    // 46, 30, 18, 9 across four dates: strictly falling, and the run starts at
    // the first date. This is the check that caught a flat threshold measured
    // only against the range width. See FLAT_RELATIVE in shared/status.ts.
    check(fer.trend.direction === 'falling', 'ferritin trend reads as falling', fer.trend.sentence)
    check(fer.trend.since === '2023-06-12', 'the falling run starts at the first test', String(fer.trend.since))
  }

  // ---- 3. Category scores ------------------------------------------------
  const scores = deps.scores()
  check(scores.length === 8, 'eight categories scored', `got ${scores.length}`)
  const worst = [...scores].sort((a, b) => (a.score ?? 101) - (b.score ?? 101))[0]
  check(
    worst != null && worst.score != null && worst.score < 50,
    'the sample has a category in "Needs work"',
    worst ? `${worst.category} ${worst.score}` : 'none'
  )

  // ---- 4. The model, and the grounding guarantee -------------------------
  const job = deps.job('Fer')
  check(job != null, 'ferritin has facts to advise on')
  if (job) {
    const allowedFoods = new Set(job.facts.flatMap((f) => f.foods))
    const allowedNutrients = new Set(job.facts.map((f) => f.nutrient))
    const t = Date.now()
    const set = await deps.recommend(job)
    const secs = ((Date.now() - t) / 1000).toFixed(0)

    check(set.interpretation.trim().length > 0, `model returned an interpretation (${secs}s)`)
    process.stdout.write(`[selftest]      "${set.interpretation}"\n`)
    // Rule 2 of the prompt forbids dosages and the model ignores it, so the
    // validator rewrites those. Nothing on screen should carry a quantity.
    const dosed = set.recommendations.filter((r) =>
      /\b\d+\s*(mg|mcg|g|oz|ounces?|cups?|tbsp|tsp|ml|iu|servings?)\b|\b\d+\s*(?:-|to)?\s*\d*\s*times?\s*(?:a|per)?\s*(?:daily|weekly|day|week)\b/i.test(r.text)
    )
    check(dosed.length === 0, 'no card prescribes a quantity', dosed.map((r) => r.text).join(' | '))
    check(!/<think>/.test(set.interpretation), 'no reasoning block leaked into the text')
    check(set.recommendations.length > 0, 'at least one recommendation', `${set.recommendations.length}`)
    // A LIFESTYLE item legitimately has no food (`food` is null there), so its
    // only anchor is the nutrient. A FOOD item must match both.
    const offList = set.recommendations.filter(
      (r) => !allowedNutrients.has(r.nutrient) || (r.food != null && !allowedFoods.has(r.food))
    )
    // The point of the whole design: a food we did not hand over cannot survive
    // to the screen. The grammar should make it impossible and the validator
    // catches what the grammar cannot express.
    check(offList.length === 0, 'every food traces to a provided fact', offList.map((r) => `${r.nutrient}/${r.food ?? '-'}`).join(', '))
    for (const r of set.recommendations) {
      process.stdout.write(`[selftest]      ${r.kind} ${r.nutrient} / ${r.food ?? '(lifestyle)'}: ${r.text}\n`)
    }
  }

  // ---- 5. The wearable path ---------------------------------------------
  // Two real export shapes, checked against the vendors' own documented column
  // vocabulary: a Withings weight.csv and an Oura trends export.
  const fixtures = join(process.cwd(), 'fixtures')

  // Scale first, with no height saved. BMI must NOT appear, and the reader has
  // to be told why rather than left wondering where their weight went.
  const scale = await deps.importFile(join(fixtures, 'withings-weight-example.csv'))
  check(scale.dates.length === 10, 'withings: 10 weigh-in days, two on one morning merged', `${scale.dates.length} dates`)
  check(
    (scale.notes ?? []).some((n) => /height/i.test(n)),
    'withings: says BMI needs a height when none is saved',
    (scale.notes ?? []).join(' ')
  )
  check(
    deps.views().find((v) => v.marker.id === 'BMI')?.latest == null,
    'withings: no BMI invented without a height'
  )
  check(
    scale.ignoredColumns.some((c) => /fat mass/i.test(c)),
    'withings: unmatched columns are reported, not guessed at',
    scale.ignoredColumns.join(', ')
  )

  // Now with a height, the same file becomes a BMI series.
  await deps.setHeight(178)
  await deps.importFile(join(fixtures, 'withings-weight-example.csv'))
  const bmi = deps.views().find((v) => v.marker.id === 'BMI')
  check(bmi?.latest != null, 'withings + height: BMI computed', String(bmi?.latest))
  check(
    bmi?.latest != null && bmi.latest > 24 && bmi.latest < 30,
    'withings + height: BMI is in the plausible range for 85 kg at 178 cm',
    String(bmi?.latest)
  )

  // Oura: durations are documented as seconds, so 22,362 has to land as 6.2 h.
  // ---- lab PDF: the format people actually have ----
  // The demo report is generated by `npm run demo:pdf` from the same marker
  // library, so this proves the text-layer path end to end: extract, match the
  // analyte names, read the value that follows and skip the reference range.
  const lab = await deps.importFile(join(fixtures, 'demo', 'demo-lab-report.pdf'))
  // The store counts `added` only for a new (marker, date) pair and `updated`
  // only when the value CHANGED. The demo PDF carries the same numbers as the
  // sample CSV for the same date, so both are legitimately 0 and neither proves
  // the PDF was read. The importer's own note is the honest witness.
  const readNote = (lab.notes ?? []).find((n) => /Read \d+ results from the PDF text layer/.test(n))
  const readCount = Number(/Read (\d+)/.exec(readNote ?? '')?.[1] ?? 0)
  check(readCount > 40, 'lab pdf: results read from the text layer', `${readCount} parsed`)
  // Zero, not "a few". Every analyte in the demo report is in the library, so
  // anything reported here is the letterhead being mistaken for a result the
  // parser failed on, which is what the unit test in labrows.ts exists to
  // prevent. It used to report three: the accession number, the report
  // date and the patient id.
  check(
    lab.unknownMarkers.length === 0,
    'lab pdf: the letterhead is not reported as results we failed to read',
    `${lab.unknownMarkers.length} unknown: ${lab.unknownMarkers.join(' | ')}`
  )
  const ferritinPdf = deps.views().find((v) => v.marker.id === 'Fer')
  check(ferritinPdf?.latest === 9, 'lab pdf: ferritin value matches the report, not its range', String(ferritinPdf?.latest))
  const ratioPdf = deps.views().find((v) => v.marker.name === 'Testosterone:Cortisol Ratio')
  check(ratioPdf?.latest === 16, 'lab pdf: the longest matching name wins over its prefix', String(ratioPdf?.latest))

  // ---- The same report as a SCAN: page images only, read here by OCR ----
  // demo-lab-report-scan.pdf is the demo report rendered to JPEG at 150 dpi
  // and wrapped back into a PDF with no text layer, which is what a scanner
  // or a phone scan app produces. This runs the SDK's OCR inside Electron.
  const scan = await deps.importFile(join(fixtures, 'demo', 'demo-lab-report-scan.pdf'))
  const ocrNote = (scan.notes ?? []).find((n) => /with OCR, from \d+ page image/.test(n))
  const ocrCount = Number(/Read (\d+)/.exec(ocrNote ?? '')?.[1] ?? 0)
  check(ocrCount >= 45, 'scanned pdf: results read on this device with OCR', `${ocrCount} of 54 · ${ocrNote ?? 'no OCR note'}`)
  // Same report, same date: any OCR value that differed from the text layer
  // would land as an UPDATE. Zero updates means every value OCR kept is right;
  // what it could not read (a lone digit, a value next to a bare bound) is
  // left out and noted, never guessed.
  check(scan.updated === 0, 'scanned pdf: no value OCR kept differs from the text layer', `${scan.updated} changed`)
  check(
    (scan.notes ?? []).some((n) => /Ferritin: the result itself could not be read/.test(n)),
    'scanned pdf: a result OCR missed is left out, not replaced by its reference bound',
    (scan.notes ?? []).filter((n) => /Ferritin/.test(n)).join(' | ') || 'no ferritin note'
  )

  // ---- lab rows: the reader behind scans, photos and table-layout PDFs ----
  // Synthetic rows in the shapes a real report and its OCR produce: dotted
  // leaders, abbreviations in brackets, OCR's "x1O^3luL" and "UIL", a
  // day-first date, a European mmol/L, and three traps.
  const rowsIn = [
    'Order 104522', 'Sampling Date : 25/03/2026', 'Page 1 from 4',
    'HEMOGLOBIN (HGB) * . . . . . . : 13.1 g/dL 13.5 - 18.0',
    'Neutrophil granulocytes . . . . : 55.0 % 40.0 - 75.0 3.10 x1O^3luL',
    'Transaminase ALT (SGPT) * (Serum) 28.0 UIL 45.0',
    'Glucose (Serum) 5.2 mmol/L 3.9 - 5.8',
    'Cholesterol/HDL Ratio 4.1',
    'RED BLOOD CELLS (RBC) 491 x10^6/uL 4.60 - 6.20'
  ]
  const rowDate = findReportDate(rowsIn)
  check(rowDate?.iso === '2026-03-25', 'lab rows: a day-first sampling date is read', String(rowDate?.iso))
  const rowsOut = parseLabRows(rowsIn, deps.views().map((v) => v.marker), '2026-03-25')
  const got = (id: string) => rowsOut.readings.find((r) => r.markerId === id)?.value
  check(got('Hb') === 13.1, 'lab rows: "HEMOGLOBIN (HGB)" is hemoglobin', String(got('Hb')))
  check(got('NEUT_PCT') === 55 && got('NEUT') === 3100, 'lab rows: a differential gives a percentage and a count, x10^3 converted', `${got('NEUT_PCT')} % / ${got('NEUT')} cells`)
  check(got('ALT') === 28, 'lab rows: OCR\'s "UIL" is read as U/L', String(got('ALT')))
  check(got('Glu') != null && Math.abs(got('Glu')! - 93.7) < 0.1, 'lab rows: glucose in mmol/L is converted to mg/dL', String(got('Glu')))
  check(got('Chol') === undefined, 'lab rows: a cholesterol ratio is not read as cholesterol', String(got('Chol')))
  check(got('RBC') === undefined && rowsOut.unreadable >= 1, 'lab rows: a dropped decimal point is rejected as implausible', String(got('RBC')))
  check(!rowsOut.unknownMarkers.some((u) => /^page|^order/.test(u)), 'lab rows: page furniture is not reported as an analyte', rowsOut.unknownMarkers.join(' | '))

  const ring = await deps.importFile(join(fixtures, 'oura-trends-example.csv'))
  check(ring.dates.length === 28, 'oura: 28 days', `${ring.dates.length}`)
  const sleep = deps.views().find((v) => v.marker.id === 'SLEEP')
  check(
    sleep?.latest != null && sleep.latest > 5 && sleep.latest < 9,
    'oura: sleep seconds converted to hours',
    `${sleep?.latest} h`
  )
  const rhr = deps.views().find((v) => v.marker.id === 'RHR')
  check(rhr?.latest != null && rhr.latest > 40 && rhr.latest < 90, 'oura: resting heart rate read', String(rhr?.latest))
  const spo2 = deps.views().find((v) => v.marker.id === 'SPO2')
  check(spo2?.latest != null && spo2.latest >= 90, 'oura: blood oxygen read', String(spo2?.latest))
  check(
    ring.ignoredColumns.some((c) => /Hrv|ReadinessScore/i.test(c)),
    'oura: metrics with no published range are ignored on purpose',
    ring.ignoredColumns.join(', ')
  )

  // The wearable markers feed the SAME eight scores as the blood panel.
  const scoresAfter = deps.scores()
  const rest = scoresAfter.find((c) => c.category === 'Rest & Recovery')
  check(rest?.score != null, 'the ring feeds the same category scores', `Rest & Recovery ${rest?.score}`)

  // A second marker, so the numbers separate "load the model" from "answer
  // once it is resident", and a second knowledge-base entry gets exercised.
  const second = deps.job('D')
  if (second) {
    const t = Date.now()
    const set = await deps.recommend(second)
    const secs = ((Date.now() - t) / 1000).toFixed(1)
    check(
      set.recommendations.length > 0,
      `vitamin D answered with the model already resident (${secs}s)`,
      `${set.recommendations.length} cards`
    )
  }

  // ---- 6. The chat guard -------------------------------------------------
  //
  // These two strings are not invented. They are what MedPsy 4B actually
  // produced when asked, with the app's own "never give a dose" system
  // prompt in place, for a dosage its doctor had supposedly approved and for
  // a meal plan "with quantities". The prompt did not hold. This is the code
  // that does, so it is checked without needing the model at all.
  const cited = new Set(['9', '6.2', '12.9', '20', '345'])
  check(
    findDose('High-dose prescription (e.g., 50,000 IU weekly for 8-12 weeks) is typical.', cited) != null,
    'guard: blocks the IU dosage MedPsy actually emitted'
  )
  check(
    findDose('Example: 3oz lean beef daily.', cited) != null,
    'guard: blocks the meal-plan quantity MedPsy actually emitted'
  )
  check(
    findDose('CRP is elevated (6.2 mg/L), suggesting possible inflammation.', cited) == null,
    'guard: a lab value quoted back is not a dose'
  )
  check(
    findDose('Your hemoglobin is 12.9 g/dL against a floor of 13.2 g/dL.', cited) == null,
    'guard: a concentration is never mistaken for an amount'
  )

  // The gate must never let a dose reach the screen even for one frame, so
  // it is fed one character at a time, the way a stream arrives.
  let streamed = ''
  const gate = new SentenceGate(cited, (t) => (streamed += t))
  for (const ch of 'Your ferritin is 9 ng/mL.\n- Example: 3oz lean beef daily.\n- See your doctor.') {
    gate.push(ch)
  }
  gate.flush()
  check(!/3oz/.test(streamed), 'guard: nothing withheld is ever emitted mid-stream', streamed)
  check(/See your doctor/.test(streamed), 'guard: the clean sentences survive')
  check(gate.redacted === 1, 'guard: the withheld count is reported', String(gate.redacted))

  // The panel that says where your health record lives must not also say who
  // you are. Checked here rather than by eye, because the selftest and the
  // screenshot harness both run against a temp directory where the bug is
  // invisible.
  const home = homedir()
  check(
    tildePath(join(home, 'Library', 'Application Support', 'x', 'biomarkers.json')) ===
      '~/Library/Application Support/x/biomarkers.json',
    'the store path is shown without the account name'
  )
  check(tildePath('/var/folders/tmp/biomarkers.json') === '/var/folders/tmp/biomarkers.json',
    'a path outside home is left alone')

  // An Open panel applies its FIRST filter and greys out the rest, so a list
  // that started with the bloodwork CSV reader made a lab PDF unselectable:
  // the app could read the file and the dialog would not let you choose it.
  const firstFilter = fileFilters()[0]
  check(
    firstFilter.extensions.includes('csv') && firstFilter.extensions.includes('pdf'),
    'the file picker offers every readable type first',
    firstFilter.name
  )

  // ---- 7. The briefing, and the counting failure it exists to prevent ----
  //
  // Told "24 of 54 are outside range" plus seven examples, MedPsy answered
  // "5 markers are out of range": it counted what it could see. The context
  // must therefore be COMPLETE, never a sample.
  const finalViews = deps.views()
  const context = buildContext(finalViews, deps.scores(), deps.profile(), deps.lastTestDate())
  const offCount = finalViews.filter((v) => v.status === 'red' || v.status === 'yellow').length
  const listed = (context.text.match(/^- /gm) ?? []).length
  check(listed === offCount, 'context: every out-of-range marker is listed, not a sample', `${listed} listed, ${offCount} off`)
  check(context.text.includes(`${offCount} of those`), 'context: the total matches the list', `expected ${offCount}`)
  check(context.cited.has('9'), "context: the reader's own values are cited for the guard")

  // ---- 8. One real chat turn --------------------------------------------
  const asked = await deps.chat('How many of my markers are out of range?')
  check(asked.text.length > 0, `chat: the model answered (${asked.seconds}s)`, asked.text.slice(0, 90))
  check(
    asked.text.includes(String(offCount)),
    'chat: it counts the out-of-range markers correctly',
    `expected ${offCount} in: ${asked.text.slice(0, 140)}`
  )
  check(findDose(asked.text, context.cited) == null, 'chat: the shown answer carries no dose')

  process.stdout.write(
    `[selftest] ${failures === 0 ? 'PASS' : `FAIL (${failures})`} in ${((Date.now() - t0) / 1000).toFixed(0)}s\n`
  )
  return failures === 0 ? 0 : 1
}
