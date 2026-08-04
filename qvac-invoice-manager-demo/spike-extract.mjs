// Spike: can we get RELIABLE structured invoice fields on-device?
//
// Two open questions this answers with measurements, before any app code is written:
//   1. TEXT path  - Qwen3 4B + responseFormat json_schema on text pulled from a PDF.
//   2. VISION path - does responseFormat json_schema work at all when the prompt carries an
//      image attachment (Qwen3-VL 2B)? The desk-tidy work measured that a 2B VLM is unreliable
//      when asked to pick from a labelled menu, so structured JSON straight out of vision is
//      NOT a safe assumption. If it fails, the app must transcribe first, then extract.
//
// Ground truth is known because the fixtures were generated (see demo/).
//
// Run: node spike-extract.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadModel, completion, unloadModel,
         QWEN3_4B_INST_Q4_K_M,
         QWEN3VL_2B_MULTIMODAL_Q4_K, MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K } from "@qvac/sdk";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEMO = path.join(HERE, "demo");

// The exact shape a user-defined template would produce.
const SCHEMA = {
  type: "object",
  properties: {
    supplier_name:  { type: "string" },
    invoice_number: { type: "string" },
    invoice_date:   { type: "string" },
    vat_id:         { type: "string" },
    currency:       { type: "string" },
    net_amount:     { type: "number" },
    vat_amount:     { type: "number" },
    total_amount:   { type: "number" },
  },
  required: ["supplier_name","invoice_number","invoice_date","vat_id","currency",
             "net_amount","vat_amount","total_amount"],
  additionalProperties: false,
};

const TRUTH = {
  atelier: { supplier_name:"Atelier Belleville SARL", invoice_number:"FA-2026-0088",
             invoice_date:"2026-07-22", vat_id:"FR40303265045", currency:"EUR",
             net_amount:2690, vat_amount:538, total_amount:3228 },
};

const SYSTEM = "You extract accounting fields from invoices. Report only what the document states. Use the document's own currency code. Amounts are plain numbers with no thousand separators. /no_think";

async function drain(run) {
  for await (const _e of run.events) { /* consume */ }
  const final = await run.final;
  return String(final?.contentText || "");
}

function compare(label, got, truth) {
  console.log(`\n  ${label}`);
  let ok = 0, n = 0;
  for (const k of Object.keys(truth)) {
    n++;
    const g = got?.[k], t = truth[k];
    const same = typeof t === "number"
      ? Math.abs(Number(g) - t) < 0.01
      : String(g || "").trim().toLowerCase() === String(t).toLowerCase();
    if (same) ok++;
    console.log(`    ${same ? "OK  " : "MISS"} ${k.padEnd(15)} got=${JSON.stringify(g)}${same ? "" : `  want=${JSON.stringify(t)}`}`);
  }
  console.log(`    -> ${ok}/${n} fields correct`);
  return { ok, n };
}

// ---------------------------------------------------------------- text path
async function textPath() {
  console.log("\n=== 1. TEXT path: pdf-parse -> Qwen3 4B + json_schema ===");
  const { default: pdfParse } = await import("pdf-parse");
  let text = "";
  try {
    const d = await pdfParse(fs.readFileSync(path.join(DEMO, "invoice-atelier.pdf")));
    text = d.text.replace(/\s+/g, " ").trim();
    console.log(`  extracted ${text.length} chars`);
  } catch (e) {
    console.log("  pdf-parse FAILED:", e.message);
    return null;
  }
  const t0 = Date.now();
  const modelId = await loadModel({ modelSrc: QWEN3_4B_INST_Q4_K_M });
  console.log(`  model loaded in ${((Date.now()-t0)/1000).toFixed(1)}s`);
  const t1 = Date.now();
  const out = await drain(completion({
    modelId,
    history: [{ role: "system", content: SYSTEM },
              { role: "user", content: `Invoice text:\n\n${text}` }],
    stream: true,
    responseFormat: { type: "json_schema", json_schema: { name: "invoice", schema: SCHEMA } },
    generationParams: { predict: 400, temp: 0 },
  }));
  console.log(`  extracted in ${((Date.now()-t1)/1000).toFixed(1)}s`);
  let parsed = null;
  try { parsed = JSON.parse(out.trim()); console.log("  valid JSON: yes"); }
  catch { console.log("  valid JSON: NO ->", out.slice(0,200)); }
  if (parsed) compare("Qwen3 4B on text", parsed, TRUTH.atelier);
  await unloadModel({ modelId });
  return parsed;
}

// ---------------------------------------------------------------- vision path
async function visionPath() {
  console.log("\n=== 2. VISION path: Qwen3-VL 2B + image attachment ===");
  const img = path.join(DEMO, "receipt-scan.png");
  const t0 = Date.now();
  const modelId = await loadModel({
    modelSrc: QWEN3VL_2B_MULTIMODAL_Q4_K.src,
    modelType: QWEN3VL_2B_MULTIMODAL_Q4_K.engine,
    modelConfig: { device: "gpu", projectionModelSrc: MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K.src, ctx_size: 8192 },
  });
  console.log(`  VLM loaded in ${((Date.now()-t0)/1000).toFixed(1)}s`);

  // 2a. structured output directly from vision (the risky assumption)
  console.log("\n  -- 2a. json_schema directly on the image --");
  let direct = null;
  const t1 = Date.now();
  try {
    const out = await drain(completion({
      modelId,
      history: [{ role: "system", content: SYSTEM },
                { role: "user", content: "Extract the accounting fields from this invoice.",
                  attachments: [{ path: img }] }],
      stream: true, kvCache: false,
      responseFormat: { type: "json_schema", json_schema: { name: "invoice", schema: SCHEMA } },
      generationParams: { predict: 400, temp: 0 },
    }));
    console.log(`  (${((Date.now()-t1)/1000).toFixed(1)}s)`);
    try { direct = JSON.parse(out.trim()); console.log("  valid JSON: yes"); }
    catch { console.log("  valid JSON: NO ->", out.slice(0,200)); }
    if (direct) compare("VLM direct json_schema", direct, TRUTH.atelier);
  } catch (e) {
    console.log("  json_schema + attachment THREW:", String(e.message || e).slice(0,180));
  }

  // 2b. two-stage: VLM transcribes, then the text model extracts
  console.log("\n  -- 2b. VLM transcribes, then text model extracts --");
  const t2 = Date.now();
  const transcript = await drain(completion({
    modelId,
    history: [{ role: "user",
                content: "Transcribe every line of text in this invoice exactly as printed, including all numbers, dates and identifiers. Output plain text only.",
                attachments: [{ path: img }] }],
    stream: true, kvCache: false,
    generationParams: { predict: 700, temp: 0 },
  }));
  console.log(`  transcribed in ${((Date.now()-t2)/1000).toFixed(1)}s, ${transcript.length} chars`);
  console.log("  transcript head:", transcript.replace(/\s+/g," ").slice(0,180));
  await unloadModel({ modelId });

  const modelId2 = await loadModel({ modelSrc: QWEN3_4B_INST_Q4_K_M });
  const out2 = await drain(completion({
    modelId: modelId2,
    history: [{ role: "system", content: SYSTEM },
              { role: "user", content: `Invoice text (OCR transcript):\n\n${transcript}` }],
    stream: true,
    responseFormat: { type: "json_schema", json_schema: { name: "invoice", schema: SCHEMA } },
    generationParams: { predict: 400, temp: 0 },
  }));
  let staged = null;
  try { staged = JSON.parse(out2.trim()); } catch { console.log("  stage-2 invalid JSON"); }
  if (staged) compare("two-stage (VLM transcribe + 4B extract)", staged, TRUTH.atelier);
  await unloadModel({ modelId: modelId2 });
  return { direct, staged };
}

try {
  const t = await textPath();
  const v = await visionPath();
  console.log("\n=== VERDICT ===");
  console.log("  text path works :", !!t);
  console.log("  vision direct   :", v?.direct ? "returned JSON" : "unusable");
  console.log("  vision two-stage:", v?.staged ? "returned JSON" : "unusable");
  process.exit(0);
} catch (e) {
  console.error("\nSPIKE FAILED:", e);
  process.exit(1);
}
