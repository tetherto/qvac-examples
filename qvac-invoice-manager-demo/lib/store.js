// Templates + extracted rows on disk. Plain JSON in the app's userData, never synced.
// Deliberately dumb: the UI owns the workflow, this only persists it.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { STARTER_TEMPLATES, normaliseFields, slug, coerce } = require("./schema");

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, "ledger.json");
    this.data = { templates: [], rows: [], activeTemplateId: null };
    this.load();
  }

  load() {
    this.recovered = null;
    if (fs.existsSync(this.file)) {
      try {
        const onDisk = JSON.parse(fs.readFileSync(this.file, "utf8"));
        this.data = { ...this.data, ...onDisk };
      } catch (e) {
        // A file that exists but will not parse is NOT a first run. Seeding over it would overwrite
        // every extracted row the user has, silently and with no way back, so it gets moved aside
        // and reported instead.
        const backup = `${this.file}.corrupt-${Date.now()}`;
        try { fs.renameSync(this.file, backup); } catch { /* keep going; we still must not lose data */ }
        this.recovered = { backup, reason: String((e && e.message) || e) };
      }
    }
    // Seed the starter templates once, so the app is useful before the user builds their own.
    if (!Array.isArray(this.data.templates) || !this.data.templates.length) {
      this.data.templates = STARTER_TEMPLATES.map((t) => ({
        ...t, fields: normaliseFields(t.fields), builtin: true,
      }));
      this.data.activeTemplateId = this.data.templates[0].id;
      this.save();
    }
    if (!Array.isArray(this.data.rows)) this.data.rows = [];
    return this.data;
  }

  save() {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);   // atomic: a crash mid-write never truncates the real file
  }

  // ---- templates ----
  templates() { return this.data.templates; }
  template(id) { return this.data.templates.find((t) => t.id === id) || null; }
  activeTemplate() { return this.template(this.data.activeTemplateId) || this.data.templates[0] || null; }

  setActiveTemplate(id) {
    if (this.template(id)) { this.data.activeTemplateId = id; this.save(); }
    return this.activeTemplate();
  }

  // Create or update. A built-in template is never mutated in place: editing one FORKS it, so the
  // starters stay intact as a reference and cannot be accidentally destroyed.
  saveTemplate(t) {
    const fields = normaliseFields(t.fields);
    if (!fields.length) throw new Error("a template needs at least one field");
    const existing = t.id ? this.template(t.id) : null;

    if (existing && !existing.builtin) {
      Object.assign(existing, {
        name: t.name || existing.name,
        description: t.description || "",
        fields,
      });
      this.save();
      return existing;
    }
    const base = slug(t.name || "template");
    let id = base, n = 2;
    while (this.template(id)) id = `${base}-${n++}`;
    const created = {
      id,
      name: t.name || "Untitled template",
      description: t.description || "",
      fields,
      builtin: false,
      forkedFrom: existing ? existing.id : null,
    };
    this.data.templates.push(created);
    this.data.activeTemplateId = id;
    this.save();
    return created;
  }

  deleteTemplate(id) {
    const t = this.template(id);
    if (!t) return false;
    if (t.builtin) throw new Error("built-in templates cannot be deleted");
    this.data.templates = this.data.templates.filter((x) => x.id !== id);
    // Rows are keyed to their template's columns and are only ever displayed through it, so rows
    // left behind here would be invisible forever while still sitting on disk. Dropping them with
    // the template is both honest and the only way the data can ever be reclaimed. The UI warns
    // with the row count before calling this.
    this.data.rows = this.data.rows.filter((r) => r.templateId !== id);
    if (this.data.activeTemplateId === id) {
      this.data.activeTemplateId = this.data.templates.length ? this.data.templates[0].id : null;
    }
    this.save();
    return true;
  }

  // ---- rows ----
  rowsFor(templateId) { return this.data.rows.filter((r) => r.templateId === templateId); }

  addRow(row) { this.data.rows.push(row); this.save(); return row; }

  updateCell(rowId, key, value) {
    const r = this.data.rows.find((x) => x.id === rowId);
    if (!r) return null;
    const template = this.template(r.templateId);
    const field = template ? normaliseFields(template.fields).find((f) => f.key === key) : null;
    // Only a real column can be written. Without this an arbitrary IPC payload could add junk keys
    // to the stored row, which the CSV exporter would then happily stringify.
    if (!field) return null;
    if (!r.values || typeof r.values !== "object") r.values = {};

    const { value: clean, empty } = coerce(field, value);
    r.values[key] = clean;
    r.edited = true;
    // Editing a cell does NOT automatically mean it is verified: emptying a flagged field, or
    // typing something unparseable, must keep the flag. Re-derive it instead of clearing it.
    if (!Array.isArray(r.missing)) r.missing = [];
    r.missing = r.missing.filter((k) => k !== key);
    if (empty && field.required) r.missing.push(key);
    this.save();
    return r;
  }

  deleteRow(rowId) {
    const before = this.data.rows.length;
    this.data.rows = this.data.rows.filter((r) => r.id !== rowId);
    if (this.data.rows.length !== before) { this.save(); return true; }
    return false;
  }

  clearRows(templateId) {
    this.data.rows = this.data.rows.filter((r) => r.templateId !== templateId);
    this.save();
  }
}

module.exports = { Store };
