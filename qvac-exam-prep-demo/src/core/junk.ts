// ============================================================
// The junk filter. Heuristics only, no AI.
//
// A question written from a table of contents, a cookie banner or a
// licence is worse than no question, and a small model will cheerfully
// write one. So chunks that look like those never reach the sampler.
//
// Every rule returns a named reason, and dropped chunks are kept (not
// deleted) so the debug screen and `npm run chunks` can show what was
// thrown out and why. When a rule misfires, that is where you see it.
// ============================================================

import type { Chunk, DroppedChunk, JunkReason } from './types'

/** Below this a chunk cannot carry a question worth asking. */
export const MIN_TOKENS = 40

const TOC_HEADING = /^(table of )?contents$|^index$|^contents at a glance$/i
const TOC_LINE = /(\.{3,}|…|\s{2,}|\t)\s*\d{1,4}\s*$|^\s*(chapter|part|section)\s+\d+\b.*\s\d{1,4}\s*$/i

const LICENCE_HEADING = /\b(licen[cs]e|copyright|legal notice|terms of (use|service)|privacy policy|disclaimer)\b/i
const LICENCE_PHRASES = [
  /all rights reserved/i,
  /permission is hereby granted/i,
  /without warrant(y|ies)/i,
  /licensed under/i,
  /copyright\s*(©|\(c\)|\d{4})/i,
  /terms and conditions/i,
  /redistribution and use/i,
  /merchantability/i,
  /fitness for a particular purpose/i,
  /cookie(s)? (policy|settings|preferences)/i
]

const REFERENCES_HEADING = /^(references|bibliography|notes|citations|footnotes|external links|further reading|see also|sources|works cited)$/i
const CITATION = /\bRetrieved\b|\bArchived from\b|\bISBN\b|\bdoi:|\bISSN\b|\bpp?\.\s?\d|\b(19|20)\d\d-\d\d-\d\d\b/g

const NAV_WORDS =
  /\b(home|next|previous|prev|skip to (main )?content|menu|sign in|log in|subscribe|edit this page|back to top|on this page|breadcrumb|search docs?)\b/gi

const CODE_LINE = /[;{}]\s*$|^\s*(\$|>|#!|import |from |def |function |const |let |var |class |return |\}|<\/?\w)/

function lines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

export function junkReason(chunk: Chunk): JunkReason | null {
  const { text, headingTrail } = chunk
  const ls = lines(text)
  const last = headingTrail[headingTrail.length - 1] ?? ''

  // No heading at all means we cannot place the chunk in the document, and
  // in practice it is front matter: badges, a title page, a byline.
  if (headingTrail.length === 0) return 'no_heading'

  if (TOC_HEADING.test(last)) return 'table_of_contents'
  if (ls.length >= 4 && ls.filter((l) => TOC_LINE.test(l)).length / ls.length >= 0.4) {
    return 'table_of_contents'
  }

  if (LICENCE_HEADING.test(last)) return 'licence_boilerplate'
  if (LICENCE_PHRASES.filter((re) => re.test(text)).length >= 2) return 'licence_boilerplate'

  // A reference list: by its heading, or by how densely it cites.
  if (REFERENCES_HEADING.test(last)) return 'references'
  const cites = text.match(CITATION)?.length ?? 0
  if (cites >= 4 && cites / Math.max(1, words(text) / 100) >= 3) return 'references'

  // Navigation: many very short lines and no real sentence among them, or
  // a short chunk dense with menu words.
  if (ls.length >= 5) {
    const avg = ls.reduce((n, l) => n + words(l), 0) / ls.length
    if (avg < 4 && !ls.some((l) => words(l) >= 10)) return 'navigation'
  }
  const navHits = text.match(NAV_WORDS)?.length ?? 0
  if (navHits >= 3 && words(text) < 120) return 'navigation'

  // Mostly symbols: a code listing, a table of numbers, ASCII art.
  const visible = text.replace(/\s/g, '')
  const letters = visible.match(/\p{L}/gu)?.length ?? 0
  if (visible.length > 0 && letters / visible.length < 0.6) return 'symbol_heavy'
  if (ls.length >= 4 && ls.filter((l) => CODE_LINE.test(l)).length / ls.length > 0.6) {
    return 'symbol_heavy'
  }

  // Last, so a short table of contents is logged as one, not as "short".
  if (chunk.tokenEstimate < MIN_TOKENS) return 'too_short'

  return null
}

export function filterChunks(chunks: Chunk[]): { kept: Chunk[]; dropped: DroppedChunk[] } {
  const kept: Chunk[] = []
  const dropped: DroppedChunk[] = []
  for (const c of chunks) {
    const reason = junkReason(c)
    if (reason) dropped.push({ ...c, dropReason: reason })
    else kept.push(c)
  }
  return { kept, dropped }
}
