// Decides HOW a document should be read, and gets it into something a model can consume.
//
// Why a text-layer PDF goes to the text model rather than to the VLM:
//   - Measured (spike-extract.mjs, experiment 1): Qwen3 4B on text pulled from a PDF scored 8/8
//     fields on the Atelier invoice.
//   - Measured (experiment 2a): Qwen3-VL 2B with json_schema straight off the IMAGE also scores
//     well, so a scan needs one call, not a transcribe-then-extract pair.
//   - Measured (spike-vlm-on-text.mjs): the VLM given the same FLAT TEXT also scores 8/8. It ties.
//     Routing text to the text model is therefore a conservative default here, NOT a proven win.
//     See the header of extractor.js before quoting any accuracy number for this split.
//
// pdf-parse is not reliable on every PDF in the wild. Real invoices come from every generator under
// the sun, so a parse failure has to be a routing decision, not an error: a failed or text-poor PDF
// falls through to the vision path. (A fixture here once failed intermittently with "bad XRef
// entry"; that turned out to be the Buffer-pooling bug fixed below, not a bad file.)
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"]);
// Below this many characters a "text" PDF is really a scan with a junk text layer, so it is
// worth more to look at the pixels than to trust the extraction.
const MIN_USEFUL_CHARS = 120;
const MAX_TEXT_CHARS = 6000; // an invoice never needs more, and it keeps the context small

function isImagePath(p) { return IMAGE_EXT.has(path.extname(p).toLowerCase()); }
function isPdfPath(p) { return path.extname(p).toLowerCase() === ".pdf"; }

// pdf-parse 1.1.4 vendors pdf.js v1.10.100, which is from 2018 and runs in the Electron MAIN
// process, where there is no sandbox. It is the highest-privilege untrusted-input surface in the
// app, so give it as little to chew on as possible: one page (the only one we read anyway) and a
// size ceiling. Without `max` it parses every page of a 20k-page file on the main thread, which
// blocks the event loop and therefore blocks the Cancel button too.
const MAX_PDF_BYTES = 25 * 1024 * 1024;

async function pdfText(filePath) {
  const pdfParse = require("pdf-parse");
  const { size } = fs.statSync(filePath);
  if (size > MAX_PDF_BYTES) {
    throw new Error(`PDF is ${(size / 1e6).toFixed(0)} MB, too large to parse safely`);
  }
  // `new Uint8Array(...)` is NOT cosmetic. Node allocates small Buffers out of a shared pool, and
  // pdf.js (inside pdf-parse) reads past the logical end of the view, so it can pick up bytes
  // belonging to a previous allocation. The symptom is a random "bad XRef entry" or "Illegal
  // character": the SAME file parses in one process and fails in another. We hit exactly that
  // here, where a fixture parsed fine in the spike and failed in the test run. Copying into a
  // standalone Uint8Array gives pdf.js its own buffer and makes parsing deterministic.
  const bytes = new Uint8Array(fs.readFileSync(filePath));
  const out = await pdfParse(bytes, { max: 1 });   // we only ever read page 1
  return String(out.text || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

// Returns one of:
//   { kind:"text",  text, signal:"pdf-text" }
//   { kind:"image", imagePath, signal:"image" }
//   { kind:"pdf-needs-render", filePath, signal, reason }   <- caller must rasterise (Electron does)
//   { kind:"unsupported", reason }
async function inspect(filePath) {
  if (!fs.existsSync(filePath)) return { kind: "unsupported", reason: "file not found" };

  if (isImagePath(filePath)) {
    return { kind: "image", imagePath: filePath, signal: "image" };
  }

  if (isPdfPath(filePath)) {
    let text = null, failure = null;
    try { text = await pdfText(filePath); }
    catch (e) { failure = String(e && e.message || e); }

    if (text && text.length >= MIN_USEFUL_CHARS) {
      return { kind: "text", text: text.slice(0, MAX_TEXT_CHARS), signal: "pdf-text" };
    }
    return {
      kind: "pdf-needs-render",
      filePath,
      signal: "pdf-scan",
      reason: failure ? `text extraction failed (${failure})` :
              `only ${text ? text.length : 0} characters of text, treating it as a scan`,
    };
  }

  return { kind: "unsupported", reason: `unsupported file type ${path.extname(filePath) || "(none)"}` };
}

module.exports = { inspect, isImagePath, isPdfPath, pdfText, MIN_USEFUL_CHARS, MAX_PDF_BYTES };
