// ============================================================
// The Electron main process: the window, the library, the papers and the
// IPC handlers.
//
// The renderer asks over `ipcRenderer.invoke` and gets answers back. Long
// jobs (downloads, generation) stream to it over `webContents.send` events,
// so the screen can update as each question is produced and checked.
//
// Everything the user makes is saved as JSON in the app's data folder
// (src/main/store.ts). Every rejection is also appended to
// rejections.jsonl there: the log of what the gate threw out, and why.
// ============================================================

import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import { access, appendFile } from 'node:fs/promises'
import { cpus, totalmem } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { generateExam } from '../core/pipeline'
import { filterPool } from '../core/sample'
import { topicOf, topicTree } from '../core/topics'
import type { Attempt, Chunk, Exam, ExamConfig, GenEvent, ModelKey, Passage, Question, Settings, Source } from '../core/types'
import { FILE_EXTENSIONS, ingest, typeOf } from './ingest'
import { MODEL_CHOICES, PARALLEL } from './models'
import { bytesOnDisk, download, engineFor, ensureLoaded, getStatus, onModelStatus, pauseDownload, ping, residentKey, shutdown, unload } from './qvac'
import { Store } from './store'

app.commandLine.appendSwitch('no-sandbox')
// The self-test and the screenshot run get a throwaway data folder, so they
// never touch your library.
if (process.env.EXAM_SELFTEST || process.env.EXAM_SHOTS) app.setPath('userData', join(app.getPath('temp'), `exam-prep-selftest-${Date.now()}`))

let win: BrowserWindow | null = null
const store = new Store(app.getPath('userData'))

function send(channel: string, payload: unknown): void {
  win?.webContents.send(channel, payload)
}

// ---- The library ----------------------------------------------------------

function sourceList(): { source: Source; kept: number; dropped: number }[] {
  const { sources, chunks, dropped } = store.library
  return sources.map((source) => ({ source, kept: chunks[source.id]?.length ?? 0, dropped: dropped[source.id]?.length ?? 0 }))
}

function readyChunks(sourceIds?: string[]): Chunk[] {
  const ids = sourceIds?.length ? new Set(sourceIds) : null
  return store.library.sources
    .filter((s) => s.status === 'ready' && (!ids || ids.has(s.id)))
    .flatMap((s) => store.library.chunks[s.id] ?? [])
}

function libraryChanged(): void {
  void store.save('library')
  send('library:changed', sourceList())
}

async function addSource(ref: string, replaceId?: string): Promise<void> {
  const type = typeOf(ref)
  if (!type) throw new Error(`Unsupported file: ${ref.split(/[\\/]/).pop()}. Use .pdf, .md, .txt or a link.`)
  const id = replaceId ?? crypto.randomUUID()
  const placeholder: Source = { id, type, ref, title: type === 'url' ? ref : (ref.split(/[\\/]/).pop() ?? ref), status: 'parsing', addedAt: new Date().toISOString() }
  const at = store.library.sources.findIndex((s) => s.id === id)
  if (at >= 0) store.library.sources[at] = placeholder
  else store.library.sources.push(placeholder)
  libraryChanged()
  let next: Source
  try {
    const result = await ingest(ref, id)
    next = result.source
    store.library.chunks[id] = result.chunks
    store.library.dropped[id] = result.dropped
    console.log(`[ingest] ${next.title}: ${result.chunks.length} chunks kept, ${result.dropped.length} dropped (${next.status})`)
  } catch (err) {
    next = { ...placeholder, status: 'fetch_failed', message: (err as Error).message }
  }
  // The user may have removed it while it was being read.
  const i = store.library.sources.findIndex((s) => s.id === id)
  if (i < 0) return
  store.library.sources[i] = next
  libraryChanged()
}

function removeSource(id: string): void {
  store.library.sources = store.library.sources.filter((s) => s.id !== id)
  delete store.library.chunks[id]
  delete store.library.dropped[id]
  libraryChanged()
}

// ---- Papers ---------------------------------------------------------------

/** Turns accepted questions into a saved paper, with its passages copied in. */
function savePaper(config: ExamConfig, questions: Question[], id = `exam-${Date.now().toString(36)}`): Exam {
  const sources = new Map(store.library.sources.map((s) => [s.id, s]))
  const chunks = new Map(readyChunks().map((c) => [c.id, c]))
  const passages: Record<string, Passage> = {}
  const perSource = new Map<string, number>()
  for (const q of questions) {
    const c = chunks.get(q.sourceChunkId)
    if (!c) continue
    const s = sources.get(c.sourceId)!
    passages[c.id] = {
      chunkId: c.id,
      text: c.text,
      headingTrail: c.headingTrail,
      sourceId: s.id,
      sourceTitle: s.title,
      sourceRef: s.ref,
      sourceType: s.type,
      pageNumber: c.pageNumber,
      anchor: c.anchor
    }
    perSource.set(s.id, (perSource.get(s.id) ?? 0) + 1)
  }
  const main = [...perSource.entries()].sort((a, b) => b[1] - a[1])[0]
  const exam: Exam = {
    id,
    createdAt: new Date().toISOString(),
    config,
    questions,
    number: Math.max(0, ...store.exams.map((e) => e.number ?? 0)) + 1,
    title: config.title?.trim() || (main ? sources.get(main[0])!.title : 'Practice paper'),
    passages
  }
  store.exams.push(exam)
  void store.save('exams')
  send('exams:changed', null)
  return exam
}

// ---- Generation -------------------------------------------------------------

interface Generation {
  config: ExamConfig
  controller: AbortController
  accepted: Question[]
  /** "Start with the ones done": stop, then save what passed. */
  keep: ((exam: Exam | null) => void) | null
  /** After an error, the questions that passed before it. */
  failed: boolean
}

let generation: Generation | null = null
const logPath = (): string => join(app.getPath('userData'), 'rejections.jsonl')

async function startGeneration(config: ExamConfig): Promise<void> {
  if (generation && !generation.failed) throw new Error('A paper is already being written.')
  const gen: Generation = { config, controller: new AbortController(), accepted: [], keep: null, failed: false }
  generation = gen
  const pool = readyChunks(config.sourceIds)
  const titles = Object.fromEntries(store.library.sources.map((s) => [s.id, s.title]))

  const emit = (e: GenEvent): void => {
    if (generation !== gen) return
    if (e.type === 'accepted') {
      gen.accepted.push(e.question)
      console.log(`[gate] accept ${e.accepted}/${e.target}: ${e.question.stem.slice(0, 90)}`)
    } else if (e.type === 'rejected') {
      const r = e.rejection
      console.log(`[gate] REJECT #${r.promptIndex} ${r.type} [${r.reasons.join(', ')}] ${r.headingTrail.join(' › ')} :: ${r.detail}`)
      void appendFile(logPath(), JSON.stringify(r) + '\n').catch(() => undefined)
    } else if (e.type === 'done') {
      // Saved under the pipeline's own id, so the event and the file agree.
      const exam = savePaper(config, e.exam.questions, e.exam.id)
      if (e.accepted) {
        store.settings.secondsPerQuestion[config.modelKey] = Math.round((e.seconds / e.accepted) * 10) / 10
        void store.save('settings')
      }
      const scoped = filterPool(pool, { sourceIds: config.sourceIds, topicFocus: config.topicFocus, topics: config.topics })
      const byTopic = new Map<string, { topic: string; sections: number; questions: number }>()
      for (const c of scoped) {
        const t = topicOf(c.headingTrail)
        const row = byTopic.get(t) ?? { topic: t, sections: 0, questions: 0 }
        row.sections++
        byTopic.set(t, row)
      }
      for (const q of exam.questions) {
        const row = byTopic.get(topicOf(q.headingTrail))
        if (row) row.questions++
      }
      e = { ...e, exam, topics: [...byTopic.values()].sort((a, b) => a.questions / a.sections - b.questions / b.sections) }
      console.log(`[gen] done: ${e.accepted}/${e.target} in ${e.seconds}s, ${e.rejected} rejected${e.shortBy ? ` (short: ${e.shortBy.reason})` : ''}`)
    } else if (e.type === 'error') {
      gen.failed = true
      console.log('[gen] error', e.message)
    } else if (e.type !== 'produced') {
      console.log('[gen]', e.type, JSON.stringify(e).slice(0, 200))
    }
    send('gen:event', e)
  }

  void generateExam({ config, chunks: pool, sourceTitles: titles, engine: engineFor(config.modelKey), emit, signal: gen.controller.signal, slots: PARALLEL })
    .catch((err) => emit({ type: 'error', message: (err as Error).message }))
    .finally(() => {
      if (gen.keep) gen.keep(gen.accepted.length ? savePaper(config, gen.accepted) : null)
      if (generation === gen && !gen.failed) generation = null
    })
}

/** Stops generation and saves the questions that already passed. */
function keepGeneration(): Promise<Exam | null> {
  const gen = generation
  if (!gen) return Promise.resolve(null)
  if (gen.failed) {
    generation = null
    return Promise.resolve(gen.accepted.length ? savePaper(gen.config, gen.accepted) : null)
  }
  return new Promise((resolve) => {
    gen.keep = resolve
    gen.controller.abort()
  })
}

// ---- Opening a source where a question came from ---------------------------

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false
  )
}

async function openSource(p: Passage): Promise<{ ok: boolean; missing?: boolean }> {
  const ref = store.library.sources.find((s) => s.id === p.sourceId)?.ref ?? p.sourceRef
  if (p.sourceType === 'url') {
    await shell.openExternal(p.anchor ? `${ref.split('#')[0]}#${p.anchor}` : ref)
    return { ok: true }
  }
  if (!(await exists(ref))) return { ok: false, missing: true }
  if (p.sourceType === 'pdf') {
    // Chromium's own PDF viewer understands #page=N; the system viewer may not.
    const viewer = new BrowserWindow({ width: 900, height: 1000, title: p.sourceTitle, autoHideMenuBar: true, webPreferences: { plugins: true } })
    await viewer.loadURL(`${pathToFileURL(ref).href}${p.pageNumber ? `#page=${p.pageNumber}` : ''}`)
    return { ok: true }
  }
  const err = await shell.openPath(ref)
  return { ok: !err }
}

// ---- IPC ----------------------------------------------------------------------

function registerIpc(): void {
  onModelStatus((s) => send('models:status', s))

  ipcMain.handle('app:state', () => ({
    settings: store.settings,
    system: { ramBytes: totalmem(), cpu: cpus()[0]?.model ?? '', platform: process.platform },
    dataDir: store.dir
  }))
  ipcMain.handle('settings:set', async (_e, patch: Partial<Settings>) => {
    store.settings = { ...store.settings, ...patch }
    if (patch.theme) nativeTheme.themeSource = patch.theme
    await store.save('settings')
    return store.settings
  })

  ipcMain.handle('models:list', async () => ({
    choices: MODEL_CHOICES,
    resident: residentKey(),
    statuses: await Promise.all(MODEL_CHOICES.map((c) => getStatus(c.key)))
  }))
  ipcMain.handle('models:download', (_e, key: ModelKey) => {
    void download(key)
  })
  ipcMain.handle('models:pause', (_e, key: ModelKey) => pauseDownload(key))
  ipcMain.handle('models:load', async (_e, key: ModelKey) => {
    await ensureLoaded(key)
  })
  ipcMain.handle('models:unload', () => unload())
  ipcMain.handle('debug:ping', (_e, key: ModelKey, prompt: string) => ping(key, prompt, (text) => send('debug:ping-delta', text)))

  ipcMain.handle('library:list', () => sourceList())
  ipcMain.handle('library:pick', async () => {
    const res = await dialog.showOpenDialog(win!, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Study material', extensions: FILE_EXTENSIONS }]
    })
    if (res.canceled) return
    // One at a time: a big PDF parse should not compete with another.
    for (const path of res.filePaths) await addSource(path)
  })
  ipcMain.handle('library:add', async (_e, refs: string[]) => {
    const errors: string[] = []
    const add = (ref: string): Promise<unknown> => addSource(ref.trim()).catch((err) => errors.push((err as Error).message))
    // Links are fetched four at a time (they wait on the network); files one
    // at a time, so a big PDF parse never competes with another.
    const links = refs.filter((r) => /^https?:/i.test(r))
    const files = refs.filter((r) => !/^https?:/i.test(r))
    const fetching = (async () => {
      for (let i = 0; i < links.length; i += 4) await Promise.all(links.slice(i, i + 4).map(add))
    })()
    for (const f of files) await add(f)
    await fetching
    return errors
  })
  ipcMain.handle('library:retry', (_e, id: string) => {
    const s = store.library.sources.find((x) => x.id === id)
    if (s) void addSource(s.ref, id)
  })
  ipcMain.handle('library:remove', (_e, id: string) => removeSource(id))
  ipcMain.handle('library:chunks', (_e, id: string) => ({ kept: store.library.chunks[id] ?? [], dropped: store.library.dropped[id] ?? [] }))
  ipcMain.handle('library:passage', (_e, chunkId: string) => {
    const c = readyChunks().find((x) => x.id === chunkId)
    if (!c) return null
    const s = store.library.sources.find((x) => x.id === c.sourceId)!
    return { chunkId: c.id, text: c.text, headingTrail: c.headingTrail, sourceId: s.id, sourceTitle: s.title, sourceRef: s.ref, sourceType: s.type, pageNumber: c.pageNumber, anchor: c.anchor } satisfies Passage
  })
  ipcMain.handle('library:topics', (_e, sourceIds?: string[]) => topicTree(readyChunks(sourceIds)))
  ipcMain.handle('library:locate', async (_e, sourceId: string) => {
    const s = store.library.sources.find((x) => x.id === sourceId)
    if (!s) return false
    const res = await dialog.showOpenDialog(win!, { title: `Locate ${s.title}`, properties: ['openFile'], filters: [{ name: 'Study material', extensions: FILE_EXTENSIONS }] })
    if (res.canceled) return false
    s.ref = res.filePaths[0]
    libraryChanged()
    return true
  })

  ipcMain.handle('gen:start', (_e, config: ExamConfig) => startGeneration(config))
  ipcMain.handle('gen:cancel', () => {
    if (generation?.failed) generation = null
    else generation?.controller.abort()
  })
  ipcMain.handle('gen:keep', () => keepGeneration())
  ipcMain.handle('log:reveal', () => shell.showItemInFolder(logPath()))

  ipcMain.handle('exams:list', () => ({ exams: store.exams, attempts: store.attempts }))
  ipcMain.handle('exams:delete', async (_e, id: string) => {
    store.exams = store.exams.filter((x) => x.id !== id)
    store.attempts = store.attempts.filter((a) => a.examId !== id)
    await Promise.all([store.save('exams'), store.save('attempts')])
    send('exams:changed', null)
  })
  ipcMain.handle('attempts:save', async (_e, attempt: Attempt) => {
    const i = store.attempts.findIndex((a) => a.id === attempt.id)
    if (i >= 0) store.attempts[i] = attempt
    else store.attempts.push(attempt)
    await store.save('attempts')
    send('exams:changed', null)
  })
  ipcMain.handle('attempts:discard', async (_e, id: string) => {
    store.attempts = store.attempts.filter((a) => a.id !== id)
    await store.save('attempts')
    send('exams:changed', null)
  })

  ipcMain.handle('source:open', (_e, p: Passage) => openSource(p))
  ipcMain.handle('source:exists', async (_e, p: Passage) => {
    if (p.sourceType === 'url') return true
    return exists(store.library.sources.find((s) => s.id === p.sourceId)?.ref ?? p.sourceRef)
  })

  ipcMain.handle('storage:info', async () => {
    const models = (await Promise.all(MODEL_CHOICES.map((c) => bytesOnDisk(c.key)))).reduce((a, b) => a + b, 0)
    return { models, ...(await store.sizes()), dir: store.dir }
  })
  ipcMain.handle('storage:reveal', () => shell.openPath(store.dir))
  ipcMain.handle('app:reset', async () => {
    generation?.controller.abort()
    generation = null
    await store.reset()
    send('library:changed', sourceList())
    send('exams:changed', null)
    return store.settings
  })
}

function createWindow(): void {
  nativeTheme.themeSource = store.settings.theme
  const light = store.settings.theme === 'light' || (store.settings.theme === 'system' && !nativeTheme.shouldUseDarkColors)
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    title: 'Exam Prep',
    backgroundColor: light ? '#f3f6f4' : '#171B17',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.on('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  // A file dropped outside the drop handler must not navigate the app away.
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
}

/**
 * `npm run selftest`: drives the real preload API from inside the renderer,
 * so one run proves renderer -> preload -> IPC -> main -> SDK and the event
 * channel back. Adds the fixture, pings the model, saves a screenshot, quits.
 */
async function selftest(): Promise<void> {
  const key = (process.env.EXAM_SELFTEST_MODEL ?? store.settings.modelKey) as ModelKey
  const fixture = join(app.getAppPath(), 'fixtures', 'sample-notes.md')
  const result = await win!.webContents.executeJavaScript(`(async () => {
    let deltas = 0, streamed = ''
    const off = window.api.debug.onPingDelta((t) => { deltas++; streamed += t })
    await window.api.library.add([${JSON.stringify(fixture)}])
    const sources = await window.api.library.list()
    const reply = await window.api.debug.ping(${JSON.stringify(key)}, 'Reply with exactly: the plumbing works.')
    off()
    return { sources: sources.map((r) => ({ title: r.source.title, status: r.source.status, kept: r.kept, dropped: r.dropped })), reply, deltas, streamedMatches: streamed === reply }
  })()`)
  console.log('[selftest]', JSON.stringify(result, null, 2))
  await new Promise((r) => setTimeout(r, 800))
  const shot = await win!.webContents.capturePage()
  const out = join(app.getAppPath(), 'out', 'selftest.png')
  await import('node:fs/promises').then(async (fs) => {
    await fs.mkdir(join(app.getAppPath(), 'out'), { recursive: true })
    await fs.writeFile(out, shot.toPNG())
  })
  console.log('[selftest] screenshot:', out)
  app.quit()
}

app.whenReady().then(async () => {
  await store.load()
  registerIpc()
  createWindow()
  if (process.env.EXAM_SHOTS) {
    win!.webContents.once('did-finish-load', () => {
      void import('./shots')
        .then((m) => m.shots(win!, app.getAppPath()))
        .then(() => app.quit())
        .catch((err) => {
          console.error('[shots] FAILED', err)
          app.exit(1)
        })
    })
  }
  if (process.env.EXAM_SELFTEST) {
    win!.webContents.once('did-finish-load', () => {
      selftest().catch((err) => {
        console.error('[selftest] FAILED', err)
        app.exit(1)
      })
    })
  }
})

let quitting = false
app.on('before-quit', (e) => {
  if (quitting) return
  e.preventDefault()
  quitting = true
  generation?.controller.abort()
  void shutdown().finally(() => app.quit())
})

app.on('window-all-closed', () => app.quit())
