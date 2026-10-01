const $ = (id) => document.getElementById(id)
const S = { demos: [], busy: new Set(), errors: {} }

const STATE = {
  ready: 'Ready',
  running: 'Running',
  starting: 'Starting',
  missing: 'Needs setup',
  error: 'Stopped with an error'
}

async function api (path, method = 'GET') {
  const res = await fetch(path, { method, headers: method === 'POST' ? { 'content-type': 'application/json' } : {}, body: method === 'POST' ? '{}' : undefined })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  return body
}

function stateOf (d) {
  if (S.busy.has(d.id)) return 'starting'
  if (d.running) return 'running'
  if (!d.ready) return 'missing'
  if (d.crashed) return 'error'
  return 'ready'
}

function button (cls, text, onClick) {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = cls
  b.textContent = text
  b.addEventListener('click', onClick)
  return b
}

function card (d) {
  const st = stateOf(d)
  const el = document.createElement('article')
  el.className = `card ${st}`
  el.setAttribute('aria-labelledby', `t-${d.id}`)

  const head = document.createElement('div')
  head.className = 'card-head'
  const tag = document.createElement('span')
  tag.className = 'tag'
  tag.textContent = d.tag
  const state = document.createElement('span')
  state.className = `state ${st}`
  state.innerHTML = '<span class="dot" aria-hidden="true"></span>'
  state.append(STATE[st])
  head.append(tag, state)

  const h = document.createElement('h2')
  h.id = `t-${d.id}`
  h.textContent = d.name
  const p = document.createElement('p')
  p.textContent = d.desc

  const actions = document.createElement('div')
  actions.className = 'actions'
  const label = d.kind === 'web' ? 'Open' : 'Launch'
  const go = button('primary', label, () => open(d))
  go.disabled = !d.ready || st === 'starting'
  actions.append(go)
  if (d.running) actions.append(button('secondary', 'Stop', () => stop(d)))
  if (d.hasLog) actions.append(button('link', 'Log', () => showLog(d)))
  const problem = S.errors[d.id] || (!d.ready && (d.why || 'Run npm run setup first'))
  if (problem) {
    const why = document.createElement('span')
    why.className = S.errors[d.id] ? 'why error' : 'why'
    if (S.errors[d.id]) why.setAttribute('role', 'alert')
    why.textContent = problem
    actions.append(why)
  }

  el.append(head, h, p, actions)
  return el
}

function render () {
  $('grid').replaceChildren(...S.demos.map(card))
  $('empty').hidden = S.demos.length > 0
  const ready = S.demos.filter((d) => d.ready).length
  const running = S.demos.filter((d) => d.running).length
  const total = S.demos.length
  $('summary').textContent = ready === total
    ? `${total} demos ready, offline${running ? `. ${running} running` : ''}`
    : `${ready} of ${total} demos ready. Run npm run setup for the rest`
  $('stop-all').hidden = running === 0
}

let lastSeen = ''
async function refresh () {
  try {
    const { demos } = await api('/api/demos')
    // Redraw only on a change: a redraw every 2 s would throw away keyboard focus.
    const seen = JSON.stringify(demos) + [...S.busy].join() + JSON.stringify(S.errors)
    if (seen === lastSeen) return
    lastSeen = seen
    S.demos = demos
    render()
  } catch {
    $('summary').textContent = 'The dashboard server stopped'
  }
}

async function open (d) {
  delete S.errors[d.id]
  if (d.kind === 'web' && d.running && d.url) { window.open(d.url, '_blank', 'noopener'); render(); return }
  S.busy.add(d.id)
  render()
  // Open the tab inside the click, before awaiting, or the browser blocks it as a popup.
  const tab = d.kind === 'web' ? window.open('about:blank', '_blank') : null
  try {
    const res = await api(`/api/demos/${d.id}/start`, 'POST')
    if (tab && res.url) tab.location.href = res.url
    else if (tab) tab.close()
  } catch (err) {
    if (tab) tab.close()
    S.errors[d.id] = err.message
  } finally {
    S.busy.delete(d.id)
    refresh()
  }
}

async function stop (d) {
  delete S.errors[d.id]
  try { await api(`/api/demos/${d.id}/stop`, 'POST') } finally { refresh() }
}

async function showLog (d) {
  $('logs-title').textContent = `${d.name}: log`
  try {
    const { lines } = await api(`/api/demos/${d.id}/log`)
    $('logs-body').textContent = lines.length ? lines.join('\n') : 'Nothing logged yet.'
  } catch (err) {
    $('logs-body').textContent = err.message
  }
  $('logs').showModal()
  $('logs-body').scrollTop = $('logs-body').scrollHeight
}

$('logs-close').addEventListener('click', () => $('logs').close())
$('stop-all').addEventListener('click', async () => { await api('/api/stop-all', 'POST').catch(() => {}); refresh() })

refresh()
setInterval(refresh, 2000)
