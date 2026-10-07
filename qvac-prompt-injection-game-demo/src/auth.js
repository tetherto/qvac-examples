// Admin auth: passphrase (set on first run or via ADMIN_PASSPHRASE env, never
// hardcoded) stored as a PBKDF2 hash; sessions are HMAC-signed expiring tokens.
import crypto from 'bare-crypto'
import bareProcess from 'bare-process'
import { readJSON, writeJSON } from './store.js'

const AUTH_FILE = 'auth.json'
const LEGACY_ITERATIONS = 120000
const ITERATIONS = 600000
const MIN_PASSPHRASE_LENGTH = 8
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000
const SIGNATURE_RE = /^[0-9a-f]{64}$/i
const SALT_RE = /^[0-9a-f]{32}$/i

let auth = null

function currentIterations () {
  const value = Number(auth?.iterations || LEGACY_ITERATIONS)
  return Number.isSafeInteger(value) && value >= LEGACY_ITERATIONS && value <= ITERATIONS ? value : LEGACY_ITERATIONS
}

function hashPassphrase (passphrase, salt, iterations = ITERATIONS) {
  return crypto.pbkdf2Sync(passphrase, Buffer.from(salt, 'hex'), iterations, 32, 'sha256').toString('hex')
}

export function initAuth () {
  auth = readJSON(AUTH_FILE, null)
  if (!auth) {
    auth = { salt: null, hash: null, iterations: ITERATIONS, secret: crypto.randomBytes(32).toString('hex') }
    const env = bareProcess.env.ADMIN_PASSPHRASE
    if (env) {
      if (env.length < MIN_PASSPHRASE_LENGTH) throw new Error(`ADMIN_PASSPHRASE must be at least ${MIN_PASSPHRASE_LENGTH} characters`)
      setPassphraseInternal(env)
    }
    else writeJSON(AUTH_FILE, auth)
  }
  if (!SIGNATURE_RE.test(auth.secret || '')) throw new Error('invalid admin auth secret; reset data/auth.json')
  if (auth.hash && (!SALT_RE.test(auth.salt || '') || !SIGNATURE_RE.test(auth.hash))) {
    throw new Error('invalid admin passphrase data; reset data/auth.json')
  }
}

export function needsSetup () {
  return !auth.hash
}

function setPassphraseInternal (passphrase) {
  auth.salt = crypto.randomBytes(16).toString('hex')
  auth.iterations = ITERATIONS
  auth.hash = hashPassphrase(passphrase, auth.salt)
  writeJSON(AUTH_FILE, auth)
}

// Only allowed while no passphrase exists (first-run setup screen).
export function setupPassphrase (passphrase) {
  if (!needsSetup()) return { ok: false, error: 'already configured' }
  if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    return { ok: false, error: `passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters` }
  }
  setPassphraseInternal(passphrase)
  return { ok: true }
}

const loginAttempts = []

export function verifyPassphrase (passphrase) {
  const now = Date.now()
  while (loginAttempts.length && now - loginAttempts[0] > 60000) loginAttempts.shift()
  if (loginAttempts.length >= 5) return { ok: false, error: 'too many attempts, wait a minute' }
  loginAttempts.push(now)

  if (needsSetup()) return { ok: false, error: 'admin passphrase not set yet' }
  const candidate = Buffer.from(hashPassphrase(String(passphrase), auth.salt, currentIterations()), 'hex')
  const expected = Buffer.from(auth.hash, 'hex')
  if (candidate.length !== expected.length || !crypto.timingSafeEqual(candidate, expected)) {
    return { ok: false, error: 'wrong passphrase' }
  }
  if (currentIterations() < ITERATIONS) setPassphraseInternal(String(passphrase))
  return { ok: true, token: issueToken() }
}

function sign (payload) {
  return crypto.createHmac('sha256', Buffer.from(auth.secret, 'hex')).update(payload).digest('hex')
}

function issueToken () {
  const exp = Date.now() + TOKEN_TTL_MS
  const payload = `admin.${exp}`
  return `${payload}.${sign(payload)}`
}

export function verifyToken (token) {
  if (typeof token !== 'string' || !SIGNATURE_RE.test(auth?.secret || '')) return false
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== 'admin') return false
  const exp = Number(parts[1])
  if (!Number.isSafeInteger(exp) || Date.now() > exp || !SIGNATURE_RE.test(parts[2])) return false
  const expected = sign(`${parts[0]}.${parts[1]}`)
  const a = Buffer.from(parts[2], 'hex')
  const b = Buffer.from(expected, 'hex')
  return crypto.timingSafeEqual(a, b)
}
