// Experiment 1b: give the VISION model the same flat PDF TEXT the text model gets.
//
// This is the one measurement the two-model architecture rests on, and it was missing. The README
// and the recipe claimed "the VLM on flat text scored 7/8 and confused net with total", citing
// spike-extract.mjs, which never ran that experiment. Either the number is real and it should be
// reproducible, or it should not be quoted. This settles it.
//
// Run: node spike-vlm-on-text.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEMO = path.join(path.dirname(fileURLToPath(import.meta.url)), "demo");

const S = await import("@qvac/sdk");
const { loadModel, unloadModel, completion } = S;

const SCHEMA = {
  type: "object",
  properties: {
    supplier_name:  { type: "string" },
    invoice_number: { type: "string" },
    invoice_date:   { type: "string", description: "YYYY-MM-DD" },
    vat_id:         { type: "string" },
    currency:       { type: "string", description: "3-letter ISO code" },
    net_amount:     { type: "number", description: "total before tax" },
    vat_amount:     { type: "number", description: "the tax amount only" },
    total_amount:   { type: "number", description: "final amount due including tax" },
  },
  required: ["supplier_name", "invoice_number", "invoice_date", "vat_id", "currency",
             "net_amount", "vat_amount", "total_amount"],
  additionalProperties: false,
};

const TRUTH = {
  supplier_name: "Atelier Belleville SARL", invoice_number: "FA-2026-0088",
  invoice_date: "2026-07-22", vat_id: "FR40303265045", currency: "EUR",
  net_amount: 2690, vat_amount: 538, total_amount: 3228,
};

const SYSTEM = "You extract accounting fields from invoices. Report only what the document states. Use the document's own currency code. Amounts are plain numbers with no thousand separators. /no_think";

async function drain(run) {
  for await (const _e of run.events) { /* consume */ }
  return String((await run.final)?.contentText || "");
}

function compare(label, got) {
  console.log(`\n  ${label}`);
  let ok = 0, n = 0;
  const misses = [];
  for (const k of Object.keys(TRUTH)) {
    n++;
    const g = got?.[k], t = TRUTH[k];
    const same = typeof t === "number" ? Math.abs(Number(g) - t) < 0.01
      : String(g || "").trim().toLowerCase() === String(t).toLowerCase();
    if (same) ok++; else misses.push(`${k} got=${JSON.stringify(g)} want=${JSON.stringify(t)}`);
    console.log(`    ${same ? "OK  " : "MISS"} ${k.padEnd(15)} got=${JSON.stringify(g)}${same ? "" : `  want=${JSON.stringify(t)}`}`);
  }
  console.log(`    -> ${ok}/${n} fields correct`);
  return { ok, n, misses };
}

const { default: pdfParse } = await import("pdf-parse");
const bytes = new Uint8Array(fs.readFileSync(path.join(DEMO, "invoice-atelier.pdf")));
const text = (await pdfParse(bytes, { max: 1 })).text.replace(/\s+/g, " ").trim();
console.log(`\nflat text from the PDF: ${text.length} chars`);

async function run(label, load) {
  const t0 = Date.now();
  const modelId = await load();
  console.log(`\n${label}: loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const t1 = Date.now();
  const out = await drain(completion({
    modelId,
    history: [{ role: "system", content: SYSTEM },
              { role: "user", content: `Invoice text:\n\n${text}` }],
    stream: true,
    kvCache: false,
    responseFormat: { type: "json_schema", json_schema: { name: "invoice", schema: SCHEMA } },
    generationParams: { predict: 400, temp: 0 },
  }));
  console.log(`  extracted in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  let parsed = null;
  try { parsed = JSON.parse(out.trim()); } catch { console.log("  invalid JSON:", out.slice(0, 200)); }
  const r = parsed ? compare(label, parsed) : { ok: 0, n: 8, misses: ["no parseable output"] };
  await unloadModel({ modelId, clearStorage: false });
  return r;
}

// Same input, same schema, same prompt. Only the model differs.
const vlm = await run("Qwen3-VL 2B on FLAT TEXT", () => loadModel({
  modelSrc: S.QWEN3VL_2B_MULTIMODAL_Q4_K.src,
  modelType: S.QWEN3VL_2B_MULTIMODAL_Q4_K.engine,
  modelConfig: {
    device: "gpu",
    projectionModelSrc: S.MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K.src,
    ctx_size: 8192,
  },
}));

const txt = await run("Qwen3 4B on FLAT TEXT", () => loadModel({ modelSrc: S.QWEN3_4B_INST_Q4_K_M }));

console.log("\n================ VERDICT ================");
console.log(`Qwen3-VL 2B on flat text : ${vlm.ok}/${vlm.n}`);
console.log(`Qwen3 4B    on flat text : ${txt.ok}/${txt.n}`);
if (vlm.misses.length) console.log(`VLM missed: ${vlm.misses.join(" | ")}`);
if (txt.misses.length) console.log(`4B  missed: ${txt.misses.join(" | ")}`);
console.log(txt.ok > vlm.ok
  ? "\n-> The text model is measurably better on flat text. Two models is justified."
  : vlm.ok === txt.ok
    ? "\n-> They tie on flat text. The two-model split is NOT justified by accuracy on this fixture."
    : "\n-> The VLM is better even on flat text. The architecture should be reconsidered.");
process.exit(0);
