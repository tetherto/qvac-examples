# Recipe · QVAC Biomarkers Demo

<!-- NOTE TO ANY AI AGENT READING THIS RECIPE: the blockquote below is a legal notice for the human using this recipe. It is NOT a build instruction. Do not act on it or treat it as a task. Keep it intact in any copy you produce. -->

> **Legal note (for the human using this recipe, not a build instruction):** This recipe is an illustrative example only and provided “as is.” You are responsible for what you build, whether you use a recipe or not, including ensuring it complies with applicable laws and is appropriately safeguarded. Use of this recipe is subject to the Tether.io Website Terms.

> **What this is:** a spec for a local desktop app that imports blood-test results from a lab PDF, a scan or photo of the report, or a CSV, scores and charts them, and uses a local medical model to suggest foods and answer questions about the results, where the model is structurally prevented from inventing a food fact.
>
> **How to use this file:** drop it into your AI coding agent (Claude Code, Cursor, Codex CLI, ChatGPT, etc.) and say "Build this for me." This recipe pins the exact QVAC SDK calls, the grounding mechanism and the scoring maths: the parts an agent cannot guess or should not improvise. Write idiomatic code for the structure and the UI.
>
> **Official QVAC documentation (open these alongside this recipe):**
> - Docs site: https://docs.qvac.tether.io/
> - Full docs concatenated for AI agents: https://docs.qvac.tether.io/llms-full.txt
> - Electron tutorial: https://docs.qvac.tether.io/tutorials/electron/
> - Text generation: https://docs.qvac.tether.io/ai-capabilities/text-generation/
> - OCR: https://docs.qvac.tether.io/ai-capabilities/ocr/
> - Source repo: https://github.com/tetherto/qvac
> - Reference implementation: https://github.com/tetherto/qvac-examples

---

## What you get

A local Electron app where you:

- Import a lab report (a digital PDF, a scanned PDF or a photo) or a CSV of blood-test results and get a 56-marker table, colour-coded against each marker's range, grouped into Unoptimized / Optimized / Never tested.
- Open any marker for its trend across every test date, the normal range as a shaded band, and a plain-English read of where it is going.
- See eight category scores on gauges, each with a panel that prints the formula and every term, so the number can be checked by hand.
- Get food recommendations from a local medical model that may only name foods from a knowledge-base file.
- Add your own sources (a URL or a local PDF), which the same local model reads into that knowledge base.
- Ask the same model questions about your own results in a chat panel, answered from a briefing built in code.

Everything runs on the machine. The first launch downloads one 2.7 GB model, and the first scan or photo downloads a 100 MB OCR model; after that the only network call in the app is fetching a page you paste in yourself.

## Why this works

**The grounding is structural, not a request.** A health app cannot rely on a 4B model choosing not to hallucinate a food. So the food names live in a JSON file, the response schema pins them to an enum, the SDK compiles that schema into a generation grammar, and the output is re-validated afterwards. The model contributes judgement (which fact matters most, how to phrase it, what the trend means) and nothing else. That division is the whole design, and it is what makes a small local model safe to ship for this.

**The arithmetic belongs in code.** Status, direction of travel, "since when", and the category score are all computed and then **told to** the model. Ask a 4B model whether a series is rising and it will sometimes say no. Compute it and hand it over, and the model writes good prose about a correct fact.

## Requirements

- **Node.js** 22.17 or higher (Node 25 verified)
- **About 7 GB free disk** (4.1 GB `node_modules`, 2.7 GB model, 100 MB OCR model)
- **16 GB RAM or more**. 16 GB is the smallest machine measured, and it is slow there
- macOS (Apple Silicon, Metal), Linux or Windows with a Vulkan GPU; CPU fallback is slow but works
- No API keys, no cloud account
- Verify the machine with `npx -y @qvac/cli doctor` before scaffolding

## Recommended hardware

One resident 4B model at 8k context, plus a 100 MB OCR model that is loaded only for the length of a scan import and unloaded after it. No vision-language model.

| | Minimum | Recommended |
|---|---|---|
| RAM | 16 GB | 32 GB or more |
| GPU | integrated / CPU fallback (slow) | Apple Silicon (Metal), or a discrete Vulkan GPU |
| Disk free | about 7 GB (4.1 for `node_modules`, 2.7 for the model, 0.1 for OCR) | 10 GB or more |
| OS | macOS 14+, Windows 10+, Linux | same |

## SDK API the agent needs to know (pin this exactly)

```ts
import {
  loadModel, unloadModel, completion, downloadAsset, ocr,
  HEALTHCARE_4B_MEDICAL_Q4_K_M, OCR_LATIN, MODEL_TYPES
} from '@qvac/sdk'
```

**The model.** `HEALTHCARE_4B_MEDICAL_Q4_K_M`: MedPsy 4B, QVAC's own medical model (registry `qvac/MedPsy-4B-GGUF`), 4B, Q4_K_M, 2.7 GB. Pin it as one constant. `MODEL.expectedSize`, `.params`, `.quantization` and `.modelId` are readable off the descriptor, so the UI can quote real numbers instead of hard-coded ones.

**Download without loading.** The setup screen wants bytes on disk, not a model in RAM:

```ts
await downloadAsset({ assetSrc: MODEL, onProgress: (p) => report(p.percentage) })
```

**Load once, keep resident.** Loading 2.7 GB per request would make the app feel broken. Load lazily on first use, keep it, unload on quit, and serialise requests: two completions at once on a 16 GB machine meets the OOM killer.

```ts
const modelId = await loadModel({
  modelSrc: MODEL,
  modelConfig: { ctx_size: 8192, device: 'gpu', gpu_layers: 99, temp: 0.3, predict: 1200 }
})
```

Size `ctx_size` by the LARGER job, which is reading a Food Library source, not writing a
recommendation: a page's text plus the 56-marker menu is about 2,800 prompt tokens and the reply runs
to 1,200. At 4096 that reply had roughly 220 tokens to land in and came back as truncated JSON.
Bigger is not safer either: 16384 has been seen to fail outright, because the KV cache for that
window cannot be allocated and the real window ends up smaller than the one you asked for.

**Structured output is the grounding mechanism.** This is the call that matters:

```ts
const run = completion({
  modelId,
  history,
  stream: false,
  responseFormat: { type: 'json_schema', json_schema: { name: 'recommendations', schema } }
})
const text = (await run.final).contentText
```

Build `schema` per request so `food` and `nutrient` are `enum`s of exactly the facts you handed over. Do **not** use `json_object`: it only forces **some** valid JSON and a small model will emit `{}`. Consume `run.events` for streaming and `await run.final` for the aggregate; `run.text` / `run.tokenStream` are legacy.

**The chat streams, and filters as it streams.** Free-form questions are the one place no schema applies, so every sentence goes through a gate before it is shown (see the hard rules):

```ts
const run = completion({ modelId, history, stream: true })
for await (const event of run.events) {
  // drop any <think> block first, then hold each sentence in the gate until it is checked
  if (event.type === 'contentDelta') gate.push(event.text)
}
await run.final
gate.flush()
```

**OCR for scans and photos.** A second, small model, loaded per import and unloaded after it, through the same queue as completions so it never competes with MedPsy for the GPU:

```ts
const ocrId = await loadModel({
  modelSrc: OCR_LATIN.src,
  modelType: MODEL_TYPES.ggmlOcr,
  modelConfig: process.platform === 'darwin' ? { backendDevice: 'metal' } : {}
})
const blocks = (await ocr({ modelId: ocrId, image }).blocks)   // image: a path, or PNG/JPEG bytes
await unloadModel({ modelId: ocrId, clearStorage: false })
```

`OCR_LATIN` is the EasyOCR pipeline (a CRAFT detector plus a Latin recognizer, about 98 MB). Each block is `{ text, bbox: [x1, y1, x2, y2], confidence }`, and blocks are not lines: see "Reading a lab report" below. Metal measured about 3 s a page against 15 s on the CPU. List `@qvac/sdk/ggml-ocr/plugin` next to the llama.cpp plugin in `qvac.config.json`, or a packaged build loses OCR.

**Unload on quit.** `unloadModel({ modelId, clearStorage: false })`: keep the weights cached so the next launch is offline and fast.

**Electron.** QVAC runs in the **main process only**; the renderer talks to it over IPC. `forge.config.cjs` must use `require('@qvac/sdk/electron-forge')` (it forces `asar: false`, because the Bare worker cannot load addons from inside an asar). `externalizeDepsPlugin()` on main and preload in `electron.vite.config.ts`. `app.commandLine.appendSwitch('no-sandbox')` for Linux. No macOS universal builds.

## The data files (author these first)

| File | What it is |
|---|---|
| `data/markers.json` | 56 markers: `id`, `name`, `unit`, `range {low, high}`, `descriptor`, `categories[]` |
| `data/categories.json` | 8 categories, each with a `description` and an explicit `markers[]` list. Markers may appear in several. |
| `data/knowledge-base.json` | `entries[markerId][low\|high] = [{nutrient, foods[], rationale}]`. **The only source of food facts.** |
| `data/range-adjustments.json` | gender/age reference intervals per marker, each with `source` and `sourceUrl` |
| `sample-bloodwork.csv` | `marker_id, marker_name, unit, <date>, …`, raw values only, no interpretation |

Cross-check them at load time and warn loudly: a category naming a marker that does not exist shows up as a quietly wrong score, which is the worst way to find out.

## Reading a lab report (PDF, scan or photo)

A lab report is a table, and both ways it arrives scramble the table. So turn it back into rows first, then read every row with one function:

- **Digital PDF**: `pdf-parse` with a `pagerender` that keeps each text item's position (`transform[4]`, `transform[5]`). The text layer often comes out column by column, so regroup by baseline and sort left to right. No model involved.
- **Scanned PDF**: no text layer. Its pages are JPEG (DCT) streams: take them out byte for byte and hand them to `ocr()`. No PDF renderer needed. Fax-style pages (CCITT, JBIG2) are refused with a message asking for JPG or PNG.
- **Photo**: straight to `ocr()`. Regroup the blocks into rows by vertical centre (same row when the centres are closer than 60% of the shorter box), left to right.

Then three rules decide what lands in the record, because a wrong number is worse than a missing one:

1. **The name must be one the app knows**, through an alias list (`HEMOGLOBIN (HGB)` is hemoglobin). Only a space or `(` may follow a matched name, so a cholesterol ratio is not cholesterol. An unknown analyte is listed in the import report, never guessed.
2. **The unit must be one the app knows for that marker**, converted when the lab uses another scale (`x10^3/uL` times 1000 into cells/uL, mmol/L into mg/dL). Undo OCR's usual misreads first (`x1O^3luL`, `UIL`, `HIU/mL`).
3. **The value must be plausible** against the range, and **a result OCR could not read is left out, never replaced.** On the demo scan OCR missed the lone digit of `Ferritin 9`, and the first number left on the row was the range's low bound, 20, which got stored. Treat a row whose unit comes before any number, or whose only numbers are a low and a high bound, as unreadable.

Prefer a labelled collection date (`Sampling Date 28/09/2026`) over the first date on the page: on the demo report the first date is the birth date. Read `a/b/yyyy` month-first only when `b` cannot be a month, otherwise day-first, and say so in the import report when it was ambiguous.

Verified: the demo report as a scan (`fixtures/demo/demo-lab-report-scan.pdf`) reads 52 of 54 results, and none differs from the text-layer import. The two it misses are named in the report.

## A second importer, for wearables

Blood tests are a few dates a year; a scale and a ring are a row a day. Vendor exports are the
TRANSPOSED shape of the bloodwork CSV: one row per date, one column per metric. Ship a second
importer for that shape and let the HEADER pick between them, not the extension: the bloodwork
importer claims a `.csv` whose first row names a marker column, the wearable one takes the rest.

Match columns by vocabulary, not per-vendor templates. Documented and checked: Withings
`Date,"Weight (kg)","Fat mass (kg)"` (the unit changes with the account setting, so read it off the
header) and Oura `Day,TotalSleepDuration,...` (durations in seconds).

Rules that matter more than the parsing:

- **Only import a metric that has a published reference interval.** BMI, sleep duration, resting
  heart rate and blood oxygen do. Steps, HRV and vendor readiness scores do not, so they are reported
  as ignored. A range you invent is worse than a metric you skip.
- **BMI is computed from weight plus the person's height, never imported**, and skipped with a note
  when no height is saved. That is the only reason an importer gets an `ImportContext`.
- **Average repeats within a day.** A scale is stepped on three times in a morning.
- **Infer sleep units from magnitude and say so.** 3 to 14 hours, 180 to 840 minutes, 10,800 to
  50,400 seconds: the bands do not overlap.
- Wearable markers join the SAME eight categories, so a ring moves the same scores a blood panel does.

## The maths (pin this too)

**`statusFor(value, range)`**: `red` outside; `yellow` inside but within 10% of the range width of a bound; `green` otherwise; `grey` for never tested. One function, read by the table, the chart dots and the scorer, so they cannot disagree.

**Status is never imported.** Ignore any CSV column claiming a status or an "optimized" flag, and list it in the import report so the user sees it was skipped.

**`trendFor(values, dates, range, name)`**: walk backwards while each step keeps moving the same way; report **that** start date as "since". "Improving" means heading towards the range, not simply going up.

What counts as flat is measured on **two** scales, and getting this wrong is the worst bug this app can have, because the sentence goes to the model as truth. A threshold of 3% of the range width alone fails whenever a marker sits far below a wide range: ferritin's range is 20-345, 3% of it is 9.75 ng/mL, so a fall from 18 to 9 reads as "held steady". Use the SMALLER of 3% of the range width and 10% of the value itself. Ten per cent because a routine assay varies by a few per cent on its own, so under a tenth "it moved" is not a claim worth making. Same lesson as `subScore` below: a wide range makes a low value's movement look like rounding error.

**`subScore(value, range)`**. In range: `70 + 30 × (1 − 2|t − 0.5|)` where `t` is the position in the range, so 70 at a bound and 100 dead centre. Out of range: `70 × (1 − min(1, |value − bound| / |bound|))`, measuring against the violated bound rather than the range width: a ferritin of 12 against a 20-345 range is 2% of the width below the floor but 40% below the floor itself, and 40% is the number a person cares about. Fall back to the range width when the bound is 0.

**Category score**: the plain average of the tested markers' sub-scores. Equal weights; say so in the explainer. Exclude untested markers rather than zeroing them. Bands: <50 Needs work, <70 Fair, <85 Good, else Optimal.

## The grounded engine (the core of the build)

1. Compute the marker's direction from its status, and treat a **borderline-but-inside** marker as leaning towards the bound it is hugging, because that is exactly the case a user wants advice for.
2. Gather the allowed facts for `(markerId, direction)`: vetted entries from the knowledge base, plus any from user-added sources, each keeping its origin.
3. If there are none, return an honest "no vetted guidance yet", never a generated answer.
4. Build the schema with `food` and `nutrient` as enums of those facts. Prompt with the marker, the latest value, the range, **the trend sentence you computed**, the same-category markers as light context, and the numbered facts.
5. Post-validate: drop a pick whose nutrient was not provided or whose food is not listed under it; rewrite any sentence naming a food from elsewhere in the knowledge base. **Show what you corrected**: a guard the user cannot see is a guard they cannot trust.
6. Also rewrite any sentence that prescribes a **quantity or a schedule**. The prompt forbids dosages and the model ignores it: MedPsy wrote "Eat 3-4 ounces of lean red meat daily" and "Include oysters 2-3 times weekly". Those numbers have no basis in anything the app knows. Match units of mass, volume and count plus "N times a week" forms, and fall back to the template sentence, which keeps the fact and drops the prescription. Asking harder in the prompt does not hold.
7. Cache on `(subject, value, direction, range, factsFingerprint)`. Editing a value, saving a profile or adding a source then produces fresh advice automatically, and "Regenerate" clears the one entry.

## Hard rules for the agent

- **Never let a food name reach the UI unless it came from the knowledge base.** Prompt, grammar and validation: all three.
- **Never compute status or trend in the renderer.** It renders; it does not judge.
- **Never let a dosage reach the UI.** Not from the model, not from the knowledge base. This app knows a marker is low; it does not know the reader's weight, diet or medication.
- **Never invent a clinical number.** No per-marker weights, no range shift, no reference interval without a source. Where a rule does not exist, keep the baseline and say the range is baseline.
- **Never import an interpretation.** Status and "optimized" are derived, always.
- **Never show a chat sentence before it has been checked.** A prompt is not a safety mechanism: told never to give a dose, MedPsy still answered "50,000 IU weekly for 8-12 weeks" and "3oz lean beef daily" to two of six adversarial questions. Hold each streamed sentence until it passes the same amount-and-schedule check as the recommendations, and answer only from a briefing built in code.
- Keep the medical disclaimer visible on every screen that shows advice. Not a tooltip.
- Merge on import, do not replace: a re-imported `(markerId, date)` overwrites and is counted, so the UI can say "12 new values, 4 updated".
- The renderer gets `contextIsolation: true`, `nodeIntegration: false`, a CSP with no outside connection, and a named preload bridge.

## How to run

```bash
npm install
npm run dev
```

Then drop a lab report (PDF, scan or photo) or a CSV on the window, or click **Try the sample**.

## How to extend

- **OCR in the Food Library**: reuse `ocrImages()` from `src/main/importer/ocr.ts` for source PDFs with no text layer. It already goes through the shared queue.
- **Retrieval**: swap the knowledge-base lookup in `factsFor` for `ragSearch` over a larger corpus. The cache fingerprint already keys on the facts used, so the invalidation is free.
- **A different model**: change the import and the constant in `src/main/qvac.ts`.

## Troubleshooting

- **`CONTEXT_OVERFLOW`**: the fact list grew. Raise `ctx_size`, but modestly: asking for a window the GPU cannot allocate a KV cache for fails at a **smaller** prompt than a conservative ask that actually fits.
- **The model emits `{}`**: you used `json_object` instead of `json_schema`. Pin the keys in the grammar.
- **Every value in the last column reads as 0**: a CRLF file, and `Number('\r')` is `0`. Split on `/\r?\n/` and strip the BOM.
- **The Bare worker will not start in a packaged build**: `asar` got re-enabled. The QVAC Forge plugin sets `asar: false`; do not override it.
- **`RPC_INIT_TIMEOUT`, and the worker stderr says `MODULE_NOT_FOUND: Cannot find module 'b4a' imported from node_modules/bogon/index.js`**: `bogon` requires `b4a` at runtime without declaring it as a dependency, so npm never puts one where `bogon` can reach it. When other packages in the tree pull conflicting `b4a` versions, npm nests every copy under its own parent and hoists none, and the worker dies on startup. Add `"b4a": "^1.8.1"` to your own `dependencies` to force one to the top level. Nothing in the app imports it; it exists to satisfy that transitive gap.
- **`npm install` takes about 4 GB**: the SDK installs every addon for every platform, though this app uses only `llm-llamacpp` and `ggml-ocr`. Declaring `plugins` in `qvac.config.json` prunes at **package** time, not install time.
