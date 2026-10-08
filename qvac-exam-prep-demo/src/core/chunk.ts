// ============================================================
// Chunking. Pure TypeScript, no AI.
//
// Every importer (Markdown, plain text, PDF, URL) turns its document into
// the same flat list of Blocks: headings and runs of text, in reading
// order. This file turns Blocks into Chunks, and it does not care where
// they came from. That is how a PDF page and a web page end up in one pool
// with no special-casing downstream.
//
//   blocks  ->  sections (one per heading)  ->  ~500-token chunks
//
// A chunk never crosses a heading, so its heading trail is exact. The one
// exception is a section too short to stand alone: it is folded into the
// next section that shares a parent, and the merged chunk takes the trail
// they have in common.
// ============================================================

import { junkReason } from './junk'
import type { Chunk } from './types'

export type Block =
  | { kind: 'heading'; level: number; text: string; anchor?: string; page?: number }
  | { kind: 'text'; text: string; page?: number; code?: boolean }

export interface ChunkOptions {
  /** Aim for chunks about this long. */
  targetTokens: number
  /** Carry this much of the end of one chunk into the start of the next. */
  overlapTokens: number
  /** A section shorter than this is merged into its next sibling. */
  minSectionTokens: number
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  targetTokens: 500,
  overlapTokens: 60,
  minSectionTokens: 120
}

/**
 * About four characters a token for English prose. An estimate, and named
 * as one: it is only used to size chunks and budget the context window,
 * and a real tokenizer would mean shipping one per model.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/** A sentence or a code block, plus whether it starts a new paragraph. */
interface Piece {
  text: string
  page?: number
  paraStart: boolean
  tokens: number
}

interface Section {
  trail: string[]
  anchor?: string
  pieces: Piece[]
}

const SENTENCE_END = /(?<=[.!?])\s+(?=["'(\[]?[A-Z0-9])/

function splitSentences(text: string): string[] {
  return text
    .split(SENTENCE_END)
    .map((s) => s.trim())
    .filter(Boolean)
}

function toPieces(block: Extract<Block, { kind: 'text' }>): Piece[] {
  const text = block.text.trim()
  if (!text) return []
  // Code and lists stay whole: splitting them on full stops makes nonsense.
  const parts = block.code || text.includes('\n') ? [text] : splitSentences(text)
  return parts.map((p, i) => ({
    text: p,
    page: block.page,
    paraStart: i === 0,
    tokens: estimateTokens(p)
  }))
}

function sectionTokens(s: Section): number {
  return s.pieces.reduce((n, p) => n + p.tokens, 0)
}

function commonPrefix(a: string[], b: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < Math.min(a.length, b.length) && a[i] === b[i]; i++) out.push(a[i])
  return out
}

/** Walks the heading hierarchy and returns one Section per run of text. */
export function toSections(blocks: Block[]): Section[] {
  const stack: { level: number; text: string; anchor?: string }[] = []
  const sections: Section[] = []
  let current: Section | null = null

  for (const block of blocks) {
    if (block.kind === 'heading') {
      while (stack.length && stack[stack.length - 1].level >= block.level) stack.pop()
      stack.push({ level: block.level, text: block.text.trim(), anchor: block.anchor })
      current = null
      continue
    }
    const pieces = toPieces(block)
    if (!pieces.length) continue
    if (!current) {
      const anchor = [...stack].reverse().find((h) => h.anchor)?.anchor
      current = { trail: stack.map((h) => h.text), anchor, pieces: [] }
      sections.push(current)
    }
    current.pieces.push(...pieces)
  }
  return sections
}

/**
 * A short section that is junk in its own right (a contents list, a nav
 * menu) must not be folded into real material: the merged chunk would
 * then be dropped whole, taking the real material with it.
 */
function isJunkSection(s: Section): boolean {
  const text = joinPieces(s.pieces)
  const reason = junkReason({ id: '', sourceId: '', text, headingTrail: s.trail, tokenEstimate: Number.MAX_SAFE_INTEGER })
  return reason !== null && reason !== 'too_short'
}

/** Folds short sections into their next sibling where they share a parent. */
function mergeShort(sections: Section[], opts: ChunkOptions): Section[] {
  const out: Section[] = []
  let pending: Section | null = null

  for (const s of sections) {
    if (pending) {
      const shared = commonPrefix(pending.trail, s.trail)
      if (shared.length > 0 && shared.length >= Math.min(pending.trail.length, s.trail.length) - 1) {
        // Keep the folded section's own heading as a line, so the model
        // still sees what the short part was about.
        const label = pending.trail.slice(shared.length).join(' › ')
        const lead: Piece[] = label
          ? [{ text: `${label}:`, page: pending.pieces[0]?.page, paraStart: true, tokens: estimateTokens(label) }]
          : []
        s.pieces = [...lead, ...pending.pieces, ...s.pieces]
        s.trail = shared
        s.anchor = pending.anchor ?? s.anchor
      } else {
        out.push(pending)
      }
      pending = null
    }
    if (sectionTokens(s) < opts.minSectionTokens && !isJunkSection(s)) pending = s
    else out.push(s)
  }
  if (pending) out.push(pending)
  return out
}

function joinPieces(pieces: Piece[]): string {
  let text = ''
  for (const p of pieces) {
    if (!text) text = p.text
    else text += (p.paraStart ? '\n\n' : ' ') + p.text
  }
  return text
}

/** Packs one section's pieces into chunks of about `targetTokens`, with overlap. */
function packSection(section: Section, opts: ChunkOptions): Piece[][] {
  const groups: Piece[][] = []
  let group: Piece[] = []
  let size = 0
  let fresh = 0 // pieces in `group` that are not overlap from the last chunk

  for (const piece of section.pieces) {
    if (fresh > 0 && size + piece.tokens > opts.targetTokens) {
      groups.push(group)
      // Seed the next chunk with the tail of this one, up to the overlap
      // budget, so a fact split across the boundary is whole in one of them.
      const tail: Piece[] = []
      let tailSize = 0
      for (let i = group.length - 1; i >= 0; i--) {
        const p = group[i]
        if (tailSize + p.tokens > opts.overlapTokens) break
        tail.unshift(p)
        tailSize += p.tokens
      }
      group = tail
      size = tailSize
      fresh = 0
    }
    group.push(piece)
    size += piece.tokens
    fresh++
  }
  if (fresh > 0) groups.push(group)
  return groups
}

export function chunkBlocks(
  sourceId: string,
  blocks: Block[],
  opts: ChunkOptions = DEFAULT_CHUNK_OPTIONS
): Chunk[] {
  const chunks: Chunk[] = []
  for (const section of mergeShort(toSections(blocks), opts)) {
    for (const pieces of packSection(section, opts)) {
      const text = joinPieces(pieces)
      const page = pieces.find((p) => p.page != null)?.page
      chunks.push({
        id: `${sourceId}:${chunks.length}`,
        sourceId,
        text,
        headingTrail: section.trail,
        ...(page != null ? { pageNumber: page } : {}),
        ...(section.anchor ? { anchor: section.anchor } : {}),
        tokenEstimate: estimateTokens(text)
      })
    }
  }
  return chunks
}

/** A heading's anchor, the way most static-site generators make one. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}
