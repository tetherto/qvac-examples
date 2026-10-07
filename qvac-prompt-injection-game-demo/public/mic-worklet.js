// Mic capture worklet: gates the room noise between words, batches the
// 128-sample render quanta into ~256ms frames and ships them to the page,
// which forwards them to the server's whisper session. The AudioContext is
// created at 16 kHz, so no resampling here.
const FRAME_SAMPLES = 4096

// Adaptive noise gate (a downward expander). The noise floor follows the
// quietest stretches: it drops to a new minimum at once and creeps up slowly,
// so the pauses inside a sentence keep pulling it back to the room's level.
// Starting low with the gate open means the first word of a push-to-talk
// recording is never clipped while the floor learns the room.
const FLOOR_INIT = 0.002 // RMS, about -54 dBFS
const FLOOR_MIN = 0.0003 // keeps digital silence from pinning the gate open
const FLOOR_RISE_S = 2
// Hysteresis between opening and closing stops the gate chattering on
// consonants that sit just above the floor.
const OPEN_RATIO = 3.2 // about +10 dB over the floor
const CLOSE_RATIO = 2.0
const HOLD_S = 0.2
const ATTACK_S = 0.005
const RELEASE_S = 0.06
// Attenuate rather than mute: Silero reads near-silence more predictably than
// digital silence, and the ramps stay click-free.
const CLOSED_GAIN = 0.1 // -20 dB

class MicProcessor extends AudioWorkletProcessor {
  constructor () {
    super()
    this.frame = new Float32Array(FRAME_SAMPLES)
    this.filled = 0
    this.gated = new Float32Array(128)

    this.floor = FLOOR_INIT
    this.open = true
    this.gain = 1
    this.holdSamples = Math.round(HOLD_S * sampleRate)
    this.hold = this.holdSamples
    this.attack = 1 - Math.exp(-1 / (ATTACK_S * sampleRate))
    this.release = 1 - Math.exp(-1 / (RELEASE_S * sampleRate))
  }

  gate (channel) {
    const n = channel.length
    if (this.gated.length !== n) this.gated = new Float32Array(n)

    let sum = 0
    for (let i = 0; i < n; i++) sum += channel[i] * channel[i]
    const rms = Math.sqrt(sum / n)

    if (rms < this.floor) this.floor = rms
    else this.floor += (rms - this.floor) * (1 - Math.exp(-n / (FLOOR_RISE_S * sampleRate)))
    if (this.floor < FLOOR_MIN) this.floor = FLOOR_MIN

    if (rms > this.floor * OPEN_RATIO) {
      this.open = true
      this.hold = this.holdSamples
    } else if (rms > this.floor * CLOSE_RATIO) {
      if (this.open) this.hold = this.holdSamples
    } else if (this.open) {
      this.hold -= n
      if (this.hold <= 0) this.open = false
    }

    const target = this.open ? 1 : CLOSED_GAIN
    const coef = target > this.gain ? this.attack : this.release
    for (let i = 0; i < n; i++) {
      this.gain += (target - this.gain) * coef
      this.gated[i] = channel[i] * this.gain
    }
    return this.gated
  }

  process (inputs) {
    const input = inputs[0]?.[0]
    // No input connected yet (or the track ended) — keep the node alive.
    if (!input) return true
    const channel = this.gate(input)

    let read = 0
    while (read < channel.length) {
      const take = Math.min(FRAME_SAMPLES - this.filled, channel.length - read)
      this.frame.set(channel.subarray(read, read + take), this.filled)
      this.filled += take
      read += take
      if (this.filled === FRAME_SAMPLES) {
        // Transferred, so allocate a fresh buffer for the next frame.
        this.port.postMessage(this.frame.buffer, [this.frame.buffer])
        this.frame = new Float32Array(FRAME_SAMPLES)
        this.filled = 0
      }
    }
    return true
  }
}

registerProcessor('mic-processor', MicProcessor)
