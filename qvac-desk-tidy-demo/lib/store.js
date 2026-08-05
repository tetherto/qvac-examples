// Tiny JSON store for settings + managed folders (rules), in the app's userData. Never synced.
"use strict";
const fs = require("node:fs");
const path = require("node:path");

class Store {
  constructor(filePath, defaults) {
    this.path = filePath;
    // defaultThreshold is a PROBABILITY (0..1), the minimum confidence to move a file.
    this.data = { settings: { defaultThreshold: 0.45 }, folders: [], ...(defaults || {}) };
    try { Object.assign(this.data, JSON.parse(fs.readFileSync(this.path, "utf8"))); } catch { /* fresh */ }
  }
  _save() {
    try {
      fs.mkdirSync(path.dirname(this.path), { recursive: true });
      fs.writeFileSync(this.path + ".tmp", JSON.stringify(this.data, null, 2));
      fs.renameSync(this.path + ".tmp", this.path);
    } catch (e) { console.error("[store] save failed:", e.message); }
  }
  get settings() { return this.data.settings; }
  setSettings(patch) { Object.assign(this.data.settings, patch); this._save(); }

  folders() { return this.data.folders; }
  getFolder(p) { return this.data.folders.find((f) => f.path === p) || null; }
  // rule: { path, trigger:"manual"|"interval"|"watch", intervalMinutes, posture:"notify"|"auto", threshold, categories? }
  upsertFolder(rule) {
    const i = this.data.folders.findIndex((f) => f.path === rule.path);
    if (i >= 0) this.data.folders[i] = { ...this.data.folders[i], ...rule };
    else this.data.folders.push({ trigger: "manual", posture: "notify", intervalMinutes: 60, threshold: 0.45, ...rule });
    this._save();
    return this.getFolder(rule.path);
  }
  removeFolder(p) { this.data.folders = this.data.folders.filter((f) => f.path !== p); this._save(); }
}

module.exports = { Store };
