// Build the demo lab report PDF used by the PDF import path.
//
// Rendered with Chromium's print-to-PDF (Electron) rather than a PDF library:
// it produces a modern, text-layer PDF that pdf.js reads back reliably, and the
// project already ships Electron so there is no new dependency.
//
//   npm run demo:pdf        ->  fixtures/demo/demo-lab-report.pdf
//
// The content is synthetic and the document says so. It is styled like a real
// panel because the point is to prove the importer copes with a real layout.
// CommonJS on purpose: this project is "type": "module", and an ESM entry point
// handed to `electron <file>` silently never runs (no output, no error). A .cjs
// entry loads the classic way and works.
const { app, BrowserWindow, dialog } = require('electron')
// Without this an exception opens a modal dialog and the script waits forever for a click,
// which looks exactly like a hang in a terminal.
dialog.showErrorBox = (title, msg) => { console.error(`[make-demo-lab-pdf] ${title}: ${msg}`) }
process.on('uncaughtException', (e) => { console.error('[make-demo-lab-pdf]', e && e.stack || e); app.exit(1) })
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs')
const { join, dirname } = require('node:path')

const ROOT = join(__dirname, '..')
const OUT = join(ROOT, 'fixtures', 'demo', 'demo-lab-report.pdf')

// data/markers.json is an OBJECT ({_note, markers, _wearableNote}), not a bare array.
const markersFile = JSON.parse(readFileSync(join(ROOT, 'data', 'markers.json'), 'utf8'))
const markers = Array.isArray(markersFile) ? markersFile : markersFile.markers
if (!Array.isArray(markers)) throw new Error('data/markers.json: expected a markers array')
const byId = new Map(markers.map((m) => [m.id, m]))

// Latest column of the sample CSV = the results this report reports.
const csv = readFileSync(join(ROOT, 'sample-bloodwork.csv'), 'utf8').trim().split('\n')
const head = csv[0].split(',')
const dateCol = head.length - 1
const collected = head[dateCol]
const rows = csv.slice(1).map((line) => {
  const c = line.split(',')
  const def = byId.get(c[0])
  const value = c[dateCol]
  const range = def?.range
  let flag = ''
  if (range && value !== '' && Number.isFinite(+value)) {
    if (+value < range.low) flag = 'L'
    else if (+value > range.high) flag = 'H'
  }
  return {
    name: c[1],
    value,
    unit: c[2] || '',
    ref: range ? `${range.low} - ${range.high}` : '',
    flag
  }
}).filter((r) => r.value !== '')

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const body = rows.map((r) => `<tr>
  <td class="n">${esc(r.name)}</td>
  <td class="v ${r.flag ? 'ab' : ''}">${esc(r.value)}</td>
  <td class="f ${r.flag === 'H' ? 'hi' : r.flag === 'L' ? 'lo' : ''}">${r.flag}</td>
  <td class="u">${esc(r.unit)}</td>
  <td class="r">${esc(r.ref)}</td>
</tr>`).join('\n')

const html = `<!doctype html><meta charset="utf-8"><style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font: 9.5pt/1.35 "Helvetica Neue", Helvetica, Arial, sans-serif; color: #111; }
  .masthead { display: flex; justify-content: space-between; align-items: flex-start;
              border-bottom: 2px solid #111; padding-bottom: 8px; }
  .lab { font-size: 15pt; font-weight: 700; letter-spacing: .5px; }
  .lab small { display: block; font-size: 7.5pt; font-weight: 400; letter-spacing: .3px; color: #555; margin-top: 2px; }
  .doc { text-align: right; font-size: 8pt; color: #333; }
  .doc b { display: block; font-size: 10pt; color: #111; }
  .note { margin: 6px 0 12px; font-size: 7.5pt; color: #777; letter-spacing: .4px; text-transform: uppercase; }
  .who { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px 14px;
         border: 1px solid #bbb; padding: 8px 10px; margin-bottom: 12px; font-size: 8.5pt; }
  .who div span { display: block; font-size: 7pt; color: #666; text-transform: uppercase; letter-spacing: .5px; }
  h2 { font-size: 9.5pt; margin: 14px 0 5px; padding-bottom: 3px; border-bottom: 1px solid #999;
       text-transform: uppercase; letter-spacing: .8px; }
  table { width: 100%; border-collapse: collapse; }
  thead th { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .5px; color: #555;
             text-align: left; border-bottom: 1px solid #999; padding: 4px 4px; }
  td { padding: 3px 4px; border-bottom: 1px solid #eee; vertical-align: top; }
  td.v, td.f, td.r, th.v, th.f, th.r { text-align: right; }
  td.v { font-variant-numeric: tabular-nums; width: 62px; }
  td.v.ab { font-weight: 700; }
  td.f { width: 22px; font-weight: 700; }
  td.f.hi, td.f.lo { color: #b00; }
  td.u { width: 74px; color: #555; }
  td.r { width: 96px; color: #555; font-variant-numeric: tabular-nums; }
  tfoot td { border: 0; padding-top: 10px; font-size: 7.5pt; color: #666; }
</style>
<div class="masthead">
  <div class="lab">EXAMPLE CLINICAL LABORATORIES<small>A fictitious laboratory, for demonstration only</small></div>
  <div class="doc"><b>COMPREHENSIVE PANEL</b>Accession EX-2025-0918-4471<br />Report generated ${collected}</div>
</div>
<div class="note">Sample document, synthetic results, not a real laboratory report and not for clinical use</div>
<div class="who">
  <div><span>Patient</span>SAMPLE, DEMO</div>
  <div><span>Patient ID</span>DEMO-000-000</div>
  <div><span>Date of birth</span>01 Jan 1985</div>
  <div><span>Sex</span>Not stated</div>
  <div><span>Collected</span>${collected} 08:15</div>
  <div><span>Received</span>${collected} 11:40</div>
  <div><span>Reported</span>${collected} 17:02</div>
  <div><span>Ordering provider</span>DEMO, EXAMPLE MD</div>
</div>
<h2>Results</h2>
<table>
  <thead><tr><th>Test</th><th class="v">Result</th><th class="f">Flag</th><th>Units</th><th class="r">Reference range</th></tr></thead>
  <tbody>${body}</tbody>
  <tfoot><tr><td colspan="5">
    H = above reference range, L = below reference range. Reference ranges are population intervals and
    vary by method and laboratory. ${rows.length} analytes reported. End of report.
  </td></tr></tfoot>
</table>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true, javascript: false } })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, pdf)
  console.log(`wrote ${OUT} (${rows.length} analytes, ${(pdf.length / 1024).toFixed(0)} KB)`)
  app.exit(0)
})
