// Renderer: UI only. Everything real happens in the main process over the `ledger` bridge.
"use strict";
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

let S = { templates: [], activeTemplateId: null, rows: [], fieldTypes: ["text", "number", "date", "currency"], busy: false };
let editing = null; // template being edited in the modal
let sawRealDownload = false; // see the download-progress handler

// An ipcMain handler that throws reaches the renderer wrapped as
// "Error invoking remote method 'save-template': Error: a template needs at least one field".
// Show the part a human wrote.
function cleanError(e) {
  const s = String((e && e.message) || e || "");
  return s.replace(/^Error invoking remote method '[^']*':\s*/, "").replace(/^Error:\s*/, "");
}

const activeTemplate = () => S.templates.find((t) => t.id === S.activeTemplateId) || S.templates[0] || null;

async function refresh() {
  S = await window.ledger.state();
  renderTemplates();
  renderFields();
  renderTable();
  // `state` reports whether a batch is running, and this used to be read and then ignored. A window
  // created or reloaded mid-batch then showed Cancel hidden (so the batch could not be stopped) and
  // Clear enabled (which deletes rows the loop is still appending).
  setBusy(!!S.busy);
}

// ── templates ────────────────────────────────────────────────────────────────
function renderTemplates() {
  const list = $("template-list");
  list.replaceChildren();
  for (const t of S.templates) {
    const li = el("li", "tpl" + (t.id === S.activeTemplateId ? " on" : ""));
    li.appendChild(el("b", null, t.name));
    if (t.description) li.appendChild(el("span", null, t.description));
    const tag = el("span", "tag", `${t.fields.length} columns${t.builtin ? " · built in" : ""}`);
    li.appendChild(tag);
    li.addEventListener("click", async () => {
      await window.ledger.setTemplate(t.id);
      await refresh();
    });
    list.appendChild(li);
  }
}

function renderFields() {
  const t = activeTemplate();
  const list = $("field-list");
  list.replaceChildren();
  if (!t) return;
  for (const f of t.fields) {
    const li = el("li");
    li.appendChild(el("span", "k", f.label));
    li.appendChild(el("span", "t", f.type));
    list.appendChild(li);
  }
  $("table-title").textContent = t.name;
  // Built-in tables are the reference set and the store refuses to delete them, so the button that
  // cannot work is not offered in the first place.
  $("delete-template").hidden = !!t.builtin;
}

// ── table ────────────────────────────────────────────────────────────────────
function renderTable() {
  const t = activeTemplate();
  const table = $("table");
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");
  thead.replaceChildren();
  tbody.replaceChildren();
  if (!t) return;

  const rows = S.rows.filter((r) => r.templateId === t.id);
  $("empty").hidden = rows.length > 0;
  const flagged = rows.filter((r) => Array.isArray(r.missing) && r.missing.length).length;
  $("row-count").innerHTML = rows.length
    ? `${rows.length} row${rows.length > 1 ? "s" : ""}` + (flagged ? ` &middot; <b>${flagged} to check</b>` : "")
    : "";

  const htr = el("tr");
  htr.appendChild(el("th", null, "Document"));
  for (const f of t.fields) htr.appendChild(el("th", null, f.label));
  htr.appendChild(el("th", null, "Read by"));
  htr.appendChild(el("th", null, ""));
  thead.appendChild(htr);

  for (const r of rows) {
    const tr = el("tr");

    const fileTd = el("td", "meta");
    const fname = el("div", "rowfile", r.name || "");
    fname.title = r.file + "\nclick to reveal in Finder";
    fname.addEventListener("click", () => window.ledger.reveal(r.file));
    fileTd.appendChild(fname);
    tr.appendChild(fileTd);

    for (const f of t.fields) {
      const td = el("td", f.type === "number" ? "num" : null);
      const missing = Array.isArray(r.missing) && r.missing.includes(f.key);
      if (missing) td.classList.add("flag");
      const input = el("input");
      input.type = "text";
      const v = r.values ? r.values[f.key] : "";
      input.value = f.type === "number" && typeof v === "number" ? v.toFixed(2) : (v ?? "");
      if (missing) {
        // The reason matters. "Cyprus" in a VAT ID column is not a missing value, it is a wrong one
        // that got rejected, and the user needs to know which of the two happened.
        const why = r.issues && r.issues[f.key];
        input.placeholder = why ? "rejected, check" : "not on the document";
        td.title = why || `${f.label} is not stated on this document`;
      }
      input.addEventListener("change", async () => {
        const raw = input.value;
        let value = raw;
        if (f.type === "number") {
          const parsed = await window.ledger.parseAmount(raw);
          if (!parsed.ok && raw.trim() !== "") {
            // Refuse the edit rather than store a guess. Silently writing 0 over a number the
            // bookkeeper typed, and clearing the review flag while doing it, is the single worst
            // thing this app could do.
            input.value = v == null ? "" : String(v);
            $("status-text").textContent = parsed.ambiguous
              ? `"${raw}" is ambiguous: write 1234.56 or 1 234,56 so the decimal mark is clear.`
              : `"${raw}" is not a number I can read.`;
            return;
          }
          value = parsed.value;
        }
        await window.ledger.updateCell(r.id, f.key, value);
        await refresh();   // the store decides whether the cell is still flagged, not the UI
      });
      td.appendChild(input);
      tr.appendChild(td);
    }

    const src = el("td", "meta");
    const isVision = /vision/i.test(r.model || "");
    const badge = el("span", "src " + (isVision ? "vision" : "text"), isVision ? "vision" : "text");
    badge.title = `${r.model || "?"} · ${r.signal || "?"} · ${((r.ms || 0) / 1000).toFixed(1)}s`;
    src.appendChild(badge);
    if (r.warning) {
      // The numbers do not add up. Say why, right on the row.
      const warn = el("span", "warn", "!");
      warn.title = r.warning;
      src.appendChild(warn);
    }
    tr.appendChild(src);

    const del = el("td", "meta");
    const btn = el("button", "del", "×");
    btn.title = "Remove this row";
    btn.addEventListener("click", async () => { await window.ledger.deleteRow(r.id); await refresh(); });
    del.appendChild(btn);
    tr.appendChild(del);

    tbody.appendChild(tr);
  }
}

// ── model settings ───────────────────────────────────────────────────────────
let MODELS = null;   // last catalogue from main

const gb = (b) => (b >= 1e9 ? (b / 1e9).toFixed(2) + " GB" : Math.round(b / 1e6) + " MB");

// A score is "43/72". Colour the best and the clearly-poor so the choice is readable at a glance
// instead of requiring arithmetic.
function scoreClass(list, m) {
  const pct = (x) => { const [a, b] = String(x.score || "0/1").split("/").map(Number); return b ? a / b : 0; };
  const best = Math.max(...list.map(pct));
  const mine = pct(m);
  if (mine === best) return "best";
  if (mine < best - 0.15) return "poor";
  return "";
}

function renderModelList(kind) {
  const list = MODELS[kind];
  const ul = $(kind === "text" ? "text-models" : "vision-models");
  ul.replaceChildren();
  for (const m of list) {
    const li = el("li", "model" + (MODELS.selected[kind] === m.key ? " on" : "") +
                          (m.available ? "" : " off"));
    li.appendChild(el("span", "dot"));

    const mid = el("div");
    const head = el("div", "head");
    head.appendChild(el("span", "name", m.label));
    if (m.score) {
      const sc = el("span", "score " + scoreClass(list, m), m.score + " fields");
      sc.title = "correct cells against the demo set's ground truth";
      head.appendChild(sc);
    }
    head.appendChild(el("span", "meta", `${gb(m.bytes)}${m.speed ? " \u00b7 " + m.speed + "/doc" : ""}`));
    mid.appendChild(head);
    mid.appendChild(el("div", "why", m.available ? m.note : `Unavailable: ${m.why}`));
    li.appendChild(mid);

    const right = el("div", "right");
    right.appendChild(el("span", "state" + (m.cached ? "" : " need"),
                         m.cached ? "on disk" : "not downloaded"));
    if (m.available && !m.cached) {
      const dl = el("button", "btn", "Download");
      dl.addEventListener("click", async (ev) => {
        ev.stopPropagation();                       // downloading is not selecting
        dl.disabled = true; dl.textContent = "Downloading";
        const res = await window.ledger.downloadModel(kind, m.key);
        if (res && res.error) {
          $("status-text").textContent = `Download failed: ${res.error}`;
          dl.disabled = false; dl.textContent = "Download";
        } else {
          $("status-text").textContent = `${res.label} downloaded (${gb(res.bytes)}).`;
        }
        await loadModels();
      });
      right.appendChild(dl);
    }
    li.appendChild(right);

    if (m.available) {
      li.addEventListener("click", async () => {
        if (MODELS.selected[kind] === m.key) return;
        try {
          const saved = await window.ledger.setModels({ ...MODELS.selected, [kind]: m.key });
          MODELS.selected = saved;
          renderModelList(kind);
          paintModelPill();
          $("status-text").textContent = m.cached
            ? `${m.label} selected. It loads on the next document.`
            : `${m.label} selected. ${gb(m.bytes)} downloads on the next document.`;
        } catch (e) {
          $("status-text").textContent = cleanError(e);
        }
      });
    }
    ul.appendChild(li);
  }
}

function paintModelPill() {
  if (!MODELS) return;
  const t = MODELS.text.find((m) => m.key === MODELS.selected.text);
  const v = MODELS.vision.find((m) => m.key === MODELS.selected.vision);
  $("model-pill").textContent = `${t ? t.label : "?"} / ${v ? v.label : "?"}`;
  $("model-pill").title = `Text: ${t ? t.label : "?"}\nVision: ${v ? v.label : "?"}`;
}

async function loadModels() {
  MODELS = await window.ledger.models();
  renderModelList("text");
  renderModelList("vision");
  const need = [...MODELS.text, ...MODELS.vision].filter((m) => m.available && !m.cached);
  $("cache-note").textContent =
    `Models live in ${MODELS.cacheDir} and are shared with every QVAC app on this machine. ` +
    (need.length ? `${need.length} of the options here are not downloaded yet.`
                 : "All of these are already on disk.");
  paintModelPill();
}

// ── extraction ───────────────────────────────────────────────────────────────
function setBusy(b) {
  S.busy = b;
  $("browse").disabled = b;
  $("cancel").hidden = !b;
  $("export").disabled = b;
  $("clear").disabled = b;
  // The template controls have to be locked too. A batch holds one table for its whole run, so
  // deleting or editing it mid-run files rows under a table that no longer exists: invisible in the
  // UI, not exportable, and still on disk. Main refuses these as well; this is the visible half.
  $("open-models").disabled = b;
  $("new-template").disabled = b;
  $("edit-template").disabled = b;
  $("delete-template").disabled = b;
  document.querySelectorAll("#template-list .tpl").forEach((n) => n.classList.toggle("locked", b));
  if (!b) { $("progress").hidden = true; $("progress-bar").style.width = "0"; }
}

function queueRow(name) {
  const q = el("div", "q run");
  q.appendChild(el("span", "n", name));
  q.appendChild(el("span", "s", "reading"));
  $("queue").hidden = false;
  $("queue").prepend(q);
  return q;
}

async function runFiles(files) {
  if (!files || !files.length) return;
  if (S.busy) { $("status-text").textContent = "Still reading the previous batch."; return; }
  const t = activeTemplate();
  if (!t) return;
  $("queue").replaceChildren();
  $("queue").hidden = true;   // reset, or a stale empty box is left over from the last run

  // Expand folders BEFORE starting, so the count is known and a 240-document batch is not a surprise.
  const scan = await window.ledger.scan(files);
  if (!scan.files.length) {
    $("status-text").textContent = "Nothing readable in that selection (looking for PDFs and images).";
    return;
  }
  const where = scan.folders ? ` from ${scan.folders} folder${scan.folders > 1 ? "s" : ""}` : "";
  if (scan.files.length > 25 &&
      !confirm(`Read ${scan.files.length} documents${where}?\n\nThis runs one model pass per document and cannot be undone, though you can cancel part way.`)) return;
  $("status-text").textContent = `Reading ${scan.files.length} documents${where}...` +
    (scan.truncated ? " (capped at the first 2000)" : "");
  $("source-hint").textContent =
    `${scan.files.length} document${scan.files.length > 1 ? "s" : ""}${where}` +
    (scan.skipped ? `, ${scan.skipped} file${scan.skipped > 1 ? "s" : ""} skipped as unsupported` : "");
  files = scan.files;

  try {
    const res = await window.ledger.extract(files, t.id);
    await refresh();
    if (res && res.error) $("status-text").textContent = "Error: " + res.error;
    else if (res) {
      const bits = [`${res.done} extracted`];
      if (res.failed) bits.push(`${res.failed} failed`);
      if (res.cancelled) bits.push("cancelled");
      $("status-text").textContent = bits.join(", ") + ". Nothing left this machine.";
    }
  } catch (e) {
    // Anything thrown outside the per-file handling in main rejects this invoke. Without a catch the
    // rows landed in the store but the table never refreshed to show them.
    await refresh();
    $("status-text").textContent = "Reading failed: " + cleanError(e);
  }
}

// ── template editor ──────────────────────────────────────────────────────────
function openEditor(template) {
  editing = template
    ? JSON.parse(JSON.stringify(template))
    : { name: "", description: "", fields: [{ label: "", type: "text", description: "" }] };
  $("editor-title").textContent = template ? (template.builtin ? "Copy this table" : "Edit table") : "New table";
  $("editor-note").textContent = template && template.builtin
    ? "This is a built-in table, so saving creates your own copy and leaves the original untouched."
    : "Columns become the fields the model must fill in.";
  $("t-name").value = template && template.builtin ? `${editing.name} (copy)` : (editing.name || "");
  $("t-desc").value = editing.description || "";
  renderEditorFields();
  $("editor").hidden = false;
  $("t-name").focus();
}

function renderEditorFields() {
  const list = $("editor-fields");
  list.replaceChildren();
  editing.fields.forEach((f, i) => {
    const li = el("li");

    const label = el("input");
    label.placeholder = "Column name";
    label.value = f.label || "";
    label.addEventListener("input", () => { f.label = label.value; });

    const type = el("select");
    for (const t of S.fieldTypes) {
      const o = el("option", null, t);
      o.value = t;
      if (t === f.type) o.selected = true;
      type.appendChild(o);
    }
    type.addEventListener("change", () => { f.type = type.value; });

    const desc = el("input");
    desc.placeholder = "Hint for the model (optional but worth it)";
    desc.value = f.description || "";
    desc.addEventListener("input", () => { f.description = desc.value; });

    const rm = el("button", "del", "×");
    rm.title = "Remove column";
    rm.addEventListener("click", () => {
      editing.fields.splice(i, 1);
      if (!editing.fields.length) editing.fields.push({ label: "", type: "text", description: "" });
      renderEditorFields();
    });

    li.append(label, type, desc, rm);
    list.appendChild(li);
  });
}

// ── wiring ───────────────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", async () => {
  // Chromium's default action for a file dropped on a page is to NAVIGATE to it. The drop zone is a
  // small band at the top, so a near-miss onto the table replaced the whole app with Chromium's PDF
  // viewer, with no way back. Swallow every drop at the document level; the #drop handlers below
  // still do the real work. Main also vetoes navigation, because this half lives in the page.
  ["dragover", "drop"].forEach((ev) =>
    document.addEventListener(ev, (e) => { e.preventDefault(); }, false));

  await refresh();
  await loadModels();

  $("browse").addEventListener("click", async () => {
    runFiles(await window.ledger.pickFiles());
  });

  // Folders are the real workflow: a year of expenses is never one flat directory.
  $("browse-folders").addEventListener("click", async () => {
    runFiles(await window.ledger.pickFolders());
  });

  const drop = $("drop");
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => {
    e.preventDefault(); drop.classList.add("hot");
  }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => {
    e.preventDefault(); drop.classList.remove("hot");
  }));
  drop.addEventListener("drop", (e) => {
    const paths = [...(e.dataTransfer.files || [])]
      .map((f) => window.ledger.pathForFile(f))
      .filter(Boolean);
    runFiles(paths);
  });

  $("cancel").addEventListener("click", () => window.ledger.cancel());

  $("open-models").addEventListener("click", async () => {
    await loadModels();
    $("models-modal").hidden = false;
  });
  $("models-close").addEventListener("click", () => { $("models-modal").hidden = true; });
  window.ledger.on("models-changed", () => { loadModels(); });

  $("add-field").addEventListener("click", () => {
    if (!editing) return;
    editing.fields.push({ label: "", type: "text", description: "" });
    renderEditorFields();
    const rows = $("editor-fields").querySelectorAll("li");
    const last = rows[rows.length - 1];
    if (last) last.querySelector("input").focus();
  });

  $("new-template").addEventListener("click", () => openEditor(null));
  $("edit-template").addEventListener("click", () => { const t = activeTemplate(); if (t) openEditor(t); });
  $("delete-template").addEventListener("click", async () => {
    const t = activeTemplate();
    if (!t || t.builtin) return;
    // Deleting a table takes its rows with it, so the count goes in the question rather than in a
    // regret afterwards.
    const n = S.rows.filter((r) => r.templateId === t.id).length;
    const warn = n ? ` Its ${n} extracted row${n > 1 ? "s" : ""} will be deleted too.` : "";
    if (!confirm(`Delete the table "${t.name}"?${warn} Your documents on disk are not touched.`)) return;
    try {
      await window.ledger.deleteTemplate(t.id);
      await refresh();
      $("status-text").textContent = `Deleted "${t.name}".`;
    } catch (e) {
      $("status-text").textContent = "Could not delete: " + cleanError(e);
    }
  });

  $("editor-cancel").addEventListener("click", () => { $("editor").hidden = true; editing = null; });
  $("editor-save").addEventListener("click", async () => {
    if (!editing) return;
    editing.name = $("t-name").value.trim();
    editing.description = $("t-desc").value.trim();
    editing.fields = editing.fields.filter((f) => (f.label || "").trim());
    if (!editing.name) { $("status-text").textContent = "Give the table a name first."; return; }
    if (!editing.fields.length) { $("status-text").textContent = "A table needs at least one column."; return; }
    try {
      await window.ledger.saveTemplate(editing);
      $("editor").hidden = true; editing = null;
      await refresh();
      $("status-text").textContent = "Table saved.";
    } catch (e) {
      $("status-text").textContent = "Could not save: " + cleanError(e);
    }
  });

  $("export").addEventListener("click", async () => {
    const t = activeTemplate(); if (!t) return;
    const rows = S.rows.filter((r) => r.templateId === t.id);
    const flagged = rows.filter((r) => Array.isArray(r.missing) && r.missing.length).length;
    // Exporting rows that still need a human is how a wrong number gets filed. Say it out loud
    // before the file exists, not after.
    if (flagged && !confirm(
      `${flagged} of ${rows.length} rows still have fields the model could not read (shown in amber).` +
      `\n\nExport anyway?`)) return;
    const euro = $("csv-flavour").value === "semicolon";
    try {
      const res = await window.ledger.exportCsv({
        templateId: t.id, delimiter: euro ? ";" : ",", decimalComma: euro,
      });
      if (res && res.error) $("status-text").textContent = "Export: " + res.error;
      else if (res && res.cancelled) $("status-text").textContent = "Export cancelled.";
      else if (res && res.path) {
        $("status-text").textContent = `Exported ${res.count} rows to ${res.path}` +
          (res.needsReview ? ` (${res.needsReview} still need review)` : "");
      }
    } catch (e) {
      // A read-only volume or a file open in Excel used to reject silently, leaving the user with no
      // idea whether anything was written.
      $("status-text").textContent = "Export failed: " + cleanError(e);
    }
  });

  $("clear").addEventListener("click", async () => {
    const t = activeTemplate(); if (!t) return;
    const n = S.rows.filter((r) => r.templateId === t.id).length;
    if (!n) { $("status-text").textContent = "Nothing to clear."; return; }
    // It sits next to Export and destroys a whole batch. It gets a question.
    if (!confirm(`Delete all ${n} extracted row${n > 1 ? "s" : ""} from "${t.name}"?` +
                 `\n\nYour documents on disk are not touched.`)) return;
    await window.ledger.clearRows(t.id);
    await refresh();
    $("status-text").textContent = `Cleared ${n} rows. Files on disk were not touched.`;
  });

  // events from main
  window.ledger.on("busy", setBusy);
  window.ledger.on("download-progress", (p) => {
    // The SDK emits a single {percentage:100} on a CACHE HIT, so announcing a download on every
    // event told the user a 2.5 GB download had just happened every single run, contradicting the
    // whole point of the cache. Only believe it once something below 100% has been seen.
    if (p.percentage < 100) sawRealDownload = true;
    if (!sawRealDownload) return;
    const pct = Number(p.percentage) || 0;
    $("progress").hidden = false;
    $("progress-bar").style.width = `${pct.toFixed(0)}%`;
    const mb = (n) => (Number.isFinite(n) ? (n / 1e6).toFixed(0) : "?");
    $("status-text").textContent =
      `Downloading the ${p.model} once: ${pct.toFixed(0)}% (${mb(p.downloaded)}/${mb(p.total)} MB)`;
  });
  window.ledger.on("file-start", (p) => {
    $("status-text").textContent = `Reading ${p.name} (${p.index + 1} of ${p.total})`;
    const q = queueRow(p.name);
    q.dataset.index = String(p.index);
  });
  window.ledger.on("file-done", (p) => {
    const q = $("queue").querySelector(`.q[data-index="${p.index}"]`);
    if (q) { q.className = "q ok"; q.querySelector(".s").textContent = "done"; }
  });
  window.ledger.on("file-error", (p) => {
    const q = $("queue").querySelector(`.q[data-index="${p.index}"]`);
    if (q) { q.className = "q err"; q.querySelector(".s").textContent = "failed"; q.title = p.error; }
    $("status-text").textContent = `${p.name}: ${p.error}`;
  });
});
