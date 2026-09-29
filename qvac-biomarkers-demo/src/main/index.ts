// ============================================================
// The Electron main process: the engine room.
//
// Everything that touches a file, the model, or the store happens here.
// The renderer gets plain data over IPC and has no access to any of it:
// contextIsolation is on, nodeIntegration is off, and the preload bridge
// exposes a named list of calls rather than a general channel.
//
// That is not ceremony. The renderer is the part that would run a fetched
// page's markup if it could, and a health record is the wrong thing to have
// within reach of it.
// ============================================================

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type {
  AppState,
  JobProgress,
  Direction,
  ImportReport,
  Profile,
  RecommendationSet
} from '../shared/types.js'
import { advisoryDirection } from '../shared/status.js'
import { loadLibrary, type Library } from './library.js'
import { Store } from './store/index.js'
import { importerFor, fileFilters, ImportError } from './importer/index.js'
import { appState, categoryScores, markerViews } from './views.js'
import {
  allKnownFoods,
  factsFor,
  fingerprint,
  recommendForCategory,
  recommendForMarker
} from './ai/index.js'
import { contextGraph, pendingSource, processSource } from './foodlib/index.js'
import { ask as askChat } from './chat/index.js'
import type { ChatTurn } from '../shared/chat.js'
import { ensureModel, isModelCached, modelInfo, shutdown } from './qvac.js'

// Linux needs this before the app is ready, and it is harmless elsewhere.
app.commandLine.appendSwitch('no-sandbox')

let library: Library
let store: Store
let mainWindow: BrowserWindow | null = null

/** The host to show in the source list, without letting a bad URL throw. */
function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, '')
  } catch {
    return 'unknown source'
  }
}

function send(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload)
}

/**
 * Progress for one job, throttled to ~15 a second. A streaming completion
 * fires per token, and flooding the renderer with IPC would cost more than
 * the inference.
 */
function jobReporter(subject: string): (label: string, percent: number | null) => void {
  let lastSentAt = 0
  return (label, percent) => {
    const now = performance.now()
    if (percent != null && percent < 100 && now - lastSentAt < 66) return
    lastSentAt = now
    send('ai:progress', { subject, label, percent } satisfies JobProgress)
  }
}

async function snapshot(): Promise<AppState> {
  return appState(library, store, await isModelCached())
}

/** Pushes a fresh snapshot to the renderer after anything that changes state. */
async function pushState(): Promise<AppState> {
  const state = await snapshot()
  send('state:changed', state)
  return state
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    show: false,
    title: 'QVAC Biomarkers Demo',
    backgroundColor: '#0D0E0D',
    autoHideMenuBar: true,
    webPreferences: {
      // electron-vite emits the preload as .mjs, and an ES-module preload
      // needs the sandbox off to load at all.
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // Nothing in this app should ever open a window or navigate away. A
  // pasted source is fetched by the main process and never rendered.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

// ---- Import --------------------------------------------------------------

async function importFile(filePath: string): Promise<{ state: AppState; report: ImportReport }> {
  const importer = importerFor(filePath)
  if (!importer) throw new ImportError('We do not know how to read that kind of file.')
  // Height is the one thing a format may need about the person: a scale's
  // weight column is only a BMI once you know it.
  const { readings, report } = await importer.read(filePath, library.markers, {
    heightCm: store.profile().heightCm
  })
  const merged = await store.merge(readings, report)
  return { state: await pushState(), report: merged }
}

// ---- Recommendations -----------------------------------------------------

/**
 * Works out the cache key for a marker, and the inputs a run would need.
 * Returns null when there is nothing to advise on, either the marker is
 * comfortably in range, or the knowledge base has nothing for that
 * direction. Both are honest answers and the UI says which.
 */
function markerJob(markerId: string, force: boolean) {
  const views = markerViews(library, store)
  const view = views.find((v) => v.marker.id === markerId)
  if (!view) return null

  const direction = advisoryDirection(view.latest, view.range) as Direction | null
  // Explicit "get recommendations" on a green marker still deserves an
  // answer, so fall back to the direction it is nearest to.
  const effective: Direction | null =
    direction ??
    (force && view.latest != null
      ? view.latest - view.range.low < view.range.high - view.latest
        ? 'low'
        : 'high'
      : null)
  if (!effective) return null

  const facts = factsFor(markerId, effective, library.knowledgeBase, store.sources())
  const neighbours = views.filter(
    (v) =>
      v.marker.id !== markerId &&
      v.marker.categories.some((c) => view.marker.categories.includes(c))
  )

  const key = Store.cacheKey({
    subject: markerId,
    value: view.latest,
    direction: effective,
    range: view.range,
    factsFingerprint: fingerprint(facts)
  })

  return { view, direction: effective, facts, neighbours, key }
}

function categoryJob(categoryName: string) {
  const category = library.categories.find((c) => c.name === categoryName)
  if (!category) return null
  const views = markerViews(library, store)
  const scores = scoreOf(categoryName)
  if (!scores) return null

  const offRange = views.filter(
    (v) => category.markers.includes(v.marker.id) && (v.status === 'red' || v.status === 'yellow')
  )

  // Facts for every marker that is actually off, in whichever direction it
  // is off. A category with nothing off gets no facts and no advice.
  const facts = offRange.flatMap((v) => {
    const direction = advisoryDirection(v.latest, v.range) as Direction | null
    return direction ? factsFor(v.marker.id, direction, library.knowledgeBase, store.sources()) : []
  })

  const key = Store.cacheKey({
    subject: `category:${categoryName}`,
    value: scores.score,
    direction: null,
    range: { low: 0, high: 100 },
    factsFingerprint: fingerprint(facts)
  })

  return { category, score: scores.score ?? 0, band: scores.band ?? 'Fair', offRange, facts, key }
}

function scoreOf(categoryName: string) {
  return categoryScores(library, store).find((s) => s.category === categoryName) ?? null
}

// ---- IPC -----------------------------------------------------------------

function registerHandlers(): void {
  ipcMain.handle('state:get', () => snapshot())

  ipcMain.handle('import:pick', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import your bloodwork',
      // Desktop, not Downloads: an exported lab result or the demo CSV from
      // `npm run demo:csv` lands there, and it is where people look first.
      defaultPath: app.getPath('desktop'),
      properties: ['openFile'],
      filters: fileFilters()
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return importFile(result.filePaths[0])
  })

  ipcMain.handle('import:sample', () => importFile(library.sampleCsvPath))

  // Drag and drop, the same importer as the picker.
  //
  // Worth having beyond convenience: the native Open panel shows the account
  // name and whatever else is in the folder, which makes it the one part of
  // this app that cannot appear in a screen recording or a screenshot. A drop
  // needs no panel.
  ipcMain.handle('import:path', (_e, filePath: string) => importFile(filePath))

  ipcMain.handle('cell:set', async (_e, markerId: string, date: string, value: number | null) => {
    await store.setValue(markerId, date, value)
    return pushState()
  })

  ipcMain.handle('profile:set', async (_e, profile: Profile) => {
    await store.setProfile(profile)
    return pushState()
  })

  ipcMain.handle('data:erase', async () => {
    await store.eraseEverything()
    return pushState()
  })

  // ---- Recommendations, marker and category ----

  // Forces the direction fallback, exactly as `recs:generate` does. The two
  // must agree or the key they compute differs and a cached answer is never
  // found again. Forcing here is also what gives an in-range marker its
  // "Get recommendations" button rather than a "nothing to say" panel.
  ipcMain.handle('recs:cached', (_e, subject: string) => {
    const job = subject.startsWith('category:')
      ? categoryJob(subject.slice('category:'.length))
      : markerJob(subject, true)
    if (!job) return { state: 'none' as const, set: null }
    const cached = store.recommendation(job.key)
    if (cached) return { state: 'ready' as const, set: cached }
    if (job.facts.length === 0) return { state: 'none' as const, set: null }
    return { state: 'idle' as const, set: null }
  })

  ipcMain.handle('recs:generate', async (_e, subject: string, force: boolean) => {
    const isCategory = subject.startsWith('category:')
    const job = isCategory
      ? categoryJob(subject.slice('category:'.length))
      : markerJob(subject, true)

    if (!job) {
      return {
        state: 'none' as const,
        set: null,
        message: 'Nothing to advise on here yet.'
      }
    }
    if (job.facts.length === 0) {
      return {
        state: 'none' as const,
        set: null,
        message:
          'No vetted guidance for this one yet. Add a source in the Food Library, or add an entry to data/knowledge-base.json.'
      }
    }

    if (force) await store.clearRecommendation(job.key)
    const cached = store.recommendation(job.key)
    if (cached) return { state: 'ready' as const, set: cached }

    send('recs:state', { subject, state: 'generating' })
    try {
      const everyKnownFood = allKnownFoods(library.knowledgeBase, store.sources())
      let set: RecommendationSet
      if (isCategory && 'category' in job) {
        set = await recommendForCategory(
          job.category,
          job.score,
          job.band,
          job.offRange,
          job.facts,
          everyKnownFood,
          (p) => send('model:progress', p),
          jobReporter(subject)
        )
      } else if ('view' in job) {
        set = await recommendForMarker(
          job.view,
          job.direction,
          job.facts,
          job.neighbours,
          everyKnownFood,
          (p) => send('model:progress', p),
          jobReporter(subject)
        )
      } else {
        throw new Error('unreachable')
      }
      await store.setRecommendation(job.key, set)
      send('recs:state', { subject, state: 'ready' })
      return { state: 'ready' as const, set }
    } catch (err) {
      const message = (err as Error).message
      send('recs:state', { subject, state: 'error', message })
      return { state: 'error' as const, set: null, message }
    }
  })

  // ---- Chat ----
  //
  // The renderer holds the conversation and sends it back each turn. The
  // briefing is rebuilt here from the live store every time, so an import
  // mid-conversation changes the next answer rather than being papered over
  // by a system turn pinned when the panel opened.

  ipcMain.handle('chat:ask', async (_e, question: string, history: ChatTurn[]) => {
    const dates = store.dates()
    try {
      const answer = await askChat(
        question,
        history,
        {
          views: markerViews(library, store),
          scores: categoryScores(library, store),
          profile: store.profile(),
          lastTestDate: dates.length > 0 ? dates[dates.length - 1] : null
        },
        (text) => send('chat:delta', { text }),
        (p) => send('model:progress', p)
      )
      return { ok: true as const, answer }
    } catch (err) {
      return { ok: false as const, message: (err as Error).message }
    }
  })

  // ---- Food Library ----

  ipcMain.handle('model:ensure', async () => {
    await ensureModel((p) => send('model:progress', p))
    return pushState()
  })

  ipcMain.handle('source:addUrl', async (_e, url: string) => {
    // Title it by host, not by the raw URL. A pasted URL is long enough to
    // blow out the source list and the context map, and the page's real title
    // replaces it a moment later anyway.
    const source = pendingSource('url', hostOf(url), url)
    await store.addSource(source)
    await pushState()
    const patch = await processSource(
      source,
      { url },
      library.markers,
      (p) => send('model:progress', p),
      jobReporter(`source:${source.id}`)
    )
    await store.updateSource(source.id, patch)
    return pushState()
  })

  ipcMain.handle('source:addPdf', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Add a PDF to your Food Library',
      defaultPath: app.getPath('desktop'),
      properties: ['openFile'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const source = pendingSource('pdf', filePath.split('/').pop() ?? 'document.pdf', 'local file')
    await store.addSource(source)
    await pushState()
    const patch = await processSource(
      source,
      { filePath },
      library.markers,
      (p) => send('model:progress', p),
      jobReporter(`source:${source.id}`)
    )
    await store.updateSource(source.id, patch)
    return pushState()
  })

  ipcMain.handle(
    'source:setFact',
    async (_e, sourceId: string, index: number, accepted: boolean) => {
      await store.setFactAccepted(sourceId, index, accepted)
      return pushState()
    }
  )

  ipcMain.handle('source:remove', async (_e, id: string) => {
    await store.removeSource(id)
    return pushState()
  })

  ipcMain.handle('source:graph', (_e, selectedId?: string) =>
    contextGraph(store.sources(), library.markers, selectedId)
  )

  ipcMain.handle('model:info', () => modelInfo)
}

// ---- Lifecycle -----------------------------------------------------------

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('io.tether.qvac.biomarkers')
  app.on('browser-window-created', (_e, window) => optimizer.watchWindowShortcuts(window))

  // BIO_SELFTEST=1 runs the whole path headlessly and exits. Point it at a
  // throwaway store FIRST: a check that quietly rewrote your own readings
  // would be worse than no check. See selftest.ts.
  const selftesting = process.env.BIO_SELFTEST === '1'
  const shooting = process.env.BIO_SHOTS === '1'
  if (selftesting || shooting) {
    const which = selftesting ? 'selftest' : 'shots'
    app.setPath('userData', join(tmpdir(), `qvac-biomarkers-${which}-${process.pid}`))
  }

  library = await loadLibrary()
  store = new Store(app.getPath('userData'))
  await store.load()

  if (selftesting) {
    const { selftest } = await import('./selftest.js')
    let code = 1
    try {
      code = await selftest({
        importSample: async () => {
          await importFile(library.sampleCsvPath)
        },
        importFile: async (filePath) => (await importFile(filePath)).report,
        setHeight: async (cm) => {
          await store.setProfile({ ...store.profile(), heightCm: cm })
        },
        views: () => markerViews(library, store),
        scores: () => categoryScores(library, store),
        job: (markerId) => markerJob(markerId, true),
        recommend: (j) =>
          recommendForMarker(
            j.view,
            j.direction,
            j.facts,
            j.neighbours,
            allKnownFoods(library.knowledgeBase, store.sources())
          ),
        profile: () => store.profile(),
        lastTestDate: () => {
          const dates = store.dates()
          return dates.length > 0 ? dates[dates.length - 1] : null
        },
        chat: (question) => {
          const dates = store.dates()
          return askChat(
            question,
            [],
            {
              views: markerViews(library, store),
              scores: categoryScores(library, store),
              profile: store.profile(),
              lastTestDate: dates.length > 0 ? dates[dates.length - 1] : null
            },
            () => undefined
          )
        }
      })
    } catch (err) {
      process.stderr.write(`[selftest] threw: ${(err as Error)?.stack ?? String(err)}\n`)
    }
    await shutdown()
    app.exit(code)
    return
  }

  registerHandlers()
  createWindow()

  // BIO_SHOTS=1 drives the real renderer and writes the window's own pixels to
  // ./shots. Used for the README and the demo, so a published screenshot is
  // always of the code that is actually here. See scripts/shots.mjs.
  if (process.env.BIO_SHOTS === '1') {
    const { captureScreens } = await import('./shots.js')
    const win = BrowserWindow.getAllWindows()[0]
    try {
      await captureScreens(win, join(app.getAppPath(), 'shots'))
    } catch (err) {
      process.stderr.write(`[shots] ${(err as Error)?.stack ?? String(err)}\n`)
      await shutdown()
      app.exit(1)
      return
    }
    await shutdown()
    app.exit(0)
    return
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Unload the model before we go, but only take over the quit once.
// `preventDefault` inside an async listener returns before the await
// finishes, so a flag is what actually makes this correct.
let unloading = false
app.on('before-quit', (event) => {
  if (unloading) return
  unloading = true
  event.preventDefault()
  shutdown()
    .catch((err) => console.warn('[main] shutdown failed:', err))
    .finally(() => app.exit(0))
})
