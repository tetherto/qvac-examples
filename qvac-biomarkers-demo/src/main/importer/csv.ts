// ============================================================
// The CSV importer.
//
// Expected shape: raw data only:
//
//   marker_id,marker_name,unit,2023-06-12,2024-02-20,2025-09-18
//   Fer,Ferritin,ng/mL,65,54,38
//   D,Vitamin D,ng/mL,38,,23
//
// One column per test date, blank where that date was not tested.
//
// What this file deliberately does NOT read: any column claiming a status,
// a flag, or an "optimized" verdict. Those are computed by the app from the
// value and the range, every time. A file that carries them gets them
// ignored and listed in the report, so the user can see we skipped them.
// ============================================================

import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import type { ImportReport, Marker, Reading } from '../../shared/types.js'
import { ImportError, type ImportResult, type Importer } from './kinds.js'

/** Column headers we look for, lower-cased. First match wins. */
const ID_HEADERS = ['marker_id', 'markerid', 'id', 'marker']
const NAME_HEADERS = ['marker_name', 'markername', 'name']
const UNIT_HEADERS = ['unit', 'units']

/**
 * Splits one CSV line, honouring double quotes so a quoted field may
 * contain commas. Small on purpose: this is the whole of our CSV grammar,
 * and a reader can check it in twenty seconds.
 */
export function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        // "" inside a quoted field is one literal quote.
        if (line[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      out.push(field)
      field = ''
    } else {
      field += ch
    }
  }
  out.push(field)
  return out.map((f) => f.trim())
}

/**
 * Reads a header cell as a test date, or returns null.
 *
 * ISO (2025-09-18) is the format we document. `YYYY/MM/DD` is accepted
 * because it is unambiguous too. `03/04/2025` is REJECTED on purpose: it
 * means March 4th to an American lab and April 3rd to a European one, and
 * silently guessing would put readings on the wrong date forever.
 */
export function parseDateHeader(cell: string): string | null {
  const s = cell.trim()
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s)
  if (!m) return null
  const [, y, mo, d] = m
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  const parsed = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return null
  // Round-trip guard: 2025-02-30 parses to March 2nd, which is not what
  // the file said.
  return parsed.toISOString().slice(0, 10) === iso ? iso : null
}

/** Reads a value cell. null = not tested. undefined = present but unreadable. */
export function parseValue(cell: string): number | null | undefined {
  const s = cell.trim().replace(/^"|"$/g, '')
  if (s === '' || s === '-' || s === '\u2013' || s === '\u2014' || s.toLowerCase() === 'n/a') return null
  // Strip thousands separators of the 1,234.5 kind. A bare comma cannot
  // reach us, it is the field delimiter.
  const cleaned = s.replace(/(?<=\d)[ _](?=\d)/g, '')
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : undefined
}

async function read(filePath: string, markers: Marker[]): Promise<ImportResult> {
  let text: string
  try {
    text = await readFile(filePath, 'utf8')
  } catch (err) {
    throw new ImportError(`Could not open ${basename(filePath)}: ${(err as Error).message}`)
  }

  // Strip a UTF-8 byte-order mark, then split on either line ending. A
  // spreadsheet export is very often CRLF, and a stray \r turns the last
  // value of every row into garbage if you do not do this.
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')

  if (lines.length < 2) {
    throw new ImportError(
      'That file has no data rows. We expect a header row of test dates and one row per marker.'
    )
  }

  const header = splitCsvLine(lines[0])
  const lower = header.map((h) => h.toLowerCase())
  const idCol = lower.findIndex((h) => ID_HEADERS.includes(h))
  const nameCol = lower.findIndex((h) => NAME_HEADERS.includes(h))
  const unitCol = lower.findIndex((h) => UNIT_HEADERS.includes(h))

  if (idCol === -1) {
    throw new ImportError(
      `No marker column found. The first row needs a "marker_id" column; we saw: ${header.join(', ')}`
    )
  }

  // Every remaining column is either a test date or something we ignore.
  const dateCols: { index: number; date: string }[] = []
  const ignoredColumns: string[] = []
  header.forEach((cell, index) => {
    if (index === idCol || index === nameCol || index === unitCol) return
    const date = parseDateHeader(cell)
    if (date) dateCols.push({ index, date })
    else if (cell !== '') ignoredColumns.push(cell)
  })

  if (dateCols.length === 0) {
    throw new ImportError(
      'No test-date columns found. Date headers must be ISO dates, like 2025-09-18. ' +
        (ignoredColumns.length ? `We ignored: ${ignoredColumns.join(', ')}` : '')
    )
  }

  // Oldest first, everywhere in the app.
  dateCols.sort((a, b) => a.date.localeCompare(b.date))

  const known = new Map(markers.map((m) => [m.id, m]))
  // Also accept a match on the marker's name, since a hand-made file is
  // more likely to carry "Ferritin" than "Fer".
  const byName = new Map(markers.map((m) => [m.name.toLowerCase(), m]))

  const readings: Reading[] = []
  const unknownMarkers: string[] = []
  let unreadable = 0

  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line)
    const rawId = cells[idCol] ?? ''
    if (rawId === '') continue

    const marker = known.get(rawId) ?? byName.get(rawId.toLowerCase())
    if (!marker) {
      if (!unknownMarkers.includes(rawId)) unknownMarkers.push(rawId)
      continue
    }

    for (const { index, date } of dateCols) {
      const parsed = parseValue(cells[index] ?? '')
      if (parsed === null) continue // not tested on this date
      if (parsed === undefined) {
        unreadable++
        continue
      }
      readings.push({ markerId: marker.id, date, value: parsed })
    }
  }

  const report: ImportReport = {
    file: basename(filePath),
    dates: dateCols.map((d) => d.date),
    added: 0, // the store fills these in when it merges
    updated: 0,
    unknownMarkers,
    unreadable,
    ignoredColumns
  }

  if (readings.length === 0) {
    throw new ImportError(
      unknownMarkers.length > 0
        ? `None of the markers in that file are in the reference library. Unrecognised: ${unknownMarkers.slice(0, 5).join(', ')}`
        : 'That file had no readable values.'
    )
  }

  return { readings, report }
}

/** True when the first row of a CSV names a marker column. */
function hasMarkerColumn(filePath: string): boolean {
  try {
    // The whole file, because a header is the first line and Node has no
    // read-one-line primitive worth the ceremony at these file sizes.
    const first = readFileSync(filePath, 'utf8').split(/\r?\n/, 1)[0] ?? ''
    return splitCsvLine(first).some((h) =>
      ID_HEADERS.includes(h.trim().toLowerCase().replace(/^"|"$/g, ''))
    )
  } catch {
    return false
  }
}

export const csvImporter: Importer = {
  id: 'csv',
  label: 'Bloodwork CSV',
  extensions: ['.csv'],
  // Two importers read `.csv` now, so the header decides. This one takes files
  // whose first row names a marker column; a wearable export names a date
  // column instead and goes to wearable.ts. Reading one line is cheap enough
  // for a check that runs once per import.
  canRead: (filePath) => extname(filePath).toLowerCase() === '.csv' && hasMarkerColumn(filePath),
  read
}
