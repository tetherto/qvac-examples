// Drives the real Electron app headlessly: boots main.js's dependencies inside Electron, renders a
// SCANNED pdf through Chromium (the one path node cannot test), extracts it, and checks the CSV.
//
// Run: npx electron test-app.cjs
"use strict";
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Electron quits as soon as the last window closes unless something says otherwise. This test's only
// window is the offscreen one used to rasterise, and destroying it therefore killed the process
// with exit code 0 in the middle of the run: the remaining assertions never executed and the suite
// looked like it had simply stopped printing. It cost a wrong diagnosis (a shared-worker deadlock)
// before the exit code gave it away. Keep the app alive; this test decides when it ends.
app.on("window-all-closed", () => { /* the test controls the lifetime, not the window count */ });

const { inspect } = require("./lib/reader");
const { Extractor } = require("./lib/extractor");
const { Store } = require("./lib/store");
const { toCsv } = require("./lib/csv");
const { schemaForTemplate, STARTER_TEMPLATES, normaliseFields } = require("./lib/schema");

const DEMO = path.join(__dirname, "demo");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  OK   " + m); } else { fail++; console.log("  FAIL " + m); } };

// Same renderer as main.js. Duplicated here on purpose: the test proves the technique works in
// Electron, independently of the app's wiring.
async function renderPdfFirstPage(pdfPath) {
  const off = new BrowserWindow({ show: false, width: 1240, height: 1754,
    webPreferences: { offscreen: true, plugins: true } });
  try {
    await off.loadURL("file://" + encodeURI(pdfPath) + "#toolbar=0&view=FitH");
    await new Promise((r) => setTimeout(r, 1500));
    const image = await off.webContents.capturePage();
    if (image.isEmpty()) throw new Error("empty capture");
    const out = path.join(os.tmpdir(), `ledger-test-${Date.now()}.png`);
    fs.writeFileSync(out, image.toPNG());
    return out;
  } finally { if (!off.isDestroyed()) off.destroy(); }
}

app.whenReady().then(async () => {
  try {
    console.log("\n=== Electron-only path: rasterise a scanned PDF, then read it ===");
    const scanned = path.join(DEMO, "invoice-scanned.pdf");
    const routed = await inspect(scanned);
    ok(routed.kind === "pdf-needs-render", `a scanned PDF asks to be rendered (${routed.reason || ""})`);

    const png = await renderPdfFirstPage(scanned);
    const size = fs.statSync(png).size;
    console.log(`    rendered to ${path.basename(png)} (${(size / 1024).toFixed(0)} KB)`);
    ok(size > 20000, "the render produced a real image, not a blank page");

    const tpl = { ...STARTER_TEMPLATES[0], fields: normaliseFields(STARTER_TEMPLATES[0].fields) };
    const ex = new Extractor();
    const res = await ex.extract({ kind: "image", imagePath: png }, tpl);
    console.log(`    extracted with ${res.model} in ${(res.ms / 1000).toFixed(1)}s`);
    console.log("    values:", JSON.stringify(res.values));

    const truth = { supplier: "Atelier Belleville SARL", invoice_number: "FA-2026-0088", total_amount: 3228 };
    let good = 0;
    for (const [k, want] of Object.entries(truth)) {
      const got = res.values[k];
      const same = typeof want === "number" ? Math.abs(Number(got) - want) < 0.01
        : String(got || "").trim().toLowerCase() === String(want).toLowerCase();
      if (same) good++; else console.log(`      MISS ${k}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
    }
    ok(good === Object.keys(truth).length, "key fields read correctly from a rasterised scan");

    console.log("\n=== store + csv inside Electron's userData ===");
    const store = new Store(path.join(app.getPath("userData"), "test-run"));
    const row = store.addRow({ id: "t1", templateId: tpl.id, file: scanned,
      name: "invoice-scanned.pdf", values: res.values, missing: res.missing, model: res.model });
    ok(store.rowsFor(tpl.id).length === 1, "row persisted");
    const { fields } = schemaForTemplate(tpl);
    const csv = toCsv(fields, [row]);
    ok(csv.split("\r\n")[0].includes("Supplier"), "CSV header carries the template labels");
    ok(csv.includes("3228.00"), "CSV writes the amount with two decimals");
    fs.rmSync(path.join(app.getPath("userData"), "test-run"), { recursive: true, force: true });
    fs.rmSync(png, { force: true });
    await ex.unload();

    console.log(`\n=== ${pass} passed, ${fail} failed ===`);
    app.exit(fail ? 1 : 0);
  } catch (e) {
    console.error("\nTEST CRASHED:", e);
    app.exit(1);
  }
});
