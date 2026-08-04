// Boots the REAL app (main.js, preload, renderer) inside Electron and inspects the live DOM.
//
// This exists because "the code looks right" is not evidence that a UI renders. It drives the same
// window a user gets, over the same IPC bridge, and it deliberately never starts an extraction, so
// it needs no model and no ~/.qvac worker.
//
// Run: npx electron test-ui.cjs
"use strict";
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Two things must happen BEFORE main.js is required.
//
// 1. Take the single-instance lock ourselves. main.js calls `app.exit(0)` when it cannot get it, so
//    running this suite while the app is open used to exit 0 having executed zero assertions: a
//    green "pass" that tested nothing. Within one process the second call returns true, so this
//    only changes the failure case, and it makes it loud.
if (!app.requestSingleInstanceLock()) {
  console.log("  FAIL another instance of the app is running; close it and re-run this suite");
  app.exit(1);
}

// 2. Point userData at a throwaway directory. This test creates and deletes templates, and it
//    asserts "exactly 3 tables" and "no rows", so against the real store it both pollutes the
//    user's data and starts failing the moment they use the app for real.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-uitest-"));
app.setPath("userData", SANDBOX);

require("./main.js"); // registers every IPC handler and creates the window on whenReady

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  OK   " + m); } else { fail++; console.log("  FAIL " + m); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await app.whenReady();
  await wait(400);
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) { console.log("  FAIL no window was created"); app.exit(1); return; }

  // The renderer paints after DOMContentLoaded -> refresh() -> IPC round trip. Subscribing to
  // did-finish-load unconditionally hangs forever when the load already finished before we got
  // here, so only wait while it is genuinely still loading, and never wait without a ceiling.
  if (win.webContents.isLoading()) {
    await Promise.race([
      new Promise((r) => win.webContents.once("did-finish-load", r)),
      wait(10000),
    ]);
  }
  await wait(1200);

  const js = (expr) => win.webContents.executeJavaScript(expr, true);
  // `el.hidden` is a lie about what the user sees: an author `display` rule overrides the attribute
  // (it did, for the template editor). Assert on layout instead, the way a person perceives it.
  // offsetParent is null on a position:fixed element even when it is plainly on screen, so the
  // measurement is the painted box.
  const visible = (id) => js(`(() => {
    const n = document.getElementById(${JSON.stringify(id)});
    if (!n) return false;
    const cs = getComputedStyle(n), r = n.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  })()`);

  console.log("\n=== the window and the IPC bridge ===");
  ok(!win.isDestroyed(), "the main window exists");
  ok(await js("typeof window.ledger === 'object'"), "the preload bridge reached the renderer");
  ok(await js("document.querySelector('.brand strong').textContent.includes('Invoice Manager')"),
    "the header names the app");

  console.log("\n=== templates arrived from the store over IPC ===");
  const tplCount = await js("document.querySelectorAll('#template-list .tpl').length");
  ok(tplCount === 3, `the three starter tables are listed (found ${tplCount})`);
  const names = await js("[...document.querySelectorAll('#template-list .tpl b')].map(n=>n.textContent)");
  ok(names.includes("Supplier invoices"), `table names rendered: ${names.join(", ")}`);
  const selected = await js("document.querySelectorAll('#template-list .tpl.on').length");
  ok(selected === 1, "exactly one table is selected");

  console.log("\n=== the columns pane follows the selected table ===");
  const cols = await js("[...document.querySelectorAll('#field-list .k')].map(n=>n.textContent)");
  ok(cols.length === 9, `the supplier-invoice table shows its 9 columns (found ${cols.length})`);
  ok(cols.includes("Net amount") && cols.includes("Total amount"),
    "net and total are separate columns, which is the whole point of the table");
  const title = await js("document.getElementById('table-title').textContent");
  ok(title === "Supplier invoices", `the results pane is titled after the table (${title})`);

  console.log("\n=== the table header is built from the template, not hardcoded ===");
  const heads = await js("[...document.querySelectorAll('#table thead th')].map(n=>n.textContent)");
  ok(heads[0] === "Document" && heads.includes("Supplier") && heads.includes("Read by"),
    `header columns come from the template (${heads.filter(Boolean).length} columns)`);
  ok(await visible("empty"), "the empty state shows while there are no rows");

  console.log("\n=== switching table redraws everything ===");
  await js("document.querySelectorAll('#template-list .tpl')[2].click()");
  await wait(500);
  const cols2 = await js("[...document.querySelectorAll('#field-list .k')].map(n=>n.textContent)");
  const title2 = await js("document.getElementById('table-title').textContent");
  ok(cols2.length === 5 && title2 === "Expense report",
    `picking the expense table swapped the columns (${title2}, ${cols2.length} columns)`);
  await js("document.querySelectorAll('#template-list .tpl')[0].click()");
  await wait(400);

  console.log("\n=== the template editor opens and is prefilled ===");
  ok(!(await visible("editor")), "the editor starts closed");
  await js("document.getElementById('edit-template').click()");
  await wait(350);
  ok(await visible("editor"), "clicking Edit opens the editor");
  const rowCount = await js("document.querySelectorAll('#editor-fields li').length");
  ok(rowCount === 9, `the editor is prefilled with the 9 existing columns (found ${rowCount})`);
  const noteText = await js("document.getElementById('editor-note').textContent");
  ok(/own copy/.test(noteText), "editing a built-in table warns that it will be copied, not overwritten");
  const nameVal = await js("document.getElementById('t-name').value");
  ok(/\(copy\)$/.test(nameVal), `the name is pre-suffixed for the copy (${nameVal})`);
  await js("document.getElementById('editor-cancel').click()");
  await wait(250);
  ok(!(await visible("editor")), "Cancel closes the editor and leaves the screen");
  const stillThree = await js("document.querySelectorAll('#template-list .tpl').length");
  ok(stillThree === 3, "cancelling really saved nothing");

  // This is the feature the whole app is for: the user decides which data gets extracted. If this
  // flow breaks, the app is a fixed-schema invoice reader, which is not what was asked for.
  console.log("\n=== building a table of your own, end to end ===");
  await js("document.getElementById('new-template').click()");
  await wait(300);
  ok(await js("document.querySelectorAll('#editor-fields li').length") === 1,
    "a new table starts with one empty column");
  await js("document.getElementById('add-field').click(); document.getElementById('add-field').click()");
  await wait(250);
  const added = await js("document.querySelectorAll('#editor-fields li').length");
  ok(added === 3, `Add column really adds rows (${added} columns)`);

  // Fill it in the way a user would: type into the inputs and fire the events the UI listens for.
  await js(`(() => {
    const set = (node, v, ev) => { node.value = v; node.dispatchEvent(new Event(ev, { bubbles: true })); };
    set(document.getElementById('t-name'), 'Rent ledger', 'input');
    set(document.getElementById('t-desc'), 'monthly rent', 'input');
    const rows = [...document.querySelectorAll('#editor-fields li')];
    const cols = [['Landlord','text'],['Paid on','date'],['Rent','number']];
    rows.forEach((li, i) => {
      set(li.querySelector('input'), cols[i][0], 'input');
      set(li.querySelector('select'), cols[i][1], 'change');
    });
    return true;
  })()`);
  await js("document.getElementById('editor-save').click()");
  await wait(700);

  ok(!(await visible("editor")), "saving closes the editor and leaves the screen");
  const afterSave = await js("[...document.querySelectorAll('#template-list .tpl b')].map(n=>n.textContent)");
  ok(afterSave.includes("Rent ledger"), `the new table joined the list (${afterSave.join(", ")})`);
  const newCols = await js("[...document.querySelectorAll('#field-list .k')].map(n=>n.textContent)");
  const newTypes = await js("[...document.querySelectorAll('#field-list .t')].map(n=>n.textContent)");
  ok(String(newCols) === "Landlord,Paid on,Rent", `its columns render (${newCols.join(", ")})`);
  ok(String(newTypes) === "text,date,number", `the chosen types survived the round trip (${newTypes.join(", ")})`);
  const newHeads = await js("[...document.querySelectorAll('#table thead th')].map(n=>n.textContent)");
  ok(newHeads.includes("Landlord") && !newHeads.includes("Supplier"),
    "the results table reshaped itself to the new columns");

  console.log("\n=== deleting a table you made (and only one you made) ===");
  ok(await visible("delete-template"), "Delete is offered for your own table");

  // Click the real button rather than the IPC behind it. The confirm is stubbed to yes, which is
  // the only part a test cannot answer for itself.
  await js("window.confirm = () => true; document.getElementById('delete-template').click()");
  await wait(700);
  const afterDelete = await js("[...document.querySelectorAll('#template-list .tpl b')].map(n=>n.textContent)");
  ok(!afterDelete.includes("Rent ledger"), `the table is gone (${afterDelete.join(", ")})`);
  ok(afterDelete.length === 3, "the three built-in tables survived");
  ok(!(await visible("delete-template")),
    "Delete hides again on a built-in table, which the store refuses to delete");

  console.log("\n=== folders: recursive, multiple, and mixed with files ===");
  // Build a nested tree here rather than pointing at anyone's real accounting folder: a test that
  // hardcodes a private path only passes on one machine, and it publishes that path.
  const TREE = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-tree-"));
  fs.mkdirSync(path.join(TREE, "2026", "anthropic"), { recursive: true });
  fs.mkdirSync(path.join(TREE, "2026", "hosting"), { recursive: true });
  for (const f of ["a.pdf", "b.pdf"]) fs.writeFileSync(path.join(TREE, "2026", "anthropic", f), "x");
  fs.writeFileSync(path.join(TREE, "2026", "hosting", "c.png"), "x");
  fs.writeFileSync(path.join(TREE, "loose.jpg"), "x");
  fs.writeFileSync(path.join(TREE, "notes.txt"), "x");

  const deep = await js(`window.ledger.scan([${JSON.stringify(TREE)}])`);
  ok(deep.files.length === 4 && deep.folders === 1,
    `one folder is walked all the way down, across subfolders (${deep.files.length} documents)`);
  const two = await js(`window.ledger.scan([${JSON.stringify(path.join(TREE, "2026", "anthropic"))}, ${JSON.stringify(path.join(TREE, "2026", "hosting"))}])`);
  ok(two.files.length === 3 && two.folders === 2, "several folders can be selected at once");
  const overlap = await js(`window.ledger.scan([${JSON.stringify(TREE)}, ${JSON.stringify(path.join(TREE, "2026"))}])`);
  ok(overlap.files.length === 4, "a parent AND a child selected together read nothing twice");
  const mixed = await js(`window.ledger.scan([${JSON.stringify(path.join(TREE, "2026"))}, ${JSON.stringify(path.join(TREE, "loose.jpg"))}, ${JSON.stringify(path.join(TREE, "notes.txt"))}])`);
  ok(mixed.files.length === 4 && mixed.skipped === 1,
    `files and folders mix, and an unsupported type is reported (${mixed.files.length} documents, ${mixed.skipped} skipped)`);
  fs.rmSync(TREE, { recursive: true, force: true });

  const empty = await js(`window.ledger.scan([])`);
  ok(empty.files.length === 0, "an empty selection expands to nothing rather than throwing");
  const ghost = await js(`window.ledger.scan(["/no/such/path/at/all"])`);
  ok(ghost.files.length === 0 && ghost.skipped === 1, "a path that does not exist is reported, not fatal");

  console.log("\n=== the folder button exists and is reachable ===");
  ok(await visible("browse-folders"), "Choose folders is on screen");
  ok(await js("document.getElementById('browse-folders').classList.contains('btn-primary')"),
    "folders are the primary action, files the secondary one");

  console.log("\n=== controls a user can reach before any model exists ===");
  ok(await js("!document.getElementById('browse').disabled"), "Choose files is enabled");
  ok(!(await visible("cancel")), "Cancel is not on screen while idle");
  const flavours = await js("[...document.querySelectorAll('#csv-flavour option')].map(o=>o.value)");
  ok(flavours.length === 2, `both CSV flavours are offered (${flavours.join(", ")})`);

  console.log("\n=== it actually painted pixels ===");
  const shot = await win.webContents.capturePage();
  ok(!shot.isEmpty(), "capturePage returned an image");
  const out = path.join(os.tmpdir(), "qvac-ledger-ui.png");
  fs.writeFileSync(out, shot.toPNG());
  const size = fs.statSync(out).size;
  ok(size > 30000, `the window is a painted UI, not a blank pane (${(size / 1024).toFixed(0)} KB)`);
  console.log(`    screenshot: ${out}`);

  fs.rmSync(SANDBOX, { recursive: true, force: true });   // leave no test store behind
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  app.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("\nUI TEST CRASHED:", e); app.exit(1); });
