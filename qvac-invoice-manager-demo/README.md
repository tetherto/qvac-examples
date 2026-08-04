# QVAC Invoice Manager Demo

Point it at a folder of invoices and receipts and a local AI fills in an accounting table. **You
decide which columns exist**: name them, give them a type, add a hint, and those columns become the
schema the model is forced to fill. Folders are read all the way down, several at once, and every
document stays on your machine. No cloud, no API keys, no per-page OCR bill.

![The app reading a folder of invoices](./docs/screenshot.png)

> **This is an example, not a product.** It is a self-contained prototype showing what the QVAC
> SDK can do. It is **not a QVAC or Tether product**, is **not an accounting, bookkeeping, or tax
> product**, and ships **as-is with no support, no warranty, and no SLA**. A local model will
> misread documents. **Every figure it produces must be checked by a human before it is filed or
> paid**, and you alone are responsible for how you use it, including complying with the accounting
> and tax rules that apply to you. See [About this example](#about-this-example).

## What you get

- **Your own tables.** Add columns, name them, pick a type (text, number, date, currency), and
  write a hint for the model. Three tables ship with it: supplier invoices, VAT return, expense
  report. Editing a built-in one makes your own copy instead of overwriting it.
- **Folders, not files.** Choose several folders at once and each is walked to the bottom, so a
  year of expenses filed as `2026/<supplier>/` works as one batch. Files, folders, and drops all
  behave the same.
- **The right reader per document.** A PDF with a real text layer is read as text. A scan or a photo
  is *looked at* by a vision model. The app decides, per file.
- **A flag you can trust.** Anything the model could not find is amber and says so. Anything it
  found but that fails a sanity check is amber too, with the reason, because a wrong value that
  looks like data is more dangerous than a blank one.
- **Arithmetic, not inference.** `net + tax = total` is checked with maths. When it fails, the row
  is marked, whatever the model said.
- **CSV out.** Comma, or the European semicolon-and-comma-decimals flavour, with a BOM so Excel
  reads UTF-8, plus `source_file` and `needs_review` columns so a suspect row can be traced back.

## How it works

```
folder(s) ──► lib/walk.js ──► every PDF and image, recursively, deduped
                                          │
                              lib/reader.js: is there real text here?
                                          │
                             yes ─────────┼───────── no
                              │                       │
                      Qwen3 4B (text)         rasterise page 1 through
                      + json_schema           Chromium, then
                              │               Qwen3-VL 2B + json_schema
                              └───────┬───────────────┘
                                      ▼
                         lib/schema.js: coerce to the column types,
                         reject implausible values, check the arithmetic
                                      ▼
                            editable table ──► CSV
```

**Structured output does the work.** Each column becomes one property of a JSON Schema with
`additionalProperties: false`, and the SDK enforces it as a generation grammar. That deletes a whole
category of failure: no prose, no code fences, no renamed keys, no missing fields.

**What a grammar cannot enforce is meaning**, and that is where the interesting problems live. Two of
them, both found by running the app over 102 real invoices:

1. **A required string field makes a model invent one.** Those invoices carry no VAT registration
   number at all. Asked to "return an empty string if the field is absent", the model instead reached
   for the nearest plausible text, every single time: `Cyprus`, `Cyprus 19% on $10.08`,
   `Anthropic, PBC`, even `4477` (a fragment of a PO box). All 102 rows were wrong and **none was
   flagged**, because a non-empty string looks like a successful read. The fix is two-part: give the
   model an explicit token to emit (`N/A`) rather than asking it for nothing, and then sanity-check
   what it does return. An identifier with no digits is not an identifier; a country is not a
   currency code; `April 27, 2026` is not `YYYY-MM-DD`.
2. **Absent is not the same as wrong.** A receipt records a payment that already happened, so it has
   no due date. 47 of those 102 documents were receipts, and 47 rows came back with no due date,
   which is the *correct* answer. The app has to say "not on the document" and "rejected, check this"
   differently, or the user learns to ignore both.

**Scanned PDFs need no native dependency.** Electron already ships Chromium's PDF viewer, so page 1
is rendered in an offscreen window and captured. No poppler, no ImageMagick, no node-gyp.

## Recommended hardware

Two models, both lazy: a folder of text PDFs never downloads the vision model, and a folder of scans
never downloads the text one.

| | Minimum | Recommended |
|---|---|---|
| RAM | 8 GB (one model at a time) | 16 GB or more |
| GPU | integrated or CPU fallback (slow) | discrete Vulkan GPU, or Apple Silicon (Metal) |
| Disk | about 3 GB for one model | about 6 GB for both |
| OS | macOS 14+, Windows 10+, Linux | same |

Check the machine before you start:

```bash
npx -y @qvac/cli doctor
```

## Run it

```bash
npm install
npm start
```

Click **Choose folders** (or drop a folder on the window). The first extraction downloads a model
into `~/.qvac/models/`, so it takes a few minutes; after that a text PDF is a few seconds and a scan
is a little longer.

Four sample documents are in `demo/`: two text invoices, one scan-only PDF, and a photo of a
receipt, so you can see both paths without supplying your own documents.

### Tests

```bash
npm test          # engine: routing, schema, store, both model paths, CSV, parser, arithmetic
npm run test:ui   # boots the real window and drives the real DOM (no model needed)
npm run test:app  # the Electron-only path: rasterise a scan, then read it
```

`test-ui.cjs` is the one worth stealing for another Electron app. It boots `main.js`, waits for the
real window, and asserts on the painted DOM. It also measures `getBoundingClientRect()` rather than
`el.hidden`, because the attribute reported "hidden" while a modal was plainly on screen: an author
`display` rule silently outranks the `hidden` attribute.

### Measuring on your own documents

```bash
node measure-real.cjs /path/to/a/folder 12
```

Reads a sample and reports how often each field was found, rejected, or left blank. Worth running
before you trust any of this on a real filing: the quality depends entirely on what your suppliers'
documents look like.

## Traps this example already pays for

| Trap | What it looks like |
|---|---|
| Node pools small Buffers and pdf.js reads past the view | the *same* PDF parses in one run and throws `bad XRef entry` in the next. Pass `new Uint8Array(readFileSync(p))` |
| `encodeURI` does not escape `#` | `Invoice #1234.pdf` opens a *different* path than the one you validated. Use `pathToFileURL` |
| A CSV value starting with `=`, `+`, `-` or `@` | a formula from a supplier's PDF runs when the export is opened in Excel. Prefix it with `'` |
| `Number(s.replace(/[^0-9.-]/g,""))` | `2 690,00` becomes **269000**. Parse the decimal mark, and refuse ambiguous values instead of guessing |
| A file dropped outside the drop zone | Chromium navigates the window to it and the app is gone. `preventDefault` at the document level *and* veto `will-navigate` |
| Two QVAC apps at once | `loadModel` never resolves and never rejects. Single-instance lock, and unload on quit |
| `el.hidden` in a test | it passes while the UI is visibly wrong |

## About this example

- **A demonstration.** It shows the local-AI pattern for document data entry. It is not a
  bookkeeping product and has had no accounting review.
- **Check every number.** A 2B or 4B model running on your laptop will misread documents. The amber
  flags and the arithmetic check catch a lot, not everything.
- **Unsupported.** Provided as-is, with no support, warranty, or guarantees.
- **Your responsibility to use lawfully.** Invoice retention, VAT filing, and bookkeeping are
  regulated differently everywhere. Meeting those rules is on you.
- **A starting point.** Fork it, read it, adapt it. `RECIPE.md` is a full build spec you can hand to
  a coding agent.

## License

Code licensed under the Apache License, Version 2.0. See [LICENSE](./LICENSE).

This example depends on `@qvac/sdk` and on `pdf-parse`, and at runtime it loads Qwen3 4B and
Qwen3-VL 2B from the QVAC registry. Using it is subject to each of their respective licenses.

## About QVAC

QVAC is an open-source, cross-platform ecosystem for building local-first, peer-to-peer AI
applications. With QVAC you can run AI tasks like LLMs, vision, speech, and RAG locally across
Linux, macOS, Windows, Android, and iOS. Learn more at [qvac.tether.io](https://qvac.tether.io).
