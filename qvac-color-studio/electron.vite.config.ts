import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: { outDir: 'dist/main' },
    // @qvac/sdk ships native addons and a Bare worker — it must stay an
    // external require at runtime, never be bundled into the main chunk.
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    build: { outDir: 'dist/preload' },
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    build: { outDir: 'dist/renderer' },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()]
  }
})
