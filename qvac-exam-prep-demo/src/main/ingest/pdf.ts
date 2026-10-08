// ============================================================
// PDFs with a text layer, via pdfjs-dist. No OCR.
//
// A PDF has no headings, only text drawn at sizes. So we find the body
// size (the size most characters are set in) and treat short lines set
// clearly larger as headings, ranked by size into levels. Running headers
// and footers are found by repetition across pages and removed. Every
// block keeps its page number, which ends up on the chunk.
//
// If the document has almost no extractable text it is a scan, and we
// say so instead of producing chunks from nothing.
// ============================================================

import { readFile } from 'node:fs/promises'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { Block } from '../../core/chunk'

/** Fewer characters than this per page on average means a scanned PDF. */
const SCANNED_CHARS_PER_PAGE = 80

interface Line {
  page: number
  text: string
  size: number
  y: number
}

export interface PdfResult {
  blocks: Block[]
  title: string | null
  pages: number
  scanned: boolean
}

interface TextItemLike {
  str: string
  transform: number[]
  hasEOL?: boolean
}

/**
 * PDF title metadata is often junk: "Microsoft Word - draft3.docx", a URL,
 * a path. Use it only when it looks like a title; otherwise the file name.
 */
function cleanTitle(raw: string): string | null {
  const t = raw.replace(/^Microsoft (Word|PowerPoint) - /i, '').replace(/\.(docx?|pptx?|pdf)$/i, '').trim()
  if (!t || t.length > 150 || /^(data:|https?:|file:|[A-Za-z]:\\|\/)/.test(t) || /^untitled$/i.test(t)) return null
  return t
}

async function extractLines(data: Uint8Array): Promise<{ lines: Line[]; pages: number; title: string | null }> {
  const task = getDocument({ data, useSystemFonts: true })
  const doc = await task.promise
  const lines: Line[] = []
  let title: string | null = null
  try {
    const meta = await doc.getMetadata().catch(() => null)
    const t = (meta?.info as { Title?: unknown } | undefined)?.Title
    if (typeof t === 'string') title = cleanTitle(t)

    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const content = await page.getTextContent()
      let cur: Line | null = null
      for (const raw of content.items) {
        if (!('str' in raw)) continue
        const item = raw as TextItemLike
        const size = Math.round(Math.hypot(item.transform[2], item.transform[3]) * 10) / 10
        const y = item.transform[5]
        // A new line when the baseline moves by more than half a size.
        if (!cur || Math.abs(cur.y - y) > Math.max(2, size * 0.5)) {
          if (cur && cur.text.trim()) lines.push(cur)
          cur = { page: p, text: '', size, y }
        }
        cur.text += item.str
        if (item.str.trim()) cur.size = Math.max(cur.size, size)
        if (item.hasEOL) {
          if (cur.text.trim()) lines.push(cur)
          cur = null
        }
      }
      if (cur && cur.text.trim()) lines.push(cur)
      page.cleanup()
    }
  } finally {
    await task.destroy()
  }
  for (const l of lines) l.text = l.text.replace(/\s+/g, ' ').trim()
  return { lines: lines.filter((l) => l.text), pages: doc.numPages, title }
}

/** Lines that repeat on many pages (running headers, footers, page numbers). */
function runningLines(lines: Line[], pages: number): Set<string> {
  const key = (t: string): string => t.toLowerCase().replace(/\d+/g, '#')
  const seen = new Map<string, Set<number>>()
  for (const l of lines) {
    const k = key(l.text)
    seen.set(k, (seen.get(k) ?? new Set()).add(l.page))
  }
  const out = new Set<string>()
  if (pages < 3) return out
  for (const [k, ps] of seen) if (ps.size >= Math.max(3, pages * 0.5)) out.add(k)
  return out
}

export async function readPdf(path: string): Promise<PdfResult> {
  const data = new Uint8Array(await readFile(path))
  const { lines: all, pages, title } = await extractLines(data)

  const chars = all.reduce((n, l) => n + l.text.length, 0)
  if (pages === 0 || chars / pages < SCANNED_CHARS_PER_PAGE) {
    return { blocks: [], title, pages, scanned: true }
  }

  const running = runningLines(all, pages)
  const lines = all.filter((l) => !running.has(l.text.toLowerCase().replace(/\d+/g, '#')) && !/^\d{1,4}$/.test(l.text))

  // Body size: the size that carries the most characters.
  const weight = new Map<number, number>()
  for (const l of lines) weight.set(l.size, (weight.get(l.size) ?? 0) + l.text.length)
  const body = [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10

  const isHeading = (l: Line): boolean =>
    l.size >= body * 1.15 && l.text.length <= 120 && /\p{L}/u.test(l.text) && !/[.,;:]$/.test(l.text)

  // Rank heading sizes, largest first, into at most four levels.
  const sizes = [...new Set(lines.filter(isHeading).map((l) => l.size))].sort((a, b) => b - a)
  const level = (size: number): number => Math.min(sizes.indexOf(size) + 1, 4)

  const blocks: Block[] = []
  let para: Line[] = []
  const flush = (): void => {
    if (!para.length) return
    // Re-join words hyphenated across a line break.
    const text = para.map((l) => l.text).join(' ').replace(/(\p{L})- (\p{Ll})/gu, '$1$2')
    blocks.push({ kind: 'text', text, page: para[0].page })
    para = []
  }

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (isHeading(l)) {
      flush()
      const prev = blocks[blocks.length - 1]
      // A heading wrapped over two lines arrives as two heading lines.
      if (prev?.kind === 'heading' && prev.level === level(l.size) && prev.page === l.page && i > 0 && isHeading(lines[i - 1])) {
        prev.text += ' ' + l.text
      } else {
        blocks.push({ kind: 'heading', level: level(l.size), text: l.text, page: l.page })
      }
      continue
    }
    const prev = para[para.length - 1]
    // A new paragraph on a page change or a gap bigger than ~1.6 lines.
    if (prev && (prev.page !== l.page || Math.abs(prev.y - l.y) > l.size * 1.6)) flush()
    para.push(l)
    // Lines that end a sentence and are clearly short end a paragraph.
    if (/[.!?:]$/.test(l.text) && l.text.length < 60) flush()
  }
  flush()

  return { blocks, title, pages, scanned: false }
}
