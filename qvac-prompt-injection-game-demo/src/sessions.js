// Player sessions: per-browser cookie, in-memory conversations, persisted
// solve progress, and a sliding-window rate limit for password guesses.
import crypto from 'bare-crypto'
import { readJSON, writeJSON } from './store.js'

const PROGRESS_FILE = 'progress.json'
const MAX_TURNS = 20 // context discipline: cap conversation length per attempt

const sessions = new Map()
let progress = null
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function initSessions () {
  progress = readJSON(PROGRESS_FILE, {})
}

export function getSession (sid) {
  let s = sessions.get(sid)
  if (!s) {
    s = { conversations: new Map(), guesses: new Map(), messages: new Map(), hints: new Map() }
    sessions.set(sid, s)
  }
  return s
}

export function newSessionId () {
  return crypto.randomUUID()
}

export function isValidSessionId (sid) {
  return typeof sid === 'string' && SESSION_ID_RE.test(sid)
}

export function conversation (sid, levelId) {
  const s = getSession(sid)
  if (!s.conversations.has(levelId)) s.conversations.set(levelId, [])
  return s.conversations.get(levelId)
}

export function pushTurn (sid, levelId, userMsg, assistantMsg) {
  const conv = conversation(sid, levelId)
  conv.push({ role: 'user', content: userMsg }, { role: 'assistant', content: assistantMsg })
  while (conv.length > MAX_TURNS * 2) conv.shift()
}

// Deliberately leaves the message budget alone: a player may clear the
// guardian's memory as often as they like, but the messages stay spent. The
// coach's memory survives too — it is there to stop the next hint repeating
// one the player has already read.
export function resetConversation (sid, levelId) {
  getSession(sid).conversations.delete(levelId)
}

// --- coaching history (opening doors) ----------------------------------------
// What the player tried and what the coach answered, so each hint can build on
// the last instead of restating it.
const MAX_HINTS = 6

export function hintHistory (sid, levelId) {
  return getSession(sid).hints.get(levelId) || []
}

export function pushHint (sid, levelId, entry) {
  const s = getSession(sid)
  const list = s.hints.get(levelId) || []
  list.push(entry)
  while (list.length > MAX_HINTS) list.shift()
  s.hints.set(levelId, list)
}

// --- per-level message budget ------------------------------------------------
export function messagesUsed (sid, levelId) {
  return getSession(sid).messages.get(levelId) || 0
}

export function countMessage (sid, levelId) {
  const s = getSession(sid)
  const used = (s.messages.get(levelId) || 0) + 1
  s.messages.set(levelId, used)
  return used
}

// A turn that never reached the player shouldn't cost them a try.
export function refundMessage (sid, levelId) {
  const s = getSession(sid)
  const used = s.messages.get(levelId) || 0
  if (used > 0) s.messages.set(levelId, used - 1)
}

// End of a run (win or loss): forget conversations, budgets, guess windows and solves.
export function resetRun (sid) {
  sessions.delete(sid)
  if (progress) {
    delete progress[sid]
    writeJSON(PROGRESS_FILE, progress)
  }
}

// --- vault grants ------------------------------------------------------------
// Clearing the last door earns one pulse of the physical relay, but the player
// spends it by pressing the button on the closing screen. The grant is kept
// out of the session map on purpose: winning wipes the run, and the right to
// open the vault has to outlive that wipe. Single use, and short lived so a
// booth session cannot bank an unlock for later.
const vaultGrants = new Map()
const GRANT_TTL_MS = 10 * 60 * 1000

export function grantVault (sid) {
  vaultGrants.set(sid, Date.now() + GRANT_TTL_MS)
}

// Burns the grant whatever the relay then does: one win, one press.
export function consumeVaultGrant (sid) {
  const expires = vaultGrants.get(sid)
  vaultGrants.delete(sid)
  if (!expires) return false
  return expires > Date.now()
}

export function solvedLevels (sid) {
  return new Set(progress[sid] || [])
}

export function markSolved (sid, levelId) {
  const set = solvedLevels(sid)
  set.add(levelId)
  progress[sid] = [...set]
  writeJSON(PROGRESS_FILE, progress)
}

// Returns remaining guesses in the current window, or -1 if rate limited.
export function checkGuessLimit (sid, levelId, perMinute) {
  const s = getSession(sid)
  const now = Date.now()
  let times = s.guesses.get(levelId) || []
  times = times.filter(t => now - t < 60000)
  if (times.length >= perMinute) {
    s.guesses.set(levelId, times)
    return -1
  }
  times.push(now)
  s.guesses.set(levelId, times)
  return perMinute - times.length
}
