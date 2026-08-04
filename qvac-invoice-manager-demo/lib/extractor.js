// The extraction engine, 100% on-device. Two models: one reads text, one looks at pixels.
//
// WHAT IS ACTUALLY MEASURED (spike-extract.mjs and spike-vlm-on-text.mjs, on the Atelier fixture):
//   - Qwen3 4B on PDF text                      -> 8/8 fields
//   - Qwen3-VL 2B on the IMAGE with json_schema -> 8/8 fields. Structured output DOES survive a
//     vision attachment, which was the risky assumption going in, so a scan needs exactly one
//     call and no separate transcribe step.
//   - Qwen3-VL 2B on the same FLAT TEXT         -> 8/8 fields. They TIE.
//
// That last line corrects an earlier claim in this file that the VLM scored 7/8 on flat text and
// confused the net amount with the total. It does not, on this fixture. The number had been written
// down without the experiment ever being run; running it refuted it.
//
// So: accuracy on this one document does NOT justify shipping two models, and the leading
// simplification is now to drop the text model and let the VLM do both (it is also the smaller
// download). That is not done here because one fixture is thin evidence to re-architect on, and a
// 2B model has more room to degrade on long or badly scanned real invoices. Measure on a real
// folder before collapsing it.
//
// Both are lazy: a folder of text PDFs never downloads the VLM, and a folder of scans never
// downloads the text model.
"use strict";
const { schemaForTemplate, promptForTemplate, coerce, checkArithmetic } = require("./schema");

// The SDK is ESM; dynamic import is the pattern the QVAC Electron examples use, and it behaves
// the same under plain Node (so this file stays headless-testable) and in Electron's main process.
let _sdk = null;
async function sdk() { if (!_sdk) _sdk = await import("@qvac/sdk"); return _sdk; }

const SYSTEM = "You are a bookkeeping assistant. You read invoices and receipts and report their fields exactly as printed. You never invent values. /no_think";

// How long a model load may go with no progress at all before we call it a deadlock. A cached load
// takes about 20s, so this leaves a wide margin.
const QUIET_MS = 120000;

class Extractor {
  // quietMs is injectable so the watchdog can be tested in milliseconds instead of two minutes.
  constructor({ quietMs = QUIET_MS } = {}) {
    this.textId = null;
    this.visionId = null;
    this._loadingText = null;
    this._loadingVision = null;
    this.quietMs = quietMs;
    this.onProgress = null; // (phase, payload) for download progress in the UI
  }

  _progress(model, bump) {
    return (p) => {
      if (bump) bump(); // the load is alive; push the watchdog back
      if (this.onProgress && p && typeof p.percentage === "number") {
        this.onProgress({ model, percentage: p.percentage, downloaded: p.downloaded, total: p.total });
      }
    };
  }

  // A model load that never resolves is the signature of a SECOND QVAC app holding the shared
  // worker in ~/.qvac: there is no error and no rejection, the promise simply never settles. This
  // was hit for real during this build, with another QVAC Electron app open in the background.
  //
  // The watchdog only fires while NOTHING is happening. Any download progress event pushes it back,
  // so a genuinely slow first download (a few GB on a bad connection) is never killed, while a
  // silent deadlock surfaces as a message that names the actual cause.
  _guardLoad(label, start) {
    let settled = false;
    let timer = null;
    let reject = null;
    const bump = () => {
      clearTimeout(timer);
      if (settled) return;
      timer = setTimeout(() => {
        if (settled || !reject) return;
        reject(new Error(
          `The ${label} did not load within ${this.quietMs < 1000 ? `${this.quietMs}ms` : `${Math.round(this.quietMs / 1000)}s`} and reported no ` +
          "progress. The usual cause is another QVAC app running at the same time: they share one " +
          "worker in ~/.qvac, and the second one waits forever. Close the other QVAC app and retry."));
      }, this.quietMs);
    };
    const guard = new Promise((_res, rej) => { reject = rej; bump(); });
    const work = start(bump).finally(() => { settled = true; clearTimeout(timer); });
    return Promise.race([work, guard]);
  }

  async ensureText() {
    if (this.textId) return this.textId;
    if (!this._loadingText) {
      this._loadingText = this._guardLoad("text model", (bump) => sdk()
        .then((S) => S.loadModel({
          modelSrc: S.QWEN3_4B_INST_Q4_K_M,
          onProgress: this._progress("text model", bump),
        }))
        .then((id) => { this.textId = id; return id; }))
        .finally(() => { this._loadingText = null; });
    }
    return this._loadingText;
  }

  async ensureVision() {
    if (this.visionId) return this.visionId;
    if (!this._loadingVision) {
      this._loadingVision = this._guardLoad("vision model", (bump) => sdk()
        .then((S) => S.loadModel({
          modelSrc: S.QWEN3VL_2B_MULTIMODAL_Q4_K.src,
          modelType: S.QWEN3VL_2B_MULTIMODAL_Q4_K.engine,
          modelConfig: {
            device: "gpu",
            projectionModelSrc: S.MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K.src,
            ctx_size: 8192, // an invoice page produces a lot of image tokens
          },
          onProgress: this._progress("vision model", bump),
        }))
        .then((id) => { this.visionId = id; return id; }))
        .finally(() => { this._loadingVision = null; });
    }
    return this._loadingVision;
  }

  async _run(opts) {
    const S = await sdk();
    const run = S.completion(opts);
    for await (const _e of run.events) { /* drained; we only need the final object */ }
    const final = await run.final;
    return String((final && final.contentText) || "");
  }

  // Extract one document against one template.
  // source is what reader.inspect() produced, with any PDF already rasterised by the caller:
  //   { kind:"text", text }  |  { kind:"image", imagePath }
  // Returns { values, missing, raw, model, ms }.
  async extract(source, template) {
    const { name, schema, fields } = schemaForTemplate(template);
    const instruction = promptForTemplate(template);
    const t0 = Date.now();
    let raw = "", usedModel = "";

    if (source.kind === "text") {
      await this.ensureText();
      usedModel = "Qwen3 4B (text)";
      raw = await this._run({
        modelId: this.textId,
        history: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `${instruction}\n\nDocument text:\n\n${source.text}` },
        ],
        stream: true,
        kvCache: false, // every document is independent; a shared cache bleeds the previous invoice
        responseFormat: { type: "json_schema", json_schema: { name, schema } },
        generationParams: { predict: 600, temp: 0 },
      });
    } else if (source.kind === "image") {
      await this.ensureVision();
      usedModel = "Qwen3-VL 2B (vision)";
      raw = await this._run({
        modelId: this.visionId,
        history: [
          { role: "system", content: SYSTEM },
          { role: "user", content: instruction, attachments: [{ path: source.imagePath }] },
        ],
        stream: true,
        kvCache: false,
        responseFormat: { type: "json_schema", json_schema: { name, schema } },
        generationParams: { predict: 600, temp: 0 },
      });
    } else {
      throw new Error(`cannot extract from source kind "${source.kind}"`);
    }

    // The grammar guarantees schema-valid JSON, but a truncated generation can still cut it off,
    // so parsing is still defended.
    let parsed = null;
    try { parsed = JSON.parse(raw.trim()); }
    catch { throw new Error("model did not return parseable JSON (generation may have been truncated)"); }

    const values = {};
    const missing = [];
    const issues = {};       // key -> why it was rejected, so the UI can say more than "check this"
    for (const f of fields) {
      const { value, empty, reason } = coerce(f, parsed[f.key]);
      values[f.key] = value;
      if (reason) issues[f.key] = reason;
      if (empty && f.required) missing.push(f.key);
    }

    // The backstop: if the numbers do not add up, flag the columns involved. This catches a wrong
    // magnitude or a total copied into the net field, both of which look entirely plausible on their
    // own and would otherwise reach a VAT filing unchallenged.
    const warnings = checkArithmetic(fields, values);
    for (const w of warnings) {
      for (const k of w.keys) if (!missing.includes(k)) missing.push(k);
    }

    return {
      values, missing, issues, raw, model: usedModel, ms: Date.now() - t0,
      warning: warnings.length ? warnings[0].message : null,
    };
  }

  async unload() {
    const S = await sdk();
    try { if (this.textId) await S.unloadModel({ modelId: this.textId, clearStorage: false }); } catch { /* */ }
    try { if (this.visionId) await S.unloadModel({ modelId: this.visionId, clearStorage: false }); } catch { /* */ }
    this.textId = null; this.visionId = null;
  }
}

module.exports = { Extractor };
