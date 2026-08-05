// WAV helpers (16-bit PCM mono) + an ffmpeg "decode anything to 16 kHz mono WAV" step.
// The header/int16 logic mirrors the SDK's own examples/tts/utils.js so TTS output plays everywhere.
const fs = require("node:fs");
const { spawn } = require("node:child_process");

function createWavHeader(dataLength, sampleRate) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + dataLength, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28); // byte rate
  h.writeUInt16LE(2, 32); // block align
  h.writeUInt16LE(16, 34); // bits per sample
  h.write("data", 36);
  h.writeUInt32LE(dataLength, 40);
  return h;
}

function int16ArrayToBuffer(samples) {
  const buf = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-32768, Math.min(32767, Math.round(samples[i] ?? 0)));
    buf.writeInt16LE(v, i * 2);
  }
  return buf;
}

// Full WAV bytes for an Int16 sample buffer (for in-memory playback, e.g. voice samples over IPC).
function wavBytes(samples, sampleRate) { const data = int16ArrayToBuffer(samples); return Buffer.concat([createWavHeader(data.length, sampleRate), data]); }

// Write an Int16 sample buffer (as returned by textToSpeech) to a real .wav file.
function writeWav(samples, sampleRate, filename) { fs.writeFileSync(filename, wavBytes(samples, sampleRate)); return filename; }

// Decode any audio/video file to a 16 kHz mono s16 WAV that Whisper accepts. Requires ffmpeg on PATH.
function toWav16k(inputPath, outPath) {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", ["-y", "-i", inputPath, "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", outPath], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let err = "";
    ff.stderr.on("data", (d) => (err += d.toString()));
    ff.on("error", (e) => reject(new Error(e.code === "ENOENT" ? "ffmpeg not found on PATH. Install it (brew install ffmpeg)." : e.message)));
    ff.on("close", (code) => (code === 0 && fs.existsSync(outPath) ? resolve(outPath) : reject(new Error("ffmpeg failed: " + err.slice(-300)))));
  });
}

module.exports = { createWavHeader, int16ArrayToBuffer, wavBytes, writeWav, toWav16k };
