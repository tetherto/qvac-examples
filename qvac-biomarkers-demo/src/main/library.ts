// ============================================================
// The reference library: the four JSON files under data/.
//
// Read once at startup. They are data, not code: growing the knowledge base
// or fixing a range means editing JSON and relaunching, which is the whole
// reason they are not baked into TypeScript.
// ============================================================

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { Category, Direction, KbFact, Marker } from '../shared/types.js'
import type { AdjustmentTable } from '../shared/ranges.js'

export interface KnowledgeBase {
  _disclaimer?: string
  entries: Record<string, Partial<Record<Direction, KbFact[]>>>
}

export interface Library {
  markers: Marker[]
  markersById: Map<string, Marker>
  categories: Category[]
  knowledgeBase: KnowledgeBase
  adjustments: AdjustmentTable
  /** Where the sample CSV lives, for the "download sample" link. */
  sampleCsvPath: string
}

/**
 * Packaged, `data/` is copied in as an extra resource (see forge.config.cjs);
 * in dev it sits in the project root. Checking both means one code path.
 */
function dataDir(): string {
  const packaged = join(process.resourcesPath ?? '', 'data')
  if (existsSync(packaged)) return packaged
  return join(app.getAppPath(), 'data')
}

function rootFile(name: string): string {
  const packaged = join(process.resourcesPath ?? '', name)
  if (existsSync(packaged)) return packaged
  return join(app.getAppPath(), name)
}

async function json<T>(name: string): Promise<T> {
  const path = join(dataDir(), name)
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (err) {
    throw new Error(`Could not read ${path}: ${(err as Error).message}`)
  }
}

export async function loadLibrary(): Promise<Library> {
  const [markerDoc, categoryDoc, knowledgeBase, adjustments] = await Promise.all([
    json<{ markers: Marker[] }>('markers.json'),
    json<{ categories: Category[] }>('categories.json'),
    json<KnowledgeBase>('knowledge-base.json'),
    json<AdjustmentTable>('range-adjustments.json')
  ])

  const markers = markerDoc.markers
  const categories = categoryDoc.categories

  // Cross-check rather than trust. A category naming a marker that does not
  // exist is a data bug that would otherwise show up as a quietly wrong
  // score, which is the worst way to find out.
  const ids = new Set(markers.map((m) => m.id))
  const problems: string[] = []
  for (const c of categories) {
    for (const id of c.markers) {
      if (!ids.has(id)) problems.push(`category "${c.name}" lists unknown marker "${id}"`)
    }
  }
  const categoryNames = new Set(categories.map((c) => c.name))
  for (const m of markers) {
    for (const name of m.categories) {
      if (!categoryNames.has(name)) problems.push(`marker "${m.id}" names unknown category "${name}"`)
    }
  }
  for (const id of Object.keys(knowledgeBase.entries)) {
    if (!ids.has(id)) problems.push(`knowledge base has an entry for unknown marker "${id}"`)
  }
  if (problems.length > 0) {
    console.warn(`[library] ${problems.length} data problem(s):\n  - ${problems.join('\n  - ')}`)
  }

  return {
    markers,
    markersById: new Map(markers.map((m) => [m.id, m])),
    categories,
    knowledgeBase,
    adjustments,
    sampleCsvPath: rootFile('sample-bloodwork.csv')
  }
}
