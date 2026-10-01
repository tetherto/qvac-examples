// QVAC demo dashboard: one page that starts, opens and stops every demo in demos.json.
// Node built-ins only. Run `npm run setup` once (installs and downloads), then `npm start`.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadDemos, demoDir, readiness } from './lib/demos.mjs'
import { start, stop, stopAll, isRunning, crashedLast, logOf, waitForPort, portOpen, signalAllSync } from './lib/procs.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC = path.join(HERE, 'public')
const PORT = Number(process.env.PORT || 8400)

const demos = loadDemos()
const byId = new Map(demos.map((d) => [d.id, d]))
let ready = new Map()

async function refreshReadiness () {
  ready = new Map(await Promise.all(demos.map(async (d) => [d.id, await readiness(d)])))
}

function view (d) {
  const r = ready.get(d.id) || { ready: false, why: 'Checking' }
  const running = isRunning(d.id)
  return {
    id: d.id,
    name: d.name,
    tag: d.tag,
    desc: d.desc,
    kind: d.kind,
    ready: r.ready,
    why: r.why,
    running,
    crashed: crashedLast(d.id),
    hasLog: logOf(d.id).length > 0,
    url: d.kind === 'web' ? `http://localhost:${d.port}${d.path || '/'}` : null
  }
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }

function json (res, code, data) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(data))
}

// The dashboard only ever answers to this computer's own names, so a web page that rebinds its
// domain to 127.0.0.1 cannot start or stop demos or read their logs.
const OWN_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`])
function hostAllowed (req) {
  return OWN_HOSTS.has(String(req.headers.host || '').toLowerCase())
}

function sameOrigin (req) {
  const origin = req.headers.origin
  if (!origin) return true
  try { return new URL(origin).host === req.headers.host } catch { return false }
}

// Start, Stop and Stop all run one after the other, never interleaved: two quick clicks must not
// leave two demos running, and a Stop all must not be overtaken by a start in flight.
let queue = Promise.resolve()
function serialized (fn) {
  const run = queue.then(fn, fn)
  queue = run.catch(() => {})
  return run
}

async function startDemo (d) {
  const r = await readiness(d)
  ready.set(d.id, r)
  if (!r.ready) throw new Error(r.why)
  const url = d.kind === 'web' ? `http://localhost:${d.port}${d.path || '/'}` : null
  // A web demo already up just needs its tab. A desktop demo keeps running on macOS after its
  // window closes, so Launch restarts it to bring a window back.
  if (isRunning(d.id)) {
    if (d.kind === 'web') return { ok: true, url }
    await stop(d.id)
  }
  // One demo at a time. Two QVAC apps loading models at once can hang without an error, and
  // each one wants most of the memory anyway.
  for (const other of demos) {
    if (other.id !== d.id && isRunning(other.id)) await stop(other.id)
  }
  // Something this dashboard did not start (an earlier session, another app) holds the port.
  for (const port of d.ports || (d.port ? [d.port] : [])) {
    if (await portOpen(port)) throw new Error(`Port ${port} is used by another program. Quit it, then try again.`)
  }
  const entry = start(d, demoDir(d))
  if (d.kind !== 'web') return { ok: true }
  const up = await waitForPort(entry, (d.startTimeout || 60) * 1000)
  if (!up) {
    await stop(d.id)
    throw new Error(`${d.name} did not start. Open its log.`)
  }
  return { ok: true, url }
}

const server = http.createServer(async (req, res) => {
  let url
  try { url = new URL(req.url, 'http://localhost') } catch { return json(res, 400, { error: 'Bad request' }) }
  const p = url.pathname
  if (!hostAllowed(req)) return json(res, 403, { error: 'Forbidden' })

  if (req.method === 'GET') {
    if (p === '/api/demos') return json(res, 200, { demos: demos.map(view) })
    const logMatch = /^\/api\/demos\/([a-z0-9-]+)\/log$/.exec(p)
    if (logMatch && byId.has(logMatch[1])) return json(res, 200, { lines: logOf(logMatch[1]) })
    const file = p === '/' ? 'index.html' : p.slice(1)
    if (/^(assets\/)?[A-Za-z0-9._-]+$/.test(file) && !file.includes('..')) {
      return fs.readFile(path.join(PUBLIC, file), (err, buf) => {
        if (err) return json(res, 404, { error: 'Not found' })
        res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' })
        res.end(buf)
      })
    }
    return json(res, 404, { error: 'Not found' })
  }

  if (req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'Forbidden' })
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return json(res, 415, { error: 'JSON only' })
    if (p === '/api/stop-all') { await serialized(stopAll); return json(res, 200, { ok: true }) }
    const m = /^\/api\/demos\/([a-z0-9-]+)\/(start|stop)$/.exec(p)
    if (!m || !byId.has(m[1])) return json(res, 404, { error: 'Not found' })
    const d = byId.get(m[1])
    try {
      if (m[2] === 'stop') { await serialized(() => stop(d.id)); return json(res, 200, { ok: true }) }
      return json(res, 200, await serialized(() => startDemo(d)))
    } catch (err) {
      return json(res, 409, { error: err.message })
    }
  }

  json(res, 405, { error: 'Method not allowed' })
})

async function shutdown () {
  console.log('\n[dashboard] stopping every demo')
  await stopAll()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
// Closing the terminal window sends SIGHUP; the demos live in their own sessions and would not get it.
process.on('SIGHUP', shutdown)
// And if the dashboard dies any other way, still ask every demo to quit.
process.on('exit', () => signalAllSync('SIGTERM'))

await refreshReadiness()
setInterval(refreshReadiness, 15000).unref()
server.listen(PORT, '127.0.0.1', () => {
  const link = `http://localhost:${PORT}`
  const n = [...ready.values()].filter((r) => r.ready).length
  console.log(`[dashboard] ${link}  (${n} of ${demos.length} demos ready)`)
  if (!process.env.NO_OPEN && process.platform === 'darwin') execFile('open', [link], () => {})
})
