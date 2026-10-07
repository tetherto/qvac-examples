// Admin console. Token kept in memory + sessionStorage; sent as Bearer.
const $ = (id) => document.getElementById(id)
let token = sessionStorage.getItem('vg_admin') || null
let levels = []
let config = {}
let selected = null

function toast (msg, kind = 'ok') {
  const t = $('toast'); t.textContent = msg; t.className = `toast show ${kind}`
  setTimeout(() => { t.className = 'toast' }, 2600)
}
function escapeHtml (s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) }

function formatReply (s) {
  return escapeHtml(String(s).replaceAll('—', ','))
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^\s*](?:[^*]*[^\s*])?)\*/g, '<strong>$1</strong>')
}

async function api (path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...opts
  })
  if (res.status === 401) { logout(); throw new Error('unauthorized') }
  return res.json().catch(() => ({}))
}

// ---- gate (setup / login) ----
async function initGate () {
  const st = await (await fetch('/api/admin/status', { headers: token ? { Authorization: 'Bearer ' + token } : {} })).json()
  if (st.authed) return showConsole()
  $('gate').classList.remove('hidden')
  $('console').classList.add('hidden')
  if (st.needsSetup) {
    $('gateTitle').textContent = 'First-run setup'
    $('gateMsg').innerHTML = 'No admin passphrase is set. Choose one now: there is <b>no default</b>. Minimum 8 characters.'
    $('gateLabel').textContent = 'New passphrase'
    $('confirmField').classList.remove('hidden')
    $('gateBtn').textContent = 'Set passphrase'
    $('gateBtn').onclick = doSetup
  } else {
    $('gateTitle').textContent = 'Admin login'
    $('gateMsg').textContent = 'Enter the admin passphrase.'
    $('gateLabel').textContent = 'Passphrase'
    $('confirmField').classList.add('hidden')
    $('gateBtn').textContent = 'Log in'
    $('gateBtn').onclick = doLogin
  }
}

async function doSetup () {
  const p = $('gatePass').value, p2 = $('gatePass2').value
  $('gateErr').textContent = ''
  if (p.length < 8) return ($('gateErr').textContent = 'Must be at least 8 characters.')
  if (p !== p2) return ($('gateErr').textContent = 'Passphrases do not match.')
  const r = await (await fetch('/api/admin/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passphrase: p }) })).json()
  if (r.ok && r.token) { setToken(r.token); showConsole() }
  else $('gateErr').textContent = r.error || 'setup failed'
}

async function doLogin () {
  const p = $('gatePass').value
  $('gateErr').textContent = ''
  const r = await (await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passphrase: p }) })).json()
  if (r.ok && r.token) { setToken(r.token); showConsole() }
  else $('gateErr').textContent = r.error || 'login failed'
}

function setToken (t) { token = t; sessionStorage.setItem('vg_admin', t) }
function logout () { token = null; sessionStorage.removeItem('vg_admin'); $('logoutBtn').classList.add('hidden'); initGate() }
$('logoutBtn').onclick = logout
$('gatePass').addEventListener('keydown', e => { if (e.key === 'Enter') $('gateBtn').click() })
$('gatePass2').addEventListener('keydown', e => { if (e.key === 'Enter') $('gateBtn').click() })

// ---- console ----
async function showConsole () {
  $('gate').classList.add('hidden')
  $('console').classList.remove('hidden')
  $('logoutBtn').classList.remove('hidden')
  await loadLevels()
}

async function loadLevels () {
  const r = await api('/api/admin/levels')
  levels = r.levels || []
  config = r.config || {}
  renderList()
  if (!selected && levels[0]) selectLevel(levels[0].id)
  else if (selected) selectLevel(selected)
}

function renderList () {
  const box = $('lvlList'); box.innerHTML = ''
  for (const l of levels) {
    const row = document.createElement('div'); row.className = 'lvlrow'
    const b = document.createElement('button')
    b.className = 'lvl pick' + (selected === l.id ? ' active' : '')
    b.innerHTML = `<span class="nm">${escapeHtml(l.name)}</span>`
    b.onclick = () => selectLevel(l.id)
    row.appendChild(b)
    box.appendChild(row)
  }
}

function guardTags (l) {
  const tag = (on, txt) => `<span class="tag ${on ? 'on' : 'off'}">${txt}</span>`
  return tag(l.inputGuard.enabled, 'input') + ' ' +
    tag(l.outputGuard.enabled && l.outputGuard.blockIfContainsPassword, l.outputGuard.fuzzy ? 'output·fuzzy' : 'output') + ' ' +
    tag(l.guardModelCheck.enabled, 'guard-model')
}

function selectLevel (id) {
  selected = id
  const l = levels.find(x => x.id === id)
  if (!l) return
  $('editTitle').innerHTML = escapeHtml(l.name) + ' &nbsp; ' + guardTags(l)
  renderList()
  renderEditForm(l)
  $('pvMsgs').innerHTML = ''
  $('atkResult').innerHTML = ''
}

function renderEditForm (l) {
  const f = $('editForm')
  f.innerHTML = `
    <div class="row">
      <div class="field"><label>Name</label><input type="text" id="e_name" value="${escapeHtml(l.name)}"></div>
      <div class="field" style="max-width:90px"><label>Order</label><input type="number" id="e_order" value="${l.order}"></div>
    </div>
    <div class="row">
      <div class="field"><label>Password (server-only)</label><input type="text" id="e_password" value="${escapeHtml(l.password)}"></div>
      <div class="field"><label>Hint (shown on doors 3 to 5 when asked; doors 1 and 2 coach the player after every attempt)</label><input type="text" id="e_hint" value="${escapeHtml(l.hint || '')}"></div>
    </div>
    <div class="row">
      <div class="field"><label>Password, Spanish (server-only, also accepted)</label><input type="text" id="e_password_es" value="${escapeHtml(l.passwordTranslations?.es || '')}"></div>
      <div class="field"><label>Password, Catalan (server-only, also accepted)</label><input type="text" id="e_password_ca" value="${escapeHtml(l.passwordTranslations?.ca || '')}"></div>
    </div>
    <div class="field"><label>Prize (shown on the win screen; include the article, e.g. "a QVAC cap")</label><input type="text" id="e_prize" value="${escapeHtml(l.prize || '')}"></div>
    <div class="field"><label>System prompt</label><textarea id="e_system">${escapeHtml(l.systemPrompt)}</textarea></div>

    <fieldset>
      <legend>Input guard (pre-model)</legend>
      <div class="chk"><input type="checkbox" id="e_ig_en" ${l.inputGuard.enabled ? 'checked' : ''}><label style="margin:0">Enabled</label></div>
      <div class="field"><label>Blocklist: one entry per line: substring, or /regex/</label><textarea id="e_ig_bl" style="min-height:120px">${escapeHtml((l.inputGuard.blocklist || []).join('\n'))}</textarea></div>
      <p class="hint">A block has the guardian write its own one-line refusal, in character, hinting that the words never reached it.</p>
    </fieldset>

    <fieldset>
      <legend>Output guard (pre-display)</legend>
      <div class="chk"><input type="checkbox" id="e_og_en" ${l.outputGuard.enabled ? 'checked' : ''}><label style="margin:0">Enabled</label></div>
      <div class="chk"><input type="checkbox" id="e_og_contains" ${l.outputGuard.blockIfContainsPassword ? 'checked' : ''}><label style="margin:0">Block if reply contains the password (in any language)</label></div>
      <div class="chk"><input type="checkbox" id="e_og_fuzzy" ${l.outputGuard.fuzzy ? 'checked' : ''}><label style="margin:0">Fuzzy match (spaced / leetspeak / reversed)</label></div>
      <p class="hint">A block here also produces a written refusal, hinting that an answer was stopped after it was spoken.</p>
    </fieldset>

    <fieldset>
      <legend>Guard-model check (2nd-pass LLM classifier)</legend>
      <div class="chk"><input type="checkbox" id="e_gm_en" ${l.guardModelCheck.enabled ? 'checked' : ''}><label style="margin:0">Enabled</label></div>
      <div class="field"><label>Classifier prompt: <code class="k">{password}</code> and <code class="k">{reply}</code> are substituted</label><textarea id="e_gm_prompt">${escapeHtml(l.guardModelCheck.prompt)}</textarea></div>
    </fieldset>

    <fieldset>
      <legend>Guess validation (the win condition)</legend>
      <div class="row">
        <div class="field"><label>Match mode</label>
          <select id="e_sv_mode">
            ${['exact', 'case_insensitive', 'trimmed', 'normalized'].map(m => `<option value="${m}" ${l.submitValidation.mode === m ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Max guesses / minute</label><input type="number" id="e_sv_rate" value="${l.submitValidation.maxGuessesPerMinute}"></div>
        <div class="field"><label>Max messages (tries) per run</label><input type="number" id="e_max_msgs" min="1" value="${l.maxMessages || 10}"></div>
      </div>
    </fieldset>

    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button id="saveBtn" class="btn">Save changes</button>
      <button id="resetLvlBtn" class="btn ghost">Reset to default</button>
      <button id="dupBtn" class="btn ghost">Duplicate</button>
      <button id="delBtn" class="btn ghost" style="margin-left:auto;color:var(--bad)">Delete</button>
    </div>`

  $('saveBtn').onclick = saveLevel
  $('resetLvlBtn').onclick = resetLevel
  $('dupBtn').onclick = duplicateLevel
  $('delBtn').onclick = deleteLevel
}

function formToLevel (l) {
  // Line-separated, not comma-separated: a regex entry like /a{1,3}/ must
  // survive a save/reload round trip intact.
  const bl = $('e_ig_bl').value.split('\n').map(s => s.trim()).filter(Boolean)
  return {
    ...l,
    name: $('e_name').value,
    order: Number($('e_order').value),
    password: $('e_password').value,
    passwordTranslations: { es: $('e_password_es').value, ca: $('e_password_ca').value },
    hint: $('e_hint').value,
    prize: $('e_prize').value,
    maxMessages: Number($('e_max_msgs').value),
    systemPrompt: $('e_system').value,
    inputGuard: { enabled: $('e_ig_en').checked, blocklist: bl },
    outputGuard: { enabled: $('e_og_en').checked, blockIfContainsPassword: $('e_og_contains').checked, fuzzy: $('e_og_fuzzy').checked },
    guardModelCheck: { enabled: $('e_gm_en').checked, prompt: $('e_gm_prompt').value },
    submitValidation: { mode: $('e_sv_mode').value, maxGuessesPerMinute: Number($('e_sv_rate').value) }
  }
}

async function saveLevel () {
  const l = levels.find(x => x.id === selected)
  const body = formToLevel(l)
  const r = await api('/api/admin/levels/' + selected, { method: 'PUT', body: JSON.stringify(body) })
  if (r.ok) { toast('Saved ✓'); await loadLevels() } else toast(r.error || 'save failed', 'bad')
}

async function resetLevel () {
  if (!confirm('Reset this level to its shipped default?')) return
  const r = await api('/api/admin/levels/' + selected + '/reset', { method: 'POST' })
  if (r.ok) { toast('Reset to default ✓'); await loadLevels() } else toast(r.error || 'no preset', 'bad')
}

async function duplicateLevel () {
  const l = formToLevel(levels.find(x => x.id === selected))
  const id = prompt('New level id (letters/numbers/dashes):', l.id + '-copy')
  if (!id) return
  const r = await api('/api/admin/levels', { method: 'POST', body: JSON.stringify({ ...l, id, name: l.name + ' (copy)', order: l.order + 1 }) })
  if (r.ok) { selected = id; toast('Duplicated ✓'); await loadLevels() } else toast(r.error || 'failed', 'bad')
}

async function deleteLevel () {
  if (!confirm('Delete this level permanently?')) return
  const r = await api('/api/admin/levels/' + selected, { method: 'DELETE' })
  if (r.ok) { selected = null; toast('Deleted'); await loadLevels() }
}

$('newBtn').onclick = async () => {
  const id = prompt('New level id (letters/numbers/dashes):', 'custom-1')
  if (!id) return
  const maxOrder = Math.max(0, ...levels.map(l => l.order))
  const body = { id, name: 'New Level', order: maxOrder + 1, password: 'CHANGEME', systemPrompt: 'You are a guardian. The secret password is CHANGEME.', hint: '' }
  const r = await api('/api/admin/levels', { method: 'POST', body: JSON.stringify(body) })
  if (r.ok) { selected = id; toast('Created ✓'); await loadLevels() } else toast(r.error || 'failed', 'bad')
}

$('resetAllBtn').onclick = async () => {
  if (!confirm('Reset ALL levels to shipped defaults? Custom levels will be lost.')) return
  const r = await api('/api/admin/reset-all', { method: 'POST' })
  if (r.ok) { selected = null; toast('All levels reset'); await loadLevels() }
}

// ---- tabs ----
document.querySelectorAll('.tabs button').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    document.querySelectorAll('.tabpane').forEach(p => p.classList.add('hidden'))
    $('tab-' + btn.dataset.tab).classList.remove('hidden')
    if (btn.dataset.tab === 'logs') loadLogs()
    if (btn.dataset.tab === 'vault') loadVault()
  }
})

// ---- test attack ----
$('atkBtn').onclick = async () => {
  if (!selected) return toast('Select a level first', 'bad')
  const message = $('atkInput').value.trim()
  if (!message) return
  $('atkBtn').disabled = true
  $('atkResult').innerHTML = '<p class="hint">Running…</p>'
  try {
    const r = await api('/api/admin/preview', { method: 'POST', body: JSON.stringify({ levelId: selected, message }) })
    renderAttack(r)
  } catch { $('atkResult').innerHTML = '<p class="hint" style="color:var(--bad)">error</p>' }
  $('atkBtn').disabled = false
}

function stage (title, ok, body) {
  const badge = ok === null ? '' : `<span class="tag ${ok ? 'on' : 'off'}">${ok ? 'ran' : 'skipped'}</span>`
  return `<div class="stage"><h4>${title} ${badge}</h4><pre>${escapeHtml(body)}</pre></div>`
}

function renderAttack (r) {
  const blocked = /BLOCKED/.test(r.verdict || '')
  let html = `<div class="verdict ${blocked ? 'block' : 'pass'}">${escapeHtml(r.verdict || '')}</div><div style="margin-top:12px">`
  html += stage('1 · Input guard', true, r.input.blocked ? `BLOCKED by rule: ${r.input.rule}` : 'passed')
  html += stage('2 · Raw model output', !!r.model, r.model ? r.model.raw : '(not reached)')
  html += stage('3 · Output guard', !!r.output, r.output ? (r.output.leaked ? `LEAK DETECTED (${r.output.how})` : 'no leak detected') : '(not reached)')
  html += stage('4 · Guard-model check', r.guardModel ? r.guardModel.checked : false,
    r.guardModel ? (r.guardModel.checked ? `verdict: ${r.guardModel.leak ? 'LEAK' : 'clean'}\nclassifier said: ${r.guardModel.verdict || ''}` : 'disabled') : '(not reached)')
  // On a block the player never sees the raw reply, only the refusal the
  // guardian wrote in its place — which is the interesting part when tuning.
  html += stage('5 · Reply shown to player', true,
    r.blockReply || (r.model ? r.model.raw : '(not reached)'))
  html += '</div>'
  $('atkResult').innerHTML = html
}

// ---- preview chat ----
async function readSSE (res, onEvent) {
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let idx
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2)
      let ev = 'message', data = ''
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event: ')) ev = line.slice(7)
        else if (line.startsWith('data: ')) data += line.slice(6)
      }
      try { onEvent(ev, data ? JSON.parse(data) : {}) } catch {}
    }
  }
}

function pvMsg (cls, text) {
  const d = document.createElement('div'); d.className = 'msg ' + cls; d.textContent = text
  $('pvMsgs').appendChild(d); $('pvMsgs').scrollTop = $('pvMsgs').scrollHeight; return d
}

async function pvSend () {
  if (!selected) return
  const msg = $('pvInput').value.trim(); if (!msg) return
  $('pvInput').value = ''
  pvMsg('user', msg)
  const bot = pvMsg('bot', ''); bot.innerHTML = '<span class="dots"></span>'
  let got = '', blockedAt = null
  try {
    const res = await fetch('/api/admin/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ levelId: selected, message: msg })
    })
    await readSSE(res, (ev, data) => {
      if (ev === 'token') { got += data.token; bot.innerHTML = formatReply(got) + '<span class="cursor">▍</span>' }
      else if (ev === 'message') { got = data.text; bot.innerHTML = formatReply(got) }
      else if (ev === 'done') { blockedAt = data.blockedAt }
      else if (ev === 'error') { got = '⚠️ ' + data.error; bot.innerHTML = formatReply(got) }
    })
  } catch { got = '⚠️ error' }
  bot.innerHTML = formatReply(got || '…')
  if (blockedAt) bot.classList.add('blocked')
}
$('pvSend').onclick = pvSend
$('pvInput').addEventListener('keydown', e => { if (e.key === 'Enter') pvSend() })
$('pvReset').onclick = async () => { await api('/api/reset', { method: 'POST', body: JSON.stringify({ levelId: selected }) }); $('pvMsgs').innerHTML = '' }

// ---- physical vault ----
function vaultOutcome (r) {
  if (r.skipped) return `skipped (${r.skipped})`
  if (r.ok) return r.dryRun ? 'dry run, no pulse sent' : '✅ pulsed'
  return `❌ ${r.error || 'HTTP ' + r.status}`
}

function renderVault (s) {
  $('vaultEnabled').checked = !!s.enabled
  const rows = [
    ['Player unlock', s.enabled ? 'on: pulse the relay' : 'off: return to the opening screen'],
    ['Mode', s.mode],
    ['Relay', s.url || 'not configured'],
    ['Safety off after', s.pulseMs ? s.pulseMs + ' ms' : 'device only'],
    ['Last pulse', s.lastFire ? new Date(s.lastFire).toLocaleTimeString() : 'never'],
    ['Last result', s.lastResult ? vaultOutcome(s.lastResult) : 'none']
  ]
  $('vaultStatus').innerHTML = rows
    .map(([k, v]) => `<div class="stage" style="padding:8px 12px"><span class="tag">${k}</span> ${escapeHtml(v)}</div>`)
    .join('')
}

async function loadVault () {
  try { renderVault(await api('/api/admin/vault')) } catch { $('vaultStatus').innerHTML = '<p class="hint" style="color:var(--bad)">error</p>' }
}

$('vaultEnabled').onchange = async () => {
  const enabled = $('vaultEnabled').checked
  try {
    const r = await api('/api/admin/vault', { method: 'PUT', body: JSON.stringify({ enabled }) })
    if (!r.ok) throw new Error(r.error || 'save failed')
    toast(enabled ? 'Vault door opening on' : 'Vault door opening off')
    renderVault(r)
  } catch {
    $('vaultEnabled').checked = !enabled
    toast('Could not save vault setting', 'bad')
  }
}

$('vaultTestBtn').onclick = async () => {
  $('vaultTestBtn').disabled = true
  try {
    const r = await api('/api/admin/vault/test', { method: 'POST', body: '{}' })
    toast(vaultOutcome(r), r.ok ? 'ok' : 'bad')
    if (r.door) renderVault(r.door)
  } catch { toast('Test failed', 'bad') }
  $('vaultTestBtn').disabled = false
}

// ---- logs ----
async function loadLogs () {
  const r = await api('/api/admin/logs')
  const box = $('logList')
  if (!r.logs || !r.logs.length) { box.innerHTML = '<p class="hint">No entries yet.</p>'; return }
  box.innerHTML = r.logs.map(e => {
    const time = new Date(e.ts).toLocaleTimeString()
    let desc
    if (e.kind === 'guess') desc = `guess on ${e.levelId}: ${e.correct ? '✅ correct' : '❌ wrong'}`
    else if (e.kind === 'gameover') desc = `game over on ${e.levelId}: 💀 run ended with ${e.cleared} cleared`
    else if (e.kind === 'vault') desc = `vault unlock${e.test ? ' (test)' : ''}: ${vaultOutcome(e)}`
    else if (e.kind === 'restart') desc = 'run abandoned, back to the start'
    else desc = `chat on ${e.levelId}${e.admin ? ' (admin)' : ''}: ${e.blockedAt ? '🛑 blocked at ' + e.blockedAt : '✓ passed'}`
    let turn = ''
    if (e.message || e.reply) {
      const player = e.message ? `<h4>player</h4><pre>${escapeHtml(e.message)}</pre>` : ''
      // Only present when the player was not writing English, since that is
      // the only time the guards read something other than what was typed.
      const read = e.english ? `<h4>read as</h4><pre>${escapeHtml(e.english)}</pre>` : ''
      const guardian = e.reply ? `<h4>guardian</h4><pre>${escapeHtml(e.reply)}</pre>` : ''
      turn = player + read + guardian
    }
    return `<div class="stage" style="padding:8px 12px"><span class="tag">${time}</span> ${escapeHtml(desc)}${turn}</div>`
  }).join('')
}
$('clearLogs').onclick = async () => { await api('/api/admin/logs', { method: 'DELETE' }); loadLogs() }

initGate()
