// The machine-readable half of a run, for the browser's AI-vs-AI screen.
//
// The CLI's stdout is human progress text, so events ride the same pipe behind
// a sentinel prefix: the server picks the tagged lines out and forwards them,
// and everything else stays a readable log. The stream does not exist unless
// --ui-events is passed, so a standalone blind test is untouched.
export const EVENT_PREFIX = 'VG_EVENT '

const OFF = { enabled: false, emit () {} }

export function createReporter (enabled) {
  if (!enabled) return OFF
  return {
    enabled: true,
    emit (type, payload = {}) {
      process.stdout.write(EVENT_PREFIX + JSON.stringify({ type, at: Date.now(), ...payload }) + '\n')
    }
  }
}

// A beat for the viewer's sake: the page types what the player is about to say
// into the composer, and typing over an HTTP call already in flight would land
// the reply before the question finished appearing. Nothing else waits on these,
// and with the stream off they cost nothing at all.
export function paced (reporter, ms) {
  if (!reporter?.enabled) return Promise.resolve()
  return new Promise(resolve => setTimeout(resolve, ms))
}
