// Launches the app on a genuinely empty store, for demoing the whole flow
// from the welcome screen.
//
// The `--user-data-dir` flag on its own is not enough. It gives the app a
// profile directory of its own, which keeps your real data safe, but that
// directory PERSISTS: import once and every later run reopens with the data
// still there. So this wipes it first. "Fresh" should mean empty, not merely
// separate.

import { rm, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const DIR = resolve(import.meta.dirname, '..', '.dev-userdata')

const had = await stat(DIR).catch(() => null)
await rm(DIR, { recursive: true, force: true })
console.log(had ? `Cleared ${DIR}` : `No profile to clear at ${DIR}`)
console.log('Starting on an empty store. Your real data is untouched.\n')

// `--` hands the rest to Electron rather than to electron-vite. Anything you
// pass after the script name is forwarded too, so
// `npm run dev:fresh -- --remote-debugging-port=9222` works.
const child = spawn(
  'npx',
  [
    'electron-vite',
    'dev',
    '--',
    '--no-sandbox',
    `--user-data-dir=${DIR}`,
    ...process.argv.slice(2)
  ],
  { stdio: 'inherit', cwd: resolve(import.meta.dirname, '..') }
)
child.on('exit', (code, signal) => {
  // Leave the directory behind on exit: if something went wrong mid-demo the
  // store is worth inspecting, and the next run clears it anyway.
  process.exit(signal ? 1 : (code ?? 0))
})
