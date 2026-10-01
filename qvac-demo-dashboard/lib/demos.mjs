// The demo list (demos.json) and the cheap readiness check the dashboard runs every 15 s.
// Setup records every model file it fetched in .state/<id>.json; readiness only stats those files,
// so the page never has to start a QVAC worker just to draw a green dot.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const STATE_DIR = path.join(HERE, '.state')

export function loadDemos () {
  return JSON.parse(fs.readFileSync(path.join(HERE, 'demos.json'), 'utf8')).demos
}

export function demoDir (d) {
  return path.resolve(HERE, '..', d.dir)
}

export function statePath (d) {
  return path.join(STATE_DIR, `${d.id}.json`)
}

export function readState (d) {
  try { return JSON.parse(fs.readFileSync(statePath(d), 'utf8')) } catch { return null }
}

// A demo with no dependencies of its own (Afri Translate uses the qvac CLI's SDK) has nothing to install.
export function hasDeps (dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    return Object.keys(pkg.dependencies || {}).length + Object.keys(pkg.devDependencies || {}).length > 0
  } catch { return true }
}

function sizeOf (file) {
  try { return fs.statSync(file).size } catch { return -1 }
}

export async function readiness (d) {
  const dir = demoDir(d)
  if (!fs.existsSync(path.join(dir, 'package.json'))) return { ready: false, why: `Folder ${d.dir} is missing` }
  if (hasDeps(dir) && !fs.existsSync(path.join(dir, 'node_modules'))) return { ready: false, why: 'Not installed. Run npm run setup' }
  for (const rel of d.requiredFiles || []) {
    if (sizeOf(path.join(dir, rel)) <= 0) return { ready: false, why: `Missing ${rel}. Run npm run setup` }
  }
  if (!(d.models || []).length) return { ready: true }
  const st = readState(d)
  if (!st?.files?.length) return { ready: false, why: 'Models not downloaded. Run npm run setup' }
  for (const f of st.files) {
    if (sizeOf(f.path) !== f.size) return { ready: false, why: 'A model file is missing. Run npm run setup' }
  }
  return { ready: true }
}
