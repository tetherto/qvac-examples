#!/usr/bin/env node
// Vault Guardian blind test — internal tooling.
//
// Spins up a Cursor agent that plays the game through the public player API
// with no sight of the passwords, the level store or the repo, and writes the
// whole run to disk. Independent of the game app: nothing under src/ imports
// this, and this imports nothing from there.
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Cursor } from '@cursor/sdk'

import { GameClient } from './client.js'
import { createReporter } from './events.js'
import { RunLogger } from './logger.js'
import { GameSession, buildCustomTools } from './tools.js'
import { playBlindRun, resolveApiKey, resolveModel, CursorAgentError } from './agent.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BLIND_TEST_DIR = path.join(HERE, '..')
const REPO_ROOT = path.join(BLIND_TEST_DIR, '..')

const DEFAULTS = {
  url: 'http://127.0.0.1:8787',
  model: 'claude-opus-5',
  logDir: path.join(BLIND_TEST_DIR, 'logs'),
  timeout: 3600, // seconds; five doors of a local 4B guardian is a long run
  bootTimeout: 900 // seconds to wait for a spawned server to load the model
}

const USAGE = `Vault Guardian blind test — an AI plays the game without seeing the passwords.

Usage:
  node src/cli.js [options]

Options:
  --url <url>            Player API of a running game (default ${DEFAULTS.url})
  --spawn                Start a throwaway game server instead of attaching
  --model <id>           Cursor model for the player (default ${DEFAULTS.model})
  --reasoning <level>    Value for a model's "reasoning" parameter (e.g. high)
  --effort <level>       Value for a model's "effort" parameter (e.g. high).
                         Same axis as --reasoning under a different name: the
                         Claude models call it effort, GPT-5.6 Sol calls it
                         reasoning. Pass whichever the chosen model declares.
  --ui-events            Also print the run as tagged JSON lines on stdout, for
                         the game's AI-vs-AI screen to render
  --log-dir <dir>        Where run logs go (default blind-test/logs)
  --timeout <seconds>    Cap on the whole run (default ${DEFAULTS.timeout})
  --boot-timeout <secs>  With --spawn, how long to wait for the model (default ${DEFAULTS.bootTimeout})
  --no-final-guess       Stop before submitting the last door's password, so a
                         configured physical vault relay is never pulsed
  --system-prompt        Send the rules as the agent's system prompt instead of
                         its first message. Needs an account entitled to set
                         one; without it the backend rejects the run and the
                         harness retries the normal way.
  --login                Log the SDK in through a browser and exit
  -h, --help             This message

Auth: set CURSOR_API_KEY, or run once with --login.

The agent plays with the same rules a human gets: ten messages per door, the
door's own hints, and nothing else. It has no filesystem or shell tools, and
its working directory is an empty scratch dir, so it cannot read the level
store or this repo's README.
`

function parseArgs (argv) {
  const opts = {
    url: DEFAULTS.url,
    model: DEFAULTS.model,
    logDir: DEFAULTS.logDir,
    timeout: DEFAULTS.timeout,
    bootTimeout: DEFAULTS.bootTimeout,
    reasoning: null,
    effort: null,
    uiEvents: false,
    spawn: false,
    finalGuess: true,
    systemPrompt: false,
    login: false,
    help: false
  }
  const need = (i, flag) => {
    if (i + 1 >= argv.length) throw new Error(`${flag} needs a value`)
    return argv[i + 1]
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case '--url': opts.url = need(i, arg); i++; break
      case '--model': opts.model = need(i, arg); i++; break
      case '--reasoning': opts.reasoning = need(i, arg); i++; break
      case '--effort': opts.effort = need(i, arg); i++; break
      case '--ui-events': opts.uiEvents = true; break
      case '--log-dir': opts.logDir = path.resolve(need(i, arg)); i++; break
      case '--timeout': opts.timeout = Number(need(i, arg)); i++; break
      case '--boot-timeout': opts.bootTimeout = Number(need(i, arg)); i++; break
      case '--spawn': opts.spawn = true; break
      case '--no-final-guess': opts.finalGuess = false; break
      case '--system-prompt': opts.systemPrompt = true; break
      case '--login': opts.login = true; break
      case '-h': case '--help': opts.help = true; break
      default: throw new Error(`unknown option: ${arg}`)
    }
  }
  if (!Number.isFinite(opts.timeout) || opts.timeout <= 0) throw new Error('--timeout must be a positive number of seconds')
  if (!Number.isFinite(opts.bootTimeout) || opts.bootTimeout <= 0) throw new Error('--boot-timeout must be a positive number of seconds')
  return opts
}

function freePort () {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// The repo's own Bare, when it has one. A globally installed `bare` can be
// older than the app expects — v1.20 has no `URL.searchParams`, which takes
// out /api/state — and a test harness silently exercising a different runtime
// than `npm start` is worse than no harness.
function bareBinary () {
  const local = path.join(REPO_ROOT, 'node_modules', '.bin', 'bare')
  return fs.existsSync(local) ? local : 'bare'
}

// A throwaway server on its own port and data dir, so a blind run cannot
// disturb a real player's progress or reach a physical relay.
async function spawnServer ({ logger, bootTimeoutMs }) {
  const port = await freePort()
  const dataDir = path.join(BLIND_TEST_DIR, '.tmp-data')
  fs.rmSync(dataDir, { recursive: true, force: true })

  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', VAULT_DATA_DIR: dataDir }
  delete env.DOOR_URL // never pulse a real lock from a test run
  delete env.DOOR_MODE
  delete env.FREE_ROAM // free roam would let the agent skip doors

  const logPath = path.join(logger.dir, 'server.log')
  const out = fs.openSync(logPath, 'a')
  // Detached, so the server gets its own process group. See stopServer().
  const child = spawn(bareBinary(), ['src/server.js'], { cwd: REPO_ROOT, env, stdio: ['ignore', out, out], detached: true })

  const url = `http://127.0.0.1:${port}`
  console.log(`[blind-test] spawned game server on ${url} (log: ${logPath})`)
  logger.event('server_spawned', { url, pid: child.pid, dataDir })

  let exited = null
  child.on('exit', (code, signal) => { exited = { code, signal } })

  const probe = new GameClient(url)
  const deadline = Date.now() + bootTimeoutMs
  while (Date.now() < deadline) {
    if (exited) throw new Error(`game server exited before it was ready (code ${exited.code}); see ${logPath}`)
    if (await probe.ping()) return { url, child }
    await sleep(1000)
  }
  await stopServer(child)
  throw new Error(`game server did not come up within ${Math.round(bootTimeoutMs / 1000)}s; see ${logPath}`)
}

// `node_modules/.bin/bare` is a Node launcher that installs no-op signal
// handlers and runs the real runtime as its own child, so a SIGTERM addressed
// to the launcher's pid is swallowed and the server — with a multi-gigabyte
// model loaded — survives the harness. Signal the whole process group instead,
// which is why the child is spawned detached.
async function stopServer (child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise(resolve => child.once('exit', resolve))
  const signal = (sig) => {
    try { process.kill(-child.pid, sig) } catch { try { child.kill(sig) } catch {} }
  }
  signal('SIGTERM')
  // The game unloads its model on SIGTERM; give it a moment before insisting.
  const kill = setTimeout(() => signal('SIGKILL'), 8000)
  await exited
  clearTimeout(kill)
}

// Module-level so the last-resort catch at the bottom can still tell a watching
// browser why the run never happened. Off until --ui-events says otherwise.
let reporter = createReporter(false)

function printSummary (summary) {
  console.log('\n─── blind test summary ───')
  console.log(`model:    ${summary.model}`)
  console.log(`outcome:  ${summary.outcome}`)
  console.log(`cleared:  ${summary.doorsCleared}/${summary.doorsTotal} doors`)
  for (const door of summary.doors) {
    const guesses = door.guesses.map(g => `${g.word}${g.correct ? '*' : ''}`).join(', ') || '—'
    const blocks = Object.entries(door.blocked).filter(([, n]) => n > 0).map(([k, n]) => `${k}:${n}`).join(' ') || 'none'
    console.log(`  door ${door.door} (${door.name}): ${door.solved ? 'solved' : 'not solved'} — ${door.messages} messages, blocks ${blocks}, guesses ${guesses}`)
  }
  console.log(`logs:     ${summary.logDir}`)
}

async function main () {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    console.log(USAGE)
    return 0
  }
  if (opts.login) {
    const result = await Cursor.auth.login()
    console.log(`[blind-test] logged in${result.email ? ` as ${result.email}` : ''}`)
    return 0
  }

  reporter = createReporter(opts.uiEvents)
  const apiKey = await resolveApiKey()
  const logger = new RunLogger(opts.logDir)
  console.log(`[blind-test] logging to ${logger.dir}`)

  let server = null
  let url = opts.url
  try {
    if (opts.spawn) {
      server = await spawnServer({ logger, bootTimeoutMs: opts.bootTimeout * 1000 })
      url = server.url
      // Detached means Ctrl-C in this terminal never reaches the server, so an
      // abandoned run would leave it holding the port and the model.
      for (const sig of ['SIGINT', 'SIGTERM']) {
        process.once(sig, () => {
          console.error(`\n[blind-test] ${sig} — stopping the spawned server`)
          stopServer(server.child).finally(() => process.exit(130))
        })
      }
    } else {
      console.log(`[blind-test] attaching to ${url}`)
      // The harness cannot see the server's env, so it cannot tell whether a
      // physical relay is wired up. Clearing the last door pulses it.
      if (opts.finalGuess) console.log('[blind-test] note: if this server has DOOR_URL set, clearing the last door will pulse the physical vault. Use --no-final-guess to stop short.')
    }

    const client = new GameClient(url)
    if (!(await client.ping())) throw new Error(`no game server answering at ${url}. Start one (npm run dev) or pass --spawn.`)

    const model = await resolveModel(opts.model, apiKey)
    // One axis, two names in the catalog: Claude Opus declares `effort`, GPT-5.6
    // Sol declares `reasoning`. Only what was asked for is sent, so a model that
    // offers neither is selected by id alone, exactly as before.
    const modelParams = [
      ...(opts.reasoning ? [{ id: 'reasoning', value: opts.reasoning }] : []),
      ...(opts.effort ? [{ id: 'effort', value: opts.effort }] : [])
    ]
    const shownParams = modelParams.map(p => ` ${p.id}=${p.value}`).join('')
    console.log(`[blind-test] player model: ${model.id}${model.resolvedFrom === 'exact' ? '' : ` (${model.resolvedFrom})`}${shownParams}`)

    const session = new GameSession({ client, logger, reporter, skipFinalGuess: !opts.finalGuess })
    const state = await session.refresh()
    const guardian = state.model?.mock ? 'MOCK model (dev)' : (state.model?.model || 'unknown')
    console.log(`[blind-test] guardian model: ${guardian}, doors: ${session.levels.length}`)
    logger.event('setup', { url, playerModel: model.id, modelParams, guardianModel: guardian, doors: session.levels.length, sessionId: client.sessionId })
    reporter.emit('run_start', {
      playerModel: model.id,
      reasoning: opts.reasoning,
      effort: opts.effort,
      guardianModel: guardian,
      doors: session.levels.length
    })

    const customTools = buildCustomTools(session, logger)
    let run = null
    let failure = null
    try {
      run = await playBlindRun({
        apiKey,
        model: model.id,
        modelParams,
        cwd: path.join(BLIND_TEST_DIR, 'workspace'),
        customTools,
        logger,
        reporter,
        timeoutMs: opts.timeout * 1000,
        useSystemPrompt: opts.systemPrompt,
        hasPlayed: () => session.summaryStats.doors.length > 0
      })
    } catch (err) {
      failure = err
    }

    const stats = session.summaryStats
    const summary = logger.summary({
      url,
      model: model.id,
      guardianModel: guardian,
      agentId: run?.agentId ?? null,
      runId: run?.runId ?? null,
      runStatus: run?.status ?? 'failed',
      runError: run?.error ?? null,
      finalReport: run?.result ?? null,
      failure: failure ? { message: failure.message, startupFailure: failure instanceof CursorAgentError } : null,
      logDir: logger.dir,
      ...stats
    })
    printSummary(summary)
    reporter.emit('run_end', {
      status: run?.status ?? 'failed',
      outcome: summary.outcome,
      doorsCleared: summary.doorsCleared,
      doorsTotal: summary.doorsTotal,
      error: failure?.message ?? run?.error?.message ?? null
    })

    if (failure) {
      console.error(`[blind-test] ${failure instanceof CursorAgentError ? 'agent never started' : 'run failed'}: ${failure.message}`)
      return failure instanceof CursorAgentError ? 1 : 2
    }
    if (run.status === 'error') {
      console.error(`[blind-test] the agent run ended in error: ${run.error?.message || 'no detail reported'}${run.error?.code ? ` (${run.error.code})` : ''}`)
      return 2
    }
    return 0
  } finally {
    if (server) await stopServer(server.child)
  }
}

main()
  .then(code => process.exit(code))
  .catch(err => {
    // Nothing was played: no credentials, no server, no such model. A watching
    // browser hears the reason here or not at all.
    reporter.emit('run_end', { status: 'failed', outcome: 'never-started', error: err.message })
    console.error(`[blind-test] ${err.message}`)
    process.exit(1)
  })
