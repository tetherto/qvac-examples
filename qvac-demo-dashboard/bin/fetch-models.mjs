// Download the models one demo needs, with THAT demo's own @qvac/sdk, so the files land exactly
// where the demo will look for them. Prints one JSON line per event on stdout for setup.mjs.
//   node bin/fetch-models.mjs <demo dir> '<models json>'
// models: [{ "constant": "QWEN3_4B_Q4_K_M" }, { "url": "https://huggingface.co/.../x.gguf" }]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const [dir, list] = process.argv.slice(2)
const models = JSON.parse(list || '[]')
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\n')

// The demo's own SDK, or, for a demo with no dependencies of its own (Afri Translate), the SDK
// inside the `qvac` CLI that the demo itself uses.
function resolveSdk () {
  try {
    return createRequire(path.join(path.resolve(dir), 'package.json')).resolve('@qvac/sdk')
  } catch {}
  const bin = execFileSync('which', ['qvac'], { encoding: 'utf8' }).trim()
  let up = path.dirname(fs.realpathSync(bin))
  for (let i = 0; i < 8; i++) {
    const pkg = path.join(up, 'package.json')
    if (fs.existsSync(pkg) && JSON.parse(fs.readFileSync(pkg, 'utf8')).name === '@qvac/cli') {
      return createRequire(pkg).resolve('@qvac/sdk')
    }
    up = path.dirname(up)
  }
  throw new Error('found the qvac CLI but not the SDK inside it')
}

let sdk
try {
  sdk = await import(pathToFileURL(resolveSdk()).href)
} catch (err) {
  emit({ t: 'error', error: `no @qvac/sdk for ${dir}: ${err.message}` })
  process.exit(1)
}

const MODELS_DIR = path.join(os.homedir(), '.qvac', 'models')

// A URL source is cached under <hash>_<file name>; find it by its name and keep the newest.
function findByName (fileName) {
  let best = null
  if (!fs.existsSync(MODELS_DIR)) return null
  for (const f of fs.readdirSync(MODELS_DIR)) {
    if (f !== fileName && !f.endsWith(`_${fileName}`)) continue
    const p = path.join(MODELS_DIR, f)
    const st = fs.statSync(p)
    if (!best || st.mtimeMs > best.mtimeMs) best = { path: p, size: st.size, mtimeMs: st.mtimeMs }
  }
  return best
}

const files = []
let failed = false
for (const m of models) {
  const label = m.constant || m.url
  try {
    let src = m.url
    if (m.constant) {
      src = sdk[m.constant]
      if (!src) throw new Error(`this SDK version has no ${m.constant}`)
      const before = await sdk.getModelInfo({ name: m.constant })
      if (!before.isCached) emit({ t: 'start', label, total: src.expectedSize })
    } else if (!findByName(decodeURIComponent(new URL(m.url).pathname.split('/').pop()))) {
      emit({ t: 'start', label })
    }
    await sdk.downloadAsset({
      assetSrc: src,
      onProgress: (p) => emit({ t: 'progress', label, downloaded: p.downloaded, total: p.total })
    })
    if (m.constant) {
      const info = await sdk.getModelInfo({ name: m.constant })
      if (!info.isCached) throw new Error('downloaded, but the file size does not match the registry')
      for (const c of info.cacheFiles || []) files.push({ label, path: c.path, size: c.actualSize ?? c.expectedSize })
    } else {
      const hit = findByName(decodeURIComponent(new URL(m.url).pathname.split('/').pop()))
      if (!hit) throw new Error('downloaded, but the file was not found in ~/.qvac/models')
      files.push({ label, path: hit.path, size: hit.size })
    }
    emit({ t: 'done', label })
  } catch (err) {
    failed = true
    emit({ t: 'error', label, error: err?.message || String(err) })
  }
}
emit({ t: 'files', files })
process.exit(failed ? 1 : 0)
