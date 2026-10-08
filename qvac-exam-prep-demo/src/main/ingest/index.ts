// ============================================================
// One entry point for every kind of source.
//
// Each importer turns its input into Blocks; from there every source goes
// through the same chunker and the same junk filter. No Electron imports,
// so `npm run chunks` and `npm run gen` use this file unchanged.
// ============================================================

import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { chunkBlocks, type Block } from '../../core/chunk'
import { filterChunks } from '../../core/junk'
import { parseMarkdown, parsePlainText } from '../../core/parse-text'
import type { Chunk, DroppedChunk, Source, SourceType } from '../../core/types'
import { readPdf } from './pdf'
import { FetchFailed, readUrl } from './url'

export interface IngestResult {
  source: Source
  chunks: Chunk[]
  dropped: DroppedChunk[]
}

export const FILE_EXTENSIONS = ['md', 'markdown', 'txt', 'pdf']

export function typeOf(ref: string): SourceType | null {
  if (/^https?:\/\//i.test(ref)) return 'url'
  const ext = extname(ref).slice(1).toLowerCase()
  if (ext === 'pdf') return 'pdf'
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (ext === 'txt') return 'text'
  return null
}

function titleFromFile(path: string): string {
  return basename(path, extname(path)).replace(/[-_]+/g, ' ').trim()
}

/** Every chunk needs a trail: when a document has no headings, its title is one. */
function ensureRoot(blocks: Block[], title: string): Block[] {
  return blocks.some((b) => b.kind === 'heading') ? blocks : [{ kind: 'heading', level: 1, text: title }, ...blocks]
}

export async function ingest(ref: string, id: string = randomUUID()): Promise<IngestResult> {
  const type = typeOf(ref)
  if (!type) throw new Error(`Unsupported file type: ${extname(ref) || ref}. Use .md, .txt, .pdf or a URL.`)

  const source: Source = { id, type, ref, title: type === 'url' ? ref : titleFromFile(ref), status: 'parsing', addedAt: new Date().toISOString() }
  if (type !== 'url') source.bytes = (await stat(ref)).size
  const done = (blocks: Block[]): IngestResult => {
    const { kept, dropped } = filterChunks(chunkBlocks(id, ensureRoot(blocks, source.title)))
    source.status = 'ready'
    if (!kept.length) source.message = 'Read fine, but no passage was substantial enough to write a question from.'
    return { source, chunks: kept, dropped }
  }

  switch (type) {
    case 'markdown': {
      const blocks = parseMarkdown(await readFile(ref, 'utf8'))
      const h1 = blocks.find((b) => b.kind === 'heading' && b.level === 1)
      if (h1) source.title = h1.text
      return done(blocks)
    }
    case 'text':
      return done(parsePlainText(await readFile(ref, 'utf8'), source.title))
    case 'pdf': {
      const pdf = await readPdf(ref)
      if (pdf.title) source.title = pdf.title
      source.pages = pdf.pages
      if (pdf.scanned) {
        source.status = 'unsupported_scanned'
        source.message = `This PDF has almost no text layer (${pdf.pages} pages): it looks scanned. Scanned PDFs need OCR, which this app does not do. Export a text PDF, or paste the text into a .txt file.`
        return { source, chunks: [], dropped: [] }
      }
      return done(pdf.blocks)
    }
    case 'url': {
      try {
        const page = await readUrl(ref)
        source.title = page.title
        return done(page.blocks)
      } catch (err) {
        source.status = 'fetch_failed'
        source.message = err instanceof FetchFailed ? err.message : `Could not read the page: ${(err as Error).message}`
        return { source, chunks: [], dropped: [] }
      }
    }
  }
}
