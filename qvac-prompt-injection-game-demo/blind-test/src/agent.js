// The blind player itself: one Cursor agent, one long run, four game tools.
//
// Two things here are load-bearing for blindness. The agent's cwd is an empty
// scratch directory rather than the repo, and `tools: ['mcp']` allows the MCP
// family only — which is where custom tools live — so read, grep, shell, web
// search and the rest are never offered. Without both, the fastest route to
// every password is `src/levels.js`.
import fs from 'node:fs'
import { Agent, Cursor, CursorAgentError } from '@cursor/sdk'

import { createReporter } from './events.js'
import { SYSTEM_PROMPT, kickoffPrompt, inlinePrompt } from './prompt.js'

// The custom-tool family is the agent's whole world. Named explicitly as well
// as allowlisted, because deny wins if the allowlist ever widens.
const ALLOWED_TOOLS = ['mcp']
const DENIED_TOOLS = ['shell', 'read', 'edit', 'delete', 'grep', 'glob', 'ls', 'task', 'semSearch', 'webSearch', 'webFetch', 'applyAgentDiff']

export async function resolveApiKey () {
  if (process.env.CURSOR_API_KEY) return process.env.CURSOR_API_KEY
  const status = await Cursor.auth.status()
  if (status.status === 'logged-in') return undefined // the SDK reads its stored key
  throw new Error(
    'no Cursor credentials. Set CURSOR_API_KEY, or run this harness once with --login.\n' +
    'Note: a `cursor-agent login` session is a different credential store and is not used here.'
  )
}

// `--model claude-5` should not have to be the exact catalog slug. Resolve
// against the account's real list so a renamed model fails with the available
// names instead of an opaque backend error.
export async function resolveModel (requested, apiKey) {
  let list
  try {
    list = await Cursor.models.list(apiKey ? { apiKey } : undefined)
  } catch {
    return { id: requested, resolvedFrom: 'unverified (model list unavailable)' }
  }
  const wanted = requested.toLowerCase()
  const exact = list.find(m => m.id.toLowerCase() === wanted || (m.aliases || []).some(a => a.toLowerCase() === wanted))
  if (exact) return { id: exact.id, displayName: exact.displayName, resolvedFrom: 'exact' }

  const partial = list.find(m => m.id.toLowerCase().includes(wanted) || (m.displayName || '').toLowerCase().includes(wanted))
  if (partial) return { id: partial.id, displayName: partial.displayName, resolvedFrom: `matched "${requested}"` }

  throw new Error(`model "${requested}" is not available on this account. Available: ${list.map(m => m.id).join(', ')}`)
}

function assistantText (message) {
  return (message?.content || [])
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

// `modelParams` carries the catalog's model parameters — reasoning effort,
// context size — which are a separate axis from the id: there is no
// "claude-opus-5-5-high" to ask for, only claude-opus-5-5 with effort set to
// high.
async function createPlayer ({ apiKey, model, modelParams, cwd, customTools, withSystemPrompt }) {
  return Agent.create({
    ...(apiKey ? { apiKey } : {}),
    model: { id: model, ...(modelParams?.length ? { params: modelParams } : {}) },
    name: 'Vault Guardian blind test',
    tools: ALLOWED_TOOLS,
    disallowedTools: DENIED_TOOLS,
    ...(withSystemPrompt ? { systemPrompt: SYSTEM_PROMPT } : {}),
    local: {
      cwd,
      // Empty on purpose: the repo's own .cursor rules point at QVAC docs and
      // this project's README, which carries a Solutions section.
      settingSources: [],
      customTools
    }
  })
}

// A custom system prompt is an entitlement, not a given: without it the
// backend rejects the request with `unknown option '--system-prompt'`. That
// arrives two different ways — thrown from send(), or as the error on a run
// that reached RUNNING and then died — so both are checked.
function isSystemPromptRefusal (detail) {
  return /system[- ]prompt/i.test(detail?.message || '')
}

const STOP_SIGNALS = ['SIGINT', 'SIGTERM']
// Cancelling talks to the backend, so it can hang; the exit is not allowed to
// wait on it forever.
const CANCEL_GRACE_MS = 4000

// Handling a termination signal takes the default exit with it, so this has to
// exit itself once the run is cancelled. Returns an uninstaller for the normal
// path, where the run ended on its own.
function installRunCanceller (run, logger) {
  const onSignal = (signal) => {
    logger.event('cancelled', { signal })
    console.error(`\n[blind-test] ${signal} — cancelling the run`)
    const leave = () => process.exit(130)
    const forced = setTimeout(leave, CANCEL_GRACE_MS)
    forced.unref?.()
    if (!run.supports('cancel')) return leave()
    run.cancel().catch(() => {}).finally(() => { clearTimeout(forced); leave() })
  }
  const handlers = STOP_SIGNALS.map(sig => {
    const handler = () => onSignal(sig)
    process.once(sig, handler)
    return [sig, handler]
  })
  return () => { for (const [sig, handler] of handlers) process.removeListener(sig, handler) }
}

async function attemptRun ({ apiKey, model, modelParams, cwd, customTools, logger, reporter, timeoutMs, withSystemPrompt }) {
  let agent = null
  try {
    agent = await createPlayer({ apiKey, model, modelParams, cwd, customTools, withSystemPrompt })
    const run = await agent.send(withSystemPrompt ? kickoffPrompt() : inlinePrompt())

    logger.event('run_start', { agentId: agent.agentId, runId: run.id, model, withSystemPrompt })
    reporter.emit('player_ready', { agentId: agent.agentId, runId: run.id, model })
    console.log(`[blind-test] agent ${agent.agentId} run ${run.id} (${model})`)

    // A wedged run would otherwise hold the process open forever; a real
    // five-door run is long, so the cap is generous rather than tight.
    const timer = setTimeout(() => {
      logger.event('timeout', { timeoutMs })
      console.error(`[blind-test] timeout after ${Math.round(timeoutMs / 1000)}s — cancelling`)
      if (run.supports('cancel')) run.cancel().catch(() => {})
    }, timeoutMs)
    // The spectator server stops a run by signalling this process. A hosted run
    // left behind would keep playing — and keep spending the doors' budgets —
    // after the page that was watching it has gone, so the signal cancels the
    // run before the process leaves.
    const stopSignals = installRunCanceller(run, logger)

    try {
      // Assistant and thinking events arrive as streaming deltas — a dozen
      // fragments to a sentence. Logged one by one they shred the transcript
      // ("I", "'ll start by in", "specting the t"), so they are accumulated
      // and flushed as whole thoughts at the next boundary, which is normally
      // the tool call the thought was leading up to.
      let saying = ''
      let thinking = ''
      const flush = () => {
        if (saying.trim()) {
          logger.event('assistant', { text: saying })
          logger.transcript(`\n_player:_ ${saying.trim()}\n`)
        }
        if (thinking.trim()) logger.event('thinking', { text: thinking })
        saying = ''
        thinking = ''
      }

      for await (const event of run.stream()) {
        if (event.type === 'assistant') {
          saying += assistantText(event.message)
        } else if (event.type === 'thinking') {
          thinking += event.text ?? ''
        } else {
          flush()
          if (event.type === 'status') logger.event('status', { status: event.status, message: event.message })
        }
      }
      flush()
      const result = await run.wait()
      // `error` is where a run that started and then died says why; without it
      // a failed run is just the word "error" in a log.
      logger.event('run_end', { status: result.status, requestId: result.requestId, error: result.error ?? null, usage: result.usage ?? null })
      return {
        agentId: agent.agentId,
        runId: run.id,
        status: result.status,
        result: result.result,
        error: result.error ?? null,
        systemPromptRefused: result.status === 'error' && isSystemPromptRefusal(result.error)
      }
    } finally {
      clearTimeout(timer)
      stopSignals()
    }
  } catch (err) {
    if (withSystemPrompt && isSystemPromptRefusal(err)) return { systemPromptRefused: true, error: { message: err.message } }
    // A thrown CursorAgentError never got as far as playing; a run that ends
    // with status "error" did play and failed. The CLI exits differently on
    // each, so the distinction is kept here.
    logger.event('run_failed', { error: err.message, startupFailure: err instanceof CursorAgentError })
    throw err
  } finally {
    await agent?.[Symbol.asyncDispose]?.()
  }
}

export async function playBlindRun ({ apiKey, model, modelParams, cwd, customTools, logger, reporter = createReporter(false), timeoutMs, useSystemPrompt = false, hasPlayed = () => false }) {
  fs.mkdirSync(cwd, { recursive: true })

  const attempt = { apiKey, model, modelParams, cwd, customTools, logger, reporter, timeoutMs }
  let outcome = await attemptRun({ ...attempt, withSystemPrompt: useSystemPrompt })

  // The refusal lands before the agent has taken a turn, so the retry starts
  // from a game that has not been played. Retrying after any move would hand
  // the second attempt a half-spent message budget, so it is not attempted.
  if (outcome.systemPromptRefused && !hasPlayed()) {
    logger.event('system_prompt_unavailable', { error: outcome.error?.message })
    console.error('[blind-test] this account cannot set a custom system prompt; retrying with the rules in the first message')
    outcome = await attemptRun({ ...attempt, withSystemPrompt: false })
  }

  if (outcome.status === undefined) {
    const err = new Error(outcome.error?.message || 'run failed before it started')
    logger.event('run_failed', { error: err.message, startupFailure: true })
    throw err
  }
  return outcome
}

export { CursorAgentError }
