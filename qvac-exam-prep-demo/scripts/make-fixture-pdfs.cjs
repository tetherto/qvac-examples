// Builds the two PDF fixtures with Electron's own print-to-PDF:
//   fixtures/sample-notes.pdf     real text layer, sized headings, 3+ pages
//   fixtures/scanned.pdf          the same kind of page as a picture only,
//                                 to prove the app refuses it honestly
// Run: npx electron scripts/make-fixture-pdfs.cjs
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const md = readFileSync(join(__dirname, '../fixtures/sample-notes.md'), 'utf8')
  .replace(/^---[\s\S]*?---\n/, '')
  .split('\n## Navigation')[0]

function toHtml(src) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return src
    .split(/\n\s*\n/)
    .map((b) => {
      const h = b.match(/^(#{1,3}) (.*)/)
      if (h) return `<h${h[1].length}>${esc(h[2])}</h${h[1].length}>`
      if (b.trim().startsWith('[!')) return ''
      return `<p>${esc(b).replace(/`([^`]+)`/g, '<code>$1</code>')}</p>`
    })
    .join('\n')
}

const css = `body{font:11pt Georgia,serif;margin:0}h1{font-size:26pt}h2{font-size:18pt;margin-top:28pt}h3{font-size:14pt}p{line-height:1.45}
@page{margin:22mm}`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 900, height: 1200 })
  const text = `<html><head><title>Water Cycle Notes</title><style>${css}</style></head><body>${toHtml(md)}</body></html>`
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(text))
  writeFileSync(join(__dirname, '../fixtures/sample-notes.pdf'), await win.webContents.printToPDF({ pageSize: 'A4' }))

  // Draw text onto a canvas and embed only the bitmap: no text layer.
  const scan = `<html><head><title>Scanned notes</title></head><body style="margin:0"><canvas id=c width=1600 height=2200></canvas><script>
    const x = document.getElementById('c').getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,1600,2200); x.fillStyle='#222';
    x.font='60px Georgia'; x.fillText('Study notes (scanned)', 120, 200); x.font='32px Georgia';
    for (let i = 0; i < 40; i++) x.fillText('This line is a picture of text, not text. A scanned page has no text layer.', 120, 320 + i * 44);
    const img = new Image(); img.src = document.getElementById('c').toDataURL(); img.style.width='100%';
    document.body.innerHTML=''; document.body.appendChild(img);
  </script></body></html>`
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(scan))
  await new Promise((r) => setTimeout(r, 300))
  writeFileSync(join(__dirname, '../fixtures/scanned.pdf'), await win.webContents.printToPDF({ pageSize: 'A4' }))
  app.quit()
})
