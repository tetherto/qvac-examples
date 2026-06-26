import { loadModel, unloadModel, transcribeStream, WHISPER_LARGE_V3_TURBO, VAD_SILERO_5_1_2 } from "@qvac/sdk";
import fs from "node:fs";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const t0 = Date.now();
const asr = await loadModel({ modelSrc: WHISPER_LARGE_V3_TURBO, modelConfig: {
  vadModelSrc: VAD_SILERO_5_1_2, audio_format: "f32le", language: "auto", detect_language: true,
  no_timestamps: true, suppress_blank: true, temperature: 0.0 } });
console.log("WHISPER+VAD+auto LOADED OK in", ((Date.now()-t0)/1000).toFixed(0)+"s");
const session = await transcribeStream({ modelId: asr, metadata: true });
const utters = [];
const consumer = (async () => { for await (const u of session) { utters.push(u); console.log("EV:", JSON.stringify(u).slice(0,200)); } })();
for (const lang of ["fr","it"]) {
  const f32 = fs.readFileSync(`/tmp/pk/${lang}.f32`).length ? fs.readFileSync(`/tmp/pk/${lang}.f32`) : null;
  if (!f32) { // build it
    const { execSync } = await import("node:child_process");
    execSync(`ffmpeg -y -i /tmp/pk/${lang}.wav -ar 16000 -ac 1 -f f32le /tmp/pk/${lang}.f32`, { stdio: "ignore" });
  }
  const buf = fs.readFileSync(`/tmp/pk/${lang}.f32`);
  const CH = 6400;
  for (let i = 0; i < buf.length; i += CH) { session.write(new Uint8Array(buf.buffer, buf.byteOffset + i, Math.min(CH, buf.length - i))); await sleep(10); }
  const sil = new Uint8Array(6400); for (let i = 0; i < 20; i++) { session.write(sil); await sleep(10); }
  await sleep(1500);
}
await sleep(1000);
try { session.end(); } catch {}
await Promise.race([consumer, sleep(4000)]);
console.log("TOTAL EVENTS:", utters.length);
await unloadModel({ modelId: asr });
console.log("WVAD_SPIKE_DONE"); process.exit(0);
