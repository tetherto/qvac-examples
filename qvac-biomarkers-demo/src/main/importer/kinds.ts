// ============================================================
// The importer contract, in its own file.
//
// It lives apart from index.ts so that a concrete importer can depend on
// the interface without depending on the registry that lists it. Otherwise
// csv.ts imports index.ts imports csv.ts, and a circular import in the one
// module that runs before any UI appears is not a thing to be clever about.
// ============================================================

import type { ImportReport, Marker, Reading } from '../../shared/types.js'

export interface ImportResult {
  readings: Reading[]
  report: ImportReport
}

/** What every importer must look like. Add a format by adding one of these. */
export interface Importer {
  /** Stable key, used in logs and errors. */
  id: string
  /** Shown in the file-picker filter. */
  label: string
  /** Lower-case, with the dot: ['.csv']. */
  extensions: string[]
  /** Cheap check before doing any work. */
  canRead(filePath: string): boolean
  /**
   * `markers` is the reference library, so an importer can reject ids it
   * does not recognise rather than inventing them.
   *
   * `ctx` carries the few facts about the person that a format may need to
   * turn its own numbers into a marker. Today that is height, without which a
   * scale's weight column cannot become a BMI. An importer that does not need
   * it ignores it.
   */
  read(filePath: string, markers: Marker[], ctx?: ImportContext): Promise<ImportResult>
}

/** What an importer may need to know about the person, and nothing more. */
export interface ImportContext {
  heightCm: number | null
}

/** Thrown when a file is the right type but unreadable. Message reaches the UI. */
export class ImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportError'
  }
}
