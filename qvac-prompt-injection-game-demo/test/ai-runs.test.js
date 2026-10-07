// The AI-vs-AI bridge, with a fake child process.
//
// Nothing here starts a hosted agent: a real run costs money and takes an hour,
// and none of what can go wrong in this module is about the model. What is
// tested is the part that is ours — who owns a run, that a second one cannot
// start, that the event stream is indexed and replayable, that every viewer
// hears it, and that a run cannot outlive the page watching it.
import bareProcess from 'bare-process'

import {
  startAiRun, stopAiRun, subscribeAiRun, aiRunStatus, aiRunConfig,
  resetAiRunsForTest, AI_RUN_INTERNALS
} from '../src/ai-runs.js'

function assert (condition, message) {
  if (!condition) throw new Error(message)
}

const pending = []
function test (name, fn) {
  pending.push([name, fn])
}

// Enough of bare-subprocess to drive the parsing and lifecycle paths: two
// readable pipes, an exit, and a record of the signals it was sent.
function fakeSpawner () {
  const spawned = []
  const spawn = (file, args, opts) => {
    const handlers = {}
    const pipe = () => {
      const listeners = []
      return { on (event, fn) { if (event === 'data') listeners.push(fn); return this }, push (text) { for (const fn of listeners) fn(Buffer.from(text)) } }
    }
    const child = {
      pid: 4242,
      file,
      args,
      opts,
      signals: [],
      stdout: pipe(),
      stderr: pipe(),
      on (event, fn) { (handlers[event] ||= []).push(fn); return this },
      emit (event, ...rest) { for (const fn of handlers[event] || []) fn(...rest) },
      kill (signal) { this.signals.push(signal) }
    }
    spawned.push(child)
    return child
  }
  return { spawn, spawned, last: () => spawned[spawned.length - 1] }
}

const line = (type, payload = {}) => AI_RUN_INTERNALS.EVENT_PREFIX + JSON.stringify({ type, ...payload }) + '\n'

function begin (sid = 'viewer-1') {
  const spawner = fakeSpawner()
  const started = startAiRun({ sid, url: 'http://127.0.0.1:8787', spawn: spawner.spawn })
  return { spawner, started, child: spawner.last() }
}

test('a run is launched with the challenger the config names', () => {
  const { started, child } = begin()
  assert(started.ok, `run did not start: ${started.error}`)
  const args = child.args.join(' ')
  const { model, effort } = aiRunConfig()
  assert(args.includes(`--model ${model}`), `expected the configured model in: ${args}`)
  assert(args.includes(`--effort ${effort}`), `expected the configured effort in: ${args}`)
  assert(args.includes('--ui-events'), 'the player must be asked for its event stream')
  assert(args.includes('--url http://127.0.0.1:8787'), 'the player needs the game URL')
  // --no-final-guess is deliberately absent: the challenger plays the last door
  // like anyone else. The relay stays shut because the grant it earns belongs to
  // its own session and nothing ever spends it.
  assert(!args.includes('--no-final-guess'), 'the challenger should play the final door')
})

test('only one run exists at a time', () => {
  const { spawner } = begin('viewer-1')
  const second = startAiRun({ sid: 'viewer-1', url: 'http://127.0.0.1:8787', spawn: spawner.spawn })
  const other = startAiRun({ sid: 'viewer-2', url: 'http://127.0.0.1:8787', spawn: spawner.spawn })
  assert(!second.ok && /already/.test(second.error), 'a second run for the same viewer should be refused')
  assert(!other.ok && /already/.test(other.error), 'a second run for another viewer should be refused')
  assert(spawner.spawned.length === 1, 'only one child should have been spawned')
})

test('a run belongs to the session that started it', () => {
  begin('viewer-1')
  assert(aiRunStatus('viewer-1').mine === true, 'the owner should see the run as theirs')
  assert(aiRunStatus('viewer-2').mine === false, 'another session should not')
  assert(aiRunStatus('viewer-2').runId === null, 'a run id is not another session\'s business')
  assert(subscribeAiRun('viewer-2', () => {}).ok === false, 'another session must not watch the run')
  assert(stopAiRun('viewer-2').ok === false, 'another session must not stop the run')
})

test('tagged lines become indexed events and untagged ones do not', () => {
  const { child } = begin()
  const seen = []
  subscribeAiRun('viewer-1', e => seen.push(e))
  child.stdout.push('[blind-test] attaching to http://127.0.0.1:8787\n')
  child.stdout.push(line('say', { door: 1, message: 'hello' }))
  child.stdout.push(line('reply', { door: 1, text: 'no' }))
  const types = seen.map(e => e.type)
  assert(!types.includes(undefined), 'a progress line must not become an event')
  assert(types.includes('say') && types.includes('reply'), `expected the tagged events, got ${types.join(',')}`)
  const indices = seen.map(e => e.i)
  assert(indices.every((n, k) => k === 0 || n > indices[k - 1]), `indices should climb: ${indices.join(',')}`)
})

test('an event split across two reads is still one event', () => {
  const { child } = begin()
  const seen = []
  subscribeAiRun('viewer-1', e => seen.push(e))
  const whole = line('say', { door: 2, message: 'a question' })
  child.stdout.push(whole.slice(0, 18))
  child.stdout.push(whole.slice(18))
  const says = seen.filter(e => e.type === 'say')
  assert(says.length === 1, `expected one say event, got ${says.length}`)
  assert(says[0].message === 'a question', 'the message should survive the split')
})

test('a malformed event line is dropped rather than thrown', () => {
  const { child } = begin()
  const seen = []
  subscribeAiRun('viewer-1', e => seen.push(e))
  child.stdout.push(AI_RUN_INTERNALS.EVENT_PREFIX + '{not json\n')
  child.stdout.push(AI_RUN_INTERNALS.EVENT_PREFIX + '{"no":"type"}\n')
  child.stdout.push(line('focus', { door: 1 }))
  assert(seen.filter(e => e.type === 'focus').length === 1, 'the good event should still arrive')
  assert(seen.every(e => typeof e.type === 'string'), 'nothing typeless should be published')
})

test('a viewer replays what it missed and nothing it did not', () => {
  const { child } = begin()
  child.stdout.push(line('say', { door: 1, message: 'first' }))
  child.stdout.push(line('reply', { door: 1, text: 'answer' }))

  const fromScratch = []
  subscribeAiRun('viewer-1', e => fromScratch.push(e)).unsubscribe()
  assert(fromScratch.some(e => e.type === 'say'), 'a fresh viewer watches from the first move')

  const last = fromScratch[fromScratch.length - 1].i
  const resumed = []
  const again = subscribeAiRun('viewer-1', e => resumed.push(e), last)
  assert(resumed.length === 0, `resuming should replay nothing, got ${resumed.length}`)
  child.stdout.push(line('guess_typing', { door: 1, word: 'MOONBEAM' }))
  assert(resumed.length === 1 && resumed[0].type === 'guess_typing', 'a resumed viewer follows along live')
  again.unsubscribe()
})

test('every viewer of a run hears every event', () => {
  const { child } = begin()
  const a = []
  const b = []
  const subA = subscribeAiRun('viewer-1', e => a.push(e))
  const subB = subscribeAiRun('viewer-1', e => b.push(e))
  child.stdout.push(line('focus', { door: 3 }))
  assert(a.some(e => e.type === 'focus') && b.some(e => e.type === 'focus'), 'both viewers should see the move')
  subA.unsubscribe()
  child.stdout.push(line('reset', { door: 3 }))
  assert(!a.some(e => e.type === 'reset'), 'an unsubscribed viewer hears nothing more')
  assert(b.some(e => e.type === 'reset'), 'the remaining viewer carries on')
  subB.unsubscribe()
})

test('stopping asks the player to cancel before it insists', () => {
  const { child } = begin()
  const seen = []
  subscribeAiRun('viewer-1', e => seen.push(e))
  const stopped = stopAiRun('viewer-1')
  assert(stopped.ok, 'the owner should be able to stop the run')
  // SIGTERM, not SIGKILL: the CLI handles it by cancelling the hosted run, which
  // is the only thing that stops it playing and spending.
  assert(child.signals[0] === 'SIGTERM', `expected SIGTERM first, got ${child.signals[0]}`)
  // Cancelling leaves a non-zero exit code behind. A run we asked to stop is not
  // a run that failed, and the viewer should not be told it was.
  child.emit('exit', 130, null)
  const exit = seen.find(e => e.type === 'run_exit')
  assert(exit.status === 'stopped', `expected a stopped run, got ${exit.status}`)
  assert(!exit.error, `a deliberate stop should carry no error, got ${exit.error}`)
})

test('a finished run reports how it ended and stops being live', () => {
  const { child } = begin()
  const seen = []
  subscribeAiRun('viewer-1', e => seen.push(e))
  child.emit('exit', 0, null)
  const exit = seen.find(e => e.type === 'run_exit')
  assert(exit && exit.status === 'finished', `expected a finished run_exit, got ${JSON.stringify(exit)}`)
  assert(aiRunStatus('viewer-1').running === false, 'a finished run is not running')
  // The ending was already in the replay, so there is nothing left to follow.
  const late = subscribeAiRun('viewer-1', () => {})
  assert(late.ok && late.live === false, 'a viewer arriving after the end gets the replay, not a subscription')
})

test('a crash reports the last thing the player said on stderr', () => {
  const { child } = begin()
  const seen = []
  subscribeAiRun('viewer-1', e => seen.push(e))
  child.stderr.push('no Cursor credentials. Set CURSOR_API_KEY\n')
  child.emit('exit', 1, null)
  const exit = seen.find(e => e.type === 'run_exit')
  assert(exit.status === 'failed', `expected a failed run, got ${exit.status}`)
  assert(/CURSOR_API_KEY/.test(exit.error), `expected the reason, got ${exit.error}`)
})

test('a child that never starts is reported, not left half-running', () => {
  const spawner = fakeSpawner()
  const started = startAiRun({ sid: 'viewer-1', url: 'http://127.0.0.1:8787', spawn: spawner.spawn })
  assert(started.ok, 'the spawn itself succeeded')
  const seen = []
  subscribeAiRun('viewer-1', e => seen.push(e))
  spawner.last().emit('error', new Error('spawn node ENOENT'))
  const exit = seen.find(e => e.type === 'run_exit')
  assert(exit && /ENOENT/.test(exit.error), `expected the spawn failure, got ${JSON.stringify(exit)}`)
  assert(aiRunStatus('viewer-1').running === false, 'a run that never started is not running')
})

test('a spawn that throws leaves no run behind', () => {
  const started = startAiRun({
    sid: 'viewer-1',
    url: 'http://127.0.0.1:8787',
    spawn: () => { throw new Error('no such runtime') }
  })
  assert(!started.ok && /no such runtime/.test(started.error), 'the failure should be reported')
  assert(aiRunStatus('viewer-1').running === false, 'a failed launch must not hold the slot')
  const retry = startAiRun({ sid: 'viewer-1', url: 'http://127.0.0.1:8787', spawn: fakeSpawner().spawn })
  assert(retry.ok, 'a retry should be allowed after a failed launch')
})

// The only thing that ends an abandoned run: a closed tab looks the same as a
// reload from the server's side, so nothing is stopped the instant a viewer
// disappears. The window is shortened here; in the app it is long enough for a
// refresh to get back and short enough that a challenger is not left playing to
// an empty room.
test('a run with nobody watching is stopped', async () => {
  resetAiRunsForTest({ idleStop: 40 })
  const { child } = begin()
  const sub = subscribeAiRun('viewer-1', () => {})
  assert(child.signals.length === 0, 'a watched run is left alone')
  sub.unsubscribe()
  assert(child.signals.length === 0, 'losing a viewer must not stop the run immediately')
  await new Promise(resolve => setTimeout(resolve, 120))
  assert(child.signals[0] === 'SIGTERM', 'an abandoned run should be stopped')
  assert(AI_RUN_INTERNALS.IDLE_STOP_MS >= 10000, 'the shipped window should outlast a reload')
})

test('a viewer coming back cancels the watchdog', async () => {
  resetAiRunsForTest({ idleStop: 40 })
  const { child } = begin()
  subscribeAiRun('viewer-1', () => {}).unsubscribe()
  subscribeAiRun('viewer-1', () => {})
  await new Promise(resolve => setTimeout(resolve, 120))
  assert(child.signals.length === 0, 'a run someone is watching again must not be stopped')
})

test('the challenger plays in its own directory, not the game\'s', () => {
  const { child } = begin()
  assert(/blind-test$/.test(child.opts.cwd), `expected the blind-test dir, got ${child.opts.cwd}`)
  assert(child.opts.stdio[0] === 'ignore', 'the player has nothing to read from stdin')
  assert(child.opts.stdio[1] === 'pipe' && child.opts.stdio[2] === 'pipe', 'both output streams must be readable')
})

async function main () {
  for (const [name, fn] of pending) {
    resetAiRunsForTest()
    try {
      await fn()
      console.log(`ok - ${name}`)
    } catch (err) {
      console.error(`not ok - ${name}: ${err.message}`)
      bareProcess.exitCode = 1
    }
  }
  resetAiRunsForTest()
  if (bareProcess.exitCode) bareProcess.exit(bareProcess.exitCode)
  console.log('ai-vs-ai bridge checks passed')
}

await main()
