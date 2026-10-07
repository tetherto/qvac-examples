// AI-vs-AI spectator runs: the plumbing behind the opening screen's second
// button, and nothing more.
//
// The player is the blind-test CLI, unchanged — a Cursor agent driving the
// public player API with no sight of this repo. This module starts one with
// --ui-events, picks its tagged event lines out of stdout, keeps them in memory
// so a page that reloads can watch the run from the beginning, and fans them
// out to whoever is watching.
//
// Two things matter here and are easy to get wrong. The challenger plays in its
// own game session: `GameClient` keeps its own `vg_sid`, so a run cannot spend,
// unlock or wipe a human's progress. And a run must not outlive the page that
// started it — hence the ownership check, the idle watchdog and the shutdown
// hook, all of which end in the same stop().
import bareProcess from 'bare-process'
import path from 'bare-path'
import fs from 'bare-fs'
import { spawn as spawnSubprocess } from 'bare-subprocess'

const ROOT = path.join(new URL('..', import.meta.url).pathname)
const BLIND_TEST_DIR = path.join(ROOT, 'blind-test')
const CLI = path.join(BLIND_TEST_DIR, 'src', 'cli.js')

// Matches EVENT_PREFIX in blind-test/src/events.js. The CLI's stdout is human
// progress text; events ride the same pipe behind this tag.
const EVENT_PREFIX = 'VG_EVENT '

// Effort is a model parameter, not part of the id: the catalog has no
// "claude-opus-5-5-high" to ask for. It is also the name Claude gives the axis
// other families call reasoning, so a different AI_PLAYER_MODEL may need the
// CLI's --reasoning flag instead.
const PLAYER_MODEL = bareProcess.env.AI_PLAYER_MODEL || 'claude-opus-5-5'
const PLAYER_EFFORT = bareProcess.env.AI_PLAYER_EFFORT || 'high'

// A five-door run against a local 4B guardian is slow. The CLI's own cap.
const RUN_TIMEOUT_S = Number(bareProcess.env.AI_RUN_TIMEOUT || 5400)

// A whole run is a few thousand events, most of them single tokens. Keeping
// them all is what lets a reload replay the match from the first move; the cap
// is a backstop against a pathological run, not an expected limit.
const MAX_EVENTS = 40000

// How long a run is kept alive with nobody watching. A closed tab and a reload
// look the same from here, so this is the whole margin a refresh has to get back
// before its match is stopped — and, the other way round, how long a hosted
// agent goes on playing and spending after the last viewer really has gone. A
// reload takes a second; a turn takes ten.
const IDLE_STOP_MS = 25_000
let idleStopMs = IDLE_STOP_MS

// SIGTERM lets the CLI cancel the hosted run first. This is how long that is
// allowed to take.
const KILL_GRACE_MS = 5000

const MAX_STDERR_LINES = 40

let run = null

function newRunId () {
  return 'ai-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
}

// The challenger is optional: it needs `npm install` in blind-test/ (the
// Cursor SDK) and Cursor credentials. Without the install the menu hides the
// mode rather than offering a button that can only fail.
function challengerInstalled () {
  try { return fs.existsSync(path.join(BLIND_TEST_DIR, 'node_modules', '@cursor', 'sdk', 'package.json')) } catch { return false }
}

export function aiRunConfig () {
  return { model: PLAYER_MODEL, effort: PLAYER_EFFORT, installed: challengerInstalled() }
}

// Public status. `owner` is never sent to a client; `mine` answers the only
// question a browser has about it.
export function aiRunStatus (sid) {
  if (!run) return { running: false, ...aiRunConfig() }
  return {
    running: run.status === 'running',
    mine: run.owner === sid,
    runId: run.owner === sid ? run.id : null,
    status: run.status,
    startedAt: run.startedAt,
    events: run.events.length,
    error: run.error,
    ...aiRunConfig()
  }
}

// One run at a time: there is one local guardian and one model, and two
// challengers would interleave their turns on the same doors.
export function startAiRun ({ sid, url, spawn = spawnSubprocess }) {
  if (run && run.status === 'running') {
    return { ok: false, error: run.owner === sid ? 'a run is already in progress' : 'someone else is already watching a run' }
  }

  const id = newRunId()
  const args = [
    CLI,
    '--url', url,
    '--model', PLAYER_MODEL,
    '--effort', PLAYER_EFFORT,
    '--timeout', String(RUN_TIMEOUT_S),
    '--ui-events'
  ]

  const state = {
    id,
    owner: sid,
    startedAt: Date.now(),
    status: 'running',
    error: null,
    events: [],
    dropped: 0,
    subscribers: new Set(),
    stderr: [],
    stdoutTail: '',
    child: null,
    idleTimer: null,
    killTimer: null
  }
  run = state

  let child
  try {
    child = spawn(bareProcess.env.VAULT_NODE || 'node', args, {
      cwd: BLIND_TEST_DIR,
      // The player's credentials come from the environment this server was
      // started in — CURSOR_API_KEY, or the SDK's own stored login. Nothing is
      // read here, so nothing can be leaked to a client.
      env: bareProcess.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (err) {
    run = null
    return { ok: false, error: `could not start the AI player: ${err.message}` }
  }

  state.child = child
  console.log(`[ai] run ${id} started: node ${args.slice(1).join(' ')} (pid ${child.pid})`)

  child.stdout?.on('data', chunk => onStdout(state, chunk))
  child.stderr?.on('data', chunk => onStderr(state, chunk))
  child.on('error', err => {
    // Most often `node` is not on PATH. The CLI never ran, so it cannot report
    // this itself.
    state.error = `could not run the AI player: ${err.message}`
    finish(state, null, null)
  })
  child.on('exit', (code, signal) => finish(state, code, signal))

  armIdleWatchdog(state)
  publish(state, { type: 'run_launched', model: PLAYER_MODEL, effort: PLAYER_EFFORT })
  return { ok: true, runId: id, ...aiRunConfig() }
}

// stdout arrives in arbitrary chunks, so lines are reassembled before anything
// looks at them: a tagged line split across two reads is still one event.
function onStdout (state, chunk) {
  state.stdoutTail += chunk.toString()
  const lines = state.stdoutTail.split('\n')
  state.stdoutTail = lines.pop() ?? ''
  for (const line of lines) {
    if (line.startsWith(EVENT_PREFIX)) {
      let event = null
      try { event = JSON.parse(line.slice(EVENT_PREFIX.length)) } catch { event = null }
      if (event && typeof event.type === 'string') publish(state, event)
      continue
    }
    if (line.trim()) console.log(`[ai] ${line}`)
  }
}

function onStderr (state, chunk) {
  for (const line of chunk.toString().split('\n')) {
    if (!line.trim()) continue
    state.stderr.push(line)
    if (state.stderr.length > MAX_STDERR_LINES) state.stderr.shift()
    console.error(`[ai] ${line}`)
  }
}

// Every event carries its index, which is what makes a reconnect cheap: the
// page says how far it got and gets the rest.
function publish (state, event) {
  const indexed = { i: state.events.length + state.dropped, ...event }
  state.events.push(indexed)
  if (state.events.length > MAX_EVENTS) {
    state.events.shift()
    state.dropped += 1
  }
  for (const send of state.subscribers) {
    try { send(indexed) } catch { /* a broken viewer unsubscribes itself below */ }
  }
}

function finish (state, code, signal) {
  if (state.status !== 'running') return
  // A run we asked to stop reports whatever exit code cancelling left behind.
  // That is not a failure, and a viewer should not be told it was one.
  if (state.stopReason) state.status = 'stopped'
  else state.status = signal ? 'stopped' : (code === 0 ? 'finished' : 'failed')
  clearTimeout(state.idleTimer)
  clearTimeout(state.killTimer)
  state.idleTimer = null
  state.killTimer = null
  // The CLI reports its own failures through the event stream. This is for the
  // ones it could not: a crash, a signal, a missing runtime.
  if (!state.error && state.status === 'failed') {
    state.error = state.stderr[state.stderr.length - 1] || `the AI player exited with code ${code}`
  }
  const why = state.stopReason ? ` — ${state.stopReason}` : ''
  console.log(`[ai] run ${state.id} ${state.status}${signal ? ` (${signal})` : ''}${why}`)
  publish(state, { type: 'run_exit', status: state.status, code, signal, reason: state.stopReason ?? null, error: state.error })
}

// Replays what has already happened, then follows along. `since` is the index
// of the last event the viewer saw, so a reload after a dropped connection
// picks up exactly where it left off — and a fresh page (-1) watches the match
// from its first move.
export function subscribeAiRun (sid, onEvent, since = -1) {
  if (!run) return { ok: false, error: 'no run in progress' }
  if (run.owner !== sid) return { ok: false, error: 'not your run' }
  const state = run
  for (const event of state.events) {
    if (event.i > since) onEvent(event)
  }
  // A run that ended before the viewer connected has nothing left to follow;
  // the replay above already carried its ending.
  if (state.status !== 'running') return { ok: true, live: false, unsubscribe () {} }

  state.subscribers.add(onEvent)
  clearTimeout(state.idleTimer)
  state.idleTimer = null
  return {
    ok: true,
    live: true,
    unsubscribe () {
      state.subscribers.delete(onEvent)
      if (!state.subscribers.size) armIdleWatchdog(state)
    }
  }
}

function armIdleWatchdog (state) {
  clearTimeout(state.idleTimer)
  state.idleTimer = setTimeout(() => {
    if (state.status !== 'running' || state.subscribers.size) return
    console.log(`[ai] run ${state.id} has no audience — stopping it`)
    stop(state, 'abandoned')
  }, idleStopMs)
}

export function stopAiRun (sid, reason = 'stopped') {
  if (!run) return { ok: true, running: false }
  if (run.owner !== sid) return { ok: false, error: 'not your run' }
  stop(run, reason)
  return { ok: true, running: false }
}

// SIGTERM first, because the CLI handles it by cancelling the hosted run before
// it exits; a run left live keeps playing the doors with nobody watching.
function stop (state, reason) {
  if (state.status !== 'running') return
  state.stopReason = reason
  try { state.child?.kill('SIGTERM') } catch {}
  clearTimeout(state.killTimer)
  state.killTimer = setTimeout(() => {
    try { state.child?.kill('SIGKILL') } catch {}
  }, KILL_GRACE_MS)
}

// Called during server shutdown, before the model unloads: the child is playing
// against a guardian that is about to disappear.
export function shutdownAiRuns () {
  if (!run || run.status !== 'running') return Promise.resolve()
  const state = run
  return new Promise(resolve => {
    const done = setTimeout(resolve, KILL_GRACE_MS + 1000)
    state.child?.on('exit', () => { clearTimeout(done); resolve() })
    stop(state, 'shutdown')
  })
}

// Tests only: forget the current run without touching a process, and shorten
// the watchdog so its behaviour can be asserted without a minute of waiting.
export function resetAiRunsForTest ({ idleStop = IDLE_STOP_MS } = {}) {
  if (run) {
    clearTimeout(run.idleTimer)
    clearTimeout(run.killTimer)
  }
  run = null
  idleStopMs = idleStop
}

export const AI_RUN_INTERNALS = { IDLE_STOP_MS, KILL_GRACE_MS, EVENT_PREFIX, MAX_EVENTS }
