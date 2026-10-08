// ============================================================
// Choosing which chunks to write questions from.
//
// Blind sampling, deliberately spread: round-robin across sources, and
// within each source round-robin across topics (the first two heading
// segments). A 300-page PDF next to a 2-page note therefore cannot take
// every question, and one long chapter cannot take every question from
// its PDF.
//
// Upgrade path: embeddings and vector search would let the sampler pick
// chunks by relevance to a topic rather than by spread. That is out of
// scope for this prototype, and spread is the better default for an exam
// that should cover the material anyway.
// ============================================================

import { inTopics } from './topics'
import type { Chunk } from './types'

/** Small seeded PRNG, so a sample and a shuffle can be replayed in tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** The topic a chunk counts toward: the first one or two heading segments. */
export function topicKey(trail: string[]): string {
  return trail.slice(0, 2).join(' › ') || 'Untitled'
}

export interface PoolFilter {
  sourceIds?: string[]
  topicFocus?: string
  topics?: string[]
}

/**
 * Applies the user's source filter and topic focus. The focus matches the
 * heading trail first; if nothing in the trail matches, it falls back to
 * the chunk text, so "locking" still finds a paragraph about state locking
 * filed under a heading called "Backends".
 */
export function filterPool(chunks: Chunk[], filter: PoolFilter): Chunk[] {
  let pool = chunks
  if (filter.sourceIds?.length) {
    const ids = new Set(filter.sourceIds)
    pool = pool.filter((c) => ids.has(c.sourceId))
  }
  if (filter.topics?.length) pool = pool.filter((c) => inTopics(c.headingTrail, filter.topics!))
  const focus = filter.topicFocus?.trim().toLowerCase()
  if (focus) {
    const byTrail = pool.filter((c) => c.headingTrail.join(' ').toLowerCase().includes(focus))
    pool = byTrail.length ? byTrail : pool.filter((c) => c.text.toLowerCase().includes(focus))
  }
  return pool
}

/** Picks up to `n` chunks, spread across sources and topics. */
export function sampleSpread(
  pool: Chunk[],
  n: number,
  rng: () => number,
  exclude: Set<string> = new Set()
): Chunk[] {
  // source -> topic -> chunks, each list shuffled
  const bySource = new Map<string, Map<string, Chunk[]>>()
  for (const c of pool) {
    if (exclude.has(c.id)) continue
    const topics = bySource.get(c.sourceId) ?? new Map<string, Chunk[]>()
    const key = topicKey(c.headingTrail)
    topics.set(key, [...(topics.get(key) ?? []), c])
    bySource.set(c.sourceId, topics)
  }

  // One iterator per source that takes one chunk from each topic in turn.
  const iterators = shuffle([...bySource.values()], rng).map((topics) => {
    const queues = shuffle([...topics.values()], rng).map((q) => shuffle(q, rng))
    let t = 0
    return (): Chunk | undefined => {
      for (let tries = 0; tries < queues.length; tries++) {
        const q = queues[t % queues.length]
        t++
        const next = q.shift()
        if (next) return next
      }
      return undefined
    }
  })

  const picked: Chunk[] = []
  let live = iterators
  while (picked.length < n && live.length) {
    const still: typeof live = []
    for (const next of live) {
      if (picked.length >= n) break
      const c = next()
      if (c) {
        picked.push(c)
        still.push(next)
      }
    }
    live = still
  }
  return picked
}
