// Screen captures, taken from inside the app.
//
//   npm run shots            writes PNGs to ./shots/
//
// It drives the real renderer through the real IPC, exactly as a person would:
// welcome, import the sample, the table, the categories, one category, one
// marker, then a recommendation from the model. `webContents.capturePage()`
// gives the window's own pixels, so there is no OS screen-recording permission
// involved and no desktop in the frame.
//
// Run against a throwaway userData so the first frame is always the welcome
// screen and your own readings are never opened.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const child = spawn('npx', ['electron-vite', 'dev', '--', '--no-sandbox'], {
  cwd: root,
  env: { ...process.env, BIO_SHOTS: '1' },
  stdio: 'inherit'
})
child.on('exit', (code) => process.exit(code ?? 0))
