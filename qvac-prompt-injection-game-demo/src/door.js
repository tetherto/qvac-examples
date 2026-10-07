// Physical vault: one relay pulse when the last door falls.
//
// Talks local HTTP to an OpenBeken-flashed relay on the LAN, so the game keeps
// its offline promise — no cloud, no account, no new dependency (bare-http1 is
// already here for the server). Every call resolves; a relay that is offline,
// renumbered or mid-reboot must never break a win.
import http from 'bare-http1'
import bareProcess from 'bare-process'
import { readJSON, writeJSON } from './store.js'

const SETTINGS_FILE = 'door.json'
const URL_BASE = (bareProcess.env.DOOR_URL || '').replace(/\/+$/, '')
// off = never touch the network, dry-run = log the pulse without sending it.
const MODE = bareProcess.env.DOOR_MODE || (URL_BASE ? 'live' : 'off')
// The device's own autoexec.bat owns the pulse; this is the backstop for a
// relay that was never scripted. 0 disables the follow-up OFF entirely.
const PULSE_MS = Number(bareProcess.env.DOOR_PULSE_MS ?? 2000)
// Raise this when DOOR_URL points at the Tuya shim: a cold session handshake
// costs more than a bare OpenBeken GET, and a timeout here logs a failure for
// a door that actually opened.
const TIMEOUT_MS = Number(bareProcess.env.DOOR_TIMEOUT_MS ?? 1500)
// Progress is per browser cookie, so several booth sessions can finish at
// once. One unlock is a prize; four in a row is a chattering relay.
const COOLDOWN_MS = 10000

const ON = '/cm?cmnd=POWER%20ON'
const OFF = '/cm?cmnd=POWER%20OFF'

let lastFire = null
let lastResult = null
// Admin toggle: a win still shows the closing screen, but the relay only
// pulses when this is on. Missing file = off, so a fresh install never
// fires the door until someone turns it on in admin.
let enabled = readJSON(SETTINGS_FILE, {}).enabled === true

export function doorEnabled () {
  return enabled
}

export function setDoorEnabled (on) {
  enabled = !!on
  writeJSON(SETTINGS_FILE, { enabled })
  return enabled
}

export function doorStatus () {
  return {
    enabled,
    mode: MODE,
    url: URL_BASE || null,
    pulseMs: Number.isFinite(PULSE_MS) && PULSE_MS > 0 ? PULSE_MS : 0,
    lastFire,
    lastResult
  }
}

// Fires the unlock. `force` skips the cooldown and the admin off-switch, for
// the test button — so the relay can be bench-checked while the game is dark.
export async function openVault ({ force = false } = {}) {
  if (!force && !enabled) return finish({ ok: true, skipped: 'admin-off' }, false)
  if (MODE === 'off') return finish({ ok: false, skipped: 'disabled' }, false)
  if (!URL_BASE) return finish({ ok: false, skipped: 'no DOOR_URL' }, false)

  const now = Date.now()
  if (!force && lastFire && now - lastFire < COOLDOWN_MS) {
    return finish({ ok: false, skipped: 'cooldown' }, false)
  }

  if (MODE === 'dry-run') {
    console.log('[door] dry-run — would pulse the relay')
    return finish({ ok: true, dryRun: true }, true)
  }

  const result = await get(ON)
  if (result.ok) {
    console.log('[door] vault pulsed')
    scheduleSafetyOff()
  } else {
    console.error('[door] unlock failed:', result.error || `HTTP ${result.status}`)
  }
  return finish(result, result.ok)
}

function finish (result, fired) {
  if (fired) lastFire = Date.now()
  lastResult = { ...result, ts: Date.now() }
  return result
}

// Belt and braces. The relay is supposed to drop itself via autoexec.bat; if
// that script is missing this puts an upper bound on the coil's on-time. A
// failure here is not worth reporting — the device-side timer is the one that
// actually protects the coil.
function scheduleSafetyOff () {
  if (!Number.isFinite(PULSE_MS) || PULSE_MS <= 0) return
  const timer = setTimeout(() => { get(OFF) }, PULSE_MS + 500)
  if (typeof timer.unref === 'function') timer.unref()
}

function get (path) {
  return new Promise((resolve) => {
    let settled = false
    let req = null

    const done = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const timer = setTimeout(() => {
      try { req?.destroy() } catch {}
      done({ ok: false, error: 'timeout' })
    }, TIMEOUT_MS)

    try {
      req = http.get(URL_BASE + path, (res) => {
        // Drain, or the response never reaches 'end'.
        res.on('data', () => {})
        res.on('error', () => done({ ok: false, error: 'response error' }))
        res.on('end', () => done({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode
        }))
      })
      req.on('error', (err) => done({ ok: false, error: err.message }))
    } catch (err) {
      done({ ok: false, error: err.message })
    }
  })
}
