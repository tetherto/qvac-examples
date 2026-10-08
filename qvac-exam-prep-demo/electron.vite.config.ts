import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: { outDir: 'dist/main' },
    // @qvac/sdk ships native addons and a Bare worker, and pdfjs-dist loads
    // its own worker file, so both stay external requires at runtime.
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@core': resolve('src/core') } }
  },
  preload: {
    build: { outDir: 'dist/preload' },
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    build: { outDir: 'dist/renderer' },
    resolve: { alias: { '@core': resolve('src/core') } },
    plugins: [react()]
  }
})
