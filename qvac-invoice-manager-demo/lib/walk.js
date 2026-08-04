// Expands whatever the user pointed at into a flat list of documents to read.
//
// Accounting folders are never flat. A year of expenses is Business-Expenses/2026/<supplier>/, and
// the natural gesture is to drop the year, or to select three supplier folders at once. So every
// path that arrives here (from the picker or from a drop) is expanded: a file is taken as-is, a
// directory is walked to the bottom.
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const SUPPORTED = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp", ".gif"]);

// Directories that are never invoices and can be enormous.
const SKIP_DIRS = new Set(["node_modules", ".git", ".svn", "__pycache__", ".Trash", "$RECYCLE.BIN"]);

const MAX_FILES = 2000;   // a guard, not a preference: 2000 documents is already a very long batch
const MAX_DEPTH = 16;

function isSupported(p) { return SUPPORTED.has(path.extname(p).toLowerCase()); }

// Walk one directory. Returns nothing; accumulates into `out`.
// Symlinked directories are NOT followed: a link back up the tree would loop forever, and no real
// accounting folder needs it.
function walkDir(dir, out, skipped, depth, seenDirs) {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    skipped.push({ path: dir, reason: `cannot read folder (${(e && e.code) || "error"})` });
    return;
  }
  // Deterministic order, so a batch is reproducible and the queue reads sensibly.
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (out.length >= MAX_FILES) return;
    // Hidden files on macOS and Linux, plus Windows/Office lock files like ~$invoice.xlsx.
    if (entry.name.startsWith(".") || entry.name.startsWith("~$")) continue;
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      let real;
      try { real = fs.realpathSync(full); } catch { continue; }
      if (seenDirs.has(real)) continue;      // already visited by another selected folder
      seenDirs.add(real);
      walkDir(full, out, skipped, depth + 1, seenDirs);
    } else if (entry.isFile()) {
      if (isSupported(full)) out.push(full);
      // Anything else is silently ignored: a folder of invoices routinely also holds .DS_Store,
      // spreadsheets and notes, and reporting each of those as an error is noise, not information.
    }
  }
}

// paths: files and/or directories, in any mix.
// Returns { files, folders, skipped, truncated } with files absolute, deduped and sorted.
function collectDocuments(paths, { maxFiles = MAX_FILES } = {}) {
  const out = [];
  const skipped = [];
  const seenDirs = new Set();
  let folders = 0;

  for (const p of Array.isArray(paths) ? paths : []) {
    if (typeof p !== "string" || !p) continue;
    let st;
    try { st = fs.statSync(p); } catch { skipped.push({ path: p, reason: "not found" }); continue; }

    if (st.isDirectory()) {
      folders++;
      let real;
      try { real = fs.realpathSync(p); } catch { real = p; }
      // Selecting both a parent and its child must not read anything twice.
      if (seenDirs.has(real)) continue;
      seenDirs.add(real);
      walkDir(p, out, skipped, 0, seenDirs);
    } else if (st.isFile()) {
      if (isSupported(p)) out.push(p);
      else skipped.push({ path: p, reason: `unsupported file type ${path.extname(p) || "(none)"}` });
    }
  }

  // A parent folder and a file inside it can both be selected, so dedupe by resolved path.
  const seen = new Set();
  const files = [];
  for (const f of out) {
    const key = path.resolve(f);
    if (seen.has(key)) continue;
    seen.add(key);
    files.push(key);
  }
  files.sort((a, b) => a.localeCompare(b));

  const truncated = files.length >= maxFiles;
  return { files: files.slice(0, maxFiles), folders, skipped, truncated };
}

module.exports = { collectDocuments, isSupported, SUPPORTED, MAX_FILES, MAX_DEPTH };
