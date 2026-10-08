// ============================================================
// Persistence: four JSON files in the app's data folder.
//
//   library.json   sources, their kept chunks and what the filter dropped
//   exams.json     every paper, with the passages its questions came from
//   attempts.json  every sitting, finished or paused
//   settings.json  theme, chosen model, measured speed
//
// Each write goes to a temporary file first and is renamed over the old
// one, so a crash mid-write leaves the previous version, never half a file.
// SQLite would be the next step once a question bank grows large.
// ============================================================

import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Attempt, Chunk, DroppedChunk, Exam, Settings, Source } from '../core/types'
import { DEFAULT_MODEL } from './models'

export interface Library {
  sources: Source[]
  chunks: Record<string, Chunk[]>
  dropped: Record<string, DroppedChunk[]>
}

export const DEFAULT_SETTINGS: Settings = { theme: 'dark', modelKey: DEFAULT_MODEL, onboarded: false, secondsPerQuestion: {} }

const FILES = { library: 'library.json', exams: 'exams.json', attempts: 'attempts.json', settings: 'settings.json' } as const

export class Store {
  library: Library = { sources: [], chunks: {}, dropped: {} }
  exams: Exam[] = []
  attempts: Attempt[] = []
  settings: Settings = { ...DEFAULT_SETTINGS }
  private queue = new Map<keyof typeof FILES, Promise<void>>()

  constructor(readonly dir: string) {}

  async load(): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    this.library = await this.read('library', this.library)
    this.exams = await this.read('exams', this.exams)
    this.attempts = await this.read('attempts', this.attempts)
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.read('settings', {})) }
    // A source still "parsing" when the app quit never finished: say so.
    for (const s of this.library.sources) {
      if (s.status === 'parsing') Object.assign(s, { status: 'fetch_failed', message: 'Reading was interrupted when the app closed. Retry it.' })
    }
  }

  private async read<T>(name: keyof typeof FILES, fallback: T): Promise<T> {
    try {
      return JSON.parse(await readFile(join(this.dir, FILES[name]), 'utf8')) as T
    } catch {
      return fallback
    }
  }

  /** Writes are serialised per file, so two quick saves never interleave. */
  save(name: keyof typeof FILES): Promise<void> {
    const data = JSON.stringify(this[name])
    const prev = this.queue.get(name) ?? Promise.resolve()
    const next = prev.then(async () => {
      const path = join(this.dir, FILES[name])
      await writeFile(path + '.tmp', data)
      await rename(path + '.tmp', path)
    })
    this.queue.set(name, next.catch((err) => console.error(`[store] ${name}:`, err)))
    return next
  }

  async sizes(): Promise<{ library: number; exams: number }> {
    const size = async (f: string): Promise<number> => (await stat(join(this.dir, f)).catch(() => null))?.size ?? 0
    return { library: await size(FILES.library), exams: (await size(FILES.exams)) + (await size(FILES.attempts)) }
  }

  /** Deletes the app's own data. Downloaded models live elsewhere and stay. */
  async reset(): Promise<void> {
    await Promise.all([...this.queue.values()])
    for (const f of [...Object.values(FILES), 'rejections.jsonl']) await rm(join(this.dir, f), { force: true })
    this.library = { sources: [], chunks: {}, dropped: {} }
    this.exams = []
    this.attempts = []
    this.settings = { ...DEFAULT_SETTINGS }
  }
}
