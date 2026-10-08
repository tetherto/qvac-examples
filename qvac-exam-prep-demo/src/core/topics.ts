// ============================================================
// Topics, from the material's own headings.
//
// A chunk's heading trail starts with its document's title ("Water Cycle
// Notes › Precipitation › Hail"). The title says which file, not what the
// passage is about, so topics start one level down: "Precipitation", then
// "Precipitation › Hail". Two sources that both have a "Precipitation"
// chapter share one topic, which is what a candidate means by a topic.
// ============================================================

import type { Chunk } from './types'

export const SEP = ' › '

/** The trail without the document title, unless the title is all there is. */
export function topicPath(trail: string[]): string[] {
  return trail.length > 1 ? trail.slice(1) : trail.slice()
}

/** The top-level topic a chunk or question counts toward in results. */
export function topicOf(trail: string[]): string {
  return topicPath(trail)[0] ?? 'Untitled'
}

export interface TopicNode {
  name: string
  path: string // 'State' or 'State › Locking'
  sections: number
  children: TopicNode[]
}

/** Two levels deep: the tree the setup screen shows, with section counts. */
export function topicTree(chunks: Chunk[]): TopicNode[] {
  const roots = new Map<string, TopicNode>()
  for (const c of chunks) {
    const [top, sub] = topicPath(c.headingTrail)
    if (!top) continue
    const root = roots.get(top) ?? { name: top, path: top, sections: 0, children: [] }
    root.sections++
    if (sub) {
      let child = root.children.find((n) => n.name === sub)
      if (!child) {
        child = { name: sub, path: top + SEP + sub, sections: 0, children: [] }
        root.children.push(child)
      }
      child.sections++
    }
    roots.set(top, root)
  }
  return [...roots.values()]
}

/** Does this chunk sit under any of the picked topic paths? */
export function inTopics(trail: string[], topics: string[]): boolean {
  if (!topics.length) return true
  const path = topicPath(trail)
  return topics.some((t) => {
    const want = t.split(SEP)
    return want.every((seg, i) => path[i] === seg)
  })
}
