// Copies the sample bloodwork out of the repo to somewhere you can actually
// find in a file dialog, so a demo can start on the empty welcome screen and
// go through the real Import button rather than the shortcut link.
//
//   npm run demo:csv                 -> ~/Desktop/qvac-biomarkers-demo.csv
//   npm run demo:csv -- ~/somewhere  -> a directory, or a full file path
//
// It also re-reads the file it just wrote and reports what the app will make
// of it, so a broken export cannot sit around waiting to spoil a demo.

import { copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'

const SOURCE = resolve(import.meta.dirname, '..', 'sample-bloodwork.csv')
const DEFAULT_NAME = 'qvac-biomarkers-demo.csv'

/** A directory argument keeps the default name; a .csv argument is the file. */
async function destination(arg) {
  if (!arg) return join(homedir(), 'Desktop', DEFAULT_NAME)
  const expanded = arg.startsWith('~') ? join(homedir(), arg.slice(1)) : arg
  const path = resolve(expanded)
  if (extname(path).toLowerCase() === '.csv') return path
  const dir = await stat(path).catch(() => null)
  if (dir?.isDirectory()) return join(path, DEFAULT_NAME)
  return path.endsWith('/') ? join(path, DEFAULT_NAME) : `${path}.csv`
}

const target = await destination(process.argv[2])
await mkdir(dirname(target), { recursive: true })
await copyFile(SOURCE, target)

// Read it back the way the importer does, and say what it found.
const text = await readFile(target, 'utf8')
const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '')
const header = lines[0].split(',')
const dates = header.slice(3)
const values = lines
  .slice(1)
  .reduce((n, line) => n + line.split(',').slice(3).filter((c) => c.trim() !== '').length, 0)

console.log(`Wrote ${target}`)
console.log(`  ${lines.length - 1} markers, ${dates.length} test dates, ${values} values`)
console.log(`  dates: ${dates.join('  ')}`)
console.log('')
console.log('To demo the full import:')
console.log('  1. npm run dev:fresh          (starts empty, leaves your real data alone)')
console.log('  2. Import your bloodwork CSV  (pick the file above)')
