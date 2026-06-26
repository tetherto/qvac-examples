import { loadModel, unloadModel, transcribe, PARAKEET_TDT_0_6B_V3_Q8_0 } from "@qvac/sdk";
const t0 = Date.now();
console.log("loading PARAKEET_TDT_0_6B_V3_Q8_0 (multilingual; downloads first time)...");
let lastPct = -1;
const id = await loadModel({ modelSrc: PARAKEET_TDT_0_6B_V3_Q8_0, modelType: "parakeet-transcription",
  onProgress: (p) => { if (p?.percentage != null) { const r = Math.floor(p.percentage/20)*20; if (r>lastPct){lastPct=r; console.log("  dl "+r+"%");} } } });
console.log("loaded in", ((Date.now()-t0)/1000).toFixed(0)+"s");
for (const f of ["en","fr","it"]) {
  try {
    const txt = await transcribe({ modelId: id, audioChunk: `/tmp/pk/${f}.wav` });
    console.log(`[${f}] text: ${JSON.stringify(txt)}`);
    const meta = await transcribe({ modelId: id, audioChunk: `/tmp/pk/${f}.wav`, metadata: true });
    console.log(`[${f}] meta: ${JSON.stringify(meta).slice(0,400)}`);
  } catch (e) { console.log(`[${f}] ERROR: ${e.message}`); }
}
await unloadModel({ modelId: id });
console.log("PK_SPIKE_DONE");
