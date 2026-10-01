const $ = (id) => document.getElementById(id)

const STYLE_LABELS = { none: 'Any', photo: 'Photo', watercolor: 'Watercolor', anime: 'Anime', pixel: 'Pixel art', clay: 'Clay' }
const params = new URLSearchParams(location.search)
// A booth screen clears itself after this many idle seconds. ?idle=0 turns it off.
const IDLE_SECONDS = params.has('idle') ? Number(params.get('idle')) || 0 : 120

const S = { phase: 'checking', style: 'none', busy: false, images: [], current: -1, lastSeconds: null, poll: null }

function gb (bytes) { return (bytes / 1e9).toFixed(1) }

function renderStatus (st) {
  S.phase = st.phase
  S.lastSeconds = st.lastSeconds ?? S.lastSeconds
  const pill = $('pill')
  pill.classList.toggle('ready', st.phase === 'ready')
  pill.classList.toggle('busy', st.phase === 'loading' || st.phase === 'downloading' || S.busy)
  const text = {
    checking: 'Checking the model',
    'needs-download': 'Model not downloaded',
    downloading: 'Downloading the model',
    loading: 'Warming up the model',
    ready: 'Ready, offline',
    error: 'Model error'
  }[st.phase] || st.phase
  $('pill-text').textContent = text

  const needs = st.phase === 'needs-download'
  $('download').hidden = !needs
  $('download').textContent = `Download ${gb(st.totalBytes)} GB`

  if (!S.busy) {
    if (st.phase === 'downloading' && st.download) {
      showProgress(st.download.received / st.download.total, `${st.download.label}`, `${gb(st.download.received)} / ${gb(st.download.total)} GB`)
    } else if (st.phase === 'loading') {
      showProgress(null, 'Warming up the model', '')
    } else {
      $('progress').hidden = true
    }
    $('empty-text').textContent = needs ? 'The model runs on this computer. Download it once.'
      : st.phase === 'error' ? (st.error || 'The model did not load.')
        : st.phase === 'downloading' || st.phase === 'loading' ? '' : 'Your image appears here'
    if (st.error && needs) showMsg(st.error)
  }
  paintGo()

  const settled = st.phase === 'ready' || st.phase === 'needs-download' || st.phase === 'error'
  if (settled && S.poll) { clearInterval(S.poll); S.poll = null }
  if (!settled && !S.poll) S.poll = setInterval(refresh, 1000)
}

function paintGo () {
  const ready = S.phase === 'ready' || S.phase === 'loading'
  const go = $('go')
  go.disabled = !ready || S.busy
  go.textContent = S.busy ? 'Generating' : 'Generate image'
  const hint = $('go-hint')
  if (!ready) hint.textContent = S.phase === 'downloading' ? 'Downloading the model' : 'Download the model first'
  else if (S.busy) hint.textContent = ''
  else hint.textContent = S.lastSeconds ? `about ${Math.round(S.lastSeconds)} s` : ''
}

async function refresh () {
  try {
    const r = await fetch('/api/status')
    renderStatus(await r.json())
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

function chip (label, onClick) {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'chip'
  b.textContent = label
  b.addEventListener('click', onClick)
  return b
}

function paintStyles () {
  for (const b of $('styles').children) {
    const on = b.dataset.style === S.style
    b.setAttribute('aria-checked', String(on))
    b.tabIndex = on ? 0 : -1
  }
}

function buildChips (st) {
  $('ideas').replaceChildren(...st.ideas.map((idea) => chip(idea, () => {
    $('prompt').value = idea
    $('prompt').focus()
    showMsg('')
  })))
  $('styles').replaceChildren(...st.styles.map((key) => {
    const b = chip(STYLE_LABELS[key] || key, () => { S.style = key; paintStyles() })
    b.dataset.style = key
    b.setAttribute('role', 'radio')
    return b
  }))
  $('styles').addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return
    const keys = st.styles
    const i = keys.indexOf(S.style)
    const next = keys[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : keys.length - 1)) % keys.length]
    S.style = next
    paintStyles()
    $('styles').querySelector(`[data-style="${next}"]`).focus()
    e.preventDefault()
  })
  paintStyles()
}

function showImage (i) {
  S.current = i
  const img = $('result')
  img.src = S.images[i].url
  img.alt = S.images[i].prompt
  img.hidden = false
  $('empty').hidden = true
  for (const [n, t] of [...$('thumbs').children].entries()) t.setAttribute('aria-current', String(n === i))
}

function addImage (url, prompt) {
  S.images.unshift({ url, prompt })
  if (S.images.length > 12) S.images.pop()
  $('thumbs').replaceChildren(...S.images.map((im, i) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'thumb'
    b.setAttribute('aria-label', `Show: ${im.prompt}`)
    const t = document.createElement('img')
    t.src = im.url
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
  S.busy = true
  showMsg('')
  paintGo()
  const t0 = performance.now()
  let timer = null
  let fraction = 0
  const tick = (label) => {
    const s = (performance.now() - t0) / 1000
    showProgress(fraction, label, `${s.toFixed(0)} s`)
  }
  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, style: S.style })
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      showMsg(body.error || 'That did not work. Try again.')
      return
    }
    let label = 'Starting'
    timer = setInterval(() => tick(label), 250)
    await readEvents(res, (ev, data) => {
      if (ev === 'queued' && data.ahead > 0) label = data.ahead === 1 ? '1 image ahead of yours' : `${data.ahead} images ahead of yours`
      if (ev === 'start') { label = 'Drawing'; fraction = 0.04 }
      if (ev === 'step') { label = `Step ${data.step} of ${data.total}`; fraction = data.step / data.total }
      if (ev === 'done') { S.lastSeconds = data.seconds; addImage(data.url, prompt) }
      if (ev === 'fail') showMsg(data.error)
      tick(label)
    })
  } catch {
    showMsg('Lost the connection to the app. Is it still running?')
  } finally {
    clearInterval(timer)
    S.busy = false
    $('progress').hidden = true
    paintGo()
  }
}

// Booth reset: a new visitor finds an empty field and no previous images.
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
    $('thumbs').replaceChildren()
    $('session-wrap').hidden = true
    $('result').hidden = true
    $('empty').hidden = false
    showMsg('')
  }, IDLE_SECONDS * 1000)
}
for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, resetIdle, { passive: true })

$('form').addEventListener('submit', generate)
$('prompt').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('form').requestSubmit() }
})
$('download').addEventListener('click', async () => {
  showMsg('')
  await fetch('/api/download', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  refresh()
  if (!S.poll) S.poll = setInterval(refresh, 1000)
})

const first = await fetch('/api/status').then((r) => r.json()).catch(() => null)
if (first) { buildChips(first); renderStatus(first) } else $('pill-text').textContent = 'Server stopped'
