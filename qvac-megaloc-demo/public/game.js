// You vs MegaLoc: a street photo that is NOT in the index, the player drops a pin, then MegaLoc
// searches live and both answers are scored by distance to where the photo was really taken.
// Challenges: demo/challenges/challenges.json (Wikimedia Commons, inside the indexed area).
window.initGame = function initGame (base, meta) {
  const ROUNDS = 5
  const $ = id => document.getElementById(id)
  let pool = []
  let rounds = [] // { c, guess, you, model, youMs, modelMs, top }
  let i = 0
  let guess = null
  let state = 'loading' // loading | guess | thinking | reveal | done
  let shownAt = 0

  const gMap = new MapView($('g-map'), {
    onTap: ll => {
      if (state !== 'guess') return
      guess = ll
      gMap.draw()
      setButton()
    },
  })
  gMap.overlay = (m, w, h, s, layer) => {
    if (layer !== 'top') return
    const r = rounds[i]
    if ((state === 'reveal' || state === 'done') && r) {
      const truth = m.project(r.c.lat, r.c.lon)
      const you = m.project(r.guess[0], r.guess[1])
      const model = m.project(r.top.lat, r.top.lon)
      m.dashed(truth, you, MAP_STYLE.you)
      m.dashed(truth, model, MAP_STYLE.pin)
      m.ring(truth[0], truth[1])
      m.pin(you[0], you[1], MAP_STYLE.you)
      m.pin(model[0], model[1], MAP_STYLE.pin)
      return
    }
    if (guess) { const [x, y] = m.project(guess[0], guess[1]); m.pin(x, y, MAP_STYLE.you) }
  }
  gMap.setBase(base, meta.points)

  // keyboard: Enter or Space drops the pin at the centre of the map
  $('g-map').addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && state === 'guess' && gMap.view) {
      e.preventDefault()
      guess = [gMap.view.cy, gMap.view.cx]
      gMap.draw(); setButton()
    }
  })

  function shuffle (a) {
    for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [a[k], a[j]] = [a[j], a[k]] }
    return a
  }

  // 3 photos MegaLoc gets right and 2 it gets wrong (measured offline), in random order
  function pickRounds () {
    const hits = shuffle(pool.filter(c => c.measured.kind === 'hit')).slice(0, 3)
    const miss = shuffle(pool.filter(c => c.measured.kind === 'miss')).slice(0, 2)
    return shuffle([...hits, ...miss]).map(c => ({ c }))
  }

  function score () {
    const done = rounds.filter(r => r.you !== undefined)
    const you = done.filter(r => r.you < r.model).length
    $('g-you').textContent = you
    $('g-model').textContent = done.length - you
  }

  function setButton () {
    const label = $('g-go-label')
    const btn = $('g-go')
    btn.classList.toggle('busy', state === 'thinking')
    if (state === 'guess') label.textContent = guess ? 'Lock my guess' : 'Drop a pin on the map'
    else if (state === 'thinking') label.textContent = `MegaLoc is comparing ${meta.photos.toLocaleString('en-US')} photos`
    else if (state === 'reveal') label.textContent = i === ROUNDS - 1 ? 'See the results' : 'Next round'
    else if (state === 'done') label.textContent = 'Play again'
  }

  function showRound () {
    const r = rounds[i]
    guess = null
    state = 'guess'
    $('g-round').textContent = `Round ${i + 1} of ${ROUNDS}`
    $('g-photo').src = `/challenges/${r.c.file}`
    $('g-credit').textContent = r.c.credit
    $('g-reveal').hidden = true
    $('g-summary').hidden = true
    $('g-photo-card').hidden = false
    gMap.flyTo(meta.points, 60)
    shownAt = performance.now()
    setButton()
  }

  async function lock () {
    const r = rounds[i]
    r.guess = guess
    r.youMs = performance.now() - shownAt
    state = 'thinking'; setButton()
    try {
      const blob = await (await fetch(`/challenges/${r.c.file}`)).blob()
      const res = await fetch('/api/locate', { method: 'POST', body: blob, headers: { 'content-type': 'image/jpeg' } })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || `Search failed (${res.status})`)
      r.top = body.matches[0]
      r.modelMs = body.timing.totalMs
    } catch (e) {
      state = 'guess'; setButton()
      $('g-error').textContent = e.message === 'Failed to fetch' ? 'The demo server is not reachable. Restart it and try again.' : e.message
      $('g-error').hidden = false
      return
    }
    $('g-error').hidden = true
    const truth = [r.c.lat, r.c.lon]
    r.you = metres(truth, r.guess)
    r.model = metres(truth, [r.top.lat, r.top.lon])
    state = 'reveal'
    $('g-you-d').textContent = fmtDistance(r.you)
    $('g-you-t').textContent = `${(r.youMs / 1000).toFixed(1)} s`
    $('g-model-d').textContent = fmtDistance(r.model)
    $('g-model-t').textContent = `${(r.modelMs / 1000).toFixed(2)} s`
    const youWin = r.you < r.model
    $('g-reveal').classList.toggle('you-won', youWin)
    $('g-verdict').textContent = youWin ? 'You win this round' : 'MegaLoc wins this round'
    $('g-reveal').hidden = false
    score()
    gMap.flyTo([truth, r.guess, [r.top.lat, r.top.lon]], 120)
    setButton()
  }

  function summary () {
    state = 'done'
    const you = rounds.filter(r => r.you < r.model).length
    const model = ROUNDS - you
    const avg = k => fmtDistance(rounds.reduce((a, r) => a + r[k], 0) / ROUNDS)
    $('g-final').textContent = you > model ? `You win ${you} to ${model}` : `MegaLoc wins ${model} to ${you}`
    $('g-rows').innerHTML = rounds.map((r, k) => `
      <tr><td><img src="/challenges/${r.c.file}" alt=""></td><td>Round ${k + 1}</td>
      <td class="num ${r.you < r.model ? 'win' : ''}">${fmtDistance(r.you)}</td>
      <td class="num ${r.you < r.model ? '' : 'win'}">${fmtDistance(r.model)}</td></tr>`).join('')
    $('g-avg-you').textContent = avg('you')
    $('g-avg-model').textContent = avg('model')
    $('g-photo-card').hidden = true
    $('g-reveal').hidden = true
    $('g-summary').hidden = false
    setButton()
  }

  function newGame () {
    rounds = pickRounds()
    i = 0
    score()
    showRound()
  }

  $('g-go').addEventListener('click', () => {
    if (state === 'guess') {
      if (!guess) { $('g-map').focus(); $('g-map-card').classList.add('nudge'); setTimeout(() => $('g-map-card').classList.remove('nudge'), 400); return }
      lock()
    } else if (state === 'reveal') {
      if (i === ROUNDS - 1) summary(); else { i++; showRound() }
    } else if (state === 'done') newGame()
  })

  fetch('/api/challenges').then(r => r.json()).then(list => {
    pool = list
    if (pool.length < ROUNDS) { $('g-error').textContent = 'No challenge photos found'; $('g-error').hidden = false; return }
    newGame()
  }).catch(() => { $('g-error').textContent = 'The demo server is not reachable. Restart it and reload.'; $('g-error').hidden = false })
}
