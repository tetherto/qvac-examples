// Routing layer: turn any file into something classifiable, and be honest about the signal used.
//
// Returns per file: { kind, signal, text, presetCategory, skip, sensitive }
//   kind:    "doc" | "image" | null  (which category set may compete; null = decided by a rule)
//   signal:  "content" | "pdf" | "vision" | "extension" | "filename" | "rule"
//   text:    the string handed to the embedding classifier (empty when presetCategory is set)
//   presetCategory: set when a deterministic rule decides the file, which skips the AI entirely
//   skip:    system junk that should not appear in a plan at all
//   sensitive: credentials and keys, never auto-moved
//
// DESIGN NOTE (measured, not guessed): sending every file through the embedding classifier scored
// 0/26 on a real Desktop, because a .mov or a .xlsx has no content to read and its filename ties
// across categories. Deterministic rules now decide everything that is decidable without AI
// (extensions, macOS screenshot/recording naming), so the classifier only sees genuine documents and
// images. That both improves accuracy and makes the "signal" column honest.
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const TEXT_EXTS = new Set([
  ".txt", ".md", ".markdown", ".rtf", ".log", ".json", ".yaml", ".yml", ".toml", ".ini",
  ".html", ".htm", ".xml", ".tex", ".org",
]);
const CODE_EXTS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".py", ".go", ".rs", ".java", ".c", ".h", ".cpp", ".hpp", ".cs", ".rb",
  ".php", ".swift", ".kt", ".sh", ".zsh", ".bash", ".sql", ".lua", ".r", ".vue", ".svelte", ".mjs", ".cjs",
]);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif", ".heic"]);
const INSTALLER_EXTS = new Set([".dmg", ".pkg", ".exe", ".msi", ".deb", ".rpm", ".appimage"]);
const ARCHIVE_EXTS = new Set([".zip", ".tar", ".gz", ".tgz", ".bz2", ".7z", ".rar", ".xz"]);
const VIDEO_EXTS = new Set([".mov", ".mp4", ".m4v", ".avi", ".mkv", ".webm", ".mpg", ".mpeg"]);
const AUDIO_EXTS = new Set([".wav", ".mp3", ".m4a", ".aiff", ".aif", ".flac", ".ogg", ".opus"]);
const SHEET_EXTS = new Set([".xlsx", ".xls", ".numbers", ".csv", ".tsv"]);
const SLIDE_EXTS = new Set([".pptx", ".ppt", ".odp"]);
const DOC_OFFICE_EXTS = new Set([".docx", ".doc", ".odt", ".pages"]);
// Credentials: never auto-move these, whatever a model thinks.
const SENSITIVE_EXTS = new Set([".pem", ".key", ".p12", ".pfx", ".crt", ".cer", ".keystore", ".jks"]);
// OS/app droppings that are not user files.
const JUNK_NAMES = new Set([".ds_store", ".localized", "thumbs.db", "desktop.ini", "icon\r", ".spotlight-v100"]);

const MAX_TEXT_BYTES = 16 * 1024; // read a bit, use less
// Long text dilutes an embedding toward a generic "document" direction (measured: 8 KB of a real doc
// gave a 0.009 margin). A focused head is far more separable.
const CLASSIFY_CHARS = 1000;

// macOS (and common tool) naming conventions are a 100%-reliable signal, no AI needed.
// NB: no `IMG_1234` pattern here. Those are camera photos, not screen captures (and the pattern could
// never match anyway, since the name being tested still carries its extension).
const RE_SCREENSHOT = /^(screenshot|screen shot|capture d.?[ée]cran|cleanshot|shot_)/i;
const RE_RECORDING = /^(screen recording|screenflow|capture vid[ée]o)/i;
const RE_OFFICE_TEMP = /^~\$/;

function readHead(filePath, bytes) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n).toString("utf8");
  } finally { fs.closeSync(fd); }
}

// Strip markup/boilerplate so the embedding sees prose, not tags and fences.
function cleanForEmbedding(raw) {
  return String(raw || "")
    // The end-tag patterns tolerate attributes and whitespace (`</script >`, `<script defer>`):
    // a naive /<\/script>/ leaves crafted markup in the text we hand to the embedding model.
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")            // html/xml tags
    .replace(/https?:\/\/\S+/g, " ")     // urls carry little category signal
    .replace(/[|#*_`>-]{2,}/g, " ")      // md rules, table pipes, fences
    .replace(/\s+/g, " ")
    .trim();
}

// Lazy pdf-parse (pulling it in is slow; only require when a PDF actually shows up).
let _pdfParse = null;
function pdfParse() { if (!_pdfParse) _pdfParse = require("pdf-parse"); return _pdfParse; }

function nameOf(filePath) { return path.basename(filePath); }
function hintOf(base) { return base.replace(/\.[^.]+$/, "").replace(/[._-]+/g, " ").trim(); }

// filePath -> routing decision. Pure and synchronous except for the PDF branch.
async function prepare(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const base = nameOf(filePath);
  const lower = base.toLowerCase();
  const hint = hintOf(base);

  // 0. junk + temp files never enter a plan
  if (JUNK_NAMES.has(lower) || RE_OFFICE_TEMP.test(base)) return { skip: true, reason: "system file" };

  // 1. credentials: surfaced but never auto-moved
  if (SENSITIVE_EXTS.has(ext)) return { kind: null, signal: "rule", text: "", presetCategory: null, sensitive: true };

  // 2. naming conventions (exact, no AI)
  if (RE_RECORDING.test(base)) return { kind: null, signal: "rule", text: "", presetCategory: "video" };
  if (RE_SCREENSHOT.test(base) && IMAGE_EXTS.has(ext)) return { kind: null, signal: "rule", text: "", presetCategory: "screenshots" };

  // 3. extension-decided types (a .dmg IS an installer; a .mov IS a video)
  if (INSTALLER_EXTS.has(ext)) return { kind: null, signal: "extension", text: "", presetCategory: "installers" };
  if (ARCHIVE_EXTS.has(ext)) return { kind: null, signal: "extension", text: "", presetCategory: "archives" };
  if (VIDEO_EXTS.has(ext)) return { kind: null, signal: "extension", text: "", presetCategory: "video" };
  if (AUDIO_EXTS.has(ext)) return { kind: null, signal: "extension", text: "", presetCategory: "audio" };
  if (SHEET_EXTS.has(ext)) return { kind: null, signal: "extension", text: "", presetCategory: "spreadsheets" };
  if (SLIDE_EXTS.has(ext)) return { kind: null, signal: "extension", text: "", presetCategory: "slides" };
  if (CODE_EXTS.has(ext)) return { kind: null, signal: "extension", text: "", presetCategory: "code" };

  // 4. documents: read the content and let the classifier decide between document categories
  if (TEXT_EXTS.has(ext)) {
    let body = ""; try { body = readHead(filePath, MAX_TEXT_BYTES); } catch { /* */ }
    const clean = cleanForEmbedding(body).slice(0, CLASSIFY_CHARS);
    return { kind: "doc", signal: "content", text: `${hint}. ${clean}`, presetCategory: null };
  }

  if (ext === ".pdf") {
    try {
      // MUST be a standalone copy, not the Buffer from readFileSync. pdf-parse hands the buffer straight
      // to pdf.js, which reads the underlying ArrayBuffer; Node pools small Buffer allocations, so pdf.js
      // could read a neighbouring buffer's bytes and fail with a random "bad XRef entry" or "Illegal
      // character". Measured: raw Buffer failed 2 of 3 PDFs non-deterministically, a `new Uint8Array(...)`
      // copy read 3 of 3 every time.
      const data = await pdfParse()(new Uint8Array(fs.readFileSync(filePath)));
      const clean = cleanForEmbedding(data.text);
      if (clean.length >= 40) return { kind: "doc", signal: "pdf", text: `${hint}. ${clean.slice(0, CLASSIFY_CHARS)}`, presetCategory: null };
    } catch (e) {
      // Scanned, encrypted or malformed (pdf.js says "bad XRef entry" on some generator output). Log it
      // rather than swallowing it: a silent catch here cost real debugging time, because a PDF quietly
      // downgraded to filename-only classification looks identical to one that was read.
      console.warn(`[router] PDF text extraction failed for ${base}: ${(e && e.message) || e}`);
    }
    // No extractable text (scanned). Classify on the filename and say so, never pretend we read it.
    return { kind: "doc", signal: "filename", text: hint, presetCategory: null };
  }

  if (DOC_OFFICE_EXTS.has(ext)) return { kind: "doc", signal: "filename", text: hint, presetCategory: null };

  // 5. images: the VLM decides (handled by the caller), never the filename alone
  if (IMAGE_EXTS.has(ext)) return { kind: "image", signal: "vision", text: "", presetCategory: null };

  // 6. genuinely unknown type: leave it alone rather than guess from a filename
  return { kind: null, signal: "rule", text: "", presetCategory: null, unknown: true };
}

function isImage(filePath) { return IMAGE_EXTS.has(path.extname(filePath).toLowerCase()); }

module.exports = {
  prepare, isImage, cleanForEmbedding,
  TEXT_EXTS, IMAGE_EXTS, INSTALLER_EXTS, ARCHIVE_EXTS, VIDEO_EXTS, AUDIO_EXTS, SHEET_EXTS, SLIDE_EXTS,
};
