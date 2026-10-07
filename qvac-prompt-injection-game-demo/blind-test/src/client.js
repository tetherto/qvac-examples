// Player-side HTTP client for the blind-test harness. Speaks only the public
// player API — the same endpoints the browser SPA uses — so the harness never
// has a route to a password.
//
// The session cookie is held here rather than handed to the agent: the server
// keys the message budget and solve progress off `vg_sid`, so losing it
// between turns would silently hand the player a fresh set of tries.

const PLAYER_LANG = 'en' // English keeps /api/chat streaming and skips the NMT pass.

export class GameClient {
  constructor (baseUrl) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, '')
    this.sid = null
  }

  get sessionId () {
    return this.sid
  }

  // Captures vg_sid the first time the server issues one and replays it after.
  #headers (extra = {}) {
    const headers = { 'Content-Type': 'application/json', ...extra }
    if (this.sid) headers.Cookie = `vg_sid=${this.sid}`
    return headers
  }

  #captureSid (res) {
    const raw = res.headers.getSetCookie?.() ?? []
    for (const cookie of raw) {
      const m = /^vg_sid=([^;]+)/.exec(cookie)
      if (m) this.sid = decodeURIComponent(m[1])
    }
  }

  async #json (path, { method = 'GET', body } = {}) {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: this.#headers(),
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    this.#captureSid(res)
    const data = await res.json().catch(() => ({}))
    return { status: res.status, data }
  }

  // Liveness probe used when waiting for a spawned server to finish loading
  // the model.
  async ping () {
    try {
      const res = await fetch(this.baseUrl + '/api/state?lang=' + PLAYER_LANG, { method: 'GET' })
      return res.ok
    } catch {
      return false
    }
  }

  async state () {
    const { status, data } = await this.#json('/api/state?lang=' + PLAYER_LANG)
    if (status !== 200) throw new Error(`GET /api/state failed (${status})`)
    return data
  }

  async guess (levelId, word) {
    const { status, data } = await this.#json('/api/guess', {
      method: 'POST',
      body: { levelId, guess: word, lang: PLAYER_LANG }
    })
    if (status === 429) return { rateLimited: true, ...data }
    if (status >= 400) throw new Error(data.error || `POST /api/guess failed (${status})`)
    return data
  }

  async resetConversation (levelId) {
    const { status, data } = await this.#json('/api/reset', { method: 'POST', body: { levelId } })
    if (status >= 400) throw new Error(data.error || `POST /api/reset failed (${status})`)
    return data
  }

  // One chat turn. /api/chat is SSE; the whole turn is collapsed into a single
  // object because the agent reads a finished reply, not a stream. `coaching`
  // is the server announcing a hint is coming, so a turn that announces one
  // and never sends it is reported as a coach failure rather than silence.
  //
  // `onStream` is for a spectator watching the turn happen, which does want the
  // stream. It sees each frame as it lands; the agent still gets the whole
  // reply at the end.
  async chat (levelId, message, onStream) {
    const res = await fetch(this.baseUrl + '/api/chat', {
      method: 'POST',
      headers: this.#headers(),
      body: JSON.stringify({ levelId, message, lang: PLAYER_LANG })
    })
    this.#captureSid(res)

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return { ok: false, error: err.error || `chat failed (${res.status})`, messagesLeft: err.messagesLeft }
    }

    const turn = { ok: true, reply: '', hint: null, blockedAt: null, messagesLeft: null, coachingPromised: false }
    for await (const { event, data } of readSSE(res)) {
      if (onStream) onStream(event, data)
      if (event === 'token') turn.reply += data.token ?? ''
      else if (event === 'message') turn.reply = data.text ?? ''
      else if (event === 'coaching') turn.coachingPromised = true
      else if (event === 'hint') turn.hint = data.hint ?? null
      else if (event === 'done') {
        turn.blockedAt = data.blockedAt ?? null
        turn.messagesLeft = data.messagesLeft ?? null
      } else if (event === 'error') {
        turn.ok = false
        turn.error = data.error || 'model error'
        turn.messagesLeft = data.messagesLeft ?? null
      }
    }
    return turn
  }
}

// Minimal SSE reader: frames split on a blank line, `event:` and `data:` lines
// within. Mirrors readSSE() in public/app.js.
async function * readSSE (res) {
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
      let event = 'message'
      let data = ''
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7)
        else if (line.startsWith('data: ')) data += line.slice(6)
      }
      let parsed = {}
      try { parsed = data ? JSON.parse(data) : {} } catch { parsed = {} }
      yield { event, data: parsed }
    }
  }
}
