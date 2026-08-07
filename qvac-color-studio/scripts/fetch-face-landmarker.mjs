// ============================================================
// Runs after `npm install`.
//
// The face mesh needs two things that npm does not put where a
// browser can reach them:
//
//   1. The MediaPipe vision WASM runtime, which ships inside
//      node_modules — we copy it into the renderer's public dir.
//   2. `face_landmarker.task`, the landmark weights, which are
//      not in the package at all — we fetch them once.
//
// Doing both here is what makes the app offline afterwards: at
// runtime nothing is loaded from a CDN.
//
// This never fails the install. If the download does not happen
// the app still starts and says so on the capture screen.
// ============================================================

import { cp, mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const target = join(root, 'src', 'renderer', 'public', 'mediapipe')

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function copyWasm() {
  const from = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
  if (!(await exists(from))) {
    console.log('[setup] @mediapipe/tasks-vision not installed yet — skipping wasm copy')
    return
  }
  await cp(from, join(target, 'wasm'), { recursive: true })
  console.log('[setup] copied the MediaPipe vision runtime')
}

async function fetchModel() {
  const dest = join(target, 'face_landmarker.task')
  if (await exists(dest)) {
    console.log('[setup] face_landmarker.task already present')
    return
  }
  console.log('[setup] fetching face_landmarker.task (~3 MB, one time)…')
  const res = await fetch(MODEL_URL)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  await writeFile(dest, Buffer.from(await res.arrayBuffer()))
  console.log('[setup] face mesh ready — the app runs offline from here')
}

try {
  await mkdir(target, { recursive: true })
  await copyWasm()
  await fetchModel()
} catch (err) {
  console.log(
    `[setup] skipped: ${err?.message ?? err}\n` +
      '[setup] the app will still start; re-run `npm run postinstall` when you have a connection.'
  )
}
