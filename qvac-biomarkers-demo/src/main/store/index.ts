// ============================================================
// store/: everything that has to survive a restart.
//
// One JSON file under Electron's userData directory. That is the right
// choice for a prototype at this size: a few thousand readings is tens of
// kilobytes, it is trivially inspectable, and a user can delete it to
// forget everything. Swap this class for SQLite without touching a caller.
//
// Four things live here:
//   readings       merged history, keyed by (markerId, date)
//   profile        weight / age group / gender
//   recommendations  the AI cache, so opening a marker twice is free
//   sources        the Food Library
// ============================================================

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  FoodSource,
  ImportReport,
  Profile,
  Reading,
  RecommendationSet
} from '../../shared/types.js'

/** Bumped when the on-disk shape changes in a way that needs migrating. */
const SCHEMA_VERSION = 1

interface Persisted {
  version: number
  /** markerId -> ISO date -> value. Nested so a merge is a two-key write. */
  readings: Record<string, Record<string, number>>
  profile: Profile
  /** cache key -> the set that was generated. See `cacheKey`. */
  recommendations: Record<string, RecommendationSet>
  sources: FoodSource[]
  lastImport: { at: string; file: string } | null
}

const EMPTY: Persisted = {
  version: SCHEMA_VERSION,
  readings: {},
  profile: { weightKg: null, heightCm: null, ageGroup: null, gender: null },
  recommendations: {},
  sources: [],
  lastImport: null
}

export class Store {
  private data: Persisted = structuredClone(EMPTY)
  private readonly file: string
  /** Serialises writes so two IPC calls cannot interleave a read-modify-write. */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(userDataDir: string) {
    this.file = join(userDataDir, 'biomarkers.json')
  }

  get path(): string {
    return this.file
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.file, 'utf8')
      const parsed = JSON.parse(raw) as Persisted
      // Merge onto EMPTY so a file written by an older version still boots
      // with every key present. The spread is SHALLOW, so `profile` has to be
      // merged in turn: a file written before `heightCm` existed would
      // otherwise replace the whole default object and leave that key
      // undefined, which the type says cannot happen.
      const base = structuredClone(EMPTY)
      this.data = {
        ...base,
        ...parsed,
        profile: { ...base.profile, ...(parsed.profile ?? {}) },
        version: SCHEMA_VERSION
      }
    } catch {
      // No file yet is the normal first-run state, not an error. A corrupt
      // file lands here too; starting empty beats refusing to open.
      this.data = structuredClone(EMPTY)
    }
  }

  private persist(): Promise<void> {
    const run = this.queue.then(async () => {
      await mkdir(dirname(this.file), { recursive: true })
      // Write beside the target and rename, so a crash mid-write cannot
      // leave a half-written health record behind.
      const tmp = `${this.file}.tmp`
      await writeFile(tmp, JSON.stringify(this.data, null, 2), 'utf8')
      await rename(tmp, this.file)
    })
    this.queue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  // ---- Readings ---------------------------------------------------------

  /** Every test date present in the store, oldest first. */
  dates(): string[] {
    const set = new Set<string>()
    for (const byDate of Object.values(this.data.readings)) {
      for (const date of Object.keys(byDate)) set.add(date)
    }
    return [...set].sort()
  }

  hasData(): boolean {
    return this.dates().length > 0
  }

  /** markerId -> date -> value, for the UI to index directly. */
  readings(): Record<string, Record<string, number>> {
    return this.data.readings
  }

  valueAt(markerId: string, date: string): number | null {
    return this.data.readings[markerId]?.[date] ?? null
  }

  /** The most recent date this marker was actually tested. */
  latestFor(markerId: string): { date: string; value: number } | null {
    const byDate = this.data.readings[markerId]
    if (!byDate) return null
    const dates = Object.keys(byDate).sort()
    if (dates.length === 0) return null
    const date = dates[dates.length - 1]
    return { date, value: byDate[date] }
  }

  /**
   * MERGE, never replace. A new date appends; a re-imported (markerId, date)
   * overwrites the old value and is counted as an update, so the UI can say
   * "12 new values, 4 updated" instead of pretending nothing changed.
   */
  async merge(readings: Reading[], report: ImportReport): Promise<ImportReport> {
    let added = 0
    let updated = 0

    for (const r of readings) {
      const byDate = (this.data.readings[r.markerId] ??= {})
      if (Object.prototype.hasOwnProperty.call(byDate, r.date)) {
        if (byDate[r.date] !== r.value) updated++
      } else {
        added++
      }
      byDate[r.date] = r.value
    }

    this.data.lastImport = { at: new Date().toISOString(), file: report.file }
    // A changed value invalidates advice that was generated for the old one.
    // The cache is keyed by value, so stale entries simply stop matching,
    // but they would sit on disk forever, so prune them here.
    this.pruneRecommendations()
    await this.persist()
    return { ...report, added, updated }
  }

  /** Manual edit from the table. Writing null deletes the cell. */
  async setValue(markerId: string, date: string, value: number | null): Promise<void> {
    if (value == null) {
      delete this.data.readings[markerId]?.[date]
      if (this.data.readings[markerId] && Object.keys(this.data.readings[markerId]).length === 0) {
        delete this.data.readings[markerId]
      }
    } else {
      ;(this.data.readings[markerId] ??= {})[date] = value
    }
    this.pruneRecommendations()
    await this.persist()
  }

  lastImport(): { at: string; file: string } | null {
    return this.data.lastImport
  }

  // ---- Profile ---------------------------------------------------------

  profile(): Profile {
    return this.data.profile
  }

  /**
   * Saving a profile can change every effective range, which can change
   * every status and score, so it invalidates the whole advice cache.
   */
  async setProfile(profile: Profile): Promise<void> {
    this.data.profile = profile
    this.data.recommendations = {}
    await this.persist()
  }

  // ---- Recommendation cache -------------------------------------------

  /**
   * Advice is only valid for the inputs it was generated from. The key
   * carries the subject, the value it was about, the direction, the range
   * it was judged against, and a fingerprint of the facts the model was
   * allowed to use, so adding a Food Library source correctly produces
   * fresh advice rather than serving yesterday's.
   */
  static cacheKey(parts: {
    subject: string
    value: number | null
    direction: string | null
    range: { low: number; high: number }
    factsFingerprint: string
  }): string {
    const { subject, value, direction, range, factsFingerprint } = parts
    return [subject, value ?? 'none', direction ?? 'none', range.low, range.high, factsFingerprint].join(
      '|'
    )
  }

  recommendation(key: string): RecommendationSet | null {
    return this.data.recommendations[key] ?? null
  }

  async setRecommendation(key: string, set: RecommendationSet): Promise<void> {
    this.data.recommendations[key] = set
    await this.persist()
  }

  /** "Regenerate": forget this one and re-run. */
  async clearRecommendation(key: string): Promise<void> {
    delete this.data.recommendations[key]
    await this.persist()
  }

  /** Drops cached advice whose subject no longer holds the value it names. */
  private pruneRecommendations(): void {
    for (const key of Object.keys(this.data.recommendations)) {
      const [subject, value] = key.split('|')
      if (subject.startsWith('category:')) continue // re-checked on read
      const latest = this.latestFor(subject)
      const current = latest ? String(latest.value) : 'none'
      if (current !== value) delete this.data.recommendations[key]
    }
  }

  // ---- Food Library ---------------------------------------------------

  sources(): FoodSource[] {
    return this.data.sources
  }

  async addSource(source: FoodSource): Promise<void> {
    this.data.sources.push(source)
    await this.persist()
  }

  async updateSource(id: string, patch: Partial<FoodSource>): Promise<void> {
    const found = this.data.sources.find((s) => s.id === id)
    if (!found) return
    Object.assign(found, patch)
    // New facts change what the model is allowed to say, so old advice goes.
    this.data.recommendations = {}
    await this.persist()
  }

  /**
   * Accepts or rejects one proposed fact, by its position in the source.
   * A source with at least one accepted fact becomes 'linked'; otherwise it
   * stays in review. Either way the advice cache goes, because what the model
   * is allowed to say has changed.
   */
  async setFactAccepted(sourceId: string, index: number, accepted: boolean): Promise<void> {
    const source = this.data.sources.find((s) => s.id === sourceId)
    const fact = source?.facts[index]
    if (!source || !fact) return
    fact.accepted = accepted
    source.state = source.facts.some((f) => f.accepted === true) ? 'linked' : 'review'
    this.data.recommendations = {}
    await this.persist()
  }

  async removeSource(id: string): Promise<void> {
    this.data.sources = this.data.sources.filter((s) => s.id !== id)
    this.data.recommendations = {}
    await this.persist()
  }

  /** Wipes the lot. The trust story needs a real delete button behind it. */
  async eraseEverything(): Promise<void> {
    this.data = structuredClone(EMPTY)
    await this.persist()
  }
}
