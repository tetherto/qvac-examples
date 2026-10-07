// Player SPA. Talks only to the public API; never sees a password.
const $ = (id) => document.getElementById(id)
let state = { levels: [], freeRoam: false }
let current = null

// Which path through the game this page is on. `human` is someone playing;
// `ai` is a hosted challenger playing while the page watches. The two share
// every renderer in this file and differ only in where the moves come from and
// in what the controls are allowed to do.
let mode = 'human'

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// Words the player has already cracked. The server never sends these back —
// we only know them because the player typed the winning guess here.
const WORDS_KEY = 'vg_words'
function loadWords () {
  try { return JSON.parse(localStorage.getItem(WORDS_KEY)) || {} } catch { return {} }
}
function saveWord (levelId, word) {
  const words = loadWords()
  words[levelId] = word
  try { localStorage.setItem(WORDS_KEY, JSON.stringify(words)) } catch {}
}

// A challenger's words are not the viewer's, so they live in memory: a match
// watched in the same browser must not overwrite the vault chips of a game
// someone is part way through.
const aiWords = {}
function crackedWords () { return mode === 'ai' ? aiWords : loadWords() }

async function api (path, opts) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts })
  return res.json().catch(() => ({}))
}

function toast (msg, kind = 'ok') {
  const t = $('toast')
  t.textContent = msg
  t.className = `toast show ${kind}`
  setTimeout(() => { t.className = 'toast' }, 2600)
}

function cornerToast (msg, kind = 'ok') {
  const t = $('resetToast')
  t.textContent = msg
  t.className = `toast corner show ${kind}`
  clearTimeout(cornerToast._hide)
  cornerToast._hide = setTimeout(() => { t.className = 'toast corner' }, 3000)
}

async function refresh () {
  // Level names, prizes and hints come back already in the player's language.
  state = await api('/api/state?lang=' + currentLang())
  applySttAvailability()
}

function levelById (id) { return state.levels.find(l => l.id === id) }
function levelIndex (id) { return state.levels.findIndex(l => l.id === id) }

// Linear progression: the furthest level the player has unlocked but not solved.
function nextLevel () {
  const open = state.levels.filter(l => l.unlocked)
  return open.find(l => !l.solved) || open[open.length - 1] || state.levels[0]
}

// The Figma door has no progress strip: the pentagon in the header carries
// the door number and how far round the five it is.
function renderProgress () {}

// Five scenes, one per door. A door past the fifth reuses them in turn.
function doorArt (n) { return ((Math.max(1, n) - 1) % 5) + 1 }

function boardImage (n) {
  const d = doorArt(n)
  // Door one's play scene is its own render in the design.
  return d === 1 ? '/assets/vg/l1-bg-play.jpg' : `/assets/vg/l${d}-bg.jpg`
}

function setBoardImage (n) {
  $('game').style.setProperty('--scene', `url("${boardImage(n)}")`)
  $('levelCounter').src = `/assets/vg/l${doorArt(n)}-counter.webp`
  $('gameRolo').src = `/assets/vg/l${doorArt(n)}-rolo-intro.webp`
}

function prefetchBoards () {
  for (let i = 1; i <= state.levels.length; i++) {
    const img = new Image()
    img.src = boardImage(i)
  }
}

// The banner only carries a door's fixed hint. Coached doors get theirs from
// the server after each attempt, under the reply it is about, and the last
// door gets none at all.
function renderHint (lvl) {
  const none = !(lvl.hintMode === 'static' && lvl.hint) && lvl.hintMode !== 'dynamic'
  const btn = $('hintBtn')
  btn.disabled = none || mode === 'ai'
  btn.title = none ? t('game.noHint') : ''
}

// "Ask Rolo for a hint": the door's fixed hint, or, on a coached door, the
// last coaching line he wrote under a reply.
let lastCoach = null
function askHint () {
  const lvl = levelById(current)
  if (!lvl || $('hintBtn').disabled) return
  const text = lvl.hintMode === 'static' && lvl.hint ? lvl.hint : (lastCoach || t('game.hintEarly'))
  // Already on show: point at it instead of rewriting it.
  const note = $('hintNote')
  if (!note.classList.contains('hidden') && !note.classList.contains('pending') && $('hintText').textContent === text) {
    note.classList.remove('nudge')
    void note.offsetWidth
    note.classList.add('nudge')
    return
  }
  fillCoach(addCoach(), text)
}

// The message budget is per level and per run. At zero the chat closes but
// guessing stays open — and Reset closes too, since clearing the transcript
// would destroy the very reply the player still needs to read.
function renderTries (lvl) {
  const left = typeof lvl.messagesLeft === 'number' ? lvl.messagesLeft : (lvl.maxMessages || 0)
  const pill = $('tries')
  $('triesLeft').textContent = left === 1 ? t('game.left1') : t('game.left', { n: left })
  pill.className = 'tries' + (left === 0 ? ' out' : (left <= 3 ? ' low' : ''))
  // A watched run never opens the composer, however many messages are left in
  // the challenger's budget.
  const spectating = mode === 'ai'
  for (const el of ['chatInput', 'sendBtn', 'resetBtn', 'micBtn']) $(el).disabled = spectating || left === 0
}

function messagesLeft () {
  const lvl = levelById(current)
  return lvl && typeof lvl.messagesLeft === 'number' ? lvl.messagesLeft : 0
}

function setMessagesLeft (levelId, left) {
  const lvl = levelById(levelId)
  if (!lvl || typeof left !== 'number') return
  lvl.messagesLeft = left
}

// Round soundtrack: loops while a door is open, and is rewound from the
// start every time the player walks into a new one. Play() is kicked from
// the language-button click so the browser still counts it as a gesture.
function restartLevelMusic () {
  const el = $('levelMusic')
  if (!el) return
  el.pause()
  el.currentTime = 0
  const play = el.play()
  if (play && typeof play.catch === 'function') play.catch(() => {})
}

function stopLevelMusic () {
  const el = $('levelMusic')
  if (!el) return
  el.pause()
  el.currentTime = 0
}

function selectLevel (id) {
  if (mic.recording) stopMic(true)
  current = id
  restartLevelMusic()
  const lvl = levelById(id)
  const n = levelIndex(id) + 1
  setBoardImage(n)
  $('levelCount').textContent = t('game.trial', { n, total: state.levels.length })
  $('levelName').textContent = lvl.name
  lastCoach = null
  renderHint(lvl)
  $('msgs').innerHTML = ''
  hideHint()
  $('guessInput').value = ''
  setPwState('')
  renderSlots()
  if (lvl.solved) addSystem(t('sys.solved'))
  for (const el of ['chatInput', 'sendBtn', 'resetBtn', 'guessInput', 'guessBtn', 'micBtn', 'sttLang']) $(el).disabled = false
  renderTries(lvl)
  renderProgress()
  if (mode === 'ai') lockSpectator()
  else $('chatInput').focus()
}

// A line in the conversation. Returns the element whose text changes: the
// bubble for the player and Rolo, the line itself for a system note.
function addMsg (cls, text) {
  const d = document.createElement('div')
  d.className = 'msg ' + cls
  let target = d
  if (cls === 'bot') d.appendChild(senderLine())
  if (cls === 'user' || cls === 'bot') {
    target = document.createElement('div')
    target.className = 'bubble'
    d.appendChild(target)
  }
  if (cls === 'bot') d.appendChild(thinkPuffs())
  target.textContent = text
  $('msgs').appendChild(d)
  $('msgs').scrollTop = $('msgs').scrollHeight
  return target
}

function senderLine (tag) {
  const row = document.createElement('div')
  row.className = 'sender'
  const img = document.createElement('img')
  img.src = '/assets/vg/rolo-peek.webp'
  img.alt = ''
  const name = document.createElement('span')
  name.textContent = t('rolo.name')
  row.append(img, name)
  if (tag) {
    const tg = document.createElement('span')
    tg.className = 'tag'
    tg.textContent = '· ' + tag
    row.appendChild(tg)
  }
  return row
}

function thinkPuffs () {
  const p = document.createElement('i')
  p.className = 'think'
  p.setAttribute('aria-hidden', 'true')
  return p
}
function addSystem (text) { return addMsg('system', text) }
function scrollMsgs () { const m = $('msgs'); m.scrollTop = m.scrollHeight }

// A coaching line, tied to the reply above it rather than to the door. It goes
// up as soon as the server says a hint is coming, and pulses until it arrives.
// The hint is not part of the conversation: it sits in one note above the
// composer, and a newer hint replaces the one before it.
function addCoach () {
  const note = $('hintNote')
  note.classList.add('pending')
  note.classList.remove('hidden', 'nudge')
  $('hintText').textContent = t('level.hintPending')
  scrollMsgs()
  return note
}

function fillCoach (note, text) {
  note.classList.remove('pending')
  $('hintText').textContent = text
  lastCoach = text
}

function hideHint () {
  $('hintNote').classList.add('hidden')
  $('hintNote').classList.remove('pending', 'nudge')
}

function escapeHtml (s) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) }

// Escape first, then turn **bold** into real markup so the guardian's
// markdown emphasis actually renders.
function formatReply (s) {
  return escapeHtml(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

async function send () {
  // Sending mid-recording flushes what has been said so far into the message.
  if (mic.recording) await stopMic()
  const input = $('chatInput')
  const msg = input.value.trim()
  if (!msg || !current || messagesLeft() === 0) return
  const levelId = current
  input.value = ''
  addMsg('user', msg)
  $('sendBtn').disabled = true
  input.disabled = true

  const bot = addMsg('bot', '')
  bot.classList.add('pending')
  bot.innerHTML = '<span class="dots"></span>'
  let got = ''
  let blockedAt = null
  let hint = null
  let coach = null

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ levelId, message: msg, lang: currentLang() })
    })
    if (!res.ok) {
      // The budget and the unlock gate both answer with JSON, not a stream.
      const err = await res.json().catch(() => ({}))
      got = '⚠️ ' + (err.error || t('err.refused'))
      setMessagesLeft(levelId, err.messagesLeft)
    } else {
      await readSSE(res, (event, data) => {
        if (event === 'token') { got += data.token; bot.innerHTML = formatReply(got) + '<span class="cursor">▍</span>' }
        else if (event === 'message') { got = data.text; bot.innerHTML = formatReply(got) }
        else if (event === 'coaching') { if (levelId === current) coach = addCoach() }
        else if (event === 'hint') { hint = data.hint }
        else if (event === 'done') { blockedAt = data.blockedAt; setMessagesLeft(levelId, data.messagesLeft) }
        else if (event === 'error') { got = '⚠️ ' + (data.error || t('err.generic')); setMessagesLeft(levelId, data.messagesLeft) }
      })
    }
  } catch (err) {
    got = '⚠️ ' + t('err.connection')
  }
  bot.classList.remove('pending')
  bot.innerHTML = formatReply(got || '…')
  if (blockedAt === 'output' || blockedAt === 'guardModel' || blockedAt === 'input') bot.classList.add('blocked')
  // A coach that came back empty takes its placeholder with it.
  if (coach && hint) fillCoach(coach, hint)
  else if (coach) hideHint()

  $('sendBtn').disabled = false
  input.disabled = false
  if (levelId === current) {
    renderTries(levelById(levelId))
    if (messagesLeft() === 0) addSystem(t('sys.outOfMessages'))
    else input.focus()
  }
}

// Minimal SSE reader over fetch's streaming body.
async function readSSE (res, onEvent) {
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let idx
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const chunk = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      let ev = 'message'; let data = ''
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event: ')) ev = line.slice(7)
        else if (line.startsWith('data: ')) data += line.slice(6)
      }
      try { onEvent(ev, data ? JSON.parse(data) : {}) } catch {}
    }
  }
}

// ===================== VOICE INPUT =====================
// Mic → 16 kHz mono f32le PCM → /api/stt/chunk → whisper on the server.
// Whisper's VAD cuts the stream into phrases, so text lands in the composer a
// beat after each pause rather than word by word.

const STT_RATE = 16000
// The server caps a chunk at 64KB, which is four 4096-sample frames; stay under.
const FRAMES_PER_POST = 3
const MAX_MSG = 4000

const mic = { recording: false, stream: null, ctx: null, filter: null, node: null, sink: null, queue: [], uploading: false }
// Below the voice band: rumble, HVAC hum and handling noise, all of which
// Silero and whisper otherwise read as part of the signal.
const MIC_HIGHPASS_HZ = 100

function sttAvailable () { return !!(state.stt && state.stt.enabled) }

// The dropdown is built from whatever the server can transcribe. "Auto" is not
// whisper's detector here: it means "whatever I chose to play in", which is the
// right guess for someone who picked a flag a moment ago. Picking a language
// explicitly overrides that, even when it disagrees with the UI.
function renderSttLanguages () {
  const select = $('sttLang')
  const codes = (state.stt && state.stt.languages) || ['auto']
  const previous = select.value
  select.innerHTML = ''
  for (const code of codes) {
    const option = document.createElement('option')
    option.value = code
    option.textContent = code === 'auto'
      ? t('stt.auto', { lang: languageName(currentLang()) })
      : languageName(code)
    select.appendChild(option)
  }
  select.value = codes.includes(previous) ? previous : 'auto'
}

function sttLanguage () {
  const chosen = $('sttLang').value
  return chosen === 'auto' ? currentLang() : chosen
}

function applySttAvailability () {
  const on = sttAvailable()
  $('micBtn').classList.toggle('hidden', !on)
  if (on) renderSttLanguages()
}

function setMicUi (recording, note = '') {
  const btn = $('micBtn')
  const label = recording ? t('chat.micStop') : t('chat.mic')
  btn.classList.toggle('recording', recording)
  btn.title = label
  btn.setAttribute('aria-label', label)
  $('sttLang').disabled = recording
  $('sttStatus').textContent = note
  // The status the old voice bar showed now reads in the composer.
  $('chatInput').placeholder = note || (mode === 'ai' ? t('ai.thinking') : t('chat.placeholder'))
}

// Float32 samples to little-endian bytes. Written through a DataView rather
// than reusing the buffer so the wire format matches the model's `f32le`
// regardless of the platform's byte order.
function toPcmBytes (frames) {
  let total = 0
  for (const f of frames) total += f.length
  const bytes = new Uint8Array(total * 4)
  const view = new DataView(bytes.buffer)
  let offset = 0
  for (const f of frames) {
    for (let i = 0; i < f.length; i++) { view.setFloat32(offset, f[i], true); offset += 4 }
  }
  return bytes
}

function base64 (bytes) {
  let s = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  }
  return btoa(s)
}

// Browsers may refuse a 16 kHz AudioContext and hand back their own rate.
function resample (input, from) {
  if (from === STT_RATE) return input
  const ratio = from / STT_RATE
  const out = new Float32Array(Math.floor(input.length / ratio))
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio
    const idx = Math.floor(pos)
    const frac = pos - idx
    const next = input[idx + 1] !== undefined ? input[idx + 1] : input[idx]
    out[i] = input[idx] * (1 - frac) + next * frac
  }
  return out
}

function appendTranscript (parts) {
  if (!parts || !parts.length) return
  const input = $('chatInput')
  const addition = parts.join(' ').replace(/\s+/g, ' ').trim()
  if (!addition) return
  const base = input.value.trim()
  input.value = (base ? base + ' ' : '') + addition
  if (input.value.length > MAX_MSG) input.value = input.value.slice(0, MAX_MSG)
  input.scrollLeft = input.scrollWidth
}

// One POST in flight at a time so the server writes frames in the order they
// were spoken; a backlog is coalesced into the next request.
async function pumpAudio () {
  if (mic.uploading || !mic.queue.length) return
  mic.uploading = true
  try {
    while (mic.queue.length) {
      const frames = mic.queue.splice(0, FRAMES_PER_POST)
      const res = await fetch('/api/stt/chunk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: base64(toPcmBytes(frames)) })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast('🎙️ ' + (data.error || t('toast.voiceFailed')), 'bad')
        await stopMic(true)
        return
      }
      appendTranscript(data.text)
      if (mic.recording) $('sttStatus').textContent = t(data.speaking ? 'stt.hearing' : 'stt.listening')
    }
  } catch {
    toast(t('toast.micLost'), 'bad')
    await stopMic(true)
  } finally {
    mic.uploading = false
  }
}

async function startMic () {
  if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) {
    toast(t('toast.micInsecure'), 'bad')
    return
  }
  let stream
  try {
    // voiceIsolation is best-effort: browsers that do not know it ignore it.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, voiceIsolation: true }
    })
  } catch {
    toast(t('toast.micDenied'), 'bad')
    return
  }

  const started = await api('/api/stt/start', { method: 'POST', body: JSON.stringify({ language: sttLanguage() }) })
  if (!started.ok) {
    for (const track of stream.getTracks()) track.stop()
    toast('🎙️ ' + (started.error || t('toast.micUnavailable')), 'bad')
    return
  }

  try {
    const ctx = new AudioContext({ sampleRate: STT_RATE })
    await ctx.audioWorklet.addModule('/mic-worklet.js')
    const source = ctx.createMediaStreamSource(stream)
    const filter = ctx.createBiquadFilter()
    filter.type = 'highpass'
    filter.frequency.value = MIC_HIGHPASS_HZ
    filter.Q.value = Math.SQRT1_2
    const node = new AudioWorkletNode(ctx, 'mic-processor')
    // A worklet is only pulled while it reaches the destination, so route it
    // through a muted gain node instead of playing the mic back at the player.
    const sink = ctx.createGain()
    sink.gain.value = 0
    node.port.onmessage = (e) => {
      if (!mic.recording) return
      mic.queue.push(resample(new Float32Array(e.data), ctx.sampleRate))
      pumpAudio()
    }
    source.connect(filter)
    filter.connect(node)
    node.connect(sink)
    sink.connect(ctx.destination)

    Object.assign(mic, { recording: true, stream, ctx, filter, node, sink, queue: [] })
    setMicUi(true, t('stt.listening'))
  } catch {
    for (const track of stream.getTracks()) track.stop()
    await api('/api/stt/cancel', { method: 'POST', body: '{}' })
    toast(t('toast.micFailed'), 'bad')
  }
}

async function stopMic (aborted = false) {
  if (!mic.recording) return
  mic.recording = false
  setMicUi(false, aborted ? '' : t('stt.transcribing'))

  if (mic.node) mic.node.port.onmessage = null
  for (const track of mic.stream?.getTracks() || []) track.stop()
  try { mic.filter?.disconnect(); mic.node?.disconnect(); mic.sink?.disconnect() } catch {}
  try { await mic.ctx?.close() } catch {}
  Object.assign(mic, { stream: null, ctx: null, filter: null, node: null, sink: null })

  if (aborted) {
    mic.queue = []
    await api('/api/stt/cancel', { method: 'POST', body: '{}' })
    return
  }
  // Send the tail of the recording before asking for the final flush.
  await pumpAudio()
  const final = await api('/api/stt/stop', { method: 'POST', body: '{}' })
  appendTranscript(final.text)
  $('sttStatus').textContent = ''
  $('chatInput').focus()
}

function toggleMic () {
  if (mic.recording) stopMic()
  else startMic()
}

// ===================== STORY SCREENS =====================
// The Figma's "Intro to the Level" and "Victory" frame: letterbox, scene,
// ribbon, Rolo, and his line in the dialogue box. The game over and the leave
// prompt reuse it, with the poses the design ships for them.

const story = { kind: null, primary: null, alt: null, typing: null }
const TYPE_MS = 14

function showStory ({ kind, door, line, pose, gift = false, button, alt = null, primary, onAlt = null }) {
  const d = doorArt(door)
  $('story').style.setProperty('--scene', `url("/assets/vg/l${d}-bg.jpg")`)
  $('storyScene').style.setProperty('--scene', `url("/assets/vg/l${d}-bg.jpg")`)
  // Restart the entrance animations every time the frame comes up.
  for (const id of ['storyRibbon', 'storyRolo', 'storyGift']) {
    const el = $(id)
    el.style.animation = 'none'
    void el.offsetWidth
    el.style.animation = ''
  }
  $('storyRibbon').src = `/assets/vg/l${d}-ribbon.webp`
  $('storyRibbon').alt = state.levels[door - 1]?.name || ''
  $('storyRolo').src = `/assets/vg/${pose}.webp`
  $('storyGift').classList.toggle('hidden', !gift || d === 5)
  if (gift && d < 5) $('storyGift').src = `/assets/vg/l${d}-gift.webp`
  $('storyBtn').textContent = button
  $('storyAlt').textContent = alt || ''
  $('storyAlt').classList.toggle('hidden', !alt)
  Object.assign(story, { kind, primary, alt: onAlt })
  $('story').classList.remove('hidden')
  typeLine(line)
  $('storyBtn').focus()
}

// Rolo's line types itself out; a key or a click finishes it at once.
function typeLine (line) {
  const el = $('storyText')
  const html = formatReply(line)
  clearInterval(story.typing)
  if (catchingUp() || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.innerHTML = html; story.typing = null; return }
  const plain = line.replace(/\*\*/g, '')
  let n = 0
  el.textContent = ''
  story.typing = setInterval(() => {
    n += 2
    if (n >= plain.length) return finishLine()
    el.textContent = plain.slice(0, n)
  }, TYPE_MS)
  story.full = html
}

function finishLine () {
  if (!story.typing) return false
  clearInterval(story.typing)
  story.typing = null
  $('storyText').innerHTML = story.full
  return true
}

function hideStory () {
  finishLine()
  $('story').classList.add('hidden')
  story.kind = null
}

function storyPrimary () {
  if (story.kind === null) return
  if (finishLine()) return
  const go = story.primary
  if (go) go()
}

function storyAlt () {
  if (story.kind === null || !story.alt) return
  story.alt()
}

function doorOf (id) { return levelIndex(id) + 1 }

// The door's opening line, then the door itself. A watched match skips it:
// nobody is there to press Start.
function showLevelIntro (lvl) {
  const door = doorOf(lvl.id)
  showStory({
    kind: 'intro',
    door,
    line: t(`story.${doorArt(door)}.intro`),
    pose: `l${doorArt(door)}-rolo-intro`,
    button: t('story.start', { n: door }),
    primary: () => enterLevel(lvl.id)
  })
}

function enterLevel (id) {
  hideStory()
  $('menu').classList.add('hidden')
  $('game').classList.remove('hidden')
  selectLevel(id)
}

// The level to open once the player dismisses the victory, or null when
// this was the last door.
let pendingNext = null

function celebrate (solvedId, nextId) {
  pendingNext = nextId
  const door = doorOf(solvedId)
  showStory({
    kind: 'win',
    door,
    line: t(`story.${doorArt(door)}.win`),
    pose: `l${doorArt(door)}-rolo-victory`,
    gift: true,
    button: t('story.continue'),
    primary: dismissPrize
  })
  burstConfetti()
}

async function dismissPrize () {
  if (story.kind !== 'win') return
  hideStory()
  clearConfetti()
  releasePrize()
  const next = pendingNext
  pendingNext = null
  if (next) {
    if (mode === 'ai') selectLevel(next)
    else showLevelIntro(levelById(next))
    return
  }
  // Last door: the server has already wiped the run. Same as a loss: back
  // to the menu so a reload cannot reopen the finished door.
  await returnToIntro()
}

// The last door: Rolo hands over the vault, and the button is what actually
// pulses the physical lock.
function showClosing () {
  stopLevelMusic()
  const door = state.levels.length || 5
  showStory({
    kind: 'final',
    door,
    line: t(`story.${doorArt(door)}.win`),
    pose: `l${doorArt(door)}-rolo-victory`,
    button: t('story.openVault'),
    primary: openVault
  })
  burstConfetti()
}

// One press, whatever the relay says. The win is already banked server-side,
// so a vault that is unplugged, in dry-run or simply absent still sends the
// player home rather than trapping them on a dead button.
async function openVault () {
  const btn = $('storyBtn')
  if (story.kind !== 'final' || btn.disabled) return
  btn.disabled = true
  // A watched run holds no grant to spend, and a match must never pulse the
  // physical lock.
  if (mode !== 'ai') {
    try { await api('/api/vault/open', { method: 'POST', body: '{}' }) } catch {}
  }
  btn.disabled = false
  clearConfetti()
  hideStory()
  await returnToIntro()
}

// The server has already wiped the run by the time this is called; `reached`
// is the only record of how far the player got.
function showGameOver (reached) {
  stopLevelMusic()
  const { door, cleared, total } = reached || {}
  const doors = t(cleared === 1 ? 'over.door' : 'over.doors')
  showStory({
    kind: 'over',
    door: door || doorOf(current) || 1,
    line: door ? t('story.over', { cleared, total, doors }) : t('story.overPlain'),
    pose: 'l3-rolo-victory',
    button: t('story.back'),
    primary: dismissGameOver
  })
}

// Rolo's face in the corner of the door: leaving from there asks first,
// because it wipes the run.
function askLeave () {
  if (story.kind !== null || $('game').classList.contains('hidden')) return
  const door = doorOf(current) || 1
  showStory({
    kind: 'leave',
    door,
    line: t('story.leave'),
    pose: 'l1-rolo-victory',
    button: t('story.leaveYes'),
    alt: t('story.stay'),
    primary: () => { hideStory(); abandonRound() },
    onAlt: () => { hideStory(); if (mode !== 'ai') $('chatInput').focus() }
  })
}

async function abandonRound () {
  hideStory()
  clearConfetti()
  // Nothing of the viewer's to wipe in a watched run: the challenger's session
  // is its own, and walking back is what ends it.
  if (mode === 'ai') return returnToIntro()
  const r = await api('/api/restart', { method: 'POST', body: '{}' })
  if (!r.ok) {
    toast(t('err.generic'), 'bad')
    return
  }
  await returnToIntro()
}

async function returnToIntro () {
  stopLevelMusic()
  const watched = mode === 'ai'
  if (watched) await endAiMatch()
  if (mic.recording) await stopMic(true)
  if (!watched) { try { localStorage.removeItem(WORDS_KEY) } catch {} }
  current = null
  pendingNext = null
  $('msgs').innerHTML = ''
  hideHint()
  $('guessInput').value = ''
  renderSlots()
  await refresh()
  hideStory()
  $('game').classList.add('hidden')
  $('menu').classList.remove('hidden')
  renderMenu()
  renderAiCta()
  selectMenu(0)
}

async function dismissGameOver () {
  if (story.kind !== 'over') return
  hideStory()
  await returnToIntro()
}

// ===================== PASSWORD SLOTS =====================
// The Figma field is a row of letter boxes. The real input sits over them and
// takes the typing; the boxes draw it. Eight boxes to start with, more as the
// word grows, so the field never tells anyone how long the password is.
const MIN_SLOTS = 8

function renderSlots () {
  const value = $('guessInput').value.toUpperCase()
  const focused = document.activeElement === $('guessInput')
  // The spare box does not depend on focus: pressing the check button blurs
  // the field, and a row that shrank on blur would slide the button out from
  // under the pointer before the click lands.
  const count = Math.max(MIN_SLOTS, value.length + 1)
  const row = $('pwSlots')
  row.innerHTML = ''
  for (let i = 0; i < count; i++) {
    const s = document.createElement('span')
    s.className = 'slot'
    if (i < value.length) { s.textContent = value[i]; s.classList.add('has') }
    if (focused && i === value.length) s.classList.add('caret')
    row.appendChild(s)
  }
}

function setPwState (name) {
  const pw = $('pwPanel')
  pw.classList.remove('wrong', 'correct', 'ready')
  if (name) pw.classList.add(name)
}

// The right word stays on show until the player presses CONTINUE.
function pwContinue () {
  const btn = $('pwContinue')
  $('pwPanel').classList.add('ready')
  btn.focus()
  return new Promise(resolve => {
    btn.onclick = () => { btn.onclick = null; $('pwPanel').classList.remove('ready'); resolve() }
  })
}

async function guess () {
  const input = $('guessInput')
  const g = input.value.trim()
  if (!g || !current || input.readOnly) return
  $('guessBtn').disabled = true
  input.readOnly = true
  let r
  try {
    r = await api('/api/guess', { method: 'POST', body: JSON.stringify({ levelId: current, guess: g, lang: currentLang() }) })
  } catch {
    // Nothing was checked: give the word back untouched.
    $('guessBtn').disabled = false
    input.readOnly = false
    return toast(t('err.connection'), 'bad')
  }
  $('guessBtn').disabled = false
  if (r.gameOver) {
    input.readOnly = false
    input.value = ''
    renderSlots()
    return showGameOver(r.reached)
  }
  if (r.correct) {
    saveWord(current, g.toUpperCase())
    setPwState('correct')
    const solvedId = current
    const lvl = levelById(solvedId)
    if (lvl) lvl.solved = true
    await pwContinue()
    input.readOnly = false
    input.value = ''
    setPwState('')
    renderSlots()
    // Do not refresh() on a final win: the server has already wiped the run,
    // and a fresh state would look like door 1 and skip the vault.
    if (r.won) {
      renderProgress()
      showClosing()
      return
    }
    await refresh()
    renderProgress()
    const next = nextLevel()
    celebrate(solvedId, next && next.id !== solvedId ? next.id : null)
  } else {
    setPwState('wrong')
    if (r.error && /too many/.test(r.error)) toast(t('toast.tooMany'), 'bad')
    else {
      const left = r.remaining
      toast(typeof left === 'number' ? t('toast.wrongLeft', { left }) : t('toast.wrong'), 'bad')
    }
    await wait(1200)
    setPwState('')
    input.readOnly = false
    input.value = ''
    renderSlots()
    input.focus()
  }
}

async function resetConv () {
  if (!current) return
  await api('/api/reset', { method: 'POST', body: JSON.stringify({ levelId: current }) })
  $('msgs').innerHTML = ''
  hideHint()
  cornerToast(t('toast.reset'))
}

function startGame () {
  prefetchBoards()
  const lvl = nextLevel()
  if (!lvl) return
  showLevelIntro(lvl)
}

// ===================== MENU =====================
// The Figma menu is a list you drive with the arrow keys; the highlighted row
// is the one Enter acts on, and hovering moves the highlight.
let menuIndex = 0

function menuItems () { return [...document.querySelectorAll('#menuList li:not(.hidden) .menu-item')] }

function selectMenu (i) {
  const items = menuItems()
  if (!items.length) return
  const usable = items.map((el, n) => (el.disabled ? -1 : n)).filter(n => n >= 0)
  if (!usable.length) return
  if (!usable.includes(i)) i = usable[0]
  menuIndex = i
  items.forEach((el, n) => el.classList.toggle('selected', n === i))
  items[i].focus({ preventScroll: true })
}

function moveMenu (step) {
  const items = menuItems()
  let i = menuIndex
  for (let n = 0; n < items.length; n++) {
    i = (i + step + items.length) % items.length
    if (!items[i].disabled) return selectMenu(i)
  }
}

function renderMenu () {
  const resuming = state.levels.some(l => l.solved)
  const lvl = nextLevel()
  $('startLabel').textContent = t(resuming ? 'menu.continue' : 'menu.start')
  $('startLevel').textContent = lvl ? t('menu.level', { n: doorOf(lvl.id) }) : ''
  $('langName').textContent = languageName(currentLang())
  const per = state.levels[0]?.maxMessages
  $('menuRules').textContent = typeof per === 'number' ? t('menu.rulesN', { n: per }) : t('menu.rules')
  for (const el of menuItems()) {
    if (el.dataset.action === 'start' || el.dataset.action === 'language') el.disabled = !state.levels.length
  }
}

async function cycleLanguage (step = 1) {
  const i = LANGUAGES.indexOf(currentLang())
  setLang(LANGUAGES[(i + step + LANGUAGES.length) % LANGUAGES.length])
  // Level names, prizes and hints come back in the language just picked.
  await refresh()
  renderMenu()
  renderAiCta()
}

function menuAction (action) {
  if (action === 'start') {
    // Unlock audio on the click itself; selectLevel rewinds it at the door.
    restartLevelMusic()
    stopLevelMusicSoon()
    startGame()
  } else if (action === 'language') cycleLanguage(1)
  else if (action === 'admin') location.href = '/admin'
  else if (action === 'ai') startAiMatch()
}

// The level music belongs to the doors. Starting it on the menu click unlocks
// audio for the page; the intro screen stays quiet until the door opens.
function stopLevelMusicSoon () { setTimeout(() => { if (!current) stopLevelMusic() }, 60) }

// ===================== MUSIC TOGGLE =====================
const MUSIC_KEY = 'vg_music'
function musicOn () { try { return localStorage.getItem(MUSIC_KEY) !== 'off' } catch { return true } }
function renderMusic () {
  const on = musicOn()
  $('levelMusic').muted = !on
  // One switch, three buttons: the menu, the story frames and the game.
  for (const btn of document.querySelectorAll('.sound-btn')) {
    btn.setAttribute('aria-pressed', String(on))
    btn.title = t(on ? 'sound.on' : 'sound.off')
    btn.setAttribute('aria-label', btn.title)
    btn.querySelector('.ico').dataset.icon = on ? 'sound-on' : 'sound-off'
  }
}
function toggleMusic () {
  try { localStorage.setItem(MUSIC_KEY, musicOn() ? 'off' : 'on') } catch {}
  renderMusic()
}

// ===================== SCALE =====================
// 1rem is ten Figma pixels times this, so the 1440x1024 frames keep their
// proportions on any screen.
function applyScale () {
  const s = Math.min(window.innerWidth / 1440, window.innerHeight / 1024)
  document.documentElement.style.setProperty('--s', Math.max(0.5, Math.min(1.6, s)).toFixed(4))
}
applyScale()
window.addEventListener('resize', applyScale)

// ===================== AI VS AI =====================
// The opening screen's other button. Nobody plays: a hosted challenger does,
// through the same public API a browser uses, and this page becomes a seat in
// the audience. Every move is rendered by the same functions above that render
// a human's, fed from the run's event stream instead of from clicks — so what
// is on screen during a match is the game's own UI, not a view of it.
//
// Nothing below is reachable from the language path.

const VERSUS_MS = 4000
// The prize popup is a beat in the show rather than a prompt, so it dismisses
// itself and the event queue waits for it.
const AI_PRIZE_MS = 3600
// Roughly a fast typist, in a fixed number of steps so a long message does not
// take proportionally longer. The pauses the player takes before sending are
// sized to cover this in blind-test/src/tools.js.
const TYPE_MAX_MS = 900
const TYPE_STEPS = 40
// Past this much backlog the page is catching up on a match already in
// progress, and the animations are in the way rather than part of the show.
const CATCHUP_DEPTH = 8

const ai = { since: -1, ended: false, bot: null, coach: null, reply: '', error: null, abort: null }
const aiQueue = []
let draining = false
let releasePrize = () => {}

function aiNote (text, kind = '') {
  const note = $('aiNote')
  note.textContent = text
  note.className = 'ai-note' + (kind ? ' ' + kind : '')
}

// A run in progress that belongs to this browser is offered as a way back in,
// so a reload does not mean losing the match.
function renderAiCta () {
  const live = !!(state.ai && state.ai.running && state.ai.mine)
  const btn = $('aiBtn')
  $('aiLabel').textContent = t(live ? 'menu.aiRejoin' : 'menu.ai')
  btn.disabled = false
  // Not installed (see blind-test/README.md): no row at all.
  btn.closest('li').classList.toggle('hidden', !live && state.ai?.installed === false)
}

async function startAiMatch () {
  const btn = $('aiBtn')
  if (btn.disabled) return
  btn.disabled = true
  const rejoining = !!(state.ai && state.ai.running && state.ai.mine)

  if (!rejoining) {
    aiNote(t('ai.starting'))
    const started = await api('/api/ai/start', { method: 'POST', body: '{}' })
    if (!started.ok) {
      aiNote(started.error || t('ai.failed'), 'bad')
      btn.disabled = false
      return
    }
  }
  aiNote('')

  mode = 'ai'
  Object.assign(ai, { since: -1, ended: false, bot: null, coach: null, reply: '', error: null })
  aiQueue.length = 0
  for (const key of Object.keys(aiWords)) delete aiWords[key]
  // Unlock audio on the click itself, the way the flags do; selectLevel rewinds
  // it when the first door actually opens.
  restartLevelMusic()

  if (!rejoining) await showVersus()
  enterAiBoard()
  if (!rejoining) hideVersus()
  watchAiRun()
}

// Four seconds of title card. The board is revealed underneath before the card
// fades, so the hold is the full four seconds and not four minus a fade.
function showVersus () {
  const el = $('versus')
  el.classList.remove('hidden', 'leaving')
  return wait(VERSUS_MS)
}

function hideVersus () {
  const el = $('versus')
  el.classList.add('leaving')
  setTimeout(() => { el.classList.add('hidden'); el.classList.remove('leaving') }, 380)
}

// The viewer's own progress has no place on a watched board, so it is blanked
// rather than left showing their pips until the run's first state event lands.
function enterAiBoard () {
  hideStory()
  $('menu').classList.add('hidden')
  $('game').classList.remove('hidden')
  $('aiPill').classList.remove('hidden')
  document.body.classList.add('spectating')
  $('restartBtn').title = t('ai.stopTitle')
  state.levels = []
  current = null
  $('msgs').innerHTML = ''
  hideHint()
  $('levelName').textContent = ''
  $('levelCount').textContent = ''
  $('triesLeft').textContent = ''
  $('hintBtn').disabled = true
  renderSlots()
  renderProgress()
  prefetchBoards()
  lockSpectator()
}

function lockSpectator () {
  for (const el of ['chatInput', 'sendBtn', 'resetBtn', 'micBtn', 'guessInput', 'guessBtn', 'sttLang']) $(el).disabled = true
  $('sttbar').classList.add('hidden')
  $('chatInput').placeholder = t('ai.thinking')
}

async function endAiMatch () {
  ai.ended = true
  aiQueue.length = 0
  ai.bot = null
  ai.coach = null
  mode = 'human'
  try { ai.abort?.abort() } catch {}
  ai.abort = null
  releasePrize()
  document.body.classList.remove('spectating')
  $('aiPill').classList.add('hidden')
  $('versus').classList.add('hidden')
  $('versus').classList.remove('leaving')
  $('restartBtn').title = t('game.leave')
  $('guessInput').classList.remove('typing')
  $('chatInput').classList.remove('typing')
  $('chatInput').value = ''
  $('chatInput').placeholder = t('chat.placeholder')
  for (const key of Object.keys(aiWords)) delete aiWords[key]
  try { await api('/api/ai/stop', { method: 'POST', body: '{}' }) } catch {}
}

// The server keeps every event of a run, so `since` is all a dropped connection
// needs: a reconnect resumes, and a fresh page watches from the opening move.
async function watchAiRun () {
  while (mode === 'ai' && !ai.ended) {
    let opened = false
    try {
      ai.abort = new AbortController()
      const res = await fetch('/api/ai/events?since=' + ai.since, { signal: ai.abort.signal })
      if (res.status === 404) return finishAiRun({ status: 'gone' })
      if (!res.ok) throw new Error('events unavailable')
      opened = true
      await readSSE(res, (event, data) => { if (event === 'ai') enqueueAi(data) })
    } catch {
      // An aborted fetch is us tearing down; the loop condition catches it.
    }
    if (mode !== 'ai' || ai.ended) return
    await wait(opened ? 500 : 1500)
  }
}

// One event at a time, each handler awaited, so a beat that has to be seen —
// a word being typed, a prize popup — holds the queue rather than being
// overrun by whatever the challenger did next.
function enqueueAi (event) {
  if (typeof event.i === 'number') ai.since = Math.max(ai.since, event.i)
  aiQueue.push(event)
  drainAiQueue()
}

async function drainAiQueue () {
  if (draining) return
  draining = true
  while (aiQueue.length && mode === 'ai') {
    const event = aiQueue.shift()
    try { await handleAiEvent(event) } catch (err) { console.error('[ai] event failed', event.type, err) }
  }
  draining = false
}

function catchingUp () { return aiQueue.length > CATCHUP_DEPTH }

async function handleAiEvent (event) {
  switch (event.type) {
    case 'state': return applyAiDoors(event.doors)
    case 'focus': return focusAiDoor(event.door)
    case 'say': return sayAi(event)
    case 'reply_token': return appendAiToken(event.token)
    case 'reply_text': return appendAiToken(event.text, true)
    case 'coaching': return promiseAiCoach()
    case 'reply': return finishAiReply(event)
    case 'reset': return resetAiTranscript()
    case 'guess_typing': return typeAiGuess(event.word)
    case 'guess_result': return settleAiGuess(event)
    case 'run_end': return noteAiOutcome(event)
    case 'run_exit': return finishAiRun(event)
  }
}

// A door number, not a level id: a blind player is never told the ids, so the
// board is keyed by the position the game already numbers doors with.
function aiLevelId (door) { return 'ai-' + door }

function applyAiDoors (doors) {
  if (!Array.isArray(doors) || !doors.length) return
  state.levels = doors.map(d => ({
    id: aiLevelId(d.door),
    name: d.name,
    order: d.door,
    prize: d.prize || '',
    hint: d.hint || null,
    hintMode: d.hintMode,
    solved: !!d.solved,
    unlocked: !!d.unlocked,
    maxMessages: d.maxMessages,
    messagesLeft: d.messagesLeft
  }))
  const lvl = levelById(current)
  if (!lvl) return
  $('levelName').textContent = lvl.name
  $('levelCount').textContent = t('level.count', { n: levelIndex(current) + 1, total: state.levels.length })
  renderHint(lvl)
  renderTries(lvl)
  renderProgress()
}

function focusAiDoor (door) {
  const id = aiLevelId(door)
  // The door's own state always arrives first; without it there is nothing to
  // open, and the next state event will bring this door round again.
  if (current === id || !levelById(id)) return
  selectLevel(id)
}

async function sayAi (event) {
  const input = $('chatInput')
  await typeInto(input, event.message)
  input.value = ''
  input.placeholder = t('ai.answering')
  addMsg('user', event.message)
  ai.reply = ''
  ai.bot = addMsg('bot', '')
  ai.bot.classList.add('pending')
  ai.bot.innerHTML = '<span class="dots"></span>'
}

// Tokens as they are generated on the English path; one whole message on the
// translated path, which cannot stream because a reply has to be finished
// before it can be translated.
function appendAiToken (text, whole = false) {
  if (!ai.bot) return
  ai.reply = whole ? (text || '') : ai.reply + (text || '')
  ai.bot.innerHTML = formatReply(ai.reply) + (whole ? '' : '<span class="cursor">▍</span>')
  scrollMsgs()
}

function promiseAiCoach () {
  if (!ai.coach) ai.coach = addCoach()
}

function finishAiReply (event) {
  const bubble = ai.bot
  ai.bot = null
  const text = event.error ? '⚠️ ' + event.error : (event.text || ai.reply)
  if (bubble) {
    bubble.classList.remove('pending')
    bubble.innerHTML = formatReply(text || '…')
    if (event.blockedAt) bubble.classList.add('blocked')
  }
  // A coach that came back empty takes its placeholder with it, the same way it
  // does for a human.
  if (ai.coach && event.hint) fillCoach(ai.coach, event.hint)
  else if (ai.coach) hideHint()
  ai.coach = null

  const id = aiLevelId(event.door)
  setMessagesLeft(id, event.messagesLeft)
  const lvl = levelById(id)
  if (lvl && current === id) {
    renderTries(lvl)
    if (event.messagesLeft === 0) addSystem(t('sys.outOfMessages'))
  }
  $('chatInput').placeholder = t('ai.thinking')
  scrollMsgs()
}

function resetAiTranscript () {
  $('msgs').innerHTML = ''
  hideHint()
  ai.bot = null
  ai.coach = null
  cornerToast(t('toast.reset'))
}

async function typeAiGuess (word) {
  const input = $('guessInput')
  await typeInto(input, word)
  input.classList.add('typing')
}

async function settleAiGuess (event) {
  const input = $('guessInput')
  input.classList.remove('typing')
  const id = aiLevelId(event.door)

  if (event.gameOver) {
    input.value = ''
    return showGameOver(event.reached)
  }
  if (!event.correct) {
    setPwState('wrong')
    toast(typeof event.remaining === 'number' ? t('toast.wrongLeft', { left: event.remaining }) : t('toast.wrong'), 'bad')
    if (!catchingUp()) await wait(900)
    setPwState('')
    input.value = ''
    renderSlots()
    return
  }

  const word = String(event.word || '').toUpperCase()
  aiWords[id] = word
  setPwState('correct')
  if (!catchingUp()) await wait(700)
  setPwState('')
  input.value = ''
  renderSlots()
  const lvl = levelById(id)
  if (lvl) lvl.solved = true
  if (current === id) addSystem(t('sys.accepted', { word }))
  renderProgress()
  if (event.won) return showClosing()

  const next = state.levels[levelIndex(id) + 1]
  celebrate(id, next ? next.id : null)
  await awaitPrize()
}

// Holds the queue while the popup is up, and dismisses it on a timer: there is
// nobody to click Continue.
function awaitPrize () {
  if (catchingUp()) {
    dismissPrize()
    return Promise.resolve()
  }
  return new Promise(resolve => {
    releasePrize = () => { releasePrize = () => {}; resolve() }
    setTimeout(dismissPrize, AI_PRIZE_MS)
  })
}

function noteAiOutcome (event) {
  if (event.error) ai.error = event.error
}

// The run is over. The closing screen and the game-over card are already where
// an ending belongs, so this only stops listening — except when nothing ever
// happened, which means no credentials, no model or no runtime, and is better
// told on the opening screen than left as a blank board.
async function finishAiRun (event) {
  if (ai.ended) return
  ai.ended = true
  const reason = event.error || ai.error
  const failed = !!reason || event.status === 'failed' || event.status === 'gone'
  if (failed && !current) {
    aiNote(reason || t('ai.failed'), 'bad')
    await returnToIntro()
    return
  }
  if (failed) cornerToast(reason || t('ai.failed'), 'bad')
  else if (story.kind === null) addSystem(t('ai.ended'))
}

// Types into a field the way a player would. The field stays disabled: this is
// a spectator watching someone else's keyboard, not an invitation.
async function typeInto (input, text) {
  const value = String(text ?? '')
  const redraw = () => { if (input.id === 'guessInput') renderSlots() }
  if (catchingUp() || !value) {
    input.value = value
    redraw()
    return
  }
  const steps = Math.min(value.length, TYPE_STEPS)
  const pause = TYPE_MAX_MS / steps
  input.value = ''
  input.classList.add('typing')
  for (let step = 1; step <= steps; step++) {
    input.value = value.slice(0, Math.round((value.length * step) / steps))
    input.scrollLeft = input.scrollWidth
    redraw()
    await wait(pause)
  }
  input.classList.remove('typing')
}

// A closed tab is deliberately not reported. It looks identical to a reload
// from here, and a match that took twenty minutes to get this far should
// survive an accidental refresh: the socket closing tells the server nobody is
// watching, and it gives the page a moment to come back before stopping the
// run. Leaving on purpose — the stop pill, the closing screen — goes through
// returnToIntro, which does say so.

// ===================== WIRING =====================
menuItems().forEach((el, i) => {
  el.addEventListener('click', () => { selectMenu(i); menuAction(el.dataset.action) })
  el.addEventListener('mouseenter', () => { if (!el.disabled) selectMenu(i) })
})
for (const btn of document.querySelectorAll('.sound-btn')) btn.onclick = toggleMusic
$('hintClose').onclick = hideHint
$('sendBtn').onclick = send
$('micBtn').onclick = toggleMic
$('resetBtn').onclick = resetConv
$('guessBtn').onclick = guess
$('hintBtn').onclick = askHint
$('restartBtn').onclick = askLeave
$('storyBtn').onclick = storyPrimary
$('storyAlt').onclick = storyAlt
$('story').addEventListener('click', e => { if (!e.target.closest('button')) finishLine() })
$('chatInput').addEventListener('keydown', e => { if (e.key === 'Enter') send() })
const pwInput = $('guessInput')
pwInput.addEventListener('keydown', e => { if (e.key === 'Enter') guess() })
pwInput.addEventListener('input', () => { pwInput.value = pwInput.value.replace(/\s+/g, ''); renderSlots() })
pwInput.addEventListener('focus', () => { $('pwPanel').classList.add('focus'); renderSlots() })
pwInput.addEventListener('blur', () => { $('pwPanel').classList.remove('focus'); renderSlots() })

document.addEventListener('keydown', e => {
  const inMenu = !$('menu').classList.contains('hidden') && story.kind === null
  if (story.kind !== null) {
    if (e.key === 'Enter' || e.key === ' ') {
      // A focused button handles its own Enter; everything else advances.
      if (document.activeElement?.tagName !== 'BUTTON') { e.preventDefault(); storyPrimary() }
      else if (finishLine()) e.preventDefault()
    } else if (e.key === 'Escape') {
      if (story.kind === 'leave') storyAlt()
      else if (story.kind === 'win') dismissPrize()
      else if (story.kind === 'over') dismissGameOver()
    }
    return
  }
  if (inMenu) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveMenu(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveMenu(-1) }
    else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && menuItems()[menuIndex]?.dataset.action === 'language') {
      e.preventDefault(); cycleLanguage(e.key === 'ArrowRight' ? 1 : -1)
    } else if (e.key === 'Enter' && document.activeElement?.classList.contains('menu-item') === false) {
      e.preventDefault(); menuItems()[menuIndex]?.click()
    }
    return
  }
  if (e.key === 'Escape' && !$('game').classList.contains('hidden')) askLeave()
})

// The menu stays disabled until the level list has arrived, so the first
// press always has a door to open.
setLang(loadLang())
renderMusic()
renderSlots()
refresh().then(() => { renderMenu(); renderAiCta(); selectMenu(0) })
