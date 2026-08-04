// Measures the extraction against a real folder. Ground truth for THESE documents, established by
// reading them: Anthropic invoices/receipts carry NO VAT registration number, are all in USD, and a
// Receipt has no due date (it has a paid date).
const fs = require("fs");
const path = require("node:path");
const { inspect } = require("./lib/reader");
const { Extractor } = require("./lib/extractor");
const { STARTER_TEMPLATES, normaliseFields } = require("./lib/schema");

const DIR = process.argv[2];
const N = Number(process.argv[3] || 12);

(async () => {
  const all = fs.readdirSync(DIR).filter((f) => f.toLowerCase().endsWith(".pdf")).sort();
  // Sample both shapes: invoices (have a due date) and receipts (do not).
  const invoices = all.filter((f) => /^Invoice-/i.test(f)).slice(0, N / 2);
  const receipts = all.filter((f) => /Receipt-/i.test(f)).slice(0, N / 2);
  const pick = [...invoices, ...receipts];

  const tpl = { ...STARTER_TEMPLATES[0], fields: normaliseFields(STARTER_TEMPLATES[0].fields) };
  const ex = new Extractor();
  const stats = { vatFlagged: 0, vatKeptWrong: 0, dueEmptyOnReceipt: 0, dueFilledOnInvoice: 0, arith: 0, curBad: 0 };

  for (const f of pick) {
    const src = await inspect(path.join(DIR, f));
    const r = await ex.extract(src, tpl);
    const isReceipt = /Receipt-/i.test(f);
    const vat = r.values.vat_id;
    const flaggedVat = r.missing.includes("vat_id");
    if (flaggedVat) stats.vatFlagged++; else if (vat) stats.vatKeptWrong++;
    if (isReceipt && !r.values.due_date) stats.dueEmptyOnReceipt++;
    if (!isReceipt && r.values.due_date) stats.dueFilledOnInvoice++;
    if (r.values.currency !== "USD") stats.curBad++;
    const n = r.values.net_amount, v = r.values.vat_amount, t = r.values.total_amount;
    if (Math.abs(n + v - t) <= 0.02 && t > 0) stats.arith++;
    console.log(`  ${f.slice(0, 34).padEnd(34)} vat=${JSON.stringify(vat).padEnd(10)}${flaggedVat ? "[flagged]" : "         "} due=${JSON.stringify(r.values.due_date).padEnd(14)} cur=${r.values.currency} ${t.toFixed(2)}${r.issues && Object.keys(r.issues).length ? "  issues: " + JSON.stringify(r.issues) : ""}`);
  }
  console.log(`\n==== over ${pick.length} real documents (${invoices.length} invoices, ${receipts.length} receipts) ====`);
  console.log(`VAT ID correctly flagged as absent : ${stats.vatFlagged}/${pick.length}`);
  console.log(`VAT ID silently kept as wrong data : ${stats.vatKeptWrong}/${pick.length}`);
  console.log(`Receipts with no due date (correct) : ${stats.dueEmptyOnReceipt}/${receipts.length}`);
  console.log(`Invoices WITH a due date (correct)  : ${stats.dueFilledOnInvoice}/${invoices.length}`);
  console.log(`Currency = USD (correct)           : ${pick.length - stats.curBad}/${pick.length}`);
  console.log(`net + vat = total                  : ${stats.arith}/${pick.length}`);
  await ex.unload();
  process.exit(0);
})().catch((e) => { console.error("CRASH:", e.message); process.exit(1); });
