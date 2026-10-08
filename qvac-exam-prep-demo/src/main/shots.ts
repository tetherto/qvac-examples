// ============================================================
// `npm run shots`: walks every screen with real data and saves a PNG of
// each to out/shots/. It adds the fixtures, writes a real paper with the
// Balanced model, sits it in exam and practice mode, and reviews it, so
// the screens are checked against what the app actually produces.
//
// Runs in a throwaway data folder; your library is never touched. Dev
// only: it drives the renderer through the window.__ef handle.
// ============================================================

import type { BrowserWindow } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function shots(win: BrowserWindow, appPath: string): Promise<void> {
  const out = join(appPath, 'out', 'shots')
  await mkdir(out, { recursive: true })
  const js = <T = unknown>(code: string): Promise<T> => win.webContents.executeJavaScript(code)
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const waitFor = async (code: string, ms = 30_000): Promise<void> => {
    const until = Date.now() + ms
    while (Date.now() < until) {
      if (await js<boolean>(`(() => { try { return !!(${code}) } catch { return false } })()`)) return
      await sleep(300)
    }
    throw new Error(`timed out waiting for: ${code}`)
  }
  const shot = async (name: string): Promise<void> => {
    await sleep(500)
    await writeFile(join(out, `${name}.png`), (await win.webContents.capturePage()).toPNG())
    console.log('[shots]', name)
  }
  const go = (route: object): Promise<unknown> => js(`window.__ef.go(${JSON.stringify(route)})`)
  const key = (k: string, mods: { metaKey?: boolean } = {}): Promise<unknown> =>
    js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, metaKey: ${!!mods.metaKey}, bubbles: true }))`)
  const click = (selector: string, text?: string): Promise<unknown> =>
    js(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(selector)})]; const el = ${text ? `els.find((e) => e.textContent.includes(${JSON.stringify(text)}))` : 'els[0]'}; if (!el) throw new Error('no ' + ${JSON.stringify(selector + (text ?? ''))}); el.click() })()`)

  await waitFor('window.__ef && window.__ef.state')

  // EXAM_SHOTS=links EXAM_LINKS=path/to/links.txt: paste a list of links,
  // one a line, into the link box as one clipboard paste, the way a demo
  // would, and time the import.
  if (process.env.EXAM_SHOTS === 'links') {
    if (!process.env.EXAM_LINKS) throw new Error('EXAM_SHOTS=links needs EXAM_LINKS=path/to/links.txt')
    const list = await (await import('node:fs/promises')).readFile(process.env.EXAM_LINKS, 'utf8')
    const count = list.split('\n').filter((l) => l.trim()).length
    await js(`window.__ef.setSettings({ onboarded: true })`)
    await go({ name: 'library' })
    await waitFor(`document.querySelector('.field input')`)
    const started = Date.now()
    await js(`(() => {
      const dt = new DataTransfer(); dt.setData('text', ${JSON.stringify(list)})
      document.querySelector('.field input').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    })()`)
    await sleep(1500)
    await shot('links-importing')
    await waitFor(`window.__ef.sources.length === ${count} && window.__ef.sources.every((r) => r.source.status !== 'parsing')`, 120_000)
    console.log(`[shots] ${count} links imported in ${((Date.now() - started) / 1000).toFixed(1)} s:`, JSON.stringify(await js(`window.__ef.sources.map((r) => [r.source.title, r.source.status, r.kept])`)))
    await shot('links-library')
    if (!process.env.EXAM_DEMO_N) return

    // EXAM_DEMO_N=3: the demo itself. Fast model, Recall, single and
    // true/false, timed from Generate to "ready".
    const n = Number(process.env.EXAM_DEMO_N)
    const model = process.env.EXAM_DEMO_MODEL ?? 'fast'
    await js(`window.__ef.setSettings({ modelKey: ${JSON.stringify(model)} })`)
    await go({ name: 'setup' })
    await waitFor(`window.__ef.resident === ${JSON.stringify(model)}`, 120_000) // the setup screen preloads it
    const t = Date.now()
    await js(`window.__ef.startGen({ title: 'Demo practice', questionCount: ${n}, difficulty: 'recall', types: ['single', 'truefalse'], mode: 'practice', modelKey: ${JSON.stringify(model)} })`)
    await sleep(3000)
    await shot('demo-writing')
    await waitFor(`window.__ef.gen && (window.__ef.gen.phase === 'done' || window.__ef.gen.phase === 'error')`, 600_000)
    const r = await js<{ phase: string; n: number; rejected: number }>(`({ phase: window.__ef.gen.phase, n: window.__ef.gen.accepted.length, rejected: window.__ef.gen.rejected })`)
    console.log(`[shots] demo: ${model}, ${r.n}/${n} questions, ${r.rejected} set aside, ${((Date.now() - t) / 1000).toFixed(1)} s from Generate to ${r.phase}`)
    await shot('demo-ready')
    return
  }

  await shot('01a-onboarding')

  const fixtures = ['sample-notes.md', 'sample-notes.pdf', 'scanned.pdf'].map((f) => join(appPath, 'fixtures', f))
  await js(`window.__ef.setSettings({ modelKey: 'fast' })`)
  void js(`window.api.library.add(${JSON.stringify(fixtures)})`)
  await sleep(150)
  await shot('01b-onboarding-importing')
  await waitFor(`window.__ef.sources.length === 3 && window.__ef.sources.every((r) => r.source.status !== 'parsing')`)
  await shot('01c-onboarding-ready')
  if (process.env.EXAM_SHOTS === 'onboarding') return

  await js(`window.__ef.setSettings({ onboarded: true })`)
  await go({ name: 'library' })
  await shot('02b-library')
  await go({ name: 'exams' })
  await shot('09e-exams-empty')
  await go({ name: 'setup' })
  await shot('03a-setup')
  await click('.picker-head', 'topic')
  await sleep(400)
  await click('.tree-pick', 'Precipitation')
  await shot('03b-setup-topics')
  await click('.picker-head', 'source')
  await sleep(300)
  await shot('03c-setup-sources')
  if (process.env.EXAM_SHOTS === 'setup') return

  // A real paper: 6 questions, every type, from the Balanced model.
  await js(`window.__ef.startGen({ questionCount: 5, difficulty: 'recall', types: ['single', 'multi', 'truefalse'], mode: 'exam', modelKey: 'fast' })`)
  await waitFor(`window.__ef.gen && window.__ef.gen.phase === 'running'`, 120_000)
  await sleep(4000)
  await shot('04a-generating-drafting')
  await waitFor(`window.__ef.gen && (window.__ef.gen.feed.length >= 1 || window.__ef.gen.phase !== 'running')`, 300_000)
  await shot('04a-generating')
  await waitFor(`window.__ef.gen && (window.__ef.gen.phase === 'done' || window.__ef.gen.phase === 'error')`, 400_000)
  await shot('04c-generated')
  const phase = await js<string>('window.__ef.gen.phase')
  if (phase !== 'done') throw new Error('generation failed: ' + (await js<string>('window.__ef.gen.error')))

  // Exam mode: answer every question, flag one, look at question 3.
  await js(`(async () => { const ex = window.__ef.gen.done.exam; window.__ef.clearGen(); await window.__ef.sit(ex) })()`)
  await waitFor(`document.querySelector('.question-pane')`)
  const n = await js<number>(`window.__ef.exams.at(-1).questions.length`)
  for (let i = 0; i < n; i++) {
    await click('button.option')
    if (i === 1) await key('f')
    if (i === 2) await shot('05a-exam')
    if (i < n - 1) await key('ArrowRight')
    await sleep(120)
  }
  await key('Enter', { metaKey: true })
  await waitFor(`document.querySelector('.score')`)
  await shot('06a-results')

  await click('.btn', 'Review all')
  await waitFor(`document.querySelector('.review-bar')`)
  await shot('07-review-first')
  for (let i = 1; i < n; i++) {
    await key('ArrowRight')
    await sleep(150)
    const hasSource = await js<boolean>(`!!document.querySelector('.source-pane')`)
    if (hasSource) {
      await shot('07a-review-wrong')
      break
    }
  }
  await click('.flag-btn')
  await shot('07b-review-flag-menu')
  await key('Escape')

  // Practice mode on the same paper: check one answer.
  await js(`(async () => { const ex = window.__ef.exams.at(-1); await window.__ef.sit(ex, 'practice') })()`)
  await waitFor(`document.querySelector('.question-pane')`)
  await click('button.option')
  await click('.btn', 'Check answer')
  await shot('05b-practice-feedback')
  await click('.link-btn', 'Save')
  await waitFor(`document.querySelector('.exam-grid')`)
  await shot('09f-exams')

  await go({ name: 'settings' })
  await sleep(500)
  await shot('08a-settings')

  await js(`window.__ef.setSettings({ theme: 'light' })`)
  const last = await js<string>(`window.__ef.attempts.filter((a) => a.finishedAt).at(-1).id`)
  await go({ name: 'results', attemptId: last })
  await shot('06a-results-light')
  await go({ name: 'library' })
  await shot('02b-library-light')
  await js(`window.__ef.setSettings({ theme: 'dark' })`)
  console.log('[shots] done:', out)
}
