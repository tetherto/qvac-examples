const $ = id => document.getElementById(id)
const fmt = n => n.toLocaleString('en-US')

let meta = null
let queryBlob = null
let queryTruth = null // [lat, lon] when the photo is an example with known coordinates
let result = null

// ---------- map (MapView lives in map.js) ----------
let base = null
const locMap = new MapView($('map'))
locMap.overlay = (m, w, h, s, layer) => {
  if (!meta) return
  if (layer === 'under-labels') { m.coverage(meta.points, s); return } // every indexed photo
  if (!result) return
  const top = result.matches[0]
  const [px, py] = m.project(top.lat, top.lon)
  // direction the matched photo was taken in
  const a = (top.heading - 90) * Math.PI / 180
  const ctx = m.ctx
  const g = ctx.createRadialGradient(px, py, 0, px, py, 46)
  g.addColorStop(0, 'rgba(0, 175, 146, 0.45)'); g.addColorStop(1, 'rgba(0, 175, 146, 0)')
  ctx.beginPath(); ctx.moveTo(px, py); ctx.arc(px, py, 46, a - 0.5, a + 0.5); ctx.closePath(); ctx.fillStyle = g; ctx.fill()
  if (queryTruth) { const [x, y] = m.project(queryTruth[0], queryTruth[1]); m.ring(x, y) }
  m.pin(px, py, MAP_STYLE.pin)
}

function resultPoints () {
  const pts = [[result.matches[0].lat, result.matches[0].lon]]
  if (queryTruth) pts.push(queryTruth)
  return pts
}

// ---------- input ----------
function setQuery (blob, url, credit, truth) {
  queryBlob = blob
  queryTruth = truth || null
  $('query-img').src = url
  $('query-img').hidden = false
  $('drop-empty').hidden = true
  $('query-credit').textContent = credit || ''
  $('query-credit').hidden = !credit
  $('go-label').textContent = 'Find this place'
  $('error').hidden = true
}

// Re-encode in the browser: applies EXIF rotation and caps the size before upload.
async function normalise (file) {
  const bmp = await createImageBitmap(file)
  const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s)
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
  return new Promise(res => c.toBlob(res, 'image/jpeg', 0.92))
}

async function useFile (file) {
  if (!file || !/^image\/(jpeg|png)$/.test(file.type)) {
    showError('Use a JPEG or PNG photo')
    return
  }
  const blob = await normalise(file)
  clearPressed()
  setQuery(blob, URL.createObjectURL(blob), '', null)
}

function clearPressed () {
  document.querySelectorAll('.ex').forEach(b => b.setAttribute('aria-pressed', 'false'))
}

const drop = $('drop')
drop.addEventListener('click', e => { if (e.target.tagName !== 'LABEL') $('file').click() })
drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file').click() } })
$('file').addEventListener('change', e => useFile(e.target.files[0]))
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over') })
drop.addEventListener('dragleave', () => drop.classList.remove('over'))
drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); useFile(e.dataTransfer.files[0]) })
addEventListener('paste', e => { const f = [...e.clipboardData.files][0]; if (f) useFile(f) })

function renderExamples () {
  const box = $('examples')
  box.innerHTML = ''
  meta.examples.forEach((ex, i) => {
    const b = document.createElement('button')
    b.className = 'ex'
    b.setAttribute('aria-pressed', 'false')
    b.setAttribute('aria-label', `Example ${i + 1}`)
    b.innerHTML = `<img src="/examples/${ex.file}" alt="">`
    b.addEventListener('click', async () => {
      const blob = await (await fetch(`/examples/${ex.file}`)).blob()
      clearPressed()
      b.setAttribute('aria-pressed', 'true')
      setQuery(blob, `/examples/${ex.file}`, ex.credit, [ex.lat, ex.lon])
    })
    box.appendChild(b)
  })
  box.parentElement.hidden = meta.examples.length === 0
}

// ---------- search ----------
function showError (msg) {
  $('error').textContent = msg
  $('error').hidden = false
}

let busy = false
async function locate () {
  if (!queryBlob) return $('file').click()
  if (busy) return
  busy = true
  const go = $('go')
  go.classList.add('busy')
  go.setAttribute('aria-busy', 'true')
  $('go-label').textContent = `Comparing with ${fmt(meta.photos)} photos`
  try {
    const res = await fetch('/api/locate', { method: 'POST', body: queryBlob, headers: { 'content-type': queryBlob.type || 'image/jpeg' } })
    const body = await res.json()
    if (!res.ok) throw new Error(body.error || `Search failed (${res.status})`)
    result = body
    const top = body.matches[0]
    const img = $('match-img')
    img.src = `/photo/${top.id}.jpg`
    img.hidden = false
    $('result-empty').hidden = true
    $('r-total').textContent = body.timing.totalMs
    $('r-embed').textContent = body.timing.embedMs
    $('r-search').textContent = body.timing.searchMs
    $('readout').hidden = false
    $('match-credit').textContent = `${top.creator || 'Mapillary contributor'}, Mapillary${top.year ? ', ' + top.year : ''}`
    $('match-credit').hidden = false
    $('s-loc').textContent = `${top.lat.toFixed(5)}, ${top.lon.toFixed(5)}, ${top.heading}°`
    $('s-score').textContent = top.score.toFixed(2)
    $('stats').hidden = false
    if (queryTruth) {
      $('s-err').textContent = `${Math.round(metres(queryTruth, [top.lat, top.lon]))} m`
    }
    $('others').innerHTML = body.matches.slice(1).map(m =>
      `<figure class="other"><img src="/photo/${m.id}.jpg" alt=""><figcaption>${m.score.toFixed(2)}</figcaption></figure>`).join('')
    $('others-wrap').hidden = false
    $('s-err-wrap').hidden = !queryTruth
    $('legend-true').hidden = !queryTruth
    locMap.flyTo(resultPoints(), 260)
  } catch (e) {
    showError(e.message === 'Failed to fetch' ? 'The demo server is not reachable. Restart it and try again.' : e.message)
  } finally {
    busy = false
    go.classList.remove('busy')
    go.removeAttribute('aria-busy')
    $('go-label').textContent = 'Find this place'
  }
}
$('go').addEventListener('click', locate)

// ---------- boot ----------
;(async () => {
  try {
    const [m, b] = await Promise.all([fetch('/api/meta').then(r => r.json()), fetch('/map.json').then(r => r.json())])
    meta = m
    base = buildBase(b)
    await document.fonts.load('500 11px Geist').catch(() => {})
    locMap.setBase(base, meta.points)
    if (window.initGame) initGame(base, meta)
  } catch {
    showError('The demo server is not reachable. Restart it and reload.')
    return
  }
  $('f-photos').textContent = fmt(meta.photos)
  if (meta.indexWallMs) {
    const s = Math.round(meta.indexWallMs / 1000)
    $('f-index').textContent = `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`
  }
  if (meta.indexMsPerPhoto) $('f-per').textContent = `${Math.round(meta.indexMsPerPhoto)} ms`
  renderExamples()
})()

// ---------- modes ----------
const MODES = [['tab-locate', 'locate'], ['tab-game', 'game']]
for (const [tab] of MODES) {
  $(tab).addEventListener('click', () => {
    for (const [t, panel] of MODES) {
      $(t).setAttribute('aria-selected', String(t === tab))
      $(panel).hidden = t !== tab
    }
  })
}
