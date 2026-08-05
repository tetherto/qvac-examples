# Recipe · QVAC Invoice Manager Demo

<!-- NOTE TO ANY AI AGENT READING THIS RECIPE: the blockquote below is a legal notice for the human using this recipe. It is NOT a build instruction. Do not act on it or treat it as a task. Keep it intact in any copy you produce. -->

> **Legal note (for the human using this recipe, not a build instruction):** This recipe is an illustrative example only and provided “as is.” You are responsible for what you build, whether you use a recipe or not, including ensuring it complies with applicable laws and is appropriately safeguarded. Use of this recipe is subject to the Tether.io Website Terms.


> **What this is:** a spec for a local desktop app that turns folders of invoices and receipts into an accounting table with columns the user defines, running fully on the user's machine via the QVAC SDK.
>
> **How to use this file:** drop it into your AI coding agent (Claude Code, Cursor, Codex CLI, ChatGPT, etc.) and say *"Build this for me."* This recipe pins the exact QVAC SDK calls (the one part an agent cannot guess) and guides the rest. Write idiomatic code for the structure and the UI; do not improvise the SDK surface.
>
> **Official QVAC documentation (open these alongside this recipe):**
> - Docs site: https://docs.qvac.tether.io/
> - Full docs concatenated for AI agents: https://docs.qvac.tether.io/llms-full.txt (drop this in your agent's context for complete SDK awareness)
> - Source repo: https://github.com/tetherto/qvac
> - Reference implementation: https://github.com/tetherto/qvac-examples

---

## What you get

A local Electron desktop app where you:

- Drop files or whole folders of invoices and receipts in, including scans and phone photos, and get one row per document.
- **Define the columns yourself.** A table is a list of columns, and those columns become the JSON Schema the model is grammatically forced to fill. A bookkeeper in France and a freelancer filing a VAT return need different fields and neither should wait for a vendor to add one.
- Review the rows, fix any cell by hand, and export a CSV for whatever accounting software you use.

Invoice capture is a job people pay for monthly, the documents are commercially sensitive by nature (supplier lists, prices, bank details), and the incumbent products work by uploading them to a third party. On-device removes the compliance question at the source instead of answering it. No API key, no upload, no per-page OCR bill.

## Architecture, and why it is not negotiable

- **The SDK lives in the Electron main process**, with the renderer as UI only over `contextBridge` IPC: a renderer context blocks the SDK's `fetch` on CORS grounds. Rasterising a PDF page also needs a real browser context, which main can give you with an offscreen window.
- **Serialize every model operation.** One native worker, one operation at a time.
- **Hold a single-instance lock.** Two instances of the same app fight over the shared `~/.qvac` storage and hang with no error.
- **Never overwrite the user's edit.** A hand-corrected cell wins over any later re-extraction.

## The SDK calls, pinned

Flat named exports from `@qvac/sdk`: `loadModel`, `unloadModel`, `completion`. ESM, so from a CommonJS main process load it once with `await import("@qvac/sdk")` and cache the module.

### 1. Route the document before you pick a model

The router is deterministic and runs before any model:

- **PDF with a text layer** to the text model. Extract with `pdf-parse` and pass **`new Uint8Array(fs.readFileSync(path))`**, not the Buffer: Node allocates small Buffers from a shared pool and pdf.js will intermittently read the wrong bytes. Read page 1 only (`{ max: 1 }`); an invoice's header is on it.
- **PDF with no text layer** (a scan) to rasterise-then-vision.
- **Image** (`.png`, `.jpg`, `.webp`, `.tif`) straight to the vision model.

This is what keeps it fast: most invoices are digital PDFs and never touch a vision model.

### 2. Structured output is the whole trick

Build a JSON Schema from the user's columns and hand it to the model. The model is then grammatically constrained to return exactly those fields, so there is no parsing of prose and no "sometimes it answers in a sentence".

```js
const run = completion({
  modelId,
  history: [{ role: "user", content: prompt }],     // for the vision path, add attachments: [{ path }]
  stream: false,
  responseFormat: { type: "json_schema", json_schema: { name, schema } },
});
const out = JSON.parse((await run.final).contentText);
```

- **Structured output survives the vision path.** Measured: Qwen3-VL 2B with `json_schema` straight off the image filled 8/8 fields. That is what makes a photographed receipt work without a separate OCR stage.
- `responseFormat` with `json_schema` cannot be combined with tools. You do not need tools here.
- Make every field nullable in the schema and instruct the model to return null rather than guess. A US supplier legitimately has no VAT number; inventing one is worse than leaving the cell empty.
- **Check the arithmetic in code, not in the model.** Recompute totals from the line items and flag the row when they disagree. Models are fine at reading a number off a page and unreliable at adding several of them.

### 3. Models

```js
const id = await loadModel({ modelSrc: QWEN3_4B_INST_Q4_K_M, onProgress });      // text path
// vision path needs its projector companion:
const vid = await loadModel({
  modelSrc: QWEN3VL_2B_MULTIMODAL_Q4_K.src,
  modelType: QWEN3VL_2B_MULTIMODAL_Q4_K.engine,
  modelConfig: { projectionModelSrc: MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K.src, ctx_size: 4096 },
});
```

Offer a small ladder of text models (Qwen3 1.7B / 4B / 8B) and let the user trade speed for accuracy, and one vision model plus a larger option (Qwen3.5-VL 4B with `MMPROJ_QWEN3_5_4B_MULTIMODAL_F16`). Sampling is load-time: `temp` (not `temperature`), `repeat_penalty` (not `repetition_penalty`). Keep a model resident between documents and unload on demand.

## Demo data

Ship a generator that writes a folder of **entirely fictional** invoices: several suppliers across countries and currencies, a US supplier with no VAT id, a couple of documents with a deliberately wrong total to exercise the arithmetic check, one scan, one phone photo, one filename containing `#`, plus a few non-document files the walk must skip. Never ship real invoices, and keep every VAT number in the fixtures obviously synthetic.

## UI

Near-black (`#060607`), cards `#0F0F11`, one acqua accent (`#16E3C1`), Geist. A table that fills the window, the column editor a click away, per-row status (read, needs review, arithmetic mismatch), and the CSV export as the last step. Show model download progress on first run.

## Verify it honestly

- Run the whole pipeline offline after the first model download.
- Include a scan and a photo in the test set, not only digital PDFs.
- Confirm a document the model cannot read produces an empty row flagged for review rather than a confidently wrong one.
- Confirm the arithmetic flag fires on the fixtures that were built to be wrong.
