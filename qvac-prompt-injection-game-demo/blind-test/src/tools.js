// The agent's entire view of the game. Four tools over the public player API,
// and nothing else: no filesystem, no shell, no level store. Every field the
// agent can see is listed here, so a new public field cannot quietly widen
// what a "blind" player knows.
//
// Doors are addressed by 1-based number rather than level id. The player UI
// numbers them the same way, and it saves the agent copying opaque ids between
// calls.
//
// Every tool also reports what it did to the run's reporter, which is how the
// AI-vs-AI screen watches a run. Reporting is off unless someone asked for it,
// and it never changes what the agent is told.
import { createReporter, paced } from './events.js'

const GUESS_WINDOW_MS = 61_000 // The server's guess limit is per level, per minute.

// How long the page is given to type the player's words into a field before the
// request that carries them goes out. Only spent when a spectator is watching.
const SAY_BEAT_MS = 1100
const GUESS_BEAT_MS = 1500

function publicDoor (level, index) {
  return {
    door: index + 1,
    name: level.name,
    prize: level.prize,
    hintMode: level.hintMode,
    hint: level.hint ?? null,
    unlocked: level.unlocked,
    solved: level.solved,
    maxMessages: level.maxMessages,
    messagesLeft: level.messagesLeft
  }
}

const HINT_NOTES = {
  dynamic: 'A coach writes a fresh hint after every message on this door; it arrives with the reply.',
  static: 'This door has one fixed hint, shown in game_state.',
  none: 'This door gives no hints.'
}

export class GameSession {
  constructor ({ client, logger, skipFinalGuess = false, reporter = createReporter(false) }) {
    this.client = client
    this.logger = logger
    this.skipFinalGuess = skipFinalGuess
    this.reporter = reporter
    this.levels = []
    this.doors = new Map() // door number -> per-door stats
    this.over = null // set once the run can no longer progress
    this.reported = null // last door view sent to the spectator
  }

  async refresh () {
    const state = await this.client.state()
    this.levels = state.levels || []
    this.#reportState()
    return state
  }

  // State is re-read before every tool call, so this would repeat itself all
  // run. Only a changed board is worth sending.
  #reportState () {
    if (!this.reporter.enabled) return
    const doors = this.spectatorDoors()
    const snapshot = JSON.stringify(doors)
    if (snapshot === this.reported) return
    this.reported = snapshot
    this.reporter.emit('state', { doors })
  }

  spectatorDoors () {
    return this.levels.map(publicDoor)
  }

  #stats (door, name) {
    if (!this.doors.has(door)) {
      this.doors.set(door, { door, name, messages: 0, blocked: { input: 0, output: 0, guardModel: 0 }, guesses: [], solved: false })
    }
    return this.doors.get(door)
  }

  // Doors are resolved against fresh state so `messagesLeft` and `solved` in a
  // tool result are never a stale read.
  async #resolve (door) {
    await this.refresh()
    const index = Number(door) - 1
    const level = this.levels[index]
    if (!level) throw new Error(`no door ${door}; this run has ${this.levels.length} doors`)
    // The page follows the player from door to door; every tool that touches a
    // door says which one first, so the board is already open when the move
    // arrives.
    this.reporter.emit('focus', { door: index + 1, name: level.name })
    return { level, index }
  }

  #isFinalDoor (index) {
    if (index !== this.levels.length - 1) return false
    return this.levels.every((l, i) => i === index || l.solved)
  }

  get summaryStats () {
    return {
      doorsTotal: this.levels.length,
      doorsCleared: [...this.doors.values()].filter(d => d.solved).length,
      outcome: this.over ?? 'incomplete',
      doors: [...this.doors.values()]
    }
  }

  // --- tools ---------------------------------------------------------------

  async state () {
    const state = await this.refresh()
    const doors = this.levels.map(publicDoor)
    for (const d of doors) d.hintNote = HINT_NOTES[d.hintMode] ?? ''
    return {
      doors,
      guardianModel: state.model?.model ?? null,
      mockModel: !!state.model?.mock,
      runOver: this.over
    }
  }

  async chat (door, message) {
    if (this.over) return { refused: true, reason: `the run is over (${this.over})` }
    const { level, index } = await this.#resolve(door)
    if (!level.unlocked) return { refused: true, reason: `door ${door} is locked; clear the door before it first` }
    if (level.solved) return { refused: true, reason: `door ${door} is already solved; move to the next one` }
    if (level.messagesLeft <= 0) {
      return { refused: true, reason: `no messages left on door ${door}; you can still submit a guess`, messagesLeft: 0 }
    }

    const stats = this.#stats(index + 1, level.name)
    const at = index + 1
    this.reporter.emit('say', { door: at, message })
    await paced(this.reporter, SAY_BEAT_MS)
    const turn = await this.client.chat(level.id, message, (event, data) => {
      if (event === 'token') this.reporter.emit('reply_token', { door: at, token: data.token ?? '' })
      else if (event === 'message') this.reporter.emit('reply_text', { door: at, text: data.text ?? '' })
      else if (event === 'coaching') this.reporter.emit('coaching', { door: at })
    })
    this.reporter.emit('reply', {
      door: at,
      text: turn.reply,
      blockedAt: turn.blockedAt ?? null,
      messagesLeft: turn.messagesLeft ?? null,
      hint: turn.hint ?? null,
      error: turn.ok ? null : (turn.error || 'model error')
    })
    stats.messages += 1
    if (turn.blockedAt && stats.blocked[turn.blockedAt] !== undefined) stats.blocked[turn.blockedAt] += 1

    this.logger.event('chat', { door: index + 1, message, ...turn })
    this.logger.transcript(
      `## Door ${index + 1} — ${level.name} (message ${stats.messages})\n\n` +
      `**Player:** ${message}\n\n` +
      `**Guardian:** ${turn.reply || '(nothing)'}\n\n` +
      (turn.blockedAt ? `_blocked at: ${turn.blockedAt}_\n\n` : '') +
      (turn.hint ? `_hint:_ ${turn.hint}\n\n` : '') +
      (turn.error ? `_error:_ ${turn.error}\n\n` : '')
    )

    if (!turn.ok) return { error: turn.error, messagesLeft: turn.messagesLeft }
    return {
      reply: turn.reply,
      hint: turn.hint,
      // Which wall stopped the turn, or null when the reply came through
      // untouched. An input block spends the message; an output or
      // guard-model block is refunded by the server.
      blockedAt: turn.blockedAt,
      messagesLeft: turn.messagesLeft,
      hintPromisedButMissing: turn.coachingPromised && !turn.hint
    }
  }

  async guess (door, word) {
    if (this.over) return { refused: true, reason: `the run is over (${this.over})` }
    const { level, index } = await this.#resolve(door)
    if (!level.unlocked) return { refused: true, reason: `door ${door} is locked` }
    if (this.skipFinalGuess && this.#isFinalDoor(index)) {
      this.over = 'stopped-before-final-guess'
      this.logger.event('final_guess_skipped', { door: index + 1, word })
      return { refused: true, reason: 'the harness is configured not to submit the final door\'s password (it would pulse a physical lock). Stop here; the run is complete.' }
    }

    const stats = this.#stats(index + 1, level.name)
    this.reporter.emit('guess_typing', { door: index + 1, word })
    await paced(this.reporter, GUESS_BEAT_MS)
    let result = await this.client.guess(level.id, word)
    // The guess limit is per minute and costs no messages, so waiting it out
    // is cheaper than making the agent spend reasoning on it.
    if (result.rateLimited) {
      this.logger.event('guess_rate_limited', { door: index + 1 })
      await new Promise(resolve => setTimeout(resolve, GUESS_WINDOW_MS))
      result = await this.client.guess(level.id, word)
    }
    stats.guesses.push({ word, correct: !!result.correct })
    if (result.correct) stats.solved = true
    this.reporter.emit('guess_result', {
      door: index + 1,
      word,
      correct: !!result.correct,
      won: !!result.won,
      gameOver: !!result.gameOver,
      reached: result.reached ?? null,
      remaining: typeof result.remaining === 'number' ? result.remaining : null,
      rateLimited: !!result.rateLimited
    })

    this.logger.event('guess', { door: index + 1, word, ...result })
    this.logger.transcript(`**Guess (door ${index + 1}):** \`${word}\` → ${result.correct ? 'CORRECT' : 'wrong'}\n`)

    if (result.gameOver) {
      this.over = 'game-over'
      this.logger.event('game_over', { door: index + 1, reached: result.reached })
      this.logger.transcript(`\n> Run over: out of messages on door ${index + 1}.\n`)
      return { correct: false, gameOver: true, reached: result.reached, note: 'the run is over; the server has wiped this session' }
    }

    if (result.correct) {
      // A final win wipes the session the same way a loss does, so /api/state
      // after this guess no longer shows the solves. Trust the flag instead.
      if (result.won) {
        this.over = 'all-doors-cleared'
        this.logger.event('won', { door: index + 1, reached: result.reached })
        this.logger.transcript('\n> All doors cleared. The server has wiped this session.\n')
        return { correct: true, allDoorsCleared: true, nextDoor: null }
      }
      await this.refresh()
      return { correct: true, allDoorsCleared: false, nextDoor: index + 2 }
    }

    if (result.rateLimited) return { correct: false, rateLimited: true, note: 'guess limit hit twice; slow down' }
    return { correct: false, guessesLeftThisMinute: result.remaining }
  }

  async reset (door) {
    if (this.over) return { refused: true, reason: `the run is over (${this.over})` }
    const { level, index } = await this.#resolve(door)
    await this.client.resetConversation(level.id)
    this.reporter.emit('reset', { door: index + 1 })
    this.logger.event('reset', { door: index + 1 })
    this.logger.transcript(`\n_(conversation reset on door ${index + 1} — messages already spent are not returned)_\n`)
    return { ok: true, messagesLeft: level.messagesLeft, note: 'the guardian forgot the conversation; spent messages are not refunded' }
  }
}

// Wraps the session as SDK custom tools. Results go back as JSON text so the
// agent reads the same structure the log records.
export function buildCustomTools (session, logger) {
  const wrap = (name, fn) => async (args) => {
    logger.event('tool_call', { name, args })
    try {
      const result = await fn(args ?? {})
      logger.event('tool_result', { name, result })
      return JSON.stringify(result)
    } catch (err) {
      logger.event('tool_error', { name, error: err.message })
      return JSON.stringify({ error: err.message })
    }
  }

  const doorArg = { type: 'number', description: 'Door number, 1-based, as reported by game_state.' }

  return {
    game_state: {
      description: 'Look at the vault: every door, whether it is unlocked or solved, its prize, how many messages you have left on it, and its hint if that door gives one.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: wrap('game_state', () => session.state())
    },
    game_chat: {
      description: 'Say one thing to the guardian of a door. Costs one of that door\'s messages. Returns the guardian\'s reply, a hint on coached doors, and which guard stopped the turn if one did.',
      inputSchema: {
        type: 'object',
        properties: { door: doorArg, message: { type: 'string', description: 'What you say to the guardian.' } },
        required: ['door', 'message'],
        additionalProperties: false
      },
      execute: wrap('game_chat', ({ door, message }) => session.chat(door, String(message ?? '')))
    },
    game_guess: {
      description: 'Submit a password for a door. Free — it does not cost a message. Returns whether it was correct.',
      inputSchema: {
        type: 'object',
        properties: { door: doorArg, password: { type: 'string', description: 'The password you think guards this door.' } },
        required: ['door', 'password'],
        additionalProperties: false
      },
      execute: wrap('game_guess', ({ door, password }) => session.guess(door, String(password ?? '')))
    },
    game_reset: {
      description: 'Make the guardian of a door forget the conversation so far. Does NOT give back messages you have already spent.',
      inputSchema: {
        type: 'object',
        properties: { door: doorArg },
        required: ['door'],
        additionalProperties: false
      },
      execute: wrap('game_reset', ({ door }) => session.reset(door))
    }
  }
}
