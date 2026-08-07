import type { ColorStudioBridge } from '../shared/types.js'

declare global {
  interface Window {
    colorStudio: ColorStudioBridge
  }
}

export {}
