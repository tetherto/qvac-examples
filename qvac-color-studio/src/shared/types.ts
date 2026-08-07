// ============================================================
// Shared types — the contract between the Electron main process
// (where every QVAC model runs) and the renderer (React UI).
//
// Both sides import from here, so an IPC change is a type error
// rather than a runtime surprise.
// ============================================================

/** How a colour reads on the person. Green = wear it, red = skip it. */
export type Rating = 'green' | 'yellow' | 'red'

export type Undertone = 'warm' | 'cool' | 'neutral'

export type Season = 'Spring' | 'Summer' | 'Autumn' | 'Winter'

/** One of the twelve fixed swatches, as the vision model reports it back. */
export interface ColorVerdict {
  /** Must match a name in `PALETTE` exactly — that is how we join the two. */
  name: string
  rating: Rating
  commentary: string
}

/**
 * The single structured pass the vision model returns for a capture.
 * One `completion()` call produces all of this; clicking a swatch never
 * re-invokes the model.
 */
export interface Analysis {
  undertone: Undertone
  season: Season
  why: string
  /** Colour names, best first. Drawn from `PALETTE`. */
  recommendedPalette: string[]
  /** Colour names to skip. Drawn from `PALETTE`. */
  avoid: string[]
  /** Exactly twelve entries, one per swatch. */
  colors: ColorVerdict[]
}

// ---- Progress events -------------------------------------------------

/** `models:progress` — model download and load, ahead of the intro screen. */
export interface ModelsProgress {
  phase: 'idle' | 'downloading' | 'ready' | 'error'
  /** 0–100. */
  percent: number
  /** Human-readable line for the progress screen. */
  label: string
  /** Megabytes fetched so far, and the total the app needs. */
  mbDone: number
  mbTotal: number
  /** Present when `phase === 'error'`. */
  error?: string
}

// ---- IPC surface -----------------------------------------------------

/**
 * What `contextBridge` exposes on `window.colorStudio`. Keep this in step
 * with `src/preload/index.ts`.
 */
export interface ColorStudioBridge {
  /**
   * Downloads and caches every model the app needs, then unloads them again.
   * Safe to call more than once — after the first run it is a fast no-op.
   */
  ensureModels: () => Promise<void>

  /**
   * Runs the one structured vision pass over the frozen still.
   * Loads the vision model, reads it, and unloads before returning.
   */
  analyze: (stillPng: Uint8Array) => Promise<Analysis>

  /** Subscribe to `models:progress`. Returns an unsubscribe function. */
  onModelsProgress: (cb: (p: ModelsProgress) => void) => () => void
}
