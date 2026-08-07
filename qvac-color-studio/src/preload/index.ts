// ============================================================
// The bridge. Two calls and one event stream — nothing else
// crosses it.
//
// The still does cross this bridge, unlike the sibling
// story-image-generator example, because here the model must
// actually look at the face. It goes to the Electron main
// process and no further: no network call touches it, and the
// temp file main writes is deleted the moment the model is done.
// ============================================================

import { contextBridge, ipcRenderer } from 'electron'
import type { Analysis, ColorStudioBridge, ModelsProgress } from '../shared/types.js'

const bridge: ColorStudioBridge = {
  ensureModels: () => ipcRenderer.invoke('models:ensure'),

  analyze: (stillPng: Uint8Array): Promise<Analysis> => ipcRenderer.invoke('analyze', stillPng),

  onModelsProgress: (cb: (p: ModelsProgress) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: ModelsProgress): void => cb(p)
    ipcRenderer.on('models:progress', listener)
    return () => ipcRenderer.removeListener('models:progress', listener)
  }
}

contextBridge.exposeInMainWorld('colorStudio', bridge)
