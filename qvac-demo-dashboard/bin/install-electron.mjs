#!/usr/bin/env node
// Installs the Electron app of the demo in the current folder: the same download as the package's
// own install.js, but unzipped with macOS ditto. The extract-zip that Electron 33 ships stops halfway
// on Node 26 and still exits 0, which leaves no path.txt and a demo that cannot launch.
//
//   cd <demo> && node <dashboard>/bin/install-electron.mjs

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

const pkgDir = path.join(process.cwd(), 'node_modules', 'electron')
if (!fs.existsSync(path.join(pkgDir, 'package.json'))) {
  console.error(`no node_modules/electron in ${process.cwd()}: run npm ci there first`)
  process.exit(1)
}
const req = createRequire(path.join(pkgDir, 'install.js'))
const { version } = req('./package.json')
const platformPath = 'Electron.app/Contents/MacOS/Electron'
const dist = path.join(pkgDir, 'dist')
const pathTxt = path.join(pkgDir, 'path.txt')

function installed () {
  try {
    return fs.readFileSync(path.join(dist, 'version'), 'utf8').trim().replace(/^v/, '') === version &&
      fs.readFileSync(pathTxt, 'utf8') === platformPath &&
      fs.existsSync(path.join(dist, platformPath))
  } catch {
    return false
  }
}

if (installed()) {
  console.log(`Electron ${version} already installed`)
  process.exit(0)
}

const { downloadArtifact } = req('@electron/get')
const zip = await downloadArtifact({
  version,
  artifactName: 'electron',
  platform: 'darwin',
  arch: 'arm64',
  cacheRoot: process.env.electron_config_cache,
  checksums: req('./checksums.json')
})

// A half-finished earlier attempt leaves a partial app behind: start from an empty folder.
fs.rmSync(dist, { recursive: true, force: true })
fs.rmSync(pathTxt, { force: true })
fs.mkdirSync(dist)
execFileSync('/usr/bin/ditto', ['-x', '-k', zip, dist])
if (!fs.existsSync(path.join(dist, platformPath))) {
  console.error(`unzipped ${zip}, but it has no ${platformPath}`)
  process.exit(1)
}
fs.writeFileSync(pathTxt, platformPath)
console.log(`Electron ${version} installed`)
