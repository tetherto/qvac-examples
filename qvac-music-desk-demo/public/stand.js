/**
 * Music Desk, event build. http://localhost:3055/stand
 *
 * Four screens on one page: setup (only when the models are missing), build, making, listen.
 * The whole thing exists because the full desk is the right shape for somebody who built it and
 * the wrong shape for a stranger at a stand.
 *
 * Two things worth knowing before changing anything here:
 *
 * 1. THE CAPTION IS NOT BUILT HERE. `lib/stand-styles.mjs` owns the styles and the composer, and
 *    `lib/caption.mjs` owns the ACE-Step rules. Both are imported, not copied, and
 *    `bin/compose-check.mjs` runs its gates against the same modules, so the tested composer is
 *    literally the shipped one. An earlier version kept card data in the page and a copy in the
 *    test and diffed them by hand.
 *
 * 2. THE PROMPT ON SCREEN IS THE CONFORMED ONE. The page runs `conformCaption` itself for the
 *    preview, so the keywords a visitor reads are the keywords the engine gets, including the
 *    "no vocals" the rules append and anything they drop. The server conforms again, which is
 *    idempotent.
 *
 * One thing measured and deliberately NOT fixed: an extended take comes back with the desk's
 * `clipped` flag set and a 0.0 dB peak. Measured on the sample data, that is 356 samples out of
 * 5.7 million, all of them in the new tail and none in the kept source, in runs of at most three
 * samples (0.03 ms). That is below audibility, so the flag is a tripwire rather than a verdict
 * and the stand does not act on it. Re-measure before concluding otherwise.
 *
 * Costs measured on this laptop, ACE-Step turbo-q4 on Metal, and the reason the numbers on the
 * buttons are allowed to be there: compose 30 s of audio is 11.5 s wall, 60 s is 12.4 s, a
 * restyle of an existing take is 8.0 s. The fixed cost is about 7.6 s and the marginal cost about
 * 0.08 s per second of audio, so length is nearly free and there is no point making shorter clips.
 */
import { STYLES, compose, restyleCaption } from '/lib/stand-styles.mjs'
import { conformCaption, countTags, TAG_TARGET } from '/lib/caption.mjs'

const $ = (id) => document.getElementById(id)
// A stand has to reset itself between visitors. Overridable as ?idle=<seconds> so the behaviour
// can be tested without waiting it out, and so the delay can be tuned on the day.
const IDLE_MS = Math.max(3, Number(new URLSearchParams(location.search).get('idle')) || 90) * 1000
const STAGES = [               // the engine's own stage names, said in plain words
  { key: 'load', label: 'loading' },
  { key: 'lm', label: 'arranging' },
  { key: 'dit', label: 'generating' },
  { key: 'vae', label: 'decoding' }
]

const st = {
  style: 0,
  mood: STYLES[0].moods[0],
  instrument: STYLES[0].instruments[0],
  typed: '',
  seconds: 30,
  take: null,                  // the take on the listen screen
  url: '',                     // its audio, kept so Stop can be undone
  caption: '',                 // the caption that produced it
  busy: false,
  screen: 'build'
}

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

/** What the engine will receive, and what the panel shows. */
function prompt () {
  const c = compose({
    style: STYLES[st.style], mood: st.mood, instrument: st.instrument, typed: st.typed
  })
  const conformed = conformCaption(c.caption, { instrumental: true })
  return { ...c, caption: conformed.caption, notes: conformed.notes, count: countTags(conformed.caption) }
}

function paintPrompt () {
  const p = prompt()
  const box = $('kw')
  box.textContent = ''
  p.caption.split(',').map((s) => s.trim()).forEach((w, i) => {
    if (i) box.appendChild(document.createTextNode(', '))
    // The visitor's own words are highlighted, so their contribution is visible in the result.
    if (p.mine.includes(w)) {
      const u = document.createElement('u')
      u.textContent = w
      box.appendChild(u)
    } else box.appendChild(document.createTextNode(w))
  })
  let msg = `${p.count} keywords, aim for ${TAG_TARGET.low} to ${TAG_TARGET.high}`
  if (p.over) msg += `, ${p.over} over budget`
  if (p.tooLong) msg += `, ${p.tooLong} too long to be a keyword`
  if (p.ignored) msg += `, ${p.ignored} of your words left out`
  $('kwn').textContent = msg
  return p
}

// ---------------------------------------------------------------------------
// The three rows: one control, one builder, one selected option each
// ---------------------------------------------------------------------------

const TICK = '<svg class="tick" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="currentColor" d="M9.6 16.6 5 12l1.4-1.4 3.2 3.2 8-8L19 7.2z"/></svg>'

function chip (label, pressed, onClick, colours) {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'chip'
  b.setAttribute('aria-pressed', String(pressed))
  if (colours) {
    const d = document.createElement('span')
    d.className = 'dot'
    d.style.setProperty('--c1', colours[0])
    d.style.setProperty('--c2', colours[1])
    b.appendChild(d)
  }
  b.appendChild(document.createTextNode(label))
  const t = document.createElement('template')
  t.innerHTML = TICK
  b.appendChild(t.content.firstChild)
  b.addEventListener('click', onClick)
  return b
}

function fillRow (id, labels, selected, onPick, colourFor) {
  const box = $(id)
  box.textContent = ''
  labels.forEach((label, i) => {
    box.appendChild(chip(label, label === selected, () => {
      if (label === selected) return          // one of each row is always chosen
      onPick(label, i)
    }, colourFor ? colourFor(i) : null))
  })
}

function paint () {
  const s = STYLES[st.style]
  const virgin = $('styles').classList.contains('untouched')
  fillRow('styles', STYLES.map((x) => x.name), s.name, (_, i) => {
    st.style = i
    st.mood = STYLES[i].moods[0]
    st.instrument = STYLES[i].instruments[0]
    $('styles').classList.remove('untouched')
    paint()
  }, (i) => [STYLES[i].c1, STYLES[i].c2])
  if (virgin) $('styles').classList.add('untouched')
  fillRow('moods', s.moods, st.mood, (w) => { st.mood = w; paint() })
  fillRow('instruments', s.instruments, st.instrument, (w) => { st.instrument = w; paint() })
  paintPrompt()
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

function show (name) {
  st.screen = name
  document.querySelectorAll('[data-screen]').forEach((s) => { s.hidden = s.dataset.screen !== name })
  if (name !== 'listen') {
    stopAudio()
    document.body.classList.remove('playing')
  }
  $('restyle').hidden = true
}

function colourise (style) {
  ;[$('pot'), $('disc'), $('deck')].forEach((n) => {
    if (!n) return
    n.style.setProperty('--c1', style.c1)
    n.style.setProperty('--c2', style.c2)
  })
}

function err (id, message) {
  const el = $(id)
  el.textContent = message
  el.hidden = !message
}

// ---------------------------------------------------------------------------
// Talking to the server
// ---------------------------------------------------------------------------

async function api (path, body) {
  const res = await fetch(path, body
    ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
    : undefined)
  const text = await res.text()
  let data = {}
  try { data = text ? JSON.parse(text) : {} } catch { data = { error: text.slice(0, 200) } }
  if (!res.ok) throw new Error(data.error || `${res.status}`)
  return data
}

/** One render. Every task the stand offers goes through here. */
function send ({ task, caption, seconds, seed, source, coverStrength, op }) {
  st.busy = true
  err('build-err', '')
  err('listen-err', '')
  return api('/api/render', {
    task,
    sheet: {
      caption,
      lyrics: '[Instrumental]',
      instrumental: true,
      bpm: 0,
      keyscale: '',
      timesignature: '',
      vocalLanguage: '',
      duration: seconds
    },
    prefer: 'fast',                 // turbo-q4. `sft` is 17 to 23 s for the same clip.
    seed: seed === undefined ? Math.floor(Math.random() * 1e6) : seed,
    variations: 1,                  // three takes would be 35 s of waiting
    formats: ['wav'],
    ...(source ? { source } : {}),
    ...(coverStrength ? { coverStrength } : {}),
    ...(op ? { op } : {})
  }).catch((e) => {
    st.busy = false
    err(st.screen === 'listen' ? 'listen-err' : 'build-err', e.message)
    show(st.screen === 'cook' ? 'build' : st.screen)
    throw e
  })
}

function startCooking (name, caption, etaSeconds) {
  colourise(STYLES[st.style])
  $('cook-name').textContent = name
  $('cook-kw').textContent = caption
  $('cook-eta').textContent = `about ${etaSeconds}s`
  paintStages(-1)
  $('track-fill').style.width = '6%'
  show('cook')
}

function paintStages (activeIndex) {
  $('cook-steps').innerHTML = STAGES
    .map((s, i) => (i === activeIndex ? `<b>${s.label}</b>` : s.label))
    .join(' <span>&rsaquo;</span> ')
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function onJob (job) {
  if (!job || st.screen !== 'cook') return
  const idx = Math.max(0, STAGES.findIndex((s) => s.key === (job.stage || 'load')))
  paintStages(idx)
  const pct = job.total > 1 && job.step
    ? (idx / STAGES.length + (job.step / job.total) / STAGES.length) * 100
    : (idx + 0.5) / STAGES.length * 100
  $('track-fill').style.width = Math.max(6, Math.min(98, pct)) + '%'
  if (job.status === 'failed') {
    st.busy = false
    err('build-err', job.error || 'the render failed')
    show('build')
  }
}

function onTake (take) {
  st.busy = false
  st.take = take
  st.caption = take.caption || st.caption
  const file = take.files && take.files[0]
  if (!file) { err('build-err', 'the render produced no file'); show('build'); return }

  const style = STYLES[st.style]
  colourise(style)
  $('now-name').textContent = style.name
  $('now-kw').textContent = st.caption
  const url = '/api/audio/out/' + encodeURIComponent(file.file.split('/').pop())
  st.url = url
  $('download').href = url
  $('download').setAttribute('download', style.name.toLowerCase().replace(/\s+/g, '-') + '.wav')
  show('listen')
  playFrom(url)
}

function subscribe () {
  const es = new EventSource('/api/events')
  es.onmessage = (m) => {
    let e
    try { e = JSON.parse(m.data) } catch { return }
    if (e.t === 'job') onJob(e.job)
    else if (e.t === 'take') onTake(e.take)
    else if (e.t === 'failed') {
      st.busy = false
      err('build-err', e.error || 'the render failed')
      show('build')
    } else if (e.t === 'models') boot(e.models)
  }
  // A dropped stream on a machine that has been running all day must not leave a dead screen.
  es.onerror = () => { setTimeout(() => { es.close(); subscribe() }, 3000) }
}

// ---------------------------------------------------------------------------
// Audio, and the ribbon that reads it
// ---------------------------------------------------------------------------

const audio = $('audio')
let ctx = null, analyser = null, freq = null, raf = 0
const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

function ensureAnalyser () {
  if (ctx) return
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return
  try {
    ctx = new AC()
    const src = ctx.createMediaElementSource(audio)
    analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.72
    freq = new Uint8Array(analyser.frequencyBinCount)
    src.connect(analyser)
    analyser.connect(ctx.destination)
  } catch {
    // No analyser is survivable: the ribbon falls back to its resting shape and the CSS pulse.
    ctx = null; analyser = null
  }
}

function playFrom (url) {
  audio.src = url
  ensureAnalyser()
  if (ctx && ctx.state === 'suspended') ctx.resume()
  audio.play().then(() => {
    document.body.classList.add('playing')
    setPlayIcon(true)
    loop()
  }).catch(() => {
    // Autoplay refused. Not an error to report: the play button is right there and obvious.
    document.body.classList.remove('playing')
    setPlayIcon(false)
    drawStill()
  })
}

function stopAudio () {
  if (raf) { cancelAnimationFrame(raf); raf = 0 }
  try { audio.pause() } catch {}
  audio.removeAttribute('src')
  // Removing the attribute alone leaves the element with a loaded resource; load() is what
  // actually aborts it and resets the element.
  try { audio.load() } catch {}
  document.body.classList.remove('playing')
  setPlayIcon(false)
  drawStill()
}

/**
 * The disc glyph and the footer button are two views of one state, so one function sets both.
 * They disagreed once: the footer said "Stop the music" after the track had already been stopped,
 * which reads as a button that does nothing.
 */
function setPlayIcon (playing) {
  $('play-path').setAttribute('d', playing ? 'M6 5h4v14H6zm8 0h4v14h-4z' : 'M8 5v14l11-7z')
  $('play').setAttribute('aria-label', playing ? 'Pause' : 'Play')
  const b = $('stop')
  if (b) {
    b.textContent = playing ? 'Stop the music' : 'Play it again'
    b.setAttribute('aria-pressed', String(!playing))
  }
}

const clock = (s) => {
  if (!isFinite(s)) return '0:00'
  const m = Math.floor(s / 60), r = Math.floor(s % 60)
  return m + ':' + (r < 10 ? '0' : '') + r
}

/** A flowing ribbon, shaped by the real spectrum rather than by a timer. */
function ribbonPath (amp, phase, detune) {
  const W = 600, H = 110, mid = H / 2, N = 48
  let d = ''
  for (let i = 0; i <= N; i++) {
    const x = (i / N) * W
    const env = Math.sin((i / N) * Math.PI)          // taper at both ends
    const y = mid +
      Math.sin(i * 0.42 + phase) * 26 * amp * env +
      Math.sin(i * 0.17 - phase * 1.7 + detune) * 14 * amp * env +
      Math.sin(i * 0.93 + phase * 0.6) * 6 * amp * env
    d += (i ? ' L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1)
  }
  return d
}

function loop () {
  if (reduce) { drawStill(); return }
  const t = audio.currentTime
  let amp = 0.45
  if (analyser) {
    analyser.getByteFrequencyData(freq)
    // Weight the low and mid bands: that is where a beat lives, and a flat average barely moves.
    let low = 0, mid = 0
    const cut = Math.floor(freq.length * 0.12)
    for (let i = 0; i < cut; i++) low += freq[i]
    for (let i = cut; i < freq.length * 0.5; i++) mid += freq[i]
    low /= cut * 255
    mid /= (freq.length * 0.5 - cut) * 255
    amp = 0.28 + low * 0.9 + mid * 0.5
  }
  amp = Math.max(0.15, Math.min(1.25, amp))
  $('rib1').setAttribute('d', ribbonPath(amp, t * 2.3, 0))
  $('rib2').setAttribute('d', ribbonPath(amp * 0.72, t * 2.3 + 0.9, 1.4))
  const body = document.querySelector('.disc .body')
  if (body) body.style.transform = 'scale(' + (1 + (amp - 0.45) * 0.1).toFixed(3) + ')'
  $('t-now').textContent = clock(t)
  $('t-end').textContent = clock(audio.duration)
  raf = requestAnimationFrame(loop)
}

function drawStill () {
  $('rib1').setAttribute('d', ribbonPath(0.5, 0, 0))
  $('rib2').setAttribute('d', ribbonPath(0.36, 0.9, 1.4))
  const body = document.querySelector('.disc .body')
  if (body) body.style.transform = 'scale(1)'
}

audio.addEventListener('ended', () => {
  document.body.classList.remove('playing')
  setPlayIcon(false)
  if (raf) { cancelAnimationFrame(raf); raf = 0 }
  drawStill()
})

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

$('typed').addEventListener('input', (e) => { st.typed = e.target.value; paintPrompt() })

document.querySelectorAll('.seg button').forEach((b) => {
  b.addEventListener('click', () => {
    b.parentNode.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', 'false'))
    b.setAttribute('aria-pressed', 'true')
    st.seconds = Number(b.dataset.secs)
    // 60 s costs about one second more than 30 s, which is why both are offered.
    $('go-eta').textContent = st.seconds === 60 ? '12s' : '11s'
  })
})

$('go').addEventListener('click', async () => {
  if (st.busy) return
  const p = paintPrompt()
  st.caption = p.caption
  startCooking(STYLES[st.style].name, p.caption, st.seconds === 60 ? 12 : 11)
  try { await send({ task: 'compose', caption: p.caption, seconds: st.seconds }) } catch {}
})

$('cancel').addEventListener('click', async () => {
  try { await api('/api/cancel', {}) } catch {}
  st.busy = false
  show('build')
})

$('stop').addEventListener('click', () => {
  if (audio.paused || !audio.getAttribute('src')) return replay()
  stopAudio()
})

/** Put the track back on after a stop. The take is still there; only the element was reset. */
function replay () {
  if (!st.url) return
  playFrom(st.url)
}
$('over').addEventListener('click', () => { show('build'); paint() })

// Leaving the page, reloading it, or hiding the tab all have to silence it. `pagehide` fires in
// cases `beforeunload` does not (bfcache, mobile), so both are wired.
window.addEventListener('pagehide', stopAudio)
window.addEventListener('beforeunload', stopAudio)



$('play').addEventListener('click', () => {
  if (audio.paused) {
    if (ctx && ctx.state === 'suspended') ctx.resume()
    audio.play().then(() => {
      document.body.classList.add('playing'); setPlayIcon(true); loop()
    }).catch(() => {})
  } else {
    audio.pause()
    document.body.classList.remove('playing')
    setPlayIcon(false)
    if (raf) { cancelAnimationFrame(raf); raf = 0 }
    drawStill()
  }
})

// The restyle card opens the other five styles; picking one is the second click.
$('act-restyle').addEventListener('click', () => {
  const box = $('restyle')
  box.hidden = !box.hidden
  if (box.hidden) return
  box.textContent = ''
  STYLES.forEach((s, i) => {
    if (i === st.style) return
    box.appendChild(chip(s.name, false, async () => {
      if (st.busy) return
      const caption = restyleCaption(s)
      const shown = conformCaption(caption, { instrumental: true }).caption
      st.style = i
      st.caption = shown
      startCooking(s.name, shown, 8)
      try {
        await send({
          task: 'cover',
          caption,
          seconds: st.seconds,
          source: { kind: 'take', id: st.take.id },
          coverStrength: 'moderate'
        })
      } catch {}
    }, [s.c1, s.c2]))
  })
})

$('act-longer').addEventListener('click', async () => {
  if (st.busy || !st.take) return
  startCooking(STYLES[st.style].name, st.caption, 12)
  try {
    await send({
      task: 'extend',
      caption: st.caption,
      seconds: st.seconds,
      source: { kind: 'take', id: st.take.id },
      op: { seconds: 30, caption: st.caption, lyrics: '[Instrumental]', mode: 'Balanced', strength: 0.5 }
    })
  } catch {}
})

$('act-again').addEventListener('click', async () => {
  if (st.busy) return
  startCooking(STYLES[st.style].name, st.caption, st.seconds === 60 ? 12 : 11)
  try { await send({ task: 'compose', caption: st.caption, seconds: st.seconds }) } catch {}
})

// ---------------------------------------------------------------------------
// Setup, only when the models are not on this machine
// ---------------------------------------------------------------------------

let catalogue = null

async function boot (models) {
  const state = models ? { models } : await api('/api/state')
  if (state.models.acestep.ready) {
    show('build')
    paint()
    drawStill()
    return
  }
  catalogue = await api('/api/models/catalogue')
  const missing = catalogue.items.filter((i) => i.essential && !i.onDisk)
  const gb = (missing.reduce((n, i) => n + i.bytes, 0) / 1e9).toFixed(1)
  $('setup-what').textContent =
    `This machine does not have the ACE-Step model yet. It is ${gb} GB and it is shared with every other QVAC app on here.`
  $('fetch').textContent = `Download ${gb} GB`
  show('setup')
}

$('fetch').addEventListener('click', async () => {
  $('fetch').disabled = true
  $('fetch').textContent = 'Downloading'
  try {
    await api('/api/models/download', { keys: catalogue.items.filter((i) => i.essential && !i.onDisk).map((i) => i.key) })
  } catch (e) {
    $('fetch').disabled = false
    $('fetch').textContent = 'Try again'
    $('setup-what').textContent = e.message
  }
})

// ---------------------------------------------------------------------------
// The stand resets itself between visitors
// ---------------------------------------------------------------------------

let idle = 0
function touch () {
  clearTimeout(idle)
  idle = setTimeout(() => {
    if (st.busy) { touch(); return }          // never interrupt a render
    st.take = null
    st.typed = ''
    $('typed').value = ''
    st.style = 0
    st.mood = STYLES[0].moods[0]
    st.instrument = STYLES[0].instruments[0]
    $('styles').classList.add('untouched')
    if (st.screen !== 'setup') { show('build'); paint() }
  }, IDLE_MS)
}
;['pointerdown', 'keydown', 'input'].forEach((e) => document.addEventListener(e, touch, { passive: true }))
touch()

subscribe()
boot().catch((e) => { err('build-err', e.message); show('build'); paint() })
