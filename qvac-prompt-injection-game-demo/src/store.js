// Local JSON persistence under ./data — the only place state lives.
import fs from 'bare-fs'
import path from 'bare-path'
import bareProcess from 'bare-process'

const DATA_DIR = bareProcess.env.VAULT_DATA_DIR || path.join(new URL('..', import.meta.url).pathname, 'data')
const PRIVATE_DIR_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600

export function dataDir () {
  return DATA_DIR
}

export function ensureDataDir () {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true, mode: PRIVATE_DIR_MODE })
  fs.chmodSync(DATA_DIR, PRIVATE_DIR_MODE)
}

export function readJSON (name, fallback) {
  const file = path.join(DATA_DIR, name)
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'))
    fs.chmodSync(file, PRIVATE_FILE_MODE)
    return value
  } catch {
    return fallback
  }
}

export function writeJSON (name, value) {
  ensureDataDir()
  const file = path.join(DATA_DIR, name)
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: PRIVATE_FILE_MODE })
  fs.chmodSync(tmp, PRIVATE_FILE_MODE)
  fs.renameSync(tmp, file)
}
