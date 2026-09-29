import type { BiomarkersApi } from './index.js'

declare global {
  interface Window {
    biomarkers: BiomarkersApi
  }
}
