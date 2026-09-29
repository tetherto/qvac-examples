// ============================================================
// The preload bridge.
//
// A named list of calls, nothing more. The renderer cannot reach the file
// system, the store or @qvac/sdk, it can only ask for these fourteen
// things, and each one is handled in the main process.
// ============================================================

import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ChatTurn } from '../shared/chat.js'
import type {
  AppState,
  ContextGraph,
  ImportReport,
  JobProgress,
  ModelProgress,
  Profile,
  RecResult,
  RecState
} from '../shared/types.js'

const api = {
  getState: (): Promise<AppState> => ipcRenderer.invoke('state:get'),

  importPick: (): Promise<{ state: AppState; report: ImportReport } | null> =>
    ipcRenderer.invoke('import:pick'),
  importSample: (): Promise<{ state: AppState; report: ImportReport }> =>
    ipcRenderer.invoke('import:sample'),
  /** Import a dropped file. The renderer never learns the path it is passing. */
  importPath: (filePath: string): Promise<{ state: AppState; report: ImportReport }> =>
    ipcRenderer.invoke('import:path', filePath),
  /**
   * The real path behind a dropped `File`. Since Electron 32 `File.path` is
   * gone and this is the supported replacement; it lives in the preload
   * because `webUtils` is not reachable from an isolated renderer.
   */
  pathForFile: (file: File): string => webUtils.getPathForFile(file),

  setCell: (markerId: string, date: string, value: number | null): Promise<AppState> =>
    ipcRenderer.invoke('cell:set', markerId, date, value),
  setProfile: (profile: Profile): Promise<AppState> => ipcRenderer.invoke('profile:set', profile),
  eraseEverything: (): Promise<AppState> => ipcRenderer.invoke('data:erase'),

  cachedRecommendations: (subject: string): Promise<RecResult> =>
    ipcRenderer.invoke('recs:cached', subject),
  generateRecommendations: (subject: string, force = false): Promise<RecResult> =>
    ipcRenderer.invoke('recs:generate', subject, force),

  ensureModel: (): Promise<AppState> => ipcRenderer.invoke('model:ensure'),

  addUrlSource: (url: string): Promise<AppState> => ipcRenderer.invoke('source:addUrl', url),
  addPdfSource: (): Promise<AppState | null> => ipcRenderer.invoke('source:addPdf'),
  setFactAccepted: (sourceId: string, index: number, accepted: boolean): Promise<AppState> =>
    ipcRenderer.invoke('source:setFact', sourceId, index, accepted),
  removeSource: (id: string): Promise<AppState> => ipcRenderer.invoke('source:remove', id),
  sourceGraph: (selectedId?: string): Promise<ContextGraph> =>
    ipcRenderer.invoke('source:graph', selectedId),

  /**
   * Ask the local model a question about the results.
   *
   * Resolves with the finished answer; the text also arrives progressively
   * on `onChatDelta`. Only sentences that cleared the dose guard are sent,
   * so nothing shown here is ever taken back.
   */
  askChat: (
    question: string,
    history: ChatTurn[]
  ): Promise<
    { ok: true; answer: { text: string; redacted: number; seconds: number } } | { ok: false; message: string }
  > => ipcRenderer.invoke('chat:ask', question, history),

  // ---- Events ----
  onChatDelta: (fn: (text: string) => void): (() => void) => {
    const handler = (_e: unknown, p: { text: string }): void => fn(p.text)
    ipcRenderer.on('chat:delta', handler)
    return () => ipcRenderer.removeListener('chat:delta', handler)
  },
  onStateChanged: (fn: (state: AppState) => void): (() => void) => {
    const handler = (_e: unknown, state: AppState): void => fn(state)
    ipcRenderer.on('state:changed', handler)
    return () => ipcRenderer.removeListener('state:changed', handler)
  },
  onModelProgress: (fn: (p: ModelProgress) => void): (() => void) => {
    const handler = (_e: unknown, p: ModelProgress): void => fn(p)
    ipcRenderer.on('model:progress', handler)
    return () => ipcRenderer.removeListener('model:progress', handler)
  },
  onJobProgress: (fn: (p: JobProgress) => void): (() => void) => {
    const handler = (_e: unknown, p: JobProgress): void => fn(p)
    ipcRenderer.on('ai:progress', handler)
    return () => ipcRenderer.removeListener('ai:progress', handler)
  },
  onRecState: (
    fn: (p: { subject: string; state: RecState; message?: string }) => void
  ): (() => void) => {
    const handler = (_e: unknown, p: { subject: string; state: RecState; message?: string }): void =>
      fn(p)
    ipcRenderer.on('recs:state', handler)
    return () => ipcRenderer.removeListener('recs:state', handler)
  }
}

export type BiomarkersApi = typeof api

contextBridge.exposeInMainWorld('biomarkers', api)
