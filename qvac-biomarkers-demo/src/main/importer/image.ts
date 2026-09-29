// ============================================================
// The photo importer: a picture of a lab report, read on this device.
//
// A phone photo or a screenshot of a report is the most common thing people
// have when there is no PDF. OCR (ocr.ts) turns it into rows and labrows.ts
// reads them with the same rules as a PDF: known names, known units,
// plausible values, and a note for everything it left out.
// ============================================================

import { basename, extname } from 'node:path'
import type { ImportReport, Marker } from '../../shared/types.js'
import { ImportError, type ImportResult, type Importer } from './kinds.js'
import { findReportDate, parseLabRows } from './labrows.js'
import { ocrImages } from './ocr.js'

async function read(filePath: string, markers: Marker[]): Promise<ImportResult> {
  const { pages, seconds } = await ocrImages([filePath])
  const rows = pages.flat()
  if (rows.length === 0) {
    throw new ImportError(`No text found in ${basename(filePath)}. Is it a photo of a lab report?`)
  }
  const found = findReportDate(rows)
  if (!found) {
    throw new ImportError(
      `No collection date found in ${basename(filePath)}. Make sure the top of the report, where ` +
        'the sampling date is printed, is in the picture.'
    )
  }
  const parsed = parseLabRows(rows, markers, found.iso)
  if (parsed.readings.length === 0) {
    throw new ImportError(
      `No recognised markers in ${basename(filePath)}. A sharper, straighter photo usually fixes it; ` +
        'the rows the OCR read are only kept when the analyte name is one the app knows.'
    )
  }
  const report: ImportReport = {
    file: basename(filePath),
    dates: [found.iso],
    added: parsed.readings.length,
    updated: 0,
    unknownMarkers: parsed.unknownMarkers,
    unreadable: parsed.unreadable,
    ignoredColumns: [],
    notes: [
      `Read ${parsed.readings.length} results on this device with OCR in ${seconds} s, dated ` +
        `${found.iso}. OCR can misread a digit: check each value against the report.`,
      ...(found.note ? [found.note] : []),
      ...parsed.notes,
      ...(parsed.unknownMarkers.length
        ? [`Not in the marker library, so skipped: ${parsed.unknownMarkers.slice(0, 8).join(', ')}.`]
        : [])
    ]
  }
  return { readings: parsed.readings, report }
}

export const imageImporter: Importer = {
  id: 'image',
  label: 'Photo of a lab report',
  extensions: ['.png', '.jpg', '.jpeg'],
  canRead: (filePath) => ['.png', '.jpg', '.jpeg'].includes(extname(filePath).toLowerCase()),
  read
}
