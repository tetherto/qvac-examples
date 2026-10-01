// Download one file that is not a QVAC registry model (the Realtime Vision detectors), check its
// SHA-256, and move it into place only when the hash matches.
//   node bin/fetch-file.mjs <url> <destination> <sha256>
// QVAC_FILES_FROM=/some/folder copies a file of the same name from that folder instead, for a
// machine with no connection or a copy already on a USB stick. The hash is checked either way.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

const [url, dest, sha] = process.argv.slice(2)
if (!url || !dest || !/^[a-f0-9]{64}$/.test(sha || '')) {
  console.error('usage: node bin/fetch-file.mjs <url> <destination> <sha256>')
  process.exit(2)
}

function hashOf (file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256')
    fs.createReadStream(file).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject)
  })
}

const name = path.basename(dest)
const part = `${dest}.part`
fs.mkdirSync(path.dirname(dest), { recursive: true })

if (fs.existsSync(dest) && await hashOf(dest) === sha) {
  console.log(`${name}: already in place`)
  process.exit(0)
}

const local = process.env.QVAC_FILES_FROM && path.join(process.env.QVAC_FILES_FROM, name)
if (local && fs.existsSync(local)) {
  console.log(`${name}: copying from ${process.env.QVAC_FILES_FROM}`)
  fs.copyFileSync(local, part)
} else {
  console.log(`${name}: downloading`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) {
    console.error(`${name}: download failed, HTTP ${res.status}`)
    process.exit(1)
  }
  const total = Number(res.headers.get('content-length')) || 0
  let got = 0
  let last = 0
  const body = Readable.fromWeb(res.body)
  body.on('data', (c) => {
    got += c.length
    if (total && Date.now() - last > 3000) {
      last = Date.now()
      console.log(`${name}: ${Math.round((got / total) * 100)}%`)
    }
  })
  await pipeline(body, fs.createWriteStream(part))
}

const got = await hashOf(part)
if (got !== sha) {
  fs.rmSync(part, { force: true })
  console.error(`${name}: SHA-256 mismatch (got ${got.slice(0, 12)}, expected ${sha.slice(0, 12)}). Not installed.`)
  process.exit(1)
}
fs.renameSync(part, dest)
console.log(`${name}: verified and installed`)
