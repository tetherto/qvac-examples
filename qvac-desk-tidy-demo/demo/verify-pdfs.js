// Electron entry point used by make-demo.cjs to verify the demo PDFs in the SAME runtime the app uses.
//
// This exists because pdf-parse's bundled pdf.js behaves differently under Electron than under Node: a
// PDF that reads fine with `node` can throw "bad XRef entry" in Electron's main process. Verifying in
// Node therefore proves nothing about the app. Prints one line per file: "OK <chars> <name>" or
// "FAIL <name>".
"use strict";
const { app } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

app.whenReady().then(async () => {
  const dir = process.argv[process.argv.length - 1];
  const pdfParse = require("pdf-parse");
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".pdf")); } catch { /* */ }
  for (const n of names) {
    try {
      const d = await pdfParse(new Uint8Array(fs.readFileSync(path.join(dir, n)))); // standalone copy: pooled Buffers make pdf.js read the wrong bytes
      const chars = String(d.text || "").replace(/\s+/g, " ").trim().length;
      console.log(chars >= 40 ? `OK ${chars} ${n}` : `FAIL ${n}`);
    } catch { console.log(`FAIL ${n}`); }
  }
  app.exit(0);
});
