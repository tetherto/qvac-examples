import { loadModel, unloadModel, transcribeStream, WHISPER_LARGE_V3_TURBO, VAD_SILERO_5_1_2 } from "@qvac/sdk";
import fs from "node:fs";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let asr;
try {
  asr = await loadModel({ modelSrc: WHISPER_LARGE_V3_TURBO, modelType: "whisper", modelConfig: {
    vadModelSrc: VAD_SILERO_5_1_2, audio_format: "f32le", language: "auto", detect_language: true,
    strategy: "greedy", n_threads: 4, no_timestamps: true, temperature: 0.0 } });
  console.log("LOAD OK (modelType:whisper + language:auto + detect_language)");
} catch (e) { console.log("LOAD FAILED:", String(e.message).slice(0,160)); process.exit(2); }
const session = await transcribeStream({ modelId: asr });
const utters = [];
const consumer = (async () => { for await (const u of session) { utters.push(String(u)); console.log("UTTER:", JSON.stringify(String(u)).slice(0,120)); } })();
const f32 = fs.readFileSync("/tmp/pk/fr.f32");
const CH = 6400;
for (let i=0;i<f32.length;i+=CH){ session.write(new Uint8Array(f32.buffer, f32.byteOffset+i, Math.min(CH,f32.length-i))); await sleep(10); }
const sil = new Uint8Array(6400); for (let i=0;i<25;i++){ session.write(sil); await sleep(10); }
await sleep(2500); try { session.end(); } catch {}
await Promise.race([consumer, sleep(4000)]);
console.log("UTTERANCES:", utters.length, "| FRENCH-LIKE:", utters.some(u=>/voudrais|cappuccino|avoine|lait/i.test(u)));
await unloadModel({ modelId: asr });
console.log("WAUTO_DONE"); process.exit(0);
