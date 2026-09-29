// ============================================================
// importer/: turning a file into normalized readings.
//
// The contract lives in kinds.ts; this file is only the registry. An
// importer takes a path and gives back (markerId, date, value) triples plus
// an honest report of what it could not read. Nothing downstream knows or
// cares whether that came from a CSV, a lab PDF or a photo of a printout.
//
// Shipping today: bloodwork CSV, wearable CSV, lab PDFs (digital or scanned),
// and photos of a report. Scans and photos are read with on-device OCR.
// ============================================================

import { csvImporter } from './csv.js'
import { wearableImporter } from './wearable.js'
import { pdfImporter } from './pdf.js'
import { imageImporter } from './image.js'
import type { Importer } from './kinds.js'

export { ImportError } from './kinds.js'
export type { ImportContext, Importer, ImportResult } from './kinds.js'

/**
 * Every importer the app knows, most specific first.
 *
 * The two CSV readers are ordered, not exclusive: `csvImporter` claims a file
 * whose header names a marker column, and `wearableImporter` takes the rest.
 * A vendor export and a bloodwork export are both `.csv` and only the header
 * tells them apart.
 */
export const importers: Importer[] = [csvImporter, wearableImporter, pdfImporter, imageImporter]

export function importerFor(filePath: string): Importer | null {
  return importers.find((i) => i.canRead(filePath)) ?? null
}

/**
 * File-picker filters, derived so the dialog can never drift from the list.
 *
 * The combined entry has to come FIRST. An Open panel selects filter one and
 * greys out everything it excludes, so a list that began with the bloodwork
 * CSV reader made a lab PDF unselectable: the app could read the file, and
 * the dialog would not let you pick it.
 */
export function fileFilters(): { name: string; extensions: string[] }[] {
  const perImporter = importers.map((i) => ({
    name: i.label,
    extensions: i.extensions.map((e) => e.replace('.', ''))
  }))
  const every = [...new Set(perImporter.flatMap((f) => f.extensions))]
  return [{ name: 'Results (' + every.join(', ') + ')', extensions: every }, ...perImporter]
}
