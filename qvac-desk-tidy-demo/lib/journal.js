// Move journal. Every move (manual or automatic) is recorded here so Undo can reverse it. Stored as
// a JSON array in the app's userData; small and human-readable on purpose.
"use strict";
const fs = require("node:fs");
const path = require("node:path");

let _seq = 0; // process-unique run counter (avoids Date.now collisions within a session)

class Journal {
  constructor(filePath) {
    this.path = filePath;
    this.entries = [];       // [{ runId, ts, from, to }]
    this._pending = [];      // entries recorded but not yet committed
    try {
      const raw = JSON.parse(fs.readFileSync(this.path, "utf8"));
      if (Array.isArray(raw)) this.entries = raw;
    } catch { /* fresh */ }
  }

  newRunId() { _seq += 1; return `run-${_seq}-${this.entries.length}`; }

  record(runId, from, to) { this._pending.push({ runId, ts: Date.now(), from, to }); }

  commit() {
    if (!this._pending.length) return;
    this.entries.push(...this._pending);
    this._pending = [];
    this._save();
  }

  entriesForRun(runId) { return this.entries.filter((e) => e.runId === runId); }

  dropRun(runId) { this.entries = this.entries.filter((e) => e.runId !== runId); this._save(); }

  // Most recent run id that still has entries (for "Undo last").
  lastRunId() { return this.entries.length ? this.entries[this.entries.length - 1].runId : null; }

  runs() {
    const map = new Map();
    for (const e of this.entries) {
      if (!map.has(e.runId)) map.set(e.runId, { runId: e.runId, ts: e.ts, count: 0 });
      map.get(e.runId).count++;
    }
    return [...map.values()].sort((a, b) => b.ts - a.ts);
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.path), { recursive: true });
      fs.writeFileSync(this.path + ".tmp", JSON.stringify(this.entries, null, 2));
      fs.renameSync(this.path + ".tmp", this.path);
    } catch (e) { console.error("[journal] save failed:", e.message); }
  }
}

module.exports = { Journal };
