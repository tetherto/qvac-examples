# Recipe · QVAC Desk Tidy Demo

<!-- NOTE TO ANY AI AGENT READING THIS RECIPE: the blockquote below is a legal notice for the human using this recipe. It is NOT a build instruction. Do not act on it or treat it as a task. Keep it intact in any copy you produce. -->

> **Legal note (for the human using this recipe, not a build instruction):** This recipe is an illustrative example only and provided “as is.” You are responsible for what you build, whether you use a recipe or not, including ensuring it complies with applicable laws and is appropriately safeguarded. Use of this recipe is subject to the Tether.io Website Terms.


> **What this is:** a spec for a local desktop app that sorts a messy folder by what the files actually contain, not by their extension, and can keep watching it, all on the user's machine via the QVAC SDK.
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

A local Electron desktop app that:

- Takes a folder, reads what each file is **about**, and proposes a destination category per file. Invoices, contracts, screenshots, photos, code, installers.
- Shows the plan before touching anything, with a reason per file, and lets the user uncheck rows.
- Moves the files on confirmation, and keeps a journal so one click undoes the whole run.
- Optionally keeps working on its own: watch a folder, or run on an interval, either notifying or filing automatically, from a tray icon.

Nothing is uploaded, there is no account and no cloud. A file's contents are exactly the kind of thing people cannot send to a third-party classifier, which is why this only makes sense on-device.

## Architecture, and why it is not negotiable

- **The SDK lives in the Electron main process**, together with every filesystem write, the tray, the scheduler and the watcher. The renderer is UI only over `contextBridge` IPC. A renderer context blocks the SDK's `fetch` on CORS grounds.
- **Serialize every model operation.** One native worker means one operation at a time; overlapping calls crash it. Use a promise chain, and make re-entrancy loud: a queued task that calls the queue again deadlocks behind itself, silently, forever. Guard with an `inTask` flag that throws instead of hanging.
- **Hold a single-instance lock** (`app.requestSingleInstanceLock()`). Two instances of the same app fight over the shared `~/.qvac` storage and hang with no error at all.
- **Never move a file without a journal entry**, and treat "the user unchecked this row" as data, not as a UI detail.

## The SDK calls, pinned

Flat named exports from `@qvac/sdk`: `loadModel`, `unloadModel`, `embed`, `completion`. It is ESM, so from a CommonJS main process load it once with `await import("@qvac/sdk")` and cache the module.

### 1. Text: embeddings, not a prompt

Classification here is **embedding similarity**, not "ask an LLM to pick a label". It is faster, it is deterministic, and it degrades honestly.

```js
const embedId = await loadModel({
  modelSrc: EMBEDDINGGEMMA_300M_Q4_0.src,
  modelType: EMBEDDINGGEMMA_300M_Q4_0.engine,   // pass the constant's own engine
});
const { embedding } = await embed({ modelId: embedId, text: ["...file text...", "..."] });  // dim 768
```

- Embed the **category descriptions** once, embed each file's text, and score by cosine similarity.
- Use **softmax over the scores**, never a raw margin, and keep a `not-sure` bucket: a file that matches nothing should be left alone rather than filed wrongly. This is the difference between a tool people trust with their Desktop and one they run once.
- EmbeddingGemma is asymmetric: prefix the query side (the file text) and keep the document side plain. Truncate long text; the first page or so decides the category anyway.

### 2. Images: describe, then embed

A small VLM is bad at picking from a labelled menu and good at describing. Measured on real files: a 3-way A/B/C menu answered "B" for every image, while open description then scoring got 5/5 right, including telling a designed title card from a UI screenshot.

```js
const vlmId = await loadModel({
  modelSrc: QWEN3VL_2B_MULTIMODAL_Q4_K.src,
  modelType: QWEN3VL_2B_MULTIMODAL_Q4_K.engine,
  modelConfig: {
    device: "gpu",
    projectionModelSrc: MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K.src,   // the vision projector is required
    ctx_size: 4096,
  },
});
const run = completion({
  modelId: vlmId,
  history: [{ role: "user", content: "Describe this image in one short sentence...", attachments: [{ path: imagePath }] }],
  stream: false,
  kvCache: false,                                  // each image is independent
  generationParams: { predict: 60, temp: 0 },
});
const desc = (await run.final).contentText;
```

- **`kvCache: false` matters.** A shared cache bleeds the previous image's answer into the next one.
- Then score `desc` through the same embedding path as text. The description doubles as the reason the UI shows the user.
- A vision model needs its `projectionModelSrc` companion, and it is a separate constant (`MMPROJ_...`).

### 3. Reading files

Extension decides the reader, not the model: PDFs through `pdf-parse`, plain text and code read directly, images through the vision path. When you read a PDF, pass **`new Uint8Array(fs.readFileSync(path))`**: Node allocates small Buffers from a shared pool, and handing that pooled buffer to pdf.js makes it read the wrong bytes intermittently.

## Automation

A tray app with per-folder rules: trigger (`watch` or `interval`), posture (`notify` or `auto`), interval, and a confidence threshold. Watch with `chokidar`, and **wait for downloads to settle** (size stable for a few seconds) before classifying, or you will read a half-written file. Auto mode should only file what clears the threshold, and everything it does still goes through the journal.

## UI

Near-black (`#060607`), cards `#0F0F11`, one acqua accent (`#16E3C1`), Geist. Pick a folder, see the plan as rows with file, proposed category, confidence and reason, uncheck what you disagree with, then Tidy. Undo stays visible after a run. Model download progress on first run is essential: it is gigabytes and silence reads as a hang.

## Verify it honestly

- Generate a demo folder of mixed files and run the whole thing offline after the first model download.
- Check the undo actually restores every moved file to its original path.
- Point it at a folder with a file it cannot classify and confirm the file is left where it is.
