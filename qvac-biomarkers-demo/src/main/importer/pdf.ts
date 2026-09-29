// ============================================================
// The lab-PDF importer.
//
// A lab PDF is the format people actually have. Two things make reading one
// safely possible here:
//
//  1. The MARKER LIBRARY IS THE ANCHOR. A results line arrives from the text
//     layer as one run with no separators ("Ferritin9Lng/mL20 - 345"), so we do
//     not try to segment it blind. We look for a marker name we already know at
//     the start of the line, longest first, and parse what follows. A line whose
//     name we do not recognise is reported, never guessed at: writing a wrong
//     number into a health record is the one failure that matters.
//  2. THE VALUE IS THE FIRST NUMBER AFTER THE NAME. The reference range sits at
//     the end of the same run, so anchoring on the name keeps them apart.
//
// A scanned PDF has no text layer. Its page images are read on this device
// with OCR (ocr.ts), and the rows go through the same reader (labrows.ts).
// ============================================================

import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import type { ImportReport, Marker, Reading } from '../../shared/types.js'
import { ImportError, type ImportResult, type Importer } from './kinds.js'
import { findReportDate, parseLabRows } from './labrows.js'
import { ocrImages } from './ocr.js'

/** Minimum characters of text layer before we call a PDF "digital". */
const TEXT_LAYER_FLOOR = 200

/**
 * Parse one results line against the marker library.
 * Returns null when the line is not a results line at all (a header, a footer).
 */
export function parseLine(
  line: string,
  namesLongestFirst: { name: string; marker: Marker }[]
): { marker: Marker; value: number } | null {
  const squashed = line.replace(/\s+/g, ' ').trim()
  if (!squashed) return null
  const lower = squashed.toLowerCase()

  for (const { name, marker } of namesLongestFirst) {
    if (!lower.startsWith(name)) continue
    const rest = squashed.slice(name.length)
    // The value is the first number after the name. Allow a leading sign and a
    // decimal point; reject a bare "-" so a range like "20 - 345" cannot be read
    // as a value when the result column happens to be empty.
    const m = /^\s*(-?\d+(?:\.\d+)?)/.exec(rest)
    if (!m) return null
    const value = Number(m[1])
    if (!Number.isFinite(value)) return null
    return { marker, value }
  }
  return null
}

/**
 * The text layer, rebuilt as ROWS. pdf.js hands back text items in the order
 * the PDF writer emitted them, which for a table is often column by column:
 * every name, then every value, then every unit. Each item carries its
 * position, so grouping by baseline and sorting by x restores the row a
 * reader sees ("Glucose : 96.9 mg/dL 74.0 - 106.0").
 */
async function extractRows(bytes: Uint8Array, filePath: string): Promise<string[]> {
  const { default: pdfParse } = await import('pdf-parse')
  const rows: string[] = []
  const pagerender = async (pageData: {
    getTextContent: (o: object) => Promise<{ items: { str: string; transform: number[]; height?: number }[] }>
  }): Promise<string> => {
    const content = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false })
    const items = content.items
      .filter((it) => String(it.str).trim())
      .map((it) => ({ s: String(it.str), x: it.transform[4], y: it.transform[5], h: Math.abs(it.transform[3]) || it.height || 8 }))
      .sort((a, b) => b.y - a.y)
    const page: { y: number; h: number; items: typeof items }[] = []
    for (const it of items) {
      const row = page.find((r) => Math.abs(r.y - it.y) < Math.max(2, Math.min(r.h, it.h) * 0.5))
      if (row) row.items.push(it)
      else page.push({ y: it.y, h: it.h, items: [it] })
    }
    const lines = page.map((r) => r.items.sort((a, b) => a.x - b.x).map((i) => i.s.trim()).join(' '))
    rows.push(...lines)
    return lines.join('\n')
  }
  try {
    // The published typings omit the options argument that pdf-parse accepts.
    await (pdfParse as unknown as (d: Uint8Array, o: object) => Promise<unknown>)(bytes, { pagerender })
  } catch (err) {
    throw new ImportError(`Could not read ${basename(filePath)} as a PDF: ${(err as Error).message}`)
  }
  return rows
}

/** Width and height of a JPEG, from its first frame header. */
function jpegSize(j: Buffer): { w: number; h: number } | null {
  let i = 2
  while (i + 9 < j.length) {
    if (j[i] !== 0xff) return null
    const marker = j[i + 1]
    const len = j.readUInt16BE(i + 2)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: j.readUInt16BE(i + 5), w: j.readUInt16BE(i + 7) }
    }
    i += 2 + len
  }
  return null
}

/**
 * The page images of a scanned PDF. Scanners and phone scan apps store each
 * page as a JPEG stream, which is a JPEG file byte for byte, so no renderer is
 * needed: find each stream, keep the ones big enough to be a page.
 */
export function jpegPages(bytes: Uint8Array): Buffer[] {
  const buf = Buffer.from(bytes)
  const soiMark = Buffer.from([0xff, 0xd8, 0xff])
  const eoiMark = Buffer.from([0xff, 0xd9])
  const pages: Buffer[] = []
  let from = 0
  for (;;) {
    const soi = buf.indexOf(soiMark, from)
    if (soi < 0) break
    const end = buf.indexOf('endstream', soi)
    if (end < 0) break
    const eoi = buf.lastIndexOf(eoiMark, end)
    if (eoi > soi) {
      const jpg = Buffer.from(buf.subarray(soi, eoi + 2))
      const size = jpegSize(jpg)
      if (size && Math.max(size.w, size.h) >= 600) pages.push(jpg)
    }
    from = end
  }
  return pages
}

/** The older line reader, kept for layouts that weld each row into one run. */
function parseWelded(rows: string[], markers: Marker[], date: string): Reading[] {
  const namesLongestFirst = markers
    .map((marker) => ({ name: marker.name.toLowerCase(), marker }))
    .sort((a, b) => b.name.length - a.name.length)
  const readings: Reading[] = []
  const seen = new Set<string>()
  for (const line of rows) {
    const hit = parseLine(line, namesLongestFirst)
    if (!hit || seen.has(hit.marker.id)) continue
    seen.add(hit.marker.id)
    readings.push({ markerId: hit.marker.id, date, value: hit.value })
  }
  return readings
}

async function read(filePath: string, markers: Marker[]): Promise<ImportResult> {
  // MUST be a standalone copy. pdf-parse hands the buffer straight to pdf.js,
  // which reads the underlying ArrayBuffer, and node POOLS small Buffer
  // allocations: a plain readFileSync buffer makes pdf.js read a neighbour's
  // bytes and fail with a random "bad XRef entry".
  const bytes = new Uint8Array(readFileSync(filePath))
  let rows = await extractRows(bytes, filePath)
  let viaOcr: { pages: number; seconds: number } | null = null

  if (rows.join('').replace(/\s+/g, '').length < TEXT_LAYER_FLOOR) {
    // No text layer: a scan. Read its page images on this device.
    const images = jpegPages(bytes)
    if (images.length === 0) {
      throw new ImportError(
        `${basename(filePath)} is a scan stored in a format this app cannot unpack. Save the pages ` +
          'as JPG or PNG (a photo or a screenshot works) and import those instead.'
      )
    }
    const { pages, seconds } = await ocrImages(images)
    rows = pages.flat()
    viaOcr = { pages: images.length, seconds }
  }

  const found = findReportDate(rows)
  if (!found) {
    throw new ImportError(
      `No collection date found in ${basename(filePath)}. The importer looks for a date such as ` +
        '28/09/2026 or 2026-09-28, ideally next to a "Sampling date" or "Collected" label.'
    )
  }
  const date = found.iso

  const parsed = parseLabRows(rows, markers, date)
  const welded = viaOcr ? [] : parseWelded(rows, markers, date)
  const readings = welded.length > parsed.readings.length ? welded : parsed.readings

  if (readings.length === 0) {
    throw new ImportError(
      `No recognised markers in ${basename(filePath)}. The importer matches the analyte names it ` +
        'knows; if this is a lab layout worth supporting, the names it saw are in the report.'
    )
  }

  const source = viaOcr
    ? `Read ${readings.length} results on this device with OCR, from ${viaOcr.pages} page ` +
      `image${viaOcr.pages === 1 ? '' : 's'} in ${viaOcr.seconds} s, dated ${date}. OCR can misread ` +
      'a digit: check each value against the report.'
    : `Read ${readings.length} results from the PDF text layer, dated ${date}.`
  const report: ImportReport = {
    file: basename(filePath),
    dates: [date],
    added: readings.length,
    updated: 0,
    unknownMarkers: parsed.unknownMarkers,
    unreadable: parsed.unreadable,
    ignoredColumns: [],
    notes: [
      source,
      ...(found.note ? [found.note] : []),
      ...parsed.notes,
      ...(parsed.unknownMarkers.length
        ? [`Not in the marker library, so skipped: ${parsed.unknownMarkers.slice(0, 8).join(', ')}.`]
        : [])
    ]
  }

  return { readings, report }
}

export const pdfImporter: Importer = {
  id: 'pdf',
  label: 'Lab PDF',
  extensions: ['.pdf'],
  canRead: (filePath) => extname(filePath).toLowerCase() === '.pdf',
  read
}
