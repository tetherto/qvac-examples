import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: { outDir: 'dist/main' },
    // @qvac/sdk ships native addons and a Bare worker, and pdf-parse reads
    // files off disk, so both must stay external requires at runtime rather
    // than being bundled into the main chunk.
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
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
