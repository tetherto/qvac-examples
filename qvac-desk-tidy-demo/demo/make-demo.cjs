// Build (or reset) a realistic messy folder to film Desk Tidy against: ~100 files.
//
// Everything here is synthetic or a repo asset: no personal files, safe to sort on camera. Re-running
// wipes the folder and rebuilds it, so every take starts from the same mess.
//
//   node demo/make-demo.cjs                       -> ~/Desktop/Desk Tidy Demo
//   node demo/make-demo.cjs "/path/to/folder"     -> anywhere else
//
// The mess exercises every path the app has: content-classified documents, real PDFs, vision-classified
// images, rule-decided media, system junk that must be IGNORED, credentials that must NEVER move, and
// deliberately vague files that should come out as "not sure".
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const REPO = path.resolve(__dirname, "..", "..", ".."); // .../QVAC-agent
const OUT = process.argv[2] || path.join(os.homedir(), "Desktop", "Desk Tidy Demo");

/* ---------------- helpers ---------------- */
function write(name, body) { fs.writeFileSync(path.join(OUT, name), body); }
const cycle = (arr, i) => arr[i % arr.length];

// PDFs are rendered by Chromium (see demo/make-pdfs.js) then verified with the app's own parser.
const pdfQueue = [];
function writePdf(name, body) { pdfQueue.push({ name, body }); }

function copyAsset(rel, name) {
  const src = path.join(REPO, rel);
  if (!fs.existsSync(src)) { missing.push(rel); return false; }
  fs.copyFileSync(src, path.join(OUT, name));
  return true;
}
const missing = [];

// Binary-ish placeholder with plausible bytes and size (Finder shows a normal-looking file).
function blob(name, kb) {
  const buf = Buffer.alloc(kb * 1024);
  for (let i = 0; i < buf.length; i += 977) buf[i] = (i * 31) % 251;
  fs.writeFileSync(path.join(OUT, name), buf);
}

/* ---------------- content generators ---------------- */
const VENDORS = [
  ["Northwind Studio Ltd", "brand identity refresh", 4800], ["Helio Cloud SAS", "hosting, July", 189],
  ["Papermill Print Co", "conference flyers, 500 units", 640], ["Lumen Legal LLP", "advisory hours", 2250],
  ["Fleetline Logistics", "courier, September", 96], ["Studio Ferran", "photography day rate", 1400],
  ["Kestrel Software", "annual licence, 5 seats", 1188], ["Marbly Coworking", "desk, Q3", 2100],
];
function invoiceBody(i) {
  const [vendor, item, amount] = cycle(VENDORS, i);
  const vat = Math.round(amount * 0.2 * 100) / 100;
  return [
    vendor.toUpperCase(), "", "INVOICE",
    `Invoice number: INV-2026-${1000 + i * 7}`,
    "Issue date: 14 July 2026", "Due date: 13 August 2026", "",
    "Bill to: Acme Analytics SAS, 40 rue de Lisbonne, 75008 Paris", "",
    "Description                          Qty     Unit price      Amount",
    `${item.padEnd(36)} 1      ${String(amount).padStart(9)}      ${String(amount).padStart(9)}`, "",
    `Subtotal ${amount}`, `VAT 20% ${vat}`, `TOTAL AMOUNT DUE ${Math.round((amount + vat) * 100) / 100} EUR`, "",
    "Payment terms: 30 days net. Bank transfer to IBAN GB29 NWBK 6016 1331 9268 19.",
  ].join("\n");
}
function receiptBody(i) {
  const [vendor, item, amount] = cycle(VENDORS, i + 3);
  return [
    `${vendor} receipt`, `Order W${9000000 + i * 131}`, "Date: 14 July 2026", "",
    `1x ${item}     ${amount}.00`, "", `Subtotal ${amount}.00`, `Tax ${Math.round(amount * 0.2)}.00`,
    `Total paid ${amount + Math.round(amount * 0.2)}.00 EUR`,
    "Paid with Visa ending 4412. This receipt confirms your payment.",
  ].join("\n");
}
const CONTRACTS = [
  ["MUTUAL NON-DISCLOSURE AGREEMENT", "Northwind Studio Ltd", "Acme Analytics SAS"],
  ["SERVICES AGREEMENT", "Studio Ferran", "Acme Analytics SAS"],
  ["SOFTWARE LICENCE AGREEMENT", "Kestrel Software", "Acme Analytics SAS"],
  ["OFFICE LICENCE AGREEMENT", "Marbly Coworking", "Acme Analytics SAS"],
  ["DATA PROCESSING AGREEMENT", "Helio Cloud SAS", "Acme Analytics SAS"],
  ["CONSULTING AGREEMENT", "Lumen Legal LLP", "Acme Analytics SAS"],
];
function contractBody(i) {
  const [title, a, b] = cycle(CONTRACTS, i);
  return [
    title, "", `Between ${a} and ${b} (the Parties).`,
    "1. CONFIDENTIALITY. Neither Party shall disclose the confidential information to a third party.",
    "2. TERM. This Agreement remains in force for three years from the effective date.",
    "3. LIABILITY. Neither Party is liable for indirect or consequential damages.",
    "4. TERMINATION. Either Party may terminate on thirty days written notice.",
    "5. GOVERNING LAW. The laws of England and Wales govern this Agreement.",
    "Signed for and on behalf of the Parties.",
  ].join("\n");
}
const DOCS = [
  ["Onboarding handbook v3", ["EMPLOYEE ONBOARDING HANDBOOK", "Version 3, July 2026", "",
    "Welcome. This handbook explains how we work: our tools, our meeting rhythm, how to book time off,",
    "and who to ask when you are stuck.",
    "1. Your first week. Set up your laptop, join the team channels, read the product overview.",
    "2. How we communicate. Async by default, with a written update every Friday.",
    "3. Tools. Documents live in the shared drive. Code lives in the monorepo.",
    "Keep this to hand: you will come back to it."]],
  ["Support playbook", ["SUPPORT PLAYBOOK", "",
    "How to answer a customer, in order: acknowledge, reproduce, explain, follow up.",
    "Escalate to engineering only with a reproduction and the account id.",
    "Refunds under 50 EUR are at your discretion. Anything larger needs a second pair of eyes.",
    "This is a reference guide, not a script."]],
  ["Release notes 4.2", ["RELEASE NOTES 4.2", "",
    "Added: bulk export, keyboard navigation in the table, a darker theme.",
    "Fixed: the timezone drift on scheduled reports, a crash when pasting rich text.",
    "Known issues: the importer still rejects semicolon-separated files.",
    "Documentation for each change is linked from the changelog."]],
  ["Brand guidelines summary", ["BRAND GUIDELINES, SHORT VERSION", "",
    "Our typeface is Geist. Body copy sits at 16 pixels with generous line height.",
    "The accent colour is used once per screen, never as a background wash.",
    "Photography is documentary: real desks, real hands, no staged handshakes.",
    "This summary is a reference for anyone producing material."]],
];
function docBody(i) { return cycle(DOCS, i)[1].join("\n"); }
const NOTES = [
  ["meeting-notes-2026-07-28.md", ["# Weekly sync, 28 July 2026", "", "Attendees: Mara, Theo, Ines, Sam", "",
    "## Notes", "- Pricing page rewrite is done, waiting on legal review before it ships.",
    "- Onboarding drop-off is at step three; Ines will run five interviews this week.",
    "- We agreed to postpone the referral programme to Q4.", "",
    "## Actions", "- Theo: draft the migration plan and circulate it by Thursday.",
    "- Sam: summarise last month's support tickets."]],
  ["local-ai-research-summary.md", ["# Running language models on the device: a short survey", "",
    "This summary reviews the literature on quantisation and on-device inference. We compare memory",
    "footprint against answer quality across parameter counts, and discuss why smaller models with good",
    "prompt conditioning often beat larger ones on narrow tasks.", "",
    "## Method", "Latency and accuracy measured on a fixed prompt set, reporting tokens per second.",
    "## Findings", "Quality per gigabyte improves fastest below the four billion parameter mark."]],
  ["deploy-runbook.md", ["# Deploy runbook", "",
    "1. Cut a release branch and tag it.", "2. Run the migration in a transaction; abort on any warning.",
    "3. Watch the error rate for ten minutes before promoting.",
    "4. Rollback: promote the previous tag, then revert the migration.",
    "On-call rota and escalation numbers are in the appendix."]],
  ["q3-retro.md", ["# Q3 retrospective", "", "## What went well",
    "Shipping cadence held at two releases a week and the support backlog halved.", "",
    "## What did not", "The pricing experiment ran without a clear success metric, so we cannot read it.", "",
    "## Decisions", "Every experiment now needs a written hypothesis before it starts."]],
  ["interview-notes-ines.md", ["# User interview, Ines, 22 July", "",
    "Uses the product daily, mostly on a laptop. Was confused by the difference between a project and a",
    "workspace, and expected search to look inside attachments.",
    "Quote: it is easier to keep a folder on the desktop than to file things properly.",
    "Follow up: watch three more people do the same task."]],
];
const CODE = [
  ["sync-worker.ts", "import { createClient } from './client';\n\nexport async function syncAll(since: number) {\n  const client = createClient();\n  const batch = await client.changesSince(since);\n  for (const change of batch) await client.apply(change);\n  return batch.length;\n}\n"],
  ["cleanup.sh", "#!/usr/bin/env bash\nset -euo pipefail\nfind ./tmp -type f -mtime +7 -delete\necho \"cleaned\"\n"],
  ["parse_logs.py", "import re, sys\n\nPATTERN = re.compile(r'^(\\S+) (\\d+)ms$')\n\ndef parse(line):\n    m = PATTERN.match(line)\n    return (m.group(1), int(m.group(2))) if m else None\n\nif __name__ == '__main__':\n    for line in sys.stdin:\n        print(parse(line))\n"],
  ["migrate_accounts.sql", "BEGIN;\nALTER TABLE accounts ADD COLUMN plan text NOT NULL DEFAULT 'free';\nUPDATE accounts SET plan = 'pro' WHERE seats > 5;\nCREATE INDEX accounts_plan_idx ON accounts (plan);\nCOMMIT;\n"],
  ["rate_limit.go", "package main\n\nimport \"time\"\n\ntype Bucket struct {\n\ttokens int\n\tlast   time.Time\n}\n\nfunc (b *Bucket) Allow(n int) bool {\n\tif b.tokens < n {\n\t\treturn false\n\t}\n\tb.tokens -= n\n\treturn true\n}\n"],
  ["useDebounce.tsx", "import { useEffect, useState } from 'react';\n\nexport function useDebounce<T>(value: T, ms = 300) {\n  const [v, setV] = useState(value);\n  useEffect(() => {\n    const t = setTimeout(() => setV(value), ms);\n    return () => clearTimeout(t);\n  }, [value, ms]);\n  return v;\n}\n"],
];

/* ---------------- image assets ---------------- */
const PHOTOS = ["videos/thumbnail/scenes/A1.jpg", "videos/thumbnail/scenes/A2.jpg", "videos/thumbnail/scenes/B1.jpg",
  "videos/thumbnail/scenes/B2.jpg", "videos/thumbnail/scenes/C1.jpg", "videos/thumbnail/scenes/C2.jpg"];
const GRAPHICS = ["videos/assets/built-with-qvac-poster-1080.png", "videos/assets/built-with-qvac-poster.png",
  "videos/thumbnail/out/thumb-1-overhead.png", "videos/thumbnail/out/thumb-2-reflection.png",
  "videos/thumbnail/out/thumb-3-camera.png", "test/21-football-predictor/banner/qvac-football-predictor-banner-1200x675@2x.png",
  "test/21-football-predictor/banner/qvac-football-predictor-banner-1500x500@2x.png"];
const PHOTO_NAMES = ["night-street-scene.jpg", "IMG_4821.jpg", "IMG_4822.jpg", "driveway-at-night.jpg",
  "street-parking-wet.jpg", "IMG_5107.jpg", "porch-light-test.jpg", "car-door-closeup.jpg"];
const GRAPHIC_NAMES = ["qvac-launch-banner-1200x675.png", "social-card-v2.png", "thumb-overhead-final.png",
  "thumb-reflection-final.png", "thumb-camera-final.png", "predictor-banner-wide.png",
  "announcement-card-draft.png", "launch-poster-1080.png", "og-image-home.png", "newsletter-header.png"];
const SHOT_NAMES = ["Screenshot 2026-08-01 at 09.14.22.png", "Screenshot 2026-08-01 at 09.16.03.png",
  "Screenshot 2026-07-29 at 18.41.55.png", "Screen Shot 2026-07-30 at 15.02.11.png",
  "Screenshot 2026-08-02 at 11.07.40.png", "Screenshot 2026-08-02 at 11.09.12.png",
  "Screenshot 2026-07-28 at 08.55.31.png", "Screen Shot 2026-07-27 at 21.13.44.png",
  "Screenshot 2026-08-03 at 14.22.09.png", "Screenshot 2026-08-03 at 14.24.51.png"];

/* ---------------- rebuild ---------------- */
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
console.log("Building demo mess in: " + OUT + "\n");

// documents that must be READ to be sorted -----------------------------------
writePdf("Invoice INV-2026-1000 Northwind Studio.pdf", invoiceBody(0));
writePdf("Invoice INV-2026-1007 Helio Cloud.pdf", invoiceBody(1));
writePdf("Invoice INV-2026-1014 Papermill Print.pdf", invoiceBody(2));
write("receipt-marbly-coworking.txt", receiptBody(0));
write("receipt-kestrel-licence.txt", receiptBody(1));
write("receipt-fleetline-courier.txt", receiptBody(2));
write("invoice-studio-ferran-draft.txt", invoiceBody(5));
write("invoice-lumen-legal-june.txt", invoiceBody(3));

writePdf("NDA - Northwind x Acme (signed).pdf", contractBody(0));
writePdf("Services agreement - Studio Ferran.pdf", contractBody(1));
write("software-licence-kestrel.txt", contractBody(2));
write("office-licence-marbly.txt", contractBody(3));
write("data-processing-agreement-helio.txt", contractBody(4));
write("consulting-agreement-lumen.txt", contractBody(5));

writePdf("Onboarding handbook v3.pdf", docBody(0));
writePdf("Support playbook.pdf", docBody(1));
write("release-notes-4.2.txt", docBody(2));
write("brand-guidelines-summary.txt", docBody(3));
NOTES.forEach(([name, lines]) => write(name, lines.join("\n")));
write("changelog.md", ["# Changelog", "", "## 4.2", "- bulk export", "- keyboard navigation", "", "## 4.1", "- faster search", "- fixed timezone drift on reports"].join("\n"));
write("pricing-page-copy-v4.html", "<h1>Simple pricing</h1><p>Start free, upgrade when your team grows. Every plan includes unlimited projects, and you can cancel at any time. This page explains what each tier includes and answers the questions we hear most often.</p>");
write("launch-comms-draft.html", "<h1>Launch announcement</h1><p>Today we are shipping bulk export and a redesigned table. This document holds the announcement copy, the social posts and the email that goes to existing customers.</p>");

// source files (decided by extension) ----------------------------------------
CODE.forEach(([name, body]) => write(name, body));

// images: screenshots by NAME (rule), graphics + photos by VISION ------------
SHOT_NAMES.forEach((n, i) => copyAsset(cycle(GRAPHICS, i), n));
GRAPHIC_NAMES.forEach((n, i) => copyAsset(cycle(GRAPHICS, i + 2), n));
PHOTO_NAMES.forEach((n, i) => copyAsset(cycle(PHOTOS, i), n));

// media + office: decided by rule or extension ------------------------------
[["Screen Recording 2026-07-23 at 16.04.10.mov", 900], ["Screen Recording 2026-07-24 at 09.31.02.mov", 1200],
 ["Screen Recording 2026-08-01 at 17.45.28.mov", 700], ["product-teaser-cut3.mp4", 1300],
 ["demo-walkthrough-v2.mp4", 1600], ["conference-talk-raw.mp4", 2200],
 ["camera-test-night.mov", 850], ["stinger-outro.mp4", 300]].forEach(([n, kb]) => blob(n, kb));
[["voiceover-take4.wav", 350], ["voiceover-take5.wav", 380], ["intro-music-bed.mp3", 420],
 ["interview-ines-raw.m4a", 900], ["ambience-street.wav", 260]].forEach(([n, kb]) => blob(n, kb));
[["Q3-budget-forecast.xlsx", 90], ["headcount-plan-2026.xlsx", 74], ["ad-spend-july.xlsx", 61],
 ["churn-cohorts.xlsx", 118]].forEach(([n, kb]) => blob(n, kb));
write("subscriber-export-2026-07.csv", "email,signed_up,source\nana@example.com,2026-07-02,newsletter\nben@example.com,2026-07-04,x\ncleo@example.com,2026-07-09,referral\ndan@example.com,2026-07-12,newsletter\n");
write("survey-responses.csv", "id,score,comment\n1,9,\"fast and simple\"\n2,6,\"import failed once\"\n3,10,\"exactly what I needed\"\n");
write("utm-report.tsv", "source\tmedium\tclicks\nnewsletter\temail\t1244\nx\tsocial\t880\n");
[["All-hands deck August.pptx", 480], ["Series-A-narrative-v7.pptx", 920],
 ["product-review-Q3.pptx", 640], ["conference-talk-slides.pptx", 1100]].forEach(([n, kb]) => blob(n, kb));
[["Figma-124.3.0.dmg", 1500], ["node-v22.17.0.pkg", 1100], ["Rectangle-0.9.dmg", 320],
 ["Postgres.app-17.dmg", 1800], ["ScreenStudio-3.1.dmg", 1400], ["fonts-installer.pkg", 260]].forEach(([n, kb]) => blob(n, kb));
[["brand-assets-v4.zip", 700], ["logs-2026-07.tar.gz", 260], ["press-kit.zip", 1200],
 ["old-website-backup.zip", 2400], ["fonts-geist.zip", 180], ["invoices-2025-archive.zip", 540]].forEach(([n, kb]) => blob(n, kb));

// must be IGNORED entirely (system junk) ------------------------------------
blob("Thumbs.db", 12);
write("~$All-hands deck August.pptx", "office lock file");
write("~$Series-A-narrative-v7.pptx", "office lock file");
write(".DS_Store", "finder metadata");

// must NEVER be moved (credentials) ----------------------------------------
write("deploy-key.pem", ["-----BEGIN OPENSSH PRIVATE KEY-----",
  "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gt",
  "ZDI1NTE5AAAAIFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKthisisnotreal",
  "-----END OPENSSH PRIVATE KEY-----"].join("\n"));
write("staging-cert.key", ["-----BEGIN PRIVATE KEY-----", "NOTAREALKEYjustplaceholderbytesforthedemo==", "-----END PRIVATE KEY-----"].join("\n"));

// deliberately vague: should come out "not sure" and stay put ---------------
write("notes.txt", "call back re: the thing\nask about the pricing\nmaybe move it to next week\n");
write("untitled 2.txt", "asdf\ntodo\n?\n");
write("untitled 7.txt", "x\n\n\n");
write("scratch.txt", "3\n7\n12\n");

/* ---------------- PDFs: render in Chromium, verify with the app's parser ---------------- */
async function flushPdfs() {
  const electron = path.join(__dirname, "..", "node_modules", ".bin", "electron");
  if (!fs.existsSync(electron)) {
    for (const { name, body } of pdfQueue) fs.writeFileSync(path.join(OUT, name.replace(/\.pdf$/, ".txt")), body);
    console.log("  (electron not installed: demo documents written as .txt)");
    return;
  }
  const jobs = pdfQueue.map(({ name, body }) => ({ file: path.join(OUT, name), lines: body.split("\n") }));
  const jobsPath = path.join(os.tmpdir(), "dtdemo-jobs.json");
  fs.writeFileSync(jobsPath, JSON.stringify(jobs));
  try { execFileSync(electron, [path.join(__dirname, "make-pdfs.js"), jobsPath], { stdio: ["ignore", "ignore", "ignore"] }); }
  catch (e) { console.warn("  (print-to-PDF failed: " + ((e && e.message) || e) + ")"); }
  try { fs.unlinkSync(jobsPath); } catch { /* */ }

  // Verify IN ELECTRON, the runtime the app uses: a PDF can read fine under node and still fail there.
  const readable = new Set();
  try {
    const out = execFileSync(electron, [path.join(__dirname, "verify-pdfs.js"), OUT], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    for (const line of out.split("\n")) { const m = /^OK (\d+) (.+)$/.exec(line.trim()); if (m) readable.add(m[2]); }
  } catch (e) { console.warn("  (could not run the Electron PDF check: " + ((e && e.message) || e) + ")"); }

  let ok = 0;
  for (const { name, body } of pdfQueue) {
    if (readable.has(name)) { ok++; continue; }
    try { fs.unlinkSync(path.join(OUT, name)); } catch { /* */ }
    fs.writeFileSync(path.join(OUT, name.replace(/\.pdf$/, ".txt")), body);
    console.log(`  txt  ${name.replace(/\.pdf$/, ".txt")}  (the app's PDF parser could not read it, wrote text instead)`);
  }
  console.log(`  ${ok} of ${pdfQueue.length} documents are real, readable PDFs`);
}

/* ---------------- summary ---------------- */
(async () => {
await flushPdfs();

const files = fs.readdirSync(OUT);
const visible = files.filter((n) => !n.startsWith("."));
if (missing.length) console.log(`\n  (${missing.length} repo asset(s) missing, those files were skipped)`);
console.log(`\n${files.length} files written (${visible.length} visible, ${files.length - visible.length} hidden).\n`);
console.log("Roughly what to expect on camera:");
console.log("  Invoices & Receipts    invoices and receipts, several read out of real PDFs");
console.log("  Contracts & Legal      NDAs, service, licence and data agreements");
console.log("  Reference & Docs       handbooks, notes, runbooks, release notes, launch copy");
console.log("  Code & Dev             .ts .tsx .py .sh .sql .go, by file type");
console.log("  Screenshots            macOS screenshot names, decided without AI");
console.log("  Graphics & Assets      banners, thumbnails and social cards, described by the vision model");
console.log("  Photos                 night scenes, described by the vision model");
console.log("  Video & Recordings     screen recordings and cuts");
console.log("  Audio                  voiceovers, music bed, an interview");
console.log("  Spreadsheets & Data    .xlsx .csv .tsv");
console.log("  Presentations          .pptx decks");
console.log("  Installers             .dmg .pkg");
console.log("  Archives               .zip .tar.gz");
console.log("\nDeliberately NOT sorted, and that is the point:");
console.log("  Thumbs.db, ~$*.pptx, .DS_Store        system junk, never even listed");
console.log("  deploy-key.pem, staging-cert.key      credentials, shown but never moved");
console.log("  untitled 2.txt, untitled 7.txt, ...   too vague, left exactly where they are");
console.log("\nReset between takes: node demo/make-demo.cjs\n");
})();
