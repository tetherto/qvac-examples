// ============================================================
// Fetching a page the user pasted.
//
// This is the app's ONLY outbound request, and it happens only when
// somebody clicks Add. It sends a URL and nothing else: no bloodwork, no
// profile, no identifiers, no telemetry. The trust line in the UI says
// exactly that rather than the easier, untrue "nothing ever leaves".
// ============================================================

/** A page bigger than this is almost certainly not an article. */
const MAX_BYTES = 3_000_000
const TIMEOUT_MS = 20_000
/**
 * How much text the model gets. 12,000 was too much: with the 56-marker menu
 * beside it the prompt alone filled the context window and left no room for
 * an answer. 8,000 is roughly 2,000 tokens and covers the body of a fact
 * sheet or an article.
 */
export const MAX_TEXT_CHARS = 8_000

export interface FetchedPage {
  title: string
  domain: string
  text: string
}

/**
 * Strips HTML to something a language model can read.
 *
 * Deliberately small and dependency-free: drop the parts that are never
 * prose, unwrap the rest, decode the handful of entities that actually
 * matter. A full HTML parser would be more correct and is not worth a
 * dependency for "get the words out of an article".
 */
export function htmlToText(html: string): { title: string; text: string } {
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title[^>]*>/i.exec(html)
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim().slice(0, 120) : ''

  // `[^>]*` on BOTH tags: HTML accepts junk inside an end tag, so `</script >`
  // and `</script\t\n bar>` still close the element. CodeQL rejects anything
  // looser, and it is right to. A comment may also end with `--!>`.
  const text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script[^>]*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style[^>]*>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript[^>]*>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg[^>]*>/gi, ' ')
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav[^>]*>/gi, ' ')
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer[^>]*>/gi, ' ')
    .replace(/<!--[\s\S]*?--!?>/g, ' ')
    // Block-level tags become line breaks so sentences do not run together.
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .split('\n')
    .map((line) => decodeEntities(line).replace(/[ \t ]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')

  return { title, text }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
}

export async function fetchPage(rawUrl: string): Promise<FetchedPage> {
  let url: URL
  try {
    url = new URL(rawUrl.trim())
  } catch {
    throw new Error('That does not look like a web address.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Only http and https addresses can be added.')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        // Identify the app honestly. No user data, no cookies, no referrer.
        'user-agent': 'QVAC-Biomarkers-Example/1.0 (+https://docs.qvac.tether.io)',
        accept: 'text/html,text/plain'
      }
    })
  } catch (err) {
    clearTimeout(timer)
    const aborted = (err as Error).name === 'AbortError'
    throw new Error(aborted ? 'That page took too long to answer.' : `Could not reach that page: ${(err as Error).message}`)
  }
  clearTimeout(timer)

  if (!response.ok) {
    throw new Error(`That page answered ${response.status}.`)
  }
  const type = response.headers.get('content-type') ?? ''
  if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) {
    throw new Error(`That address is ${type || 'not text'}. Paste a link to an article, or upload the PDF.`)
  }

  const buffer = await response.arrayBuffer()
  if (buffer.byteLength > MAX_BYTES) {
    throw new Error('That page is too large to read.')
  }
  const html = new TextDecoder('utf-8').decode(buffer)
  const { title, text } = /text\/plain/i.test(type)
    ? { title: '', text: html }
    : htmlToText(html)

  if (text.trim().length < 200) {
    throw new Error('There was almost no text on that page. It may need JavaScript to render.')
  }

  return {
    title: title || url.hostname,
    domain: url.hostname.replace(/^www\./, ''),
    text: text.slice(0, MAX_TEXT_CHARS)
  }
}
