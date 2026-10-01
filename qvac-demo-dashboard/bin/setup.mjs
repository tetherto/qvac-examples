// One-time setup, run at the office with a good connection, before going to the event:
//   npm run setup            every demo
//   npm run setup -- music   only the demos whose id contains "music"
// It installs each demo, downloads every model it needs, runs any extra step, and records what it
// fetched in .state/ so the dashboard can tell, offline, that everything is in place.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { HERE, STATE_DIR, loadDemos, demoDir, statePath, readiness, hasDeps } from '../lib/demos.mjs'
import { withToolPaths } from '../lib/procs.mjs'

const only = process.argv[2]
const demos = loadDemos().filter((d) => !only || d.id.includes(only))
const GB = (n) => `${(n / 1e9).toFixed(1)} GB`

function say (s) { process.stdout.write(`${s}\n`) }
function fail (s) { say(`\n  ${s}`); process.exitCode = 1 }

// Preflight: things a missing tool would otherwise break halfway through.
async function preflight () {
  const problems = []
  const [maj, min] = process.versions.node.split('.').map(Number)
  if (maj < 22 || (maj === 22 && min < 17)) problems.push(`Node ${process.versions.node} is too old: install Node 22.17 or newer.`)
  if (process.platform !== 'darwin' || process.arch !== 'arm64') problems.push('This kit is tested on Apple Silicon Macs only.')
  for (const d of demos) {
    for (const tool of d.needs || []) {
      if (spawnSync('which', [tool], { env: { ...process.env, PATH: withToolPaths(process.env.PATH) } }).status !== 0) problems.push(`${d.name} needs \`${tool}\`: ${d.needsHint?.[tool] || `install ${tool}`}.`)
    }
  }
  const free = Number(spawnSync('df', ['-k', os.homedir()]).stdout.toString().trim().split('\n').pop().split(/\s+/)[3]) * 1024
  // Only what is still to come counts: a demo that is already ready needs no more space.
  let want = 0
  for (const d of demos) if (!(await readiness(d)).ready) want += d.diskBytes || 0
  if (free && want && free < want) problems.push(`Not enough free disk: ${GB(free)} free, about ${GB(want)} needed.`)
  return problems
}

function run (cmd, args, cwd, onLine) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PATH: withToolPaths(process.env.PATH) } })
    let tail = ''
    const take = (c) => {
      tail = (tail + c).slice(-4000)
      if (onLine) for (const line of String(c).split('\n')) if (line.trim()) onLine(line)
    }
    child.stdout.on('data', take)
    child.stderr.on('data', (c) => { tail = (tail + c).slice(-4000) })
    child.on('close', (code) => resolve({ code, tail }))
  })
}

async function install (d, dir) {
  if (!hasDeps(dir)) { say('  nothing to install'); return }
  const lock = fs.existsSync(path.join(dir, 'package-lock.json'))
  // npm writes node_modules/.package-lock.json after a complete install. Newer than the lock file
  // means the install is current, so a second run of setup does not wipe and redo it.
  const done = path.join(dir, 'node_modules', '.package-lock.json')
  if (lock && fs.existsSync(done) && fs.statSync(done).mtimeMs >= fs.statSync(path.join(dir, 'package-lock.json')).mtimeMs) {
    say('  already installed')
    return
  }
  say(`  installing (${lock ? 'npm ci' : 'npm install'})`)
  const r = await run('npm', [lock ? 'ci' : 'install', '--no-audit', '--no-fund'], dir)
  if (r.code !== 0) throw new Error(`npm failed:\n${r.tail}`)
}

async function fetchModels (d, dir) {
  if (!(d.models || []).length) return []
  let files = []
  let last = 0
  const fetching = new Set() // only files that were actually missing get a progress line
  const r = await run(process.execPath, [path.join(HERE, 'bin', 'fetch-models.mjs'), dir, JSON.stringify(d.models)], HERE, (line) => {
    let ev
    try { ev = JSON.parse(line) } catch { return }
    if (ev.t === 'start') { fetching.add(ev.label); say(`  downloading ${ev.label}${ev.total ? ` (${GB(ev.total)})` : ''}`) }
    if (ev.t === 'progress' && fetching.has(ev.label) && ev.total && Date.now() - last > 3000) {
      last = Date.now()
      say(`    ${Math.round((ev.downloaded / ev.total) * 100)}%  ${GB(ev.downloaded)} of ${GB(ev.total)}`)
    }
    if (ev.t === 'error') say(`  FAILED ${ev.label || ''}: ${ev.error}`)
    if (ev.t === 'files') files = ev.files
  })
  if (r.code !== 0) throw new Error('a model did not download (see above). Run setup again: downloads resume.')
  return files
}

async function extraSteps (d, dir) {
  for (const step of d.extraSetup || []) {
    if (step.creates && fs.existsSync(path.join(dir, step.creates))) continue
    say(`  ${step.label}`)
    const [cmd, ...args] = step.run
    const r = await run(cmd, args.map((a) => a.replace('{dashboard}', HERE)), dir, (line) => say(`    ${line}`))
    if (r.code !== 0) {
      if (step.optional) { say(`  skipped: ${step.label} did not complete. ${step.ifSkipped || ''}`); continue }
      throw new Error(`${step.label} failed:\n${r.tail}`)
    }
  }
}

const problems = await preflight()
if (problems.length) {
  say('Fix these first, then run setup again:')
  for (const p of problems) say(`  - ${p}`)
  process.exit(1)
}

fs.mkdirSync(STATE_DIR, { recursive: true })
for (const d of demos) {
  const dir = demoDir(d)
  say(`\n${d.name}`)
  try {
    await install(d, dir)
    const files = await fetchModels(d, dir)
    await extraSteps(d, dir)
    fs.writeFileSync(statePath(d), JSON.stringify({ at: new Date().toISOString(), files }, null, 2))
    const r = await readiness(d)
    say(r.ready ? '  ready' : `  not ready: ${r.why}`)
    if (!r.ready) process.exitCode = 1
  } catch (err) {
    fail(`${d.name}: ${err.message}`)
  }
}

say('\nSummary')
for (const d of demos) {
  const r = await readiness(d)
  say(`  ${r.ready ? 'ready  ' : 'MISSING'}  ${d.name}${r.ready ? '' : `: ${r.why}`}`)
}
say(process.exitCode ? '\nSome demos are not ready. Fix the lines above and run setup again.' : '\nAll set. Start the dashboard with: npm start')
