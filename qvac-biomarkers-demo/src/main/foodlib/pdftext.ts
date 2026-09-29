// ============================================================
// Reading a local PDF's text layer.
//
// Text layer only, on purpose. A scanned page or a phone photo has no text
// to read, and handling those means loading a second model (QVAC's `ocr`),
// which on a 16 GB machine has to wait for MedPsy to unload first. That is
// a real feature, not a hard one, and it is not in this version. When a
// file has no text we say so plainly instead of returning nothing.
// ============================================================

import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { MAX_TEXT_CHARS } from './fetch.js'

/** Bigger than this and something is wrong with the file, not our reading. */
const MAX_PDF_BYTES = 25_000_000
/** Below this the "text layer" is a scanning artefact, not content. */
const MIN_USEFUL_CHARS = 200

export interface PdfText {
  title: string
  domain: string
  text: string
}

export async function readPdf(filePath: string): Promise<PdfText> {
  const bytes = await readFile(filePath)
  if (bytes.byteLength > MAX_PDF_BYTES) {
    throw new Error('That PDF is too large to read.')
  }

  // Required lazily: pdf-parse is CommonJS and pulls in a chunk of code we
  // do not want to pay for on every launch.
  const { default: pdfParse } = await import('pdf-parse')
  let parsed: { text: string; info?: { Title?: string } }
  try {
    parsed = await pdfParse(bytes)
  } catch (err) {
    throw new Error(`Could not read that PDF: ${(err as Error).message}`)
  }

  const text = (parsed.text ?? '').replace(/[ \t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  if (text.length < MIN_USEFUL_CHARS) {
    throw new Error(
      'That PDF has no text layer, so it is probably a scan. Reading scans needs QVAC OCR, ' +
        'which this prototype does not load. Try a digital PDF, or paste a link instead.'
    )
  }

  const name = basename(filePath)
  return {
    title: (parsed.info?.Title || '').trim() || name.replace(/\.pdf$/i, ''),
    domain: name,
    text: text.slice(0, MAX_TEXT_CHARS)
  }
}
