// The tidy engine: scan -> route+classify (streaming, cancellable) -> plan -> apply (journalled,
// collision-suffixed, never deletes) -> undo. No Electron here so it can be tested headless.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { prepare, isImage } = require("./router");

// `kinds` is the modality a category can apply to. It matters a lot: letting a PDF compete against
// "installers" or "archives" crushed every margin (measured: 0/26 on a real Desktop). A document is
// only ever scored against document categories, an image only against image categories.
const DEFAULT_CATEGORIES = [
  { id: "invoices",    label: "Invoices & Receipts", folder: "Invoices & Receipts", kinds: ["doc"],   desc: "a bill for one specific transaction: an invoice or receipt with an invoice number, line items, quantities, unit prices, a total amount due, VAT and payment terms" },
  { id: "contracts",   label: "Contracts & Legal",   folder: "Contracts & Legal",   kinds: ["doc"],   desc: "a contract or legal agreement between parties, with clauses, obligations, liability, termination, signatures, terms and conditions, an NDA or a formal policy" },
  // `code` is deliberately NOT a document category. Measured on a real Desktop, it hijacked
  // "Code of Conduct.pdf", an AI research paper and a marketing HTML file, because the token "code"
  // attracts. Source files are already routed to it by extension, which is exact.
  { id: "code",        label: "Code & Dev",          folder: "Code & Dev",          kinds: [],        desc: "source code, a script or a software development file" },
  { id: "reference",   label: "Reference & Docs",    folder: "Reference & Docs",    kinds: ["doc"],   desc: "anything written to read, keep or share: an article, a manual, a guide, a research paper, a report, an audit, technical or product documentation, notes, a plan, a map or floor plan, an agenda, a programme, a review, a summary, a draft or marketing and announcement copy" },
  // Null hypothesis inside the softmax. Without a "none of the above" option an ambiguous file is
  // forced to pick a real category and, measured, it drifted into "invoices" (a floorplan scored 0.46
  // invoices). Giving the model somewhere honest to land is what makes "leave it alone" work.
  { id: "_other",      label: "Not sure",            folder: null,                  kinds: ["doc"],   desc: "a document whose purpose is unclear, a fragment, a form, a template, raw data, a list of settings, or a file with too little readable text to categorise" },
  { id: "screenshots", label: "Screenshots",         folder: "Screenshots",         kinds: ["image"], desc: "a screenshot: a capture of a computer or phone screen showing an application window, a user interface, a settings panel, a browser, a web page, a chat conversation, a terminal, source code or a spreadsheet" },
  { id: "photos",      label: "Photos",              folder: "Photos",              kinds: ["image"], desc: "a photograph of the real world taken with a camera: people, faces, animals, food, plants, landscapes, streets, buildings, vehicles or objects" },
  { id: "graphics",    label: "Graphics & Assets",   folder: "Graphics & Assets",   kinds: ["image"], desc: "a designed graphic: a marketing banner, a video thumbnail, a social media post, a poster, a title card or a logo, combining imagery with large overlaid headline text and branding" },
  { id: "video",       label: "Video & Recordings",  folder: "Video & Recordings",  kinds: [],        desc: "a video file or a screen recording" },
  { id: "audio",       label: "Audio",               folder: "Audio",               kinds: [],        desc: "an audio file, a voice recording or a piece of music" },
  { id: "spreadsheets",label: "Spreadsheets & Data", folder: "Spreadsheets & Data", kinds: [],        desc: "a spreadsheet or a data table, such as an account statement or an export" },
  { id: "slides",      label: "Presentations",       folder: "Presentations",       kinds: [],        desc: "a slide deck or a presentation" },
  { id: "installers",  label: "Installers",          folder: "Installers",          kinds: [],        desc: "a software installer, a setup package or an application download" },
  { id: "archives",    label: "Archives",            folder: "Archives",            kinds: [],        desc: "a zip file, a compressed archive or a backup" },
];

const SKIP_NAMES = new Set([".DS_Store", ".localized", "Icon\r", "desktop.ini"]);

function folderForCategory(categories, id) {
  const c = categories.find((x) => x.id === id);
  return c ? c.folder : null;
}

// Top-level files only (never recurse into existing folders, so re-running never re-sorts).
function scanFolder(dir) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { throw new Error("cannot read folder: " + e.message); }
  const files = [];
  for (const e of entries) {
    if (!e.isFile()) continue;                 // dirs (incl. our category folders) skipped
    if (e.name.startsWith(".")) continue;       // hidden files left alone
    if (SKIP_NAMES.has(e.name)) continue;
    files.push(path.join(dir, e.name));
  }
  return files;
}

// Suffix " (n)" before the extension until the path is free. Never overwrites.
function freeTarget(targetDir, base) {
  const ext = path.extname(base), stem = path.basename(base, ext);
  let candidate = path.join(targetDir, base), n = 2;
  while (fs.existsSync(candidate)) { candidate = path.join(targetDir, `${stem} (${n})${ext}`); n++; }
  return candidate;
}

// Build a move plan. classifier must have setCategories() already. Streams each row via onRow.
// signal: an AbortSignal to cancel a long scan. Returns the full plan array.
async function buildPlan(dir, classifier, categories, { onRow, abortSignal } = {}) {
  const files = scanFolder(dir);
  const plan = [];
  for (let i = 0; i < files.length; i++) {
    if (abortSignal && abortSignal.aborted) break;
    const filePath = files[i];
    const base = path.basename(filePath);
    let row;
    try {
      const routed = await prepare(filePath);
      if (routed.skip) continue;                                   // system junk never enters a plan
      if (routed.sensitive) {
        // Credentials are surfaced so the user sees them, but never proposed for a move.
        row = { file: filePath, name: base, category: "not-sure", signal: "rule", confidence: 0, sure: false, note: "credential file, left alone" };
      } else if (routed.presetCategory) {
        row = { file: filePath, name: base, category: routed.presetCategory, signal: routed.signal, confidence: 1, sure: true };
      } else if (routed.kind === "image") {
        const res = await classifier.classifyImage(filePath);
        row = { file: filePath, name: base, category: res.category, signal: "vision", confidence: res.confidence, sure: res.sure, raw: res.raw };
      } else if (routed.kind === "doc") {
        const [res] = await classifier.classifyTexts([routed.text], "doc");
        row = { file: filePath, name: base, category: res.category, signal: routed.signal, confidence: res.confidence, sure: res.sure, scores: res.scores };
      } else {
        // Unknown type with nothing readable: leave it rather than guess.
        row = { file: filePath, name: base, category: "not-sure", signal: "rule", confidence: 0, sure: false, note: "unrecognised type" };
      }
    } catch (e) {
      row = { file: filePath, name: base, category: "not-sure", signal: "error", confidence: 0, sure: false, error: String(e.message || e) };
    }
    row.index = i; row.total = files.length;
    const folder = row.sure ? folderForCategory(categories, row.category) : null;
    row.targetFolder = folder;                                   // null => left in place
    row.willMove = !!folder;
    plan.push(row);
    if (onRow) onRow(row);
  }
  return plan;
}

// Apply the moves (only rows with willMove and not excluded). Journals every move. Returns
// { runId, moved:[{from,to}], summary:{...} }. `excluded` is a Set of file paths to skip.
function applyPlan(dir, plan, categories, journal, { excluded } = {}) {
  const runId = journal.newRunId();
  const moved = [];
  for (const row of plan) {
    if (!row.willMove) continue;
    if (excluded && excluded.has(row.file)) continue;
    const folder = folderForCategory(categories, row.category);
    if (!folder) continue;
    const targetDir = path.join(dir, folder);
    fs.mkdirSync(targetDir, { recursive: true });
    const dest = freeTarget(targetDir, row.name);
    try {
      fs.renameSync(row.file, dest);            // same-volume move; never deletes
    } catch (e) {
      if (e.code === "EXDEV") { fs.copyFileSync(row.file, dest); fs.rmSync(row.file); }
      else throw e;
    }
    moved.push({ from: row.file, to: dest, category: row.category });
    journal.record(runId, row.file, dest);
  }
  journal.commit();
  const byCat = {};
  for (const m of moved) byCat[m.category] = (byCat[m.category] || 0) + 1;
  return { runId, moved, summary: { count: moved.length, byCategory: byCat } };
}

// Reverse a run: move each file back to where it came from (collision-safe), then drop the entries.
function undoRun(journal, runId) {
  const entries = journal.entriesForRun(runId);
  let restored = 0;
  const touchedDirs = new Set();
  for (const e of [...entries].reverse()) {
    if (!fs.existsSync(e.to)) continue;
    const backDir = path.dirname(e.from);
    fs.mkdirSync(backDir, { recursive: true });
    const dest = fs.existsSync(e.from) ? freeTarget(backDir, path.basename(e.from)) : e.from;
    try { fs.renameSync(e.to, dest); restored++; touchedDirs.add(path.dirname(e.to)); }
    catch (err) { if (err.code === "EXDEV") { fs.copyFileSync(e.to, dest); fs.rmSync(e.to); restored++; touchedDirs.add(path.dirname(e.to)); } }
  }
  // Remove category folders this undo emptied (rmdir only ever removes an EMPTY dir, so a folder that
  // still holds anything is left untouched).
  for (const d of touchedDirs) { try { fs.rmdirSync(d); } catch { /* not empty: keep it */ } }
  journal.dropRun(runId);
  return { restored };
}

module.exports = { DEFAULT_CATEGORIES, scanFolder, buildPlan, applyPlan, undoRun, folderForCategory };
