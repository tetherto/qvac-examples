// ============================================================
// The preload bridge: a named list of calls, nothing more.
// The renderer cannot reach the file system, the network or @qvac/sdk.
// ============================================================

import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { TopicNode } from '../core/topics'
import type { Attempt, Chunk, DroppedChunk, Exam, ExamConfig, GenEvent, ModelChoice, ModelKey, ModelStatus, Passage, Settings, Source } from '../core/types'

export interface SourceRow {
  source: Source
  kept: number
  dropped: number
}

export interface AppState {
  settings: Settings
  system: { ramBytes: number; cpu: string; platform: string }
  dataDir: string
}

function on<T>(channel: string, fn: (payload: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, payload: T): void => fn(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api = {
  app: {
    state: (): Promise<AppState> => ipcRenderer.invoke('app:state'),
    setSettings: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('settings:set', patch),
    reset: (): Promise<Settings> => ipcRenderer.invoke('app:reset'),
    storage: (): Promise<{ models: number; library: number; exams: number; dir: string }> => ipcRenderer.invoke('storage:info'),
    revealData: (): Promise<void> => ipcRenderer.invoke('storage:reveal'),
    /** The path of a file dropped on the window (File.path is gone in Electron 32+). */
    pathFor: (file: File): string => webUtils.getPathForFile(file)
  },
  models: {
    list: (): Promise<{ choices: ModelChoice[]; resident: ModelKey | null; statuses: ModelStatus[] }> => ipcRenderer.invoke('models:list'),
    download: (key: ModelKey): Promise<void> => ipcRenderer.invoke('models:download', key),
    pause: (key: ModelKey): Promise<void> => ipcRenderer.invoke('models:pause', key),
    load: (key: ModelKey): Promise<void> => ipcRenderer.invoke('models:load', key),
    unload: (): Promise<void> => ipcRenderer.invoke('models:unload'),
    onStatus: (fn: (s: ModelStatus) => void) => on('models:status', fn)
  },
  debug: {
    ping: (key: ModelKey, prompt: string): Promise<string> => ipcRenderer.invoke('debug:ping', key, prompt),
    onPingDelta: (fn: (text: string) => void) => on('debug:ping-delta', fn)
  },
  library: {
    list: (): Promise<SourceRow[]> => ipcRenderer.invoke('library:list'),
    pick: (): Promise<void> => ipcRenderer.invoke('library:pick'),
    /** Paths or links; resolves with one message per one that could not be added. */
    add: (refs: string[]): Promise<string[]> => ipcRenderer.invoke('library:add', refs),
    retry: (id: string): Promise<void> => ipcRenderer.invoke('library:retry', id),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('library:remove', id),
    chunks: (id: string): Promise<{ kept: Chunk[]; dropped: DroppedChunk[] }> => ipcRenderer.invoke('library:chunks', id),
    passage: (chunkId: string): Promise<Passage | null> => ipcRenderer.invoke('library:passage', chunkId),
    topics: (sourceIds?: string[]): Promise<TopicNode[]> => ipcRenderer.invoke('library:topics', sourceIds),
    locate: (sourceId: string): Promise<boolean> => ipcRenderer.invoke('library:locate', sourceId),
    onChanged: (fn: (rows: SourceRow[]) => void) => on('library:changed', fn)
  },
  gen: {
    start: (config: ExamConfig): Promise<void> => ipcRenderer.invoke('gen:start', config),
    cancel: (): Promise<void> => ipcRenderer.invoke('gen:cancel'),
    /** Stop now and save the questions already checked. */
    keep: (): Promise<Exam | null> => ipcRenderer.invoke('gen:keep'),
    onEvent: (fn: (e: GenEvent) => void) => on('gen:event', fn),
    revealLog: (): Promise<void> => ipcRenderer.invoke('log:reveal')
  },
  exams: {
    list: (): Promise<{ exams: Exam[]; attempts: Attempt[] }> => ipcRenderer.invoke('exams:list'),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('exams:delete', id),
    saveAttempt: (a: Attempt): Promise<void> => ipcRenderer.invoke('attempts:save', a),
    discardAttempt: (id: string): Promise<void> => ipcRenderer.invoke('attempts:discard', id),
    onChanged: (fn: () => void) => on('exams:changed', fn)
  },
  source: {
    open: (p: Passage): Promise<{ ok: boolean; missing?: boolean }> => ipcRenderer.invoke('source:open', p),
    exists: (p: Passage): Promise<boolean> => ipcRenderer.invoke('source:exists', p)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
