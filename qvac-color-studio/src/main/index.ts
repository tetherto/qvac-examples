// ============================================================
// QVAC Color Studio — Electron main process.
//
// Two jobs only: own the window, and own the models. Every
// @qvac/sdk call happens here (see `qvac.ts`); the renderer never
// touches the SDK and never reaches the network.
//
// The renderer sends up the frozen still and gets back an
// `Analysis` object or a PNG. The webcam, the face mesh and the
// drape compositing all stay on the renderer side.
// ============================================================

import { app, BrowserWindow, Menu, ipcMain, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

import { ensureModels, readColors, shutdown } from './qvac.js'
import { buildAnalysisPrompt, parseAnalysis } from './analysis.js'
import type { Analysis, ModelsProgress } from '../shared/types.js'

const here = dirname(fileURLToPath(import.meta.url))

// Linux sandboxing and the Bare worker do not get on.
app.commandLine.appendSwitch('no-sandbox')

// The SDK finds `qvac.config.json` by walking up from the working directory
// looking for a package.json. In development that is already the project
// root, but a packaged app starts in `/`, so point it at the app directory
// before any model call. Without this the config — and with it the raised
// download timeouts — is silently ignored in a packaged build.
process.chdir(app.getAppPath())

// Drop the menu bar on Windows and Linux, where it is just clutter above a
// single-window app. Keep it on macOS: the application menu is where Cmd-Q
// and the clipboard shortcuts live, and removing it takes them with it.
if (process.platform !== 'darwin') Menu.setApplicationMenu(null)

let win: BrowserWindow | null = null

// ---- Window ---------------------------------------------------------

function createWindow(): void {
  win = new BrowserWindow({
    width: 1400,
    height: 940,
    minWidth: 1180,
    minHeight: 800,
    show: false,
    backgroundColor: '#DEDCD6',
    title: 'QVAC Color Studio',
    // The app draws its own title strip; keep the real traffic lights.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(here, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // An ES-module preload needs the sandbox off.
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win?.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(here, '../renderer/index.html'))
  }
}

// ---- Progress plumbing ----------------------------------------------

function sendModelsProgress(p: ModelsProgress): void {
  win?.webContents.send('models:progress', p)
}

// ---- Temp file for the still ----------------------------------------
//
// Multimodal attachments take a file path, so the capture has to touch
// disk. We write it to a private temp directory and delete it as soon as
// the model is done — the photo is not something to leave lying around.

async function withTempStill<T>(png: Uint8Array, run: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'qvac-color-studio-'))
  const path = join(dir, 'capture.png')
  await writeFile(path, png)
  try {
    return await run(path)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

// ---- IPC ------------------------------------------------------------

function registerHandlers(): void {
  // First run: pull every model file down, then report ready. Later runs
  // find everything cached and finish at once.
  ipcMain.handle('models:ensure', async () => {
    try {
      await ensureModels(sendModelsProgress)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      sendModelsProgress({
        phase: 'error',
        percent: 0,
        label: 'Could not fetch the models',
        mbDone: 0,
        mbTotal: 0,
        error: message
      })
      throw err
    }
  })

  // The one structured vision pass. Load → read → unload, every time.
  ipcMain.handle('analyze', async (_event, stillPng: Uint8Array): Promise<Analysis> => {
    const raw = await withTempStill(stillPng, (path) => readColors(path, buildAnalysisPrompt()))
    // Log the raw reply. A small model's JSON is the thing you will actually
    // need to debug, and `parseAnalysis` repairs so much that a bad reply is
    // otherwise invisible.
    console.log(`[analyze] model replied (${raw.length} chars):\n${raw}`)
    return parseAnalysis(raw)
  })
}

// ---- Lifecycle ------------------------------------------------------

app.whenReady().then(() => {
  electronApp.setAppUserModelId('io.tether.qvac.colorstudio')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  registerHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Never leave a model resident after the app goes away.
app.on('before-quit', () => {
  shutdown().catch(() => {})
})
