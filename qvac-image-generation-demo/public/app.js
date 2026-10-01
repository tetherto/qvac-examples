const $ = (id) => document.getElementById(id)

const STYLE_LABELS = { none: 'Any', photo: 'Photo', watercolor: 'Watercolor', anime: 'Anime', pixel: 'Pixel art', clay: 'Clay' }
const params = new URLSearchParams(location.search)
// A booth screen clears itself after this many idle seconds. ?idle=0 turns it off.
const IDLE_SECONDS = params.has('idle') ? Number(params.get('idle')) || 0 : 120

const S = {
  status: null,
  style: 'none',
  model: null, // chosen model key
  size: null,
  steps: null,
  busy: false,
  images: [],
  poll: null
}

const gb = (bytes) => (bytes / 1e9).toFixed(1)
const modelOf = (key) => S.status?.models.find((m) => m.key === key)
const current = () => modelOf(S.model)

// What the chosen model is doing right now, as one word the page can switch on.
function phaseOf (m) {
  if (!S.status?.checked) return 'checking'
  if (S.status.download?.key === m.key) return 'downloading'
  if (!m.cached) return m.error ? 'error' : 'needs-download'
  if (S.status.loading === m.key) return 'loading'
  if (m.error) return 'error'
  return S.status.loaded === m.key ? 'ready' : 'idle'
}

function renderStatus () {
  const m = current()
  if (!m) return
  const phase = phaseOf(m)
  const pill = $('pill')
  pill.classList.toggle('ready', phase === 'ready' || phase === 'idle')
  pill.classList.toggle('busy', phase === 'loading' || phase === 'downloading' || S.busy)
  $('pill-text').textContent = {
    checking: 'Checking the model',
    'needs-download': `${m.label} not downloaded`,
    downloading: `Downloading ${m.label}`,
    loading: `Loading ${m.label}`,
    ready: 'Ready, offline',
    idle: 'Ready, offline',
    error: `${m.label}: error`
  }[phase]
  $('foot-model').textContent = m.label

  const needs = phase === 'needs-download' || (phase === 'error' && !m.cached)
  $('download').hidden = !needs || Boolean(S.status.download)
  $('download').textContent = `Download ${m.label} (${gb(m.bytes)} GB)`

  if (!S.busy) {
    const d = S.status.download
    if (phase === 'downloading' && d) {
      showProgress(d.total ? d.received / d.total : null, d.label, `${gb(d.received)} / ${gb(d.total)} GB`)
    } else if (phase === 'loading') {
      showProgress(null, `Loading ${m.label}`, '')
    } else {
      $('progress').hidden = true
    }
    if (!S.images.length) {
      $('empty-text').textContent = needs ? `${m.label} runs on this computer. Download it once.`
        : phase === 'error' ? m.error
          : phase === 'downloading' || phase === 'loading' ? '' : 'Your image appears here'
    }
    if (m.error && needs) showMsg(m.error)
  }
  paintGo()

  const settled = S.status.checked && !S.status.download && !S.status.loading
  if (settled && S.poll) { clearInterval(S.poll); S.poll = null }
  if (!settled && !S.poll) S.poll = setInterval(refresh, 1000)
}

function paintGo () {
  const m = current()
  const go = $('go')
  const usable = m && m.cached && S.status?.download?.key !== m.key
  go.disabled = !usable || S.busy
  go.textContent = S.busy ? 'Generating' : 'Generate image'
  const hint = $('go-hint')
  if (!m) hint.textContent = ''
  else if (!m.cached) hint.textContent = S.status?.download?.key === m.key ? 'Downloading the model' : 'Download the model first'
  else if (S.busy) hint.textContent = ''
  else if (S.status?.loaded !== m.key && S.status?.loading !== m.key) hint.textContent = 'Loads the model first'
  else hint.textContent = m.lastSeconds ? `about ${Math.round(m.lastSeconds)} s` : ''
}

let cachedSeen = ''
async function refresh () {
  try {
    S.status = await (await fetch('/api/status')).json()
    renderStatus()
    // Redraw the model chips only when a download changed what is on disk, or every poll would
    // throw away keyboard focus and swallow clicks.
    const cached = S.status.models.map((m) => m.cached).join()
    if (cached !== cachedSeen) { cachedSeen = cached; paintModels() }
  } catch {
    $('pill-text').textContent = 'Server stopped'
  }
}

function showProgress (fraction, label, right) {
  $('progress').hidden = false
  const bar = $('bar')
  bar.parentElement.classList.toggle('pulse', fraction === null)
  bar.style.width = fraction === null ? '' : `${Math.max(2, Math.round(fraction * 100))}%`
  $('progress-label').textContent = label
  $('progress-time').textContent = right
}

function showMsg (text) {
  $('msg').textContent = text
  $('msg').hidden = !text
}

function chip (label, onClick, sub) {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'chip'
  b.textContent = label
  if (sub) {
    const s = document.createElement('span')
    s.className = 'sub'
    s.textContent = sub
    b.append(s)
  }
  b.addEventListener('click', onClick)
  return b
}

// A radio group of chips: arrow keys move the choice, one chip in the tab order.
function radioGroup (el, items, selected, onPick) {
  el.replaceChildren(...items.map((it) => {
    const b = chip(it.label, () => onPick(it.value), it.sub)
    b.setAttribute('role', 'radio')
    b.dataset.value = String(it.value)
    const on = String(it.value) === String(selected)
    b.setAttribute('aria-checked', String(on))
    b.tabIndex = on ? 0 : -1
    return b
  }))
  el.onkeydown = (e) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return
    const i = items.findIndex((it) => String(it.value) === String(selected))
    const next = items[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]
    onPick(next.value)
    el.querySelector(`[data-value="${next.value}"]`)?.focus()
    e.preventDefault()
  }
}

function paintStyles () {
  radioGroup($('styles'), S.status.styles.map((k) => ({ value: k, label: STYLE_LABELS[k] || k })), S.style, (v) => { S.style = v; paintStyles() })
}

function paintModels () {
  radioGroup($('models'), S.status.models.map((m) => ({ value: m.key, label: m.label, sub: m.cached ? '' : `${gb(m.bytes)} GB` })), S.model, pickModel)
}

function paintSettings () {
  const m = current()
  const range = $('steps')
  range.min = m.steps.min
  range.max = m.steps.max
  range.value = S.steps
  $('steps-out').textContent = String(S.steps)
  radioGroup($('sizes'), m.sizes.map((px) => ({ value: px, label: `${px} px` })), S.size, (v) => { S.size = v; paintSettings() })
}

// A new model brings its own defaults: its native size and its usual number of steps.
function pickModel (key) {
  S.model = key
  const m = current()
  S.size = m.size
  S.steps = m.steps.value
  showMsg('')
  paintModels()
  paintSettings()
  renderStatus()
}

function resetSettings () {
  $('seed').value = ''
  pickModel(S.status.defaultModel)
}

function showImage (i) {
  const im = S.images[i]
  const img = $('result')
  img.src = im.url
  img.alt = im.prompt
  img.hidden = false
  $('empty').hidden = true
  $('meta').hidden = false
  $('meta').textContent = `${im.label} · ${im.size} px · ${im.steps} steps · seed ${im.seed} · ${im.seconds} s`
  for (const [n, t] of [...$('thumbs').children].entries()) t.setAttribute('aria-current', String(n === i))
}

function addImage (im) {
  S.images.unshift(im)
  if (S.images.length > 12) S.images.pop()
  $('thumbs').replaceChildren(...S.images.map((x, i) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'thumb'
    b.setAttribute('aria-label', `Show: ${x.prompt}`)
    const t = document.createElement('img')
    t.src = x.url
    t.alt = ''
    b.append(t)
    b.addEventListener('click', () => showImage(i))
    return b
  }))
  $('session-wrap').hidden = false
  showImage(0)
}

// Server-sent events over a POST: read the stream and split on blank lines.
async function readEvents (res, onEvent) {
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let cut
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, cut)
      buf = buf.slice(cut + 2)
      const ev = /^event: (.+)$/m.exec(block)
      const data = /^data: (.+)$/m.exec(block)
      if (ev && data) onEvent(ev[1], JSON.parse(data[1]))
    }
  }
}

async function generate (e) {
  e.preventDefault()
  const prompt = $('prompt').value.trim()
  if (!prompt) { showMsg('Write what you want to see, or pick an idea.'); $('prompt').focus(); return }
  if (S.busy) return
  const seedText = $('seed').value.trim()
  const seed = seedText === '' ? null : Number(seedText)
  if (seed !== null && !(Number.isInteger(seed) && seed >= 0 && seed < 2 ** 31)) {
    showMsg('The seed is a whole number from 0 to 2147483647, or empty for a random one.')
    $('seed').focus()
    return
  }
  S.busy = true
  showMsg('')
  paintGo()
  const t0 = performance.now()
  let timer = null
  let fraction = 0
  let label = 'Starting'
  const tick = () => showProgress(fraction, label, `${((performance.now() - t0) / 1000).toFixed(0)} s`)
  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, style: S.style, model: S.model, size: S.size, steps: S.steps, seed })
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      showMsg(body.error || 'That did not work. Try again.')
      return
    }
    timer = setInterval(tick, 250)
    await readEvents(res, (ev, data) => {
      if (ev === 'queued' && data.loading) { label = `Loading ${data.loading}`; fraction = null }
      else if (ev === 'queued' && data.ahead > 0) label = data.ahead === 1 ? '1 image ahead of yours' : `${data.ahead} images ahead of yours`
      if (ev === 'loading') { label = `Loading ${data.label}`; fraction = null }
      if (ev === 'start') { label = 'Drawing'; fraction = 0.04 }
      if (ev === 'step') { label = `Step ${data.step} of ${data.total}`; fraction = data.step / data.total }
      if (ev === 'done') addImage({ ...data, prompt })
      if (ev === 'fail') showMsg(data.error)
      tick()
    })
  } catch {
    showMsg('Lost the connection to the app. Is it still running?')
  } finally {
    clearInterval(timer)
    S.busy = false
    $('progress').hidden = true
    refresh()
  }
}

// Booth reset: a new visitor finds an empty field, default settings and no previous images.
let idleTimer = null
function resetIdle () {
  if (!IDLE_SECONDS) return
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    if (S.busy) return resetIdle()
    $('prompt').value = ''
    S.images = []
    S.style = 'none'
    paintStyles()
    resetSettings()
    $('settings').open = false
    $('thumbs').replaceChildren()
    $('session-wrap').hidden = true
    $('meta').hidden = true
    $('result').hidden = true
    $('empty').hidden = false
    showMsg('')
    renderStatus()
  }, IDLE_SECONDS * 1000)
}
for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, resetIdle, { passive: true })

$('form').addEventListener('submit', generate)
$('prompt').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('form').requestSubmit() }
})
$('steps').addEventListener('input', () => {
  S.steps = Number($('steps').value)
  $('steps-out').textContent = String(S.steps)
})
$('reset').addEventListener('click', resetSettings)
$('download').addEventListener('click', async () => {
  showMsg('')
  const res = await fetch('/api/download', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: S.model }) })
  if (!res.ok) showMsg((await res.json().catch(() => ({}))).error || 'The download did not start.')
  refresh()
})

try {
  S.status = await (await fetch('/api/status')).json()
  $('ideas').replaceChildren(...S.status.ideas.map((idea) => chip(idea, () => {
    $('prompt').value = idea
    $('prompt').focus()
    showMsg('')
  })))
  paintStyles()
  cachedSeen = S.status.models.map((m) => m.cached).join()
  pickModel(S.status.defaultModel) // renderStatus inside starts polling if the server is still busy
} catch {
  $('pill-text').textContent = 'Server stopped'
}
