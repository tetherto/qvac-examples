// Headless test of the whole engine except Electron: routing, schema generation, extraction on
// all three document paths, template switching, and CSV output. Ground truth is known because
// the fixtures in demo/ were generated.
//
// Run: node test-engine.cjs
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { inspect } = require("./lib/reader");
const { Extractor } = require("./lib/extractor");
const { Store } = require("./lib/store");
const { toCsv } = require("./lib/csv");
const { collectDocuments } = require("./lib/walk");
const { schemaForTemplate, STARTER_TEMPLATES, normaliseFields, parseAmount, coerce, checkArithmetic } = require("./lib/schema");

const DEMO = path.join(__dirname, "demo");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  OK   " + m); } else { fail++; console.log("  FAIL " + m); } };

const TRUTH = {
  "invoice-atelier.pdf": { supplier: "Atelier Belleville SARL", invoice_number: "FA-2026-0088",
    invoice_date: "2026-07-22", net_amount: 2690, vat_amount: 538, total_amount: 3228, currency: "EUR" },
  "invoice-nordwind.pdf": { supplier: "Nordwind Cloud GmbH", invoice_number: "2026-0412",
    invoice_date: "2026-07-14", net_amount: 2755, vat_amount: 551, total_amount: 3306, currency: "EUR" },
  "receipt-scan.png": { supplier: "Atelier Belleville SARL", invoice_number: "FA-2026-0088",
    invoice_date: "2026-07-22", net_amount: 2690, vat_amount: 538, total_amount: 3228, currency: "EUR" },
};

(async () => {
  console.log("\n=== 1. schema generation from a template ===");
  const tpl = { ...STARTER_TEMPLATES[0], fields: normaliseFields(STARTER_TEMPLATES[0].fields) };
  const { schema, fields } = schemaForTemplate(tpl);
  ok(schema.type === "object", "schema is an object");
  ok(schema.additionalProperties === false, "additionalProperties is false (no stray keys)");
  ok(schema.required.length === fields.length, `all ${fields.length} fields are required`);
  ok(!!schema.properties.net_amount && schema.properties.net_amount.type === "number", "net_amount typed as number");
  ok(schema.properties.invoice_date.description.includes("YYYY-MM-DD"), "date field carries a format hint");

  console.log("\n=== 2. routing: each fixture takes the right path ===");
  const routes = {};
  for (const f of ["invoice-atelier.pdf", "invoice-nordwind.pdf", "invoice-scanned.pdf", "receipt-scan.png"]) {
    const r = await inspect(path.join(DEMO, f));
    routes[f] = r;
    console.log(`    ${f} -> ${r.kind} (${r.signal})${r.reason ? " : " + r.reason.slice(0, 60) : ""}`);
  }
  // These assertions used to be written the other way round, keyed on "one of the two text invoices
  // will break pdf-parse". That was true only because Node's Buffer pooling made parsing random;
  // once reader.js started passing a standalone Uint8Array, both text PDFs parsed every time and
  // the suite failed. Lesson: never assert on a bug. Each fixture now has ONE correct destination,
  // and the scan-only PDF is in the list, which it was not before.
  ok(routes["invoice-atelier.pdf"].kind === "text", "a text-layer PDF routes to the text model");
  ok(routes["invoice-nordwind.pdf"].kind === "text", "the second text PDF does too, deterministically");
  ok(routes["invoice-scanned.pdf"].kind === "pdf-needs-render",
     "a scan-only PDF asks to be rasterised instead of being read as text");
  ok(routes["receipt-scan.png"].kind === "image", "an image routes straight to the vision path");
  // The one thing we genuinely do not control: a PDF that pdf-parse cannot read at all must be a
  // routing decision, not a crash.
  const broken = path.join(os.tmpdir(), `ledger-not-a-pdf-${process.pid}.pdf`);
  fs.writeFileSync(broken, "this is not a PDF at all");
  const brokenRoute = await inspect(broken);
  ok(brokenRoute.kind === "pdf-needs-render",
     `an unparseable PDF falls through to vision rather than erroring (${(brokenRoute.reason || "").slice(0, 42)})`);
  fs.rmSync(broken, { force: true });

  console.log("\n=== 3. store: templates fork, built-ins survive ===");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-test-"));
  const store = new Store(dir);
  ok(store.templates().length === 3, "three starter templates seeded");
  ok(store.templates().every((t) => t.builtin), "starters are marked builtin");
  const forked = store.saveTemplate({ id: "supplier-invoices", name: "My supplier table",
    fields: [{ label: "Supplier", type: "text" }, { label: "Total", type: "number" }] });
  ok(forked.id !== "supplier-invoices", "editing a builtin forks to a new id");
  ok(forked.forkedFrom === "supplier-invoices", "the fork records its origin");
  ok(!!store.template("supplier-invoices"), "the builtin still exists after forking");
  let threw = false;
  try { store.deleteTemplate("supplier-invoices"); } catch { threw = true; }
  ok(threw, "deleting a builtin is refused");
  ok(store.deleteTemplate(forked.id), "a user template can be deleted");
  let threw2 = false;
  try { store.saveTemplate({ name: "empty", fields: [] }); } catch { threw2 = true; }
  ok(threw2, "a template with no fields is refused");

  // The watchdog exists because a second QVAC app makes loadModel hang forever with no error. It is
  // timer logic around a race, so it gets tested on fakes rather than trusted. quietMs is injected
  // so this runs in milliseconds.
  console.log("\n=== 4. the model-load watchdog ===");
  const wd = new Extractor({ quietMs: 300 });
  const never = () => new Promise(() => {});                 // hangs, exactly like the deadlock

  const t0 = Date.now();
  let msg = "";
  try { await wd._guardLoad("text model", never); }
  catch (e) { msg = String(e.message); }
  ok(/another QVAC app/.test(msg), "a silent hang is rejected with the real cause named");
  ok(Date.now() - t0 >= 250 && Date.now() - t0 < 2000, "it fires on time, not instantly and not late");

  const fast = await wd._guardLoad("text model", () => Promise.resolve("model-1"));
  ok(fast === "model-1", "a load that works is passed straight through");

  // The important half: a slow download must NOT be killed. Progress keeps pushing the deadline.
  let ticks = 0;
  const slowButAlive = (bump) => new Promise((resolve) => {
    const iv = setInterval(() => { ticks++; bump(); if (ticks === 6) { clearInterval(iv); resolve("model-2"); } }, 120);
  });
  const slow = await wd._guardLoad("text model", slowButAlive);
  ok(slow === "model-2" && ticks === 6,
    `a load that keeps reporting progress survives past the quiet window (${ticks} progress events over ~720ms with a 300ms window)`);

  console.log("\n=== 5. extraction on all three paths (this loads models) ===");
  const ex = new Extractor();
  const results = {};
  // Exercise one document per model: whichever PDF took the text path (Qwen3 4B) and the image
  // (Qwen3-VL 2B). The render path itself needs Electron, so it is covered by the app test.
  const textFixture = Object.keys(routes).find((f) => routes[f].kind === "text");
  const targets = [textFixture, "receipt-scan.png"].filter(Boolean);
  for (const f of targets) {
    const src = routes[f];
    const res = await ex.extract(src, tpl);
    results[f] = res;
    const truth = TRUTH[f];
    const v = res.values;
    console.log(`\n    ${f}  [${res.model}, ${(res.ms / 1000).toFixed(1)}s]`);
    let good = 0, tot = 0;
    for (const [k, want] of Object.entries(truth)) {
      const key = k === "supplier" ? "supplier" : k;
      const got = v[key];
      tot++;
      const same = typeof want === "number"
        ? Math.abs(Number(got) - want) < 0.01
        : String(got || "").trim().toLowerCase() === String(want).toLowerCase();
      if (same) good++; else console.log(`      MISS ${key}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
    }
    console.log(`      ${good}/${tot} known fields correct`);
    ok(good === tot, `${f}: every known field extracted correctly`);
    ok(Array.isArray(res.missing), `${f}: reports which fields came back empty`);
  }

  console.log("\n=== 6. CSV output ===");
  const rows = Object.entries(results).map(([file, r], i) => ({
    id: "r" + i, templateId: tpl.id, file, values: r.values, missing: r.missing,
  }));
  const csv = toCsv(fields, rows);
  const lines = csv.trim().split("\r\n");
  ok(lines.length === rows.length + 1, `CSV has a header plus ${rows.length} rows`);
  ok(csv.charCodeAt(0) === 0xfeff, "CSV starts with a BOM so Excel reads UTF-8");
  ok(lines[0].split(",").length === fields.length + 2,
     "header carries the template columns plus source_file and needs_review");
  ok(/source_file,needs_review$/.test(lines[0]),
     "a row can always be traced back to its document, and its review flag survives the export");
  const euro = toCsv(fields, rows, { delimiter: ";", decimalComma: true });
  ok(euro.includes(";"), "European variant uses semicolons");
  ok(/\d,\d\d/.test(euro), "European variant writes decimals with a comma");
  // A value containing the delimiter must be quoted, not allowed to split the row.
  const tricky = toCsv([{ key: "s", label: "Supplier", type: "text" }],
    [{ values: { s: 'Smith, Jones & Co "The Agency"' } }]);
  ok(tricky.includes('"Smith, Jones & Co ""The Agency"""'), "commas and quotes inside a value are escaped");

  console.log("\n=== 7. the amount parser, which is where wrong numbers come from ===");
  // Every one of these was silently wrong before: "2690,00" became 269000, "8,1" became 81,
  // "2.690,00" became 2.69. A hundredfold error in a ledger, with nothing flagged.
  const amounts = [
    ["2690,00", 2690], ["1 234,56", 1234.56], ["EUR 2 690,00", 2690], ["8,1", 8.1],
    ["2.690,00", 2690], ["1.234.567,89", 1234567.89], ["1,234,567.89", 1234567.89],
    ["(1.234,56)", -1234.56], ["-2690", -2690], ["3228", 3228], [2690.5, 2690.5],
  ];
  let amountsOk = 0;
  for (const [input, want] of amounts) {
    const r = parseAmount(input);
    if (r.ok && Math.abs(r.value - want) < 0.001) amountsOk++;
    else console.log(`      MISS ${JSON.stringify(input)} -> ${JSON.stringify(r)} want ${want}`);
  }
  ok(amountsOk === amounts.length, `${amountsOk}/${amounts.length} real-world amount formats parse correctly`);
  // Refusing to guess is a feature: "1.234" is 1234 to a German and 1.234 to an American.
  ok(parseAmount("1.234").ambiguous === true && parseAmount("1.234").ok === false,
     "a genuinely ambiguous amount is refused, not guessed");
  ok(parseAmount("abc").ok === false, "junk is refused");
  ok(coerce({ key: "n", type: "number", required: true }, "1.234").empty === true,
     "a refused amount is flagged for a human instead of stored as a number");

  console.log("\n=== 8. CSV formula injection (the export opens in Excel) ===");
  const evil = toCsv([{ key: "s", label: "Supplier", type: "text" }, { key: "n", label: "Net", type: "number" }],
    [{ name: "inv.pdf", values: { s: `=cmd|' /C calc'!A0`, n: -1234.56 }, missing: [] }]);
  ok(evil.includes("'=cmd"), "a formula from a third-party invoice is neutralised with a leading quote");
  ok(!/(^|[,;])=/m.test(evil), "no cell begins with a bare = after neutralisation");
  ok(evil.includes("-1234.56"), "a negative NUMBER is left alone, not turned into text");

  console.log("\n=== 9. the arithmetic backstop ===");
  const money = normaliseFields([{ label: "Net amount", type: "number" },
    { label: "VAT amount", type: "number" }, { label: "Total amount", type: "number" }]);
  ok(checkArithmetic(money, { net_amount: 2690, vat_amount: 538, total_amount: 3228 }).length === 0,
     "a row that adds up is not flagged");
  ok(checkArithmetic(money, { net_amount: 3228, vat_amount: 538, total_amount: 3228 }).length === 1,
     "the total copied into the net field is caught, which no other check would see");
  ok(checkArithmetic(money, { net_amount: 269000, vat_amount: 538, total_amount: 3228 }).length === 1,
     "a hundredfold magnitude error is caught");
  ok(checkArithmetic(money, { net_amount: 0, vat_amount: 0, total_amount: 0 }).length === 0,
     "an empty row is left to the missing-field flag, not double-reported");

  console.log("\n=== 10. absent vs wrong: measured against 102 real invoices ===");
  // Those documents carry NO VAT registration number. Before the N/A sentinel and these checks, the
  // model filled the column with the nearest plausible text on all 102 and nothing was flagged.
  const vatF = normaliseFields([{ label: "VAT ID", type: "text" }])[0];
  const curF = normaliseFields([{ label: "Currency", type: "currency" }])[0];
  const dateF = normaliseFields([{ label: "Invoice date", type: "date" }])[0];
  const rejected = ["Cyprus", "Anthropic, PBC", "Cyprus 19% on $10.08"];
  ok(rejected.every((v) => coerce(vatF, v).empty && coerce(vatF, v).reason),
     "the exact wrong VAT IDs seen in production are rejected with a reason");
  ok(coerce(vatF, "FR40303265045").value === "FR40303265045", "a real VAT ID is kept");
  ok(coerce(vatF, "N/A").empty && !coerce(vatF, "N/A").reason,
     "the not-stated sentinel reads as absent, not as the literal text N/A");
  ok(coerce(vatF, "none").empty && coerce(vatF, "  -  ").empty,
     "the variants a model reaches for instead of the sentinel are folded in");
  ok(coerce(curF, "Cyprus").empty && coerce(curF, "USD").value === "USD",
     "a country is not a currency code");
  ok(coerce(dateF, "April 27, 2026").empty && coerce(dateF, "2026-04-27").value === "2026-04-27",
     "a date that is not YYYY-MM-DD is rejected rather than stored in a date column");

  console.log("\n=== 11. expanding files and folders ===");
  const wdir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-walk-"));
  fs.mkdirSync(path.join(wdir, "sub", "deeper"), { recursive: true });
  fs.mkdirSync(path.join(wdir, "node_modules"), { recursive: true });
  fs.writeFileSync(path.join(wdir, "a.pdf"), "x");
  fs.writeFileSync(path.join(wdir, "sub", "b.png"), "x");
  fs.writeFileSync(path.join(wdir, "sub", "deeper", "c.jpg"), "x");
  fs.writeFileSync(path.join(wdir, "sub", "notes.txt"), "x");
  fs.writeFileSync(path.join(wdir, ".hidden.pdf"), "x");
  fs.writeFileSync(path.join(wdir, "node_modules", "d.pdf"), "x");
  const w = collectDocuments([wdir]);
  ok(w.files.length === 3, `a folder is walked to the bottom (${w.files.length} documents found)`);
  ok(!w.files.some((f) => f.includes("node_modules")), "node_modules is not walked");
  ok(!w.files.some((f) => f.includes(".hidden")), "hidden files are ignored");
  ok(!w.files.some((f) => f.endsWith(".txt")), "unsupported types in a folder are ignored quietly");
  const w2 = collectDocuments([wdir, path.join(wdir, "sub")]);
  ok(w2.files.length === 3, "a parent and its child selected together read nothing twice");
  const w3 = collectDocuments([path.join(wdir, "a.pdf"), path.join(wdir, "sub")]);
  ok(w3.files.length === 3, "files and folders can be mixed in one selection");
  ok(collectDocuments(["/does/not/exist"]).skipped.length === 1, "a missing path is reported, not fatal");
  ok(collectDocuments([]).files.length === 0 && collectDocuments(null).files.length === 0,
     "an empty or absent selection is handled");
  fs.rmSync(wdir, { recursive: true, force: true });

  await ex.unload();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("\nTEST CRASHED:", e); process.exit(1); });
