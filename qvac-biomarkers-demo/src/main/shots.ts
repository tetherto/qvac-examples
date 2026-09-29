// ============================================================
// Window captures for the README and the demo.
//
// Driven by BIO_SHOTS=1 from index.ts. Every frame comes from
// `webContents.capturePage()`, so it is the window's own pixels: no desktop,
// no OS screen-recording permission, and no chance of shipping a screenshot
// of a build that no longer exists.
//
// The clicks go through the renderer's own handlers, found by their visible
// text, so this breaks loudly if a label changes rather than capturing an
// empty screen quietly.
// ============================================================

import type { BrowserWindow } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Clicks the first element whose visible text starts with `text`. */
const CLICK = (text: string): string => `(() => {
  const want = ${JSON.stringify(text)}.toLowerCase()
  const els = [...document.querySelectorAll('button, .link, .tab, .grid-row, .cat-card, .row, a')]
  const el = els.find((e) => (e.textContent || '').trim().toLowerCase().startsWith(want))
  if (!el) return 'NOT FOUND: ' + want
  el.click()
  return 'ok'
})()`

/**
 * True once this text is anywhere on screen. `includes`, not `startsWith`: the
 * progress line reads "MedPsy 4B, on this device", so anchoring at the start
 * only finds labels that happen to begin with the phrase.
 */
const HAS = (text: string): string => `(() => {
  const want = ${JSON.stringify(text)}.toLowerCase()
  return (document.body.innerText || '').toLowerCase().includes(want)
})()`

/**
 * The import toast lives for 6 seconds (Toast.tsx:21) and sits over the bottom
 * of the content, which is exactly where the recommendation cards are. Close it
 * rather than waiting it out.
 */
async function closeToast(win: BrowserWindow): Promise<void> {
  await win.webContents.executeJavaScript(
    `(() => { const b = document.querySelector('.toast .icon-btn'); if (b) b.click(); return 'ok' })()`
  )
  await sleep(400)
}

async function click(win: BrowserWindow, text: string): Promise<void> {
  const r = await win.webContents.executeJavaScript(CLICK(text))
  if (r !== 'ok') throw new Error(`[shots] could not click "${text}": ${r}`)
  await sleep(700)
}

/** Waits for a selector to match, for things whose TEXT comes from the model. */
async function waitForSelector(win: BrowserWindow, selector: string, seconds = 240): Promise<void> {
  const js = `document.querySelectorAll(${JSON.stringify(selector)}).length`
  for (let i = 0; i < seconds * 2; i++) {
    if ((await win.webContents.executeJavaScript(js)) > 0) return
    await sleep(500)
  }
  await dump(win, `waiting-for-${selector.replace(/[^a-z0-9]+/gi, '-')}`)
  throw new Error(`[shots] "${selector}" never appeared`)
}

async function waitFor(win: BrowserWindow, text: string, seconds = 20): Promise<void> {
  for (let i = 0; i < seconds * 2; i++) {
    if (await win.webContents.executeJavaScript(HAS(text))) return
    await sleep(500)
  }
  // Leave evidence. A run that times out silently is a run you cannot debug.
  await dump(win, `waiting-for-${text.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`)
  throw new Error(`[shots] "${text}" never appeared`)
}

/** Writes the window as it stands, plus whatever the screen says, on failure. */
async function dump(win: BrowserWindow, name: string): Promise<void> {
  try {
    const img = await win.webContents.capturePage()
    const file = join(FAILDIR, `fail-${name}.png`)
    await mkdir(FAILDIR, { recursive: true })
    await writeFile(file, img.toPNG())
    const text = await win.webContents.executeJavaScript(
      "document.body.innerText.replace(/\\n{2,}/g, '\\n').slice(0, 1200)"
    )
    process.stderr.write(`[shots] ${file}\n[shots] screen reads:\n${text}\n`)
  } catch {
    /* the window may be gone */
  }
}

let FAILDIR = '.'

/**
 * macOS stops painting a window that is not frontmost, and `capturePage()`
 * then hands back the last frame it did paint. That is how the first version of
 * this file wrote a welcome-screen PNG while the DOM had already moved on to
 * the table. So: kill background throttling, raise the window, invalidate, and
 * only then capture.
 */
async function paint(win: BrowserWindow): Promise<void> {
  win.webContents.setBackgroundThrottling(false)
  if (!win.isVisible()) win.show()
  win.focus()
  win.webContents.invalidate()
  await sleep(400)
}


/** Scrolls the first element whose text contains `text` to the top of the view. */
async function scrollTo(win: BrowserWindow, text: string): Promise<void> {
  const js =
    '(() => {' +
    '  const want = ' + JSON.stringify(text.toLowerCase()) + ';' +
    '  const el = [...document.querySelectorAll("h2, h3, .head, .panel, .rec-card, div")]' +
    '    .find((e) => (e.textContent || "").trim().toLowerCase().startsWith(want));' +
    '  if (!el) return "NOT FOUND";' +
    '  el.scrollIntoView({ block: "start" });' +
    '  return "ok";' +
    '})()'
  const r = await win.webContents.executeJavaScript(js)
  if (r !== 'ok') throw new Error(`[shots] could not scroll to "${text}": ${r}`)
  await sleep(500)
}

export async function captureScreens(win: BrowserWindow, outDir: string): Promise<void> {
  await mkdir(outDir, { recursive: true })
  FAILDIR = outDir
  let n = 0
  let previous = ''
  const shot = async (name: string): Promise<void> => {
    let png: Buffer | null = null
    // Two frames identical to the last shot means the window is not painting,
    // not that the screen did not change: every step here changes it.
    for (let attempt = 0; attempt < 4; attempt++) {
      await paint(win)
      png = (await win.webContents.capturePage()).toPNG()
      const sig = createHash('sha1').update(png).digest('hex')
      if (sig !== previous) {
        previous = sig
        break
      }
      process.stderr.write(`[shots] frame for "${name}" matched the previous one, repainting\n`)
    }
    const file = join(outDir, `${String(++n).padStart(2, '0')}-${name}.png`)
    await writeFile(file, png as Buffer)
    process.stdout.write(`[shots] ${file}\n`)
  }

  await sleep(2500) // fonts and the first paint
  await shot('welcome-profile')

  // Step one is the profile, on its own, because it used to lose every race
  // against the Import button sitting beside it.
  await click(win, '40-49')
  await click(win, 'Male')
  await click(win, 'Continue')
  await waitFor(win, 'Drop your results here', 10)
  await shot('welcome-import')

  // Step two, and then the confirmation: a screen you dismiss, not a toast
  // that vanishes while you are still reading the counts.
  await click(win, 'No results to hand')
  await waitFor(win, 'values added', 40)
  await shot('import-summary')
  await click(win, 'See my results')

  await waitFor(win, 'outside your range', 30)
  await shot('overview')

  // The chat panel, opened from the same screen and answering a starter
  // question, so the frame shows a real reply and not an empty panel.
  await click(win, 'Ask MedPsy')
  await waitFor(win, 'runs on this machine', 10)
  await shot('chat-open')
  await click(win, 'Give me a full read')
  await waitForSelector(win, '.chat-meta', 240)
  await sleep(600)
  await shot('chat-answer')
  // Its close button is an icon, so there is no text for `click` to find.
  await win.webContents.executeJavaScript(
    `(() => { const b = document.querySelector('.chat-panel .icon-btn'); if (b) b.click(); return 'ok' })()`
  )
  await sleep(500)

  await click(win, 'Table')
  await waitFor(win, 'UNOPTIMIZED', 30)
  await shot('table-summary')
  await click(win, 'UNOPTIMIZED')
  await waitFor(win, 'Ferritin', 30)
  await shot('table')

  await click(win, 'Categories')
  await waitFor(win, 'Hormones')
  await shot('categories')

  await click(win, 'Oxygen & Blood')
  await waitFor(win, 'How this score is calculated')
  await shot('category')

  await click(win, 'Ferritin')
  await waitFor(win, 'Get recommendations')
  await shot('marker')

  // The model. Slow on purpose: this is the frame worth having.
  await click(win, 'Get recommendations')
  await waitFor(win, 'on this device', 5)
  await shot('generating')
  // NOT a text wait: the sentence on a card is the model's, and the fallback
  // phrase this used to wait for only appears when validation rejected it.
  // Waiting on the card itself works either way.
  await waitForSelector(win, '.rec-card', 240)
  await sleep(1200)
  await closeToast(win)
  // The cards sit below the chart, so the frame worth keeping starts at them.
  await scrollTo(win, 'General recommendations')
  await shot('marker-recommendations')
}
