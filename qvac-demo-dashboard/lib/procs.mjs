// Start, stop and watch the demo processes. Each demo runs `npm start` in its own folder, in its
// own process group, so Stop takes down everything it spawned (Electron helpers, model workers).
import { spawn } from 'node:child_process'
import net from 'node:net'

const LOG_LINES = 300
const STOP_GRACE_MS = 8000 // time for a QVAC worker to unload its model before SIGKILL
const running = new Map() // id -> { child, pgid, port, log, stopping, crashed, exited }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function pushLog (entry, chunk) {
  for (const line of String(chunk).split(/\r?\n/)) {
    if (!line.trim()) continue
    // Progress bars redraw with carriage returns and escape codes: keep the last frame only.
    entry.log.push(line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').split('\r').pop().slice(0, 400))
  }
  if (entry.log.length > LOG_LINES) entry.log.splice(0, entry.log.length - LOG_LINES)
}

// Started from a GUI or a launcher, PATH often lacks Homebrew, and the demos shell out to ffmpeg,
// qvac and npm. Put the usual tool folders first.
export function withToolPaths (p = '') {
  const extra = ['/opt/homebrew/bin', '/usr/local/bin'].filter((d) => !p.split(':').includes(d))
  return [...extra, p].filter(Boolean).join(':')
}

export function portOpen (port, host = '127.0.0.1', timeout = 400) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host })
    const done = (ok) => { sock.destroy(); resolve(ok) }
    sock.setTimeout(timeout, () => done(false))
    sock.once('connect', () => done(true))
    sock.once('error', () => done(false))
  })
}

// The group outlives `npm`, its leader: the SDK's model worker keeps unloading after the server
// exits. A demo is running for as long as anything in its group is.
// Once a group is seen gone, its id is forgotten for good: macOS recycles ids, and a later program
// given the same one must never be signalled or mistaken for the demo. EPERM means the id already
// belongs to another user, so it counts as gone too (our demos run as us).
function groupAlive (entry) {
  if (!entry || !entry.pgid) return false
  try {
    process.kill(-entry.pgid, 0)
    return true
  } catch {
    entry.pgid = null
    return false
  }
}

// Forget dead groups even when no page is polling.
setInterval(() => { for (const e of running.values()) groupAlive(e) }, 2000).unref()

export function isRunning (id) {
  return groupAlive(running.get(id))
}

export function crashedLast (id) {
  const e = running.get(id)
  return Boolean(e && e.crashed && !groupAlive(e))
}

export function logOf (id) {
  return running.get(id)?.log || []
}

export function start (demo, dir) {
  const env = { ...process.env, PATH: withToolPaths(process.env.PATH), ...(demo.env || {}) }
  if (demo.port) env.PORT = String(demo.port)
  const child = spawn('npm', ['start'], { cwd: dir, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const entry = { child, pgid: child.pid, port: demo.port, log: [], stopping: false, crashed: false, exited: false }
  child.stdout.on('data', (c) => pushLog(entry, c))
  child.stderr.on('data', (c) => pushLog(entry, c))
  child.on('error', (err) => {
    entry.exited = true
    entry.crashed = true
    pushLog(entry, `[dashboard] could not start: ${err.message}`)
  })
  child.on('exit', (code, signal) => {
    entry.exited = true
    // npm re-raises a child's fatal signal, so a crash can arrive as a signal with no exit code.
    if (!entry.stopping && (code || signal)) entry.crashed = true
    pushLog(entry, `[dashboard] stopped (${signal || `exit ${code}`})`)
  })
  running.set(demo.id, entry)
  return entry
}

function killGroup (entry, signal) {
  if (!groupAlive(entry)) return
  try { process.kill(-entry.pgid, signal) } catch {}
}

// Resolve only when every process of the demo is gone, so the next demo never loads a model while
// this one is still unloading. SIGTERM first, SIGKILL for whatever is left after the grace period.
export async function stop (id) {
  const e = running.get(id)
  if (!groupAlive(e)) return false
  e.stopping = true
  killGroup(e, 'SIGTERM')
  const deadline = Date.now() + STOP_GRACE_MS
  while (groupAlive(e) && Date.now() < deadline) await sleep(150)
  if (groupAlive(e)) {
    pushLog(e, '[dashboard] still running 8 s after Stop, forcing it to quit')
    killGroup(e, 'SIGKILL')
    const hard = Date.now() + 3000
    while (groupAlive(e) && Date.now() < hard) await sleep(100)
  }
  return true
}

export async function stopAll () {
  await Promise.all([...running.keys()].map(stop))
}

// Last resort when the dashboard itself goes away (terminal closed, crash): ask every group to
// quit. Synchronous, because nothing asynchronous runs inside an 'exit' handler.
export function signalAllSync (signal = 'SIGTERM') {
  for (const e of running.values()) killGroup(e, signal)
}

// Wait for a web demo to answer on its port, giving up as soon as the demo has exited.
export async function waitForPort (entry, ms = 60000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (entry.exited && !groupAlive(entry)) return false
    if (await portOpen(entry.port)) return true
    await sleep(500)
  }
  return false
}
