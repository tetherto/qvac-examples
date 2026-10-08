// ============================================================
// Web pages. Fetched in the main process, never the renderer.
//
// Mozilla's Readability (the engine behind Firefox Reader View) strips the
// page to its article: no nav, footer, sidebar or cookie banner. We then
// walk what is left in reading order. Heading anchors are looked up on the
// ORIGINAL page, because those are the ids a link can jump to; Readability
// may move or drop them. A heading with no id gets the usual slug.
// ============================================================

import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import { slugify, type Block } from '../../core/chunk'

const TIMEOUT_MS = 20_000

export interface UrlResult {
  blocks: Block[]
  title: string
}

export class FetchFailed extends Error {}

/** Every heading's anchor on the page as served, keyed by its text. */
function anchorsOf(document: Document): Map<string, string> {
  const map = new Map<string, string>()
  for (const h of document.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
    const text = (h.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
    const id =
      h.getAttribute('id') ||
      h.querySelector('[id]')?.getAttribute('id') ||
      h.querySelector('a[name]')?.getAttribute('name') ||
      (h.parentElement?.tagName === 'SECTION' ? h.parentElement.getAttribute('id') : null)
    if (text && id && !map.has(text)) map.set(text, id)
  }
  return map
}

// Tables are read a row at a time ("Puppet | Push, pull | Declarative"):
// one block per cell would scatter a row across the chunk.
const PICK = 'h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,dt,dd,figcaption,tr'

/** A list item that is a citation: "↑ Smith (2016) … ISBN …", "Retrieved 15 July". */
const CITATION_ITEM = /^[↑^]|\bRetrieved\b|\bArchived from\b|\bISBN\b|\bdoi:/

/**
 * Five or more list items in a row of four words or fewer is a link list
 * ("See also", "Related pages", an in-article menu), not study material.
 */
function dropLinkLists(blocks: Block[]): void {
  const isLink = (b: Block): boolean => b.kind === 'text' && b.text.startsWith('- ') && b.text.split(/\s+/).length <= 5
  for (let i = 0; i < blocks.length; ) {
    let j = i
    while (j < blocks.length && isLink(blocks[j])) j++
    if (j - i >= 5) blocks.splice(i, j - i)
    else i = j + 1
  }
}

export async function readUrl(url: string): Promise<UrlResult> {
  let html: string
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': 'Mozilla/5.0 (QVAC Exam Prep; local study tool)', accept: 'text/html,*/*' },
      redirect: 'follow'
    })
    if (!res.ok) throw new FetchFailed(`The page answered ${res.status} ${res.statusText}.`)
    const type = res.headers.get('content-type') ?? ''
    if (!/html|xml|text\/plain/.test(type)) throw new FetchFailed(`That address returned ${type || 'an unknown type'}, not a web page.`)
    html = await res.text()
  } catch (err) {
    if (err instanceof FetchFailed) throw err
    const msg = (err as Error).name === 'TimeoutError' ? 'The page took too long to answer.' : (err as Error).message
    throw new FetchFailed(`Could not fetch the page: ${msg}`)
  }

  const { document } = parseHTML(html)
  const anchors = anchorsOf(document as unknown as Document)
  const pageTitle = (document.querySelector('title')?.textContent ?? '').trim()

  const article = new Readability(document as unknown as Document, { charThreshold: 300 }).parse()
  let root: Element
  if (article?.content) {
    root = parseHTML(`<!doctype html><html><body>${article.content}</body></html>`).document.body as unknown as Element
  } else {
    // Readability gave up: fall back to the body minus the obvious chrome.
    const body = document.body as unknown as Element
    for (const el of body.querySelectorAll('nav,header,footer,aside,script,style,noscript,form,[role=navigation]')) el.remove()
    root = body
  }

  const title = (article?.title || pageTitle || new URL(url).hostname).trim()
  const blocks: Block[] = []

  for (const el of root.querySelectorAll(PICK)) {
    const tag = el.tagName.toLowerCase()
    // A list item or quote that wraps paragraphs is read through its children.
    // Without block children the wrapper is read whole, so nothing is read twice.
    if ((tag === 'li' || tag === 'blockquote' || tag === 'dd') && el.querySelector('p,pre,li,h1,h2,h3,h4,h5,h6')) continue
    if (tag === 'li' && CITATION_ITEM.test((el.textContent ?? '').trim())) continue
    const raw =
      tag === 'tr'
        ? [...el.querySelectorAll('th,td')].map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | ')
        : (el.textContent ?? '').replace(tag === 'pre' ? /[ \t]+$/gm : /\s+/g, tag === 'pre' ? '' : ' ')
    // Wiki-style edit links and footnote markers: [edit], [1], [citation needed].
    const text = (tag === 'pre' ? raw : raw.replace(/\[(edit|\d+|[a-z]|citation needed|clarification needed)\]/gi, '')).trim()
    if (!text) continue
    const h = tag.match(/^h([1-6])$/)
    if (h) {
      const anchor = anchors.get(text.toLowerCase()) ?? slugify(text)
      blocks.push({ kind: 'heading', level: Number(h[1]), text, anchor })
    } else if (tag === 'pre') {
      blocks.push({ kind: 'text', text, code: true })
    } else {
      blocks.push({ kind: 'text', text: tag === 'li' ? `- ${text}` : text })
    }
  }

  dropLinkLists(blocks)

  // Readability often removes the page's own h1. Put the title back as the
  // root, so every chunk has a heading trail to hang on.
  if (!blocks.some((b) => b.kind === 'heading' && b.level === 1)) {
    blocks.unshift({ kind: 'heading', level: 1, text: title, anchor: anchors.get(title.toLowerCase()) })
  }
  return { blocks, title }
}
