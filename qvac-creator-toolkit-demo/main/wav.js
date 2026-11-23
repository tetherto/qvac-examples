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

// Decode any audio/video file to a 16 kHz mono s16 WAV for speech recognition. Requires ffmpeg on PATH.
function toWav16k(inputPath, outPath) { return toWavRate(inputPath, outPath, 16000); }

// Decode or resample any audio to a mono s16 WAV at `rate` (MOSS-TTSD wants 24 kHz references).
function toWavRate(inputPath, outPath, rate, af = null) {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", ["-y", "-i", inputPath, "-vn", ...(af ? ["-af", af] : []), "-ar", String(rate), "-ac", "1", "-c:a", "pcm_s16le", outPath], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let err = "";
    ff.stderr.on("data", (d) => (err += d.toString()));
    ff.on("error", (e) => reject(new Error(e.code === "ENOENT" ? "ffmpeg not found on PATH. Install it (brew install ffmpeg)." : e.message)));
    ff.on("close", (code) => (code === 0 && fs.existsSync(outPath) ? resolve(outPath) : reject(new Error("ffmpeg failed: " + err.slice(-300)))));
  });
}

// ---- raw interleaved PCM (AudioGen returns 48 kHz STEREO 16-bit, not the mono the TTS path assumes) ----
function pcmWavBytes(pcm, { sampleRate = 48000, channels = 2, bitsPerSample = 16 } = {}) {
  const data = Buffer.from(pcm.buffer ? pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) : pcm);
  const blockAlign = (channels * bitsPerSample) / 8;
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);                       // PCM
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * blockAlign, 28); // byte rate
  h.writeUInt16LE(blockAlign, 32);
  h.writeUInt16LE(bitsPerSample, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

// Mean level of a slice of interleaved 16-bit PCM, in dBFS. -Infinity for digital silence.
function levelDb(pcm, { channels = 2 }, fromSec = 0, toSec = Infinity, sampleRate = 48000) {
  const view = new Int16Array(pcm.buffer ? pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) : pcm);
  const frame = channels;
  const start = Math.max(0, Math.floor(fromSec * sampleRate) * frame);
  const end = Math.min(view.length, Math.floor(Math.min(toSec, view.length / frame / sampleRate) * sampleRate) * frame);
  if (end <= start) return -Infinity;
  let sum = 0;
  for (let i = start; i < end; i++) { const s = view[i] / 32768; sum += s * s; }
  const rms = Math.sqrt(sum / (end - start));
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

// Drop a silent tail. ACE-Step sometimes ends a take with several seconds of digital silence: a valid
// file that sounds broken. Measured in the 0.17 lab, so the app trims it instead of shipping it.
function trimSilentTail(pcm, { sampleRate = 48000, channels = 2 } = {}, thresholdDb = -60, windowSec = 1) {
  const view = new Int16Array(pcm.buffer ? pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) : pcm);
  const totalSec = view.length / channels / sampleRate;
  let endSec = totalSec;
  while (endSec > windowSec) {
    const db = levelDb(view, { channels }, endSec - windowSec, endSec, sampleRate);
    if (db > thresholdDb) break;
    endSec -= windowSec;
  }
  const trimmed = Math.max(0, totalSec - endSec);
  if (trimmed < windowSec) return { pcm: view, trimmedSec: 0, seconds: totalSec };
  const keep = Math.floor(endSec * sampleRate) * channels;
  return { pcm: view.subarray(0, keep), trimmedSec: trimmed, seconds: endSec };
}

// Shape the end of an ACE-Step take. The music often stops before the length asked for and the
// engine pads the rest with a low rumble (~-47 dBFS, in 22 of 22 test takes), so an absolute
// -60 dB gate misses it. Trim the TAIL only, 26 dB under the take's own level, keep 0.8 s so the last
// note rings, cap anything past 1.15x the asked length at that length, then fade out.
function shapeTail(pcm, { sampleRate = 48000, channels = 2 } = {}, askedSec = 0) {
  const view = pcm instanceof Int16Array ? pcm : new Int16Array(pcm.buffer ? pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) : pcm);
  const frames = Math.floor(view.length / channels);
  const total = frames / sampleRate;
  const rms = (fromF, toF) => { let sum = 0, n = 0; for (let i = fromF * channels; i < toF * channels; i++) { const s = view[i] / 32768; sum += s * s; n++; } return n ? 10 * Math.log10(sum / n + 1e-20) : -200; };
  const overall = rms(0, frames);
  const floor = Math.max(-70, Math.min(-35, overall - 26));
  const win = Math.round(0.1 * sampleRate);
  let endF = frames;
  while (endF > 2 * sampleRate && rms(endF - win, endF) <= floor) endF -= win;
  endF = Math.min(frames, endF + Math.round(0.8 * sampleRate));
  let fade = 0.6;
  if (askedSec && endF / sampleRate > askedSec * 1.15 + 0.5) { endF = Math.round(askedSec * sampleRate); fade = 1.5; }
  const out = view.slice(0, endF * channels);
  const fadeF = Math.min(endF, Math.round(fade * sampleRate));
  for (let f = 0; f < fadeF; f++) {
    const g = (1 - f / fadeF) ** 2;
    const base = (endF - fadeF + f) * channels;
    for (let c = 0; c < channels; c++) out[base + c] = Math.round(out[base + c] * g);
  }
  return { pcm: out, seconds: endF / sampleRate, trimmedSec: Math.max(0, total - endF / sampleRate) };
}

// The quiet stretches of an audio file, from ffmpeg's silencedetect: [{ start, end }] in seconds, plus
// the file's duration. Used to cut speech into pieces at its pauses.
function silences(inputPath, noiseDb = -32, minSec = 0.15) {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", ["-hide_banner", "-i", inputPath, "-af", `silencedetect=noise=${noiseDb}dB:d=${minSec}`, "-f", "null", "-"], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    ff.stderr.on("data", (d) => (err += d.toString()));
    ff.on("error", (e) => reject(new Error(e.code === "ENOENT" ? "ffmpeg not found on PATH. Install it (brew install ffmpeg)." : e.message)));
    ff.on("close", (code) => {
      if (code !== 0) return reject(new Error("ffmpeg failed: " + err.slice(-300)));
      const d = err.match(/Duration: (\d+):(\d+):([\d.]+)/);
      const duration = d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0;
      const quiet = []; let open = null;
      for (const m of err.matchAll(/silence_(start|end): ([\d.]+)/g)) {
        if (m[1] === "start") open = +m[2];
        else { quiet.push({ start: open ?? 0, end: +m[2] }); open = null; }
      }
      if (open !== null) quiet.push({ start: open, end: duration });
      resolve({ quiet, duration });
    });
  });
}

module.exports = { createWavHeader, int16ArrayToBuffer, wavBytes, writeWav, toWav16k, toWavRate, pcmWavBytes, levelDb, trimSilentTail, shapeTail, silences };
