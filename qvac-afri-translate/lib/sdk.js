// Resolve the SDK that the `qvac` CLI on PATH actually loads.
//
// Not a local dependency on purpose: @qvac/cli carries native binaries for every
// platform (several GB), and a second copy in this recipe could drift from the CLI
// the rest of the machine uses. Following the CLI means the version reported in the
// UI is the version doing the work.

import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

let cached = null

function readJson (p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null }
}

function findCli () {
  let bin
  try {
    bin = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['qvac'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/)[0].trim()
  } catch {
    throw new Error('the `qvac` CLI is not on PATH. Install it with: npm i -g @qvac/cli')
  }
  let dir = path.dirname(fs.realpathSync(bin))
  for (let i = 0; i < 8; i++) {
    const pkg = readJson(path.join(dir, 'package.json'))
    if (pkg && pkg.name === '@qvac/cli') return { dir, version: pkg.version, sdkRange: (pkg.dependencies || {})['@qvac/sdk'] }
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`found ${bin} but could not locate the @qvac/cli package around it`)
}

/**
 * The SDK's own version.
 *
 * Asking for `@qvac/sdk/package.json` looks obvious and fails: the package's
 * `exports` map does not expose it, so the resolve throws. Walk up from the resolved
 * entry point instead, which is what the QVAC benchmark's detector had to do too.
 */
function sdkVersion (req, entry) {
  try {
    const j = readJson(req.resolve('@qvac/sdk/package.json'))
    if (j && j.version) return j.version
  } catch { /* blocked by the exports map, as expected */ }
  let dir = path.dirname(entry.replace(/^file:\/\//, ''))
  for (let i = 0; i < 8; i++) {
    const j = readJson(path.join(dir, 'package.json'))
    if (j && j.name === '@qvac/sdk' && j.version) return j.version
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  return 'unknown'
}

export async function sdk () {
  if (cached) return cached
  const cli = findCli()
  const req = createRequire(path.join(cli.dir, 'package.json'))
  const entry = req.resolve('@qvac/sdk')
  const mod = await import(entry.startsWith('file:') ? entry : `file://${entry}`)
  cached = { mod, cliVersion: cli.version, sdkVersion: sdkVersion(req, entry), sdkRange: cli.sdkRange }
  return cached
}
