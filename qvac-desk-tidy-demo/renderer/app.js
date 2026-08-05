// Desk Tidy renderer. UI only: everything real happens in the main process over the preload bridge.
//
// The plan is presented as one card per DESTINATION FOLDER, not as a row per file, because that is how
// people think about tidying ("what is going where"). Per-file detail, overrides and the reason for each
// decision are one click away inside the card.
"use strict";
const T = window.tidy;
const $ = (s) => document.querySelector(s);
const el = (t, cls, txt) => { const e = document.createElement(t); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const svg = (paths, cls) => {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  if (cls) s.setAttribute("class", cls);
  s.setAttribute("viewBox", "0 0 24 24");
  for (const d of [].concat(paths)) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d); s.appendChild(p);
  }
  return s;
};

// simple line icons per category (kept in the UI layer: the engine has no opinion on looks)
const ICONS = {
  invoices: ["M6 3h12v18l-3-2-3 2-3-2-3 2z", "M9 8h6M9 12h6"],
  contracts: ["M7 3h7l5 5v13H7z", "M14 3v5h5", "M10 15c1.5-2 3 2 4.5 0"],
  reference: ["M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1-2-2z", "M9 3v18"],
  screenshots: ["M3 5h18v11H3z", "M9 20h6M12 16v4"],
  photos: ["M3 5h18v14H3z", "M8.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3", "M3 16l5-4 4 3 3-2 6 5"],
  graphics: ["M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z", "M18 15l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z"],
  video: ["M3 6h13v12H3z", "M16 10l5-3v10l-5-3"],
  audio: ["M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"],
  spreadsheets: ["M3 4h18v16H3z", "M3 9h18M3 14h18M9 4v16M15 4v16"],
  slides: ["M3 4h18v12H3z", "M12 16v4M8 20h8"],
  installers: ["M12 3v11", "M8 11l4 4 4-4", "M4 19h16"],
  archives: ["M3 6h18v13H3z", "M3 6l2-3h14l2 3", "M10 11h4"],
  _folder: ["M3 6h6l2 2h10v11H3z"],
};
const CHEV = "M9 6l6 6-6 6";
const XMARK = ["M6 6l12 12", "M18 6L6 18"];

// what the app did to decide, in words a person can read
function whyText(row) {
  switch (row.signal) {
    case "pdf": return "read the PDF";
    case "content": return "read the text inside";
    case "vision": return "looked at the picture";
    case "extension": return "by file type";
    case "rule": return "by the file name";
    default: return "";
  }
}
const isSoft = (row) => ["pdf", "content", "vision"].includes(row.signal);

let CATS = [];              // [{id,label,folder}]
let dir = null, rows = [], scanId = null, lastRunId = null, total = 0;
const groupEls = new Map(); // catId -> { card, list, count, preview, detail, rows[] }

/* ---------------- tabs / screens ---------------- */
const SCREENS = { pick: "#s-pick", review: "#s-review", done: "#s-done", auto: "#s-auto" };
function show(name) {
  for (const [k, sel] of Object.entries(SCREENS)) $(sel).classList.toggle("active", k === name);
}
document.querySelectorAll(".tab").forEach((b) => b.onclick = () => {
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === b));
  if (b.dataset.tab === "auto") { show("auto"); loadFolders(); }
  else show(rows.length ? "review" : "pick");
});

/* ---------------- pick + scan ---------------- */
$("#pick").onclick = async () => {
  const r = await T.pickFolder();
  if (r) startScan(r.dir, r.count);
};
$("#rv-back").onclick = () => { if (scanId) T.cancelScan(scanId); resetPlan(); show("pick"); };
$("#dn-again").onclick = () => { resetPlan(); show("pick"); };
$("#dn-open").onclick = () => dir && T.reveal(dir);

function resetPlan() { rows = []; groupEls.clear(); $("#rv-groups").innerHTML = ""; $("#rv-left").classList.add("hidden"); scanId = null; }

function setProgress(text, frac) {
  $("#rv-progress .txt").textContent = text;
  if (frac != null) $("#rv-progress .fill").style.width = Math.max(6, Math.round(frac * 100)) + "%";
}

async function startScan(folder, count) {
  dir = folder; total = count || 0;
  resetPlan();
  $("#rv-path").textContent = folder;
  $("#rv-title").textContent = "Looking through your files";
  $("#rv-progress").classList.remove("hidden");
  $("#rv-assure").classList.remove("hidden");
  setProgress("Starting", 0.04);
  $("#rv-apply").disabled = true;
  show("review");

  const res = await T.scan({ dir: folder, scanId: (scanId = "s" + Date.now()) });
  $("#rv-progress").classList.add("hidden");
  if (!res.ok) { $("#rv-title").textContent = "That did not work"; $("#rv-path").textContent = res.error || "Unknown error"; return; }
  if (!rows.length) (res.plan || []).forEach(addRow);   // non-streaming fallback
  finishScan();
}

function finishScan() {
  const moving = rows.filter((r) => r.willMove).length;
  const folders = new Set(rows.filter((r) => r.willMove).map((r) => r.category)).size;
  $("#rv-title").textContent = moving
    ? `Ready to tidy ${moving} file${moving === 1 ? "" : "s"} into ${folders} folder${folders === 1 ? "" : "s"}`
    : "Nothing here needs moving";
  refreshApply();
}

T.onScanStatus(({ scanId: sid, text }) => { if (sid === scanId) setProgress(text, 0.08); });
T.onScanRow(({ scanId: sid, row }) => {
  if (sid !== scanId) return;
  addRow(row);
  if (row.total) total = row.total;
  setProgress(`Read ${rows.length} of ${total || "?"}`, total ? rows.length / total : null);
});

/* ---------------- plan rendering ---------------- */
function addRow(row) {
  rows.push(row);
  if (row.willMove) addToGroup(row); else renderLeftAlone();
  refreshApply();
}

function catOf(id) { return CATS.find((c) => c.id === id) || { id, label: id, folder: id }; }

function addToGroup(row) {
  let g = groupEls.get(row.category);
  if (!g) g = createGroup(row.category);
  g.rows.push(row);
  g.count.textContent = g.rows.length;
  renderPreview(g);
  if (g.card.classList.contains("open")) g.detail.appendChild(fileRow(row, g));
}

function createGroup(catId) {
  const cat = catOf(catId);
  const card = el("div", "group");
  const head = el("div", "g-head");
  const icon = el("span", "g-icon"); icon.appendChild(svg(ICONS[catId] || ICONS._folder));
  const name = el("span", "g-name", cat.label);
  const count = el("span", "g-count", "0");
  const chev = svg(CHEV, "g-chev");
  head.append(icon, name, count, chev);
  const preview = el("div", "g-preview");
  const detail = el("div", "g-detail hidden");
  card.append(head, preview, detail);
  $("#rv-groups").appendChild(card);

  const g = { card, head, count, preview, detail, rows: [], catId };
  head.onclick = () => {
    const open = card.classList.toggle("open");
    preview.classList.toggle("hidden", open);
    detail.classList.toggle("hidden", !open);
    if (open && !detail.childElementCount) g.rows.forEach((r) => detail.appendChild(fileRow(r, g)));
  };
  groupEls.set(catId, g);
  return g;
}

function renderPreview(g) {
  g.preview.innerHTML = "";
  g.rows.slice(0, 3).forEach((r) => g.preview.appendChild(el("span", "fpill", r.name)));
  if (g.rows.length > 3) g.preview.appendChild(el("span", "fpill more", `and ${g.rows.length - 3} more`));
}

function fileRow(row, g) {
  const tr = el("div", "frow");
  const main = el("div", "fr-main");
  main.appendChild(el("div", "fr-name", row.name));
  const soft = isSoft(row) && row.confidence != null && row.confidence < 0.6;
  const why = el("div", "fr-why" + (soft ? " unsure" : ""), whyText(row) + (soft ? " · worth a look" : ""));
  if (row.raw) why.title = row.raw;             // the vision model's own sentence
  main.appendChild(why);

  const sel = el("select", "select");
  CATS.forEach((c) => sel.appendChild(new Option(c.label, c.id)));
  sel.value = row.category;
  sel.onchange = () => { row.category = sel.value; rebuildGroups(); };

  const drop = el("button", "fr-drop"); drop.title = "Leave this one where it is";
  drop.appendChild(svg(XMARK));
  drop.onclick = () => { row.willMove = false; rebuildGroups(); renderLeftAlone(); };

  tr.append(main, sel, drop);
  void g;
  return tr;
}

// full redraw, only after a user override (rare) so streaming stays incremental
function rebuildGroups() {
  groupEls.clear();
  $("#rv-groups").innerHTML = "";
  rows.filter((r) => r.willMove).forEach(addToGroup);
  refreshApply();
}

function leaveReason(row) {
  if (row.note) return row.note;
  if (row.signal === "error") return "could not be read";
  return "not clear enough to file";
}

function renderLeftAlone() {
  const left = rows.filter((r) => !r.willMove);
  const box = $("#rv-left");
  if (!left.length) { box.classList.add("hidden"); return; }
  box.classList.remove("hidden");
  box.innerHTML = "";
  box.appendChild(el("h3", null, `Left exactly where they are (${left.length})`));
  box.appendChild(el("div", "lc-sub", "Desk Tidy only moves what it is sure about."));
  left.slice(0, 12).forEach((r) => {
    const row = el("div", "lc-row");
    row.append(el("span", "n", r.name), el("span", "r", leaveReason(r)));
    box.appendChild(row);
  });
  if (left.length > 12) box.appendChild(el("div", "lc-row", `and ${left.length - 12} more`));
}

function refreshApply() {
  const n = rows.filter((r) => r.willMove).length;
  const b = $("#rv-apply");
  b.textContent = n ? `Tidy up ${n} file${n === 1 ? "" : "s"}` : "Nothing to move";
  b.disabled = n === 0;
}

/* ---------------- apply + undo ---------------- */
$("#rv-apply").onclick = async () => {
  $("#rv-apply").disabled = true;
  const res = await T.apply({ dir, plan: rows });
  lastRunId = res.runId;
  showDone(res.summary.count, res.summary.byCategory, rows.filter((r) => !r.willMove).length, false);
};

function showDone(count, byCategory, leftCount, auto) {
  $("#dn-title").textContent = count ? `Tidied ${count} file${count === 1 ? "" : "s"}.` : "Nothing moved.";
  const chips = $("#dn-chips"); chips.innerHTML = "";
  for (const [cat, n] of Object.entries(byCategory || {})) {
    const chip = el("span", "chip", catOf(cat).label);
    chip.appendChild(el("b", null, String(n)));
    chips.appendChild(chip);
  }
  $("#dn-note").textContent =
    (leftCount ? `${leftCount} file${leftCount === 1 ? "" : "s"} left where they were. ` : "") +
    (auto ? "Done on its own. " : "") + "Nothing was uploaded, and you can undo this.";
  $("#dn-undo").disabled = !count;
  show("done");
}

$("#dn-undo").onclick = async () => {
  if (!lastRunId) return;
  const r = await T.undo(lastRunId);
  $("#dn-title").textContent = `Put ${r.restored} file${r.restored === 1 ? "" : "s"} back.`;
  $("#dn-chips").innerHTML = "";
  $("#dn-note").textContent = "Everything is exactly where it started.";
  $("#dn-undo").disabled = true;
};

// a result pushed in from an automation notification
T.onLoadResult((payload) => {
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x.dataset.tab === "tidy"));
  dir = payload.dir;
  if (payload.applied) {
    lastRunId = payload.runId;
    rows = payload.plan || [];
    showDone(payload.summary.count, payload.summary.byCategory, rows.filter((r) => !r.willMove).length, true);
  } else {
    resetPlan();
    $("#rv-path").textContent = payload.dir;
    $("#rv-progress").classList.add("hidden");
    (payload.plan || []).forEach(addRow);
    finishScan();
    show("review");
  }
});
T.onUndone(({ restored }) => { void restored; });

/* ---------------- keep it tidy ---------------- */
const TRIGGER_TEXT = { manual: "Only when you ask", interval: "Checks regularly", watch: "Watches for new files" };
const EVERY = { 15: "every 15 minutes", 60: "every hour", 360: "every 6 hours", 1440: "once a day" };
let editing = null;

async function loadFolders() {
  const folders = await T.listFolders();
  const list = $("#au-list"); list.innerHTML = "";
  if (!folders.length) {
    list.appendChild(el("div", "empty", "No folders yet. Add one and Desk Tidy will keep it in order for you."));
    return;
  }
  folders.forEach((f) => {
    const card = el("div", "fcard");
    const icon = el("span", "g-icon"); icon.appendChild(svg(ICONS._folder));
    const main = el("div", "fc-main");
    main.appendChild(el("div", "fc-name", f.path.split("/").pop() || f.path));
    const when = f.trigger === "interval" ? `${TRIGGER_TEXT.interval} ${EVERY[f.intervalMinutes] || `every ${f.intervalMinutes} min`}` : TRIGGER_TEXT[f.trigger];
    const then = f.posture === "auto" ? "files them for you" : "asks you first";
    const desc = el("div", "fc-desc");
    desc.append(document.createTextNode(when), el("span", "dot", "·"), document.createTextNode(then));
    main.appendChild(desc);
    const edit = el("button", "btn ghost", "Change");
    edit.onclick = () => openEditor(f);
    card.append(icon, main, edit);
    list.appendChild(card);
  });
}

$("#au-add").onclick = async () => {
  const r = await T.pickFolder();
  if (r) openEditor({ path: r.dir, trigger: "watch", posture: "notify", intervalMinutes: 60, threshold: 0.45 });
};

function pickSeg(id, value) {
  document.querySelectorAll(`#${id} button`).forEach((b) => b.classList.toggle("on", b.dataset.v === String(value)));
}
function segValue(id) {
  const on = document.querySelector(`#${id} button.on`);
  return on ? on.dataset.v : null;
}
function wireSeg(id, onPick) {
  document.querySelectorAll(`#${id} button`).forEach((b) => b.onclick = () => { pickSeg(id, b.dataset.v); if (onPick) onPick(b.dataset.v); });
}
wireSeg("ed-trigger", (v) => $("#ed-interval-row").classList.toggle("hidden", v !== "interval"));
wireSeg("ed-posture", (v) => {
  $("#ed-posture-hint").textContent = v === "auto"
    ? "Files are moved for you, and every run can be undone from the menu bar."
    : "You get a notification and nothing moves until you have looked at it.";
});
wireSeg("ed-care");

function openEditor(f) {
  editing = f;
  $("#ed-path").textContent = f.path;
  pickSeg("ed-trigger", f.trigger || "watch");
  $("#ed-interval-row").classList.toggle("hidden", (f.trigger || "watch") !== "interval");
  $("#ed-interval").value = String(f.intervalMinutes || 60);
  pickSeg("ed-posture", f.posture || "notify");
  document.querySelector("#ed-posture button.on").click();
  const thr = f.threshold || 0.45;
  pickSeg("ed-care", thr >= 0.6 ? "0.65" : thr <= 0.4 ? "0.35" : "0.45");
  $("#au-editor").classList.remove("hidden");
}
$("#ed-cancel").onclick = () => { $("#au-editor").classList.add("hidden"); editing = null; };
$("#ed-save").onclick = async () => {
  if (!editing) return;
  await T.saveFolder({
    path: editing.path,
    trigger: segValue("ed-trigger") || "watch",
    posture: segValue("ed-posture") || "notify",
    intervalMinutes: +$("#ed-interval").value || 60,
    threshold: +(segValue("ed-care") || 0.45),
  });
  $("#au-editor").classList.add("hidden"); editing = null;
  loadFolders();
};
$("#ed-remove").onclick = async () => {
  if (!editing) return;
  await T.removeFolder(editing.path);
  $("#au-editor").classList.add("hidden"); editing = null;
  loadFolders();
};

/* ---------------- boot ---------------- */
(async () => {
  try { CATS = await T.getCategories(); } catch { CATS = []; }
})();
