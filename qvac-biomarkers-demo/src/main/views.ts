// ============================================================
// Assembling what the renderer draws.
//
// The renderer holds no health logic. Everything it shows (statuses,
// effective ranges, trend sentences, category scores, the term-by-term
// explainer) is computed here from the store and the shared maths, and
// sent over as plain data. That way there is exactly one implementation of
// "is this in range", and the chart, the table and the score cannot
// disagree.
// ============================================================

import type {
  AppState,
  CategoryScore,
  MarkerView,
  Marker,
  Range,
  ScoreTrendPoint
} from '../shared/types.js'
import { homedir } from 'node:os'
import { effectiveRange } from '../shared/ranges.js'
import { scoreCategory, scoreTrend } from '../shared/scoring.js'
import { statusFor, trendFor } from '../shared/status.js'
import type { Library } from './library.js'
import type { Store } from './store/index.js'
import { modelInfo } from './qvac.js'

export function markerViews(library: Library, store: Store): MarkerView[] {
  const dates = store.dates()
  const profile = store.profile()

  return library.markers.map((marker) => {
    const { range, personalized, note } = effectiveRange(marker, profile, library.adjustments)
    const values = dates.map((d) => store.valueAt(marker.id, d))
    const latest = store.latestFor(marker.id)

    return {
      marker,
      range,
      personalized,
      personalizedNote: note,
      values,
      latest: latest?.value ?? null,
      latestDate: latest?.date ?? null,
      status: statusFor(latest?.value ?? null, range),
      trend: trendFor(values, dates, range, marker.name)
    }
  })
}

/** The effective-range lookup the scorer needs, built once per snapshot. */
function rangeLookup(library: Library, store: Store): (marker: Marker) => Range {
  const profile = store.profile()
  const cache = new Map<string, Range>()
  return (marker) => {
    let found = cache.get(marker.id)
    if (!found) {
      found = effectiveRange(marker, profile, library.adjustments).range
      cache.set(marker.id, found)
    }
    return found
  }
}

export function categoryScores(library: Library, store: Store): CategoryScore[] {
  const rangeFor = rangeLookup(library, store)
  const latest = new Map<string, number | null>()
  for (const marker of library.markers) {
    latest.set(marker.id, store.latestFor(marker.id)?.value ?? null)
  }
  return library.categories.map((c) =>
    scoreCategory(c, library.markersById, latest, rangeFor)
  )
}

export function categoryTrends(library: Library, store: Store): Record<string, ScoreTrendPoint[]> {
  const rangeFor = rangeLookup(library, store)
  const dates = store.dates()
  const out: Record<string, ScoreTrendPoint[]> = {}
  for (const c of library.categories) {
    out[c.name] = scoreTrend(
      c,
      library.markersById,
      dates,
      (markerId, date) => store.valueAt(markerId, date),
      rangeFor
    )
  }
  return out
}

/** One snapshot of everything the UI needs. Cheap enough to resend whole. */
export function appState(library: Library, store: Store, modelCached: boolean): AppState {
  return {
    hasData: store.hasData(),
    dates: store.dates(),
    markers: markerViews(library, store),
    categories: library.categories,
    scores: categoryScores(library, store),
    trends: categoryTrends(library, store),
    profile: store.profile(),
    sources: store.sources(),
    lastImport: store.lastImport(),
    model: { ...modelInfo, cached: modelCached },
    disclaimer:
      library.knowledgeBase._disclaimer ??
      'Directional, best-effort guidance only. Not a substitute for professional medical or nutritional advice.',
    storePath: tildePath(store.path),
    /** Marker ids the knowledge base can say something about, either direction. */
    coveredMarkers: coveredMarkers(library, store)
  }
}

function coveredMarkers(library: Library, store: Store): string[] {
  const ids = new Set(Object.keys(library.knowledgeBase.entries))
  for (const source of store.sources()) {
    for (const fact of source.facts) if (fact.accepted === true) ids.add(fact.markerId)
  }
  return [...ids]
}

/**
 * The store's location, with the home directory written as `~`.
 *
 * The panel that shows this exists to tell you where your health record
 * lives, and an absolute path carries the account name to get there. That
 * name is on screen in every screenshot and every recording of this app, and
 * it is not part of the answer.
 */
export function tildePath(absolute: string): string {
  const home = homedir()
  return absolute.startsWith(home + '/') ? `~${absolute.slice(home.length)}` : absolute
}
