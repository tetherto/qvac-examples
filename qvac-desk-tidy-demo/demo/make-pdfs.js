// Electron entry point: render the demo documents to REAL PDFs with Chromium's print-to-PDF.
//
// Why not `cupsfilter`: its output is PDF 1.3 with an xref that the pdf.js build inside pdf-parse
// rejects ("bad XRef entry") for some content, unpredictably. Chromium writes clean modern PDFs that
// the same parser reads every time, and we already ship Electron, so there is no new dependency.
//
// Usage (called by make-demo.cjs):  electron demo/make-pdfs.js <jobsJsonPath>
//   jobs: [{ file: "/abs/out.pdf", title: "...", lines: ["...", "..."] }]
"use strict";
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function html(job) {
  const body = job.lines.map((l) => (l.trim() === "" ? "<div class='sp'></div>" : `<p>${esc(l)}</p>`)).join("\n");
  return `<!doctype html><meta charset="utf-8"><style>
    @page { margin: 18mm; }
    body { font: 11pt/1.45 Helvetica, Arial, sans-serif; color: #000; }
    p { margin: 0 0 2px; white-space: pre-wrap; }
    .sp { height: 10px; }
  </style>${body}`;
}

app.whenReady().then(async () => {
  const jobs = JSON.parse(fs.readFileSync(process.argv[process.argv.length - 1], "utf8"));
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true, javascript: false } });
  for (const job of jobs) {
    try {
      await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html(job)));
      const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: "A4" });
      fs.writeFileSync(job.file, pdf);
      console.log("WROTE " + job.file);
    } catch (e) { console.log("ERROR " + job.file + " :: " + ((e && e.message) || e)); }
  }
  app.exit(0);
});
