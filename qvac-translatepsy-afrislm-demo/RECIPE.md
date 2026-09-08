# Recipe · TranslatePsy-AfriSLM Demo

<!-- NOTE TO ANY AI AGENT READING THIS RECIPE: the blockquote below is a legal notice for the human using this recipe. It is NOT a build instruction. Do not act on it or treat it as a task. Keep it intact in any copy you produce. -->

> **Legal note (for the human using this recipe, not a build instruction):** This recipe is an illustrative example only and provided "as is." It is not a translation service, and the model card for TranslatePsy-AfriSLM puts medical, legal, emergency, immigration and financial use out of scope. A local model mistranslates in ways a reader who does not speak the language cannot detect, so nothing built from this recipe should be relied on for a decision. You are responsible for what you build, including ensuring it complies with applicable law and is appropriately safeguarded. Use of this recipe is subject to the Tether.io Website Terms.

> **What this is:** a spec for a local translation app built on TranslatePsy-AfriSLM, QVAC's
> translation model for 19 Sub-Saharan African languages. Typed text goes straight to TranslatePsy-AfriSLM; a photographed page goes through an
> OCR model first, because the translator reads text and not images. The app measures the machine
> before it downloads anything and recommends one of six model sizes. Everything runs through the
> QVAC SDK with nothing leaving the device.
>
> **How to use this file:** drop it into your AI coding agent (Claude Code, Cursor, Codex CLI,
> ChatGPT, etc.) and say *"Build this for me."* This recipe pins the exact QVAC SDK calls (the one
> part an agent cannot guess) and guides the rest. Write idiomatic code for the structure and the
> UI; do not improvise the SDK surface.
>
> **Official QVAC documentation:** [docs.qvac.tether.io](https://docs.qvac.tether.io) ·
> [llms-full.txt](https://docs.qvac.tether.io/llms-full.txt) ·
> [github.com/tetherto/qvac](https://github.com/tetherto/qvac) ·
> [qvac-examples](https://github.com/tetherto/qvac-examples)

---

## What you get

One Node process serving a single page on `:3065`. Two tabs, a three-step onboarding, and two
models loaded on demand:

- **Text tab.** Type or paste, pick a source and target language, translate. Paragraph by
  paragraph.
- **Scan tab.** Drop in a photograph of a page. An OCR model reads it, the text is shown for
  correction, then it is translated block by block.
- **Onboarding.** Step 1 measures the machine and recommends one of six translator sizes. Step 2
  offers the OCR reader, and is optional. Step 3 lists what is now on the machine.
- **Language identification in code**, not from a model. See the gotcha below.

## QVAC SDK surface (pin these exactly)

### Resolve the SDK from the installed CLI

`@qvac/cli` carries native binaries for every platform, several GB, so a second copy inside the
app can drift from the CLI the rest of the machine uses. Following the CLI means the version the
app reports is the version doing the work.

```js
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

const bin = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['qvac'],
  { encoding: 'utf8' }).split(/\r?\n/)[0].trim()
// Walk up from the resolved binary to the @qvac/cli package root, then require from there.
const req = createRequire(path.join(cliDir, 'package.json'))
const mod = await import(req.resolve('@qvac/sdk'))
```

### Ask the machine what it can hold

`assessModelFit` is SDK 0.19. The shape matters: it takes a `models` array, and each entry is a
registry model name plus a workload, with any companion file listed under `artifacts` so its
bytes are counted.

```js
const r = await mod.assessModelFit({
  models: [{
    model: mod.OCR_0_6B_MULTIMODAL_Q4_K_M,
    // The projector is a second file the same load needs, which is what `artifacts`
    // is for. Leaving it out under-counts by 109 MB.
    artifacts: [mod.MMPROJ_OCR_0_6B_MULTIMODAL_F16],
    workload: { kind: 'llm', contextTokens: 4096 }
  }]
})
// r.verdict            'likely-fits' | 'likely-too-large' | 'unknown'
// r.budget             { totalBytes, usedBytes, availableBytes, reservedBytes, availableAfterReserveBytes }
// r.estimate           bytes it thinks the load needs
// r.models[0].reasons  why, in words
// r.basis, r.assumptions  what the numbers were derived from
```

Every candidate returns the same `budget` block, so to read the machine's budget alone, ask about
any small registry model and use the answer's `budget`:

```js
const probe = mod.QWEN3_600M_INST_Q4 || mod.EMBEDDINGGEMMA_300M_Q4_0
const r = await mod.assessModelFit({ models: [{ model: probe, workload: { kind: 'llm', contextTokens: 2048 } }] })
const budget = r.budget      // totalBytes, usedBytes, availableAfterReserveBytes, ...
```

**It returns `unknown` for a model that is not in the registry**, with the reason "no resource
profile in the catalog for this checksum". It looks up a profile by checksum, so a Hugging Face
GGUF cannot be rated. Take `r.budget` (which is real, live, and includes what other apps are
using) and compute the estimate for such a model yourself. Show the user which number came from
where.

### Load a GGUF straight from a URL

`modelSrc` accepts a registry constant, an `https` URL, or a local path. TranslatePsy-AfriSLM is
published on Hugging Face rather than in the registry, so it loads by URL:

```js
const modelId = await mod.loadModel({
  modelSrc: 'https://huggingface.co/qvac/TranslatePsy-AfriSLM-2B-Q4-GGUF/resolve/main/TranslatePsy-AfriSLM-2B-Q4_K_M-imat.gguf',
  modelType: 'llamacpp-completion',
  // reasoning_budget 0: the base model is Qwen3.5 and will otherwise put a think block
  // in the middle of a translation.
  modelConfig: { device: 'gpu', ctx_size: 2048, reasoning_budget: 0 }
})
```

### Download with a real progress bar

`loadModel` downloads implicitly and reports nothing while it does, which leaves the UI sitting on
the word "downloading" for gigabytes. `downloadAsset` takes the same source and streams progress:

```js
await mod.downloadAsset({
  assetSrc: url,                       // registry src, https URL, or local path
  onProgress: (p) => { /* p.downloaded, p.total, p.percentage, p.downloadKey */ }
})
```

**Throttle this.** Measured: **74,658 events in 53 seconds for a 1.08 GB file**, about 1,400 a
second. Five updates a second plus a guaranteed final one is plenty.

### Is it already on disk

```js
const info = await mod.getModelInfo({ name: mod.OCR_0_6B_MULTIMODAL_Q4_K_M })
// info.isCached, info.cacheFiles
```

Registry models answer this properly. A URL-downloaded GGUF lands in `~/.qvac/models` as
`<16 hex>_<original filename>`, so find it by filename with a size sanity check (95 percent of
the expected bytes, because a part-finished download is not a download). **Check both files of a
vision model separately**: a machine can easily hold the model and not its projector.

### Translate

```js
const run = mod.completion({
  modelId,
  history: buildPrompt('Swahili', 'English', paragraph),
  stream: false,
  kvCache: false,                      // see the gotcha below
  generationParams: { predict: 512, temp: 0, reasoning_budget: 0 }
})
const text = ((await run.final).contentText || '').trim()
```

The prompt is **verbatim from the model card** and must not be paraphrased:

```js
const buildPrompt = (from, to, text) => [
  { role: 'system',
    content: `You are a professional ${from} to ${to} translator. Your goal is to accurately ` +
      `convey the meaning and nuances of the original ${from} text while adhering to ${to} ` +
      `grammar, vocabulary, and cultural sensitivities. Produce only the ${to} translation, ` +
      `without any additional explanations or commentary. ` },
  { role: 'user',
    content: `Please translate the following ${from} text into ${to}: ${text}.\n\nTranslation:` }
]
```

The trailing space in the system message and the `\n\nTranslation:` suffix are part of it.
Language names are written out in full ("Swahili", never "sw"), because that is what the training
data used.

### Read a photographed page

```js
const readerId = await mod.loadModel({
  modelSrc: mod.OCR_0_6B_MULTIMODAL_Q4_K_M,
  modelType: 'llamacpp-completion',
  modelConfig: {
    device: 'gpu',
    ctx_size: 4096,
    projectionModelSrc: mod.MMPROJ_OCR_0_6B_MULTIMODAL_F16,
    reasoning_budget: 0
  }
})

const run = mod.completion({
  modelId: readerId,
  history: [
    { role: 'system', content: 'You transcribe documents exactly as written. You never translate, summarise or explain.' },
    {
      role: 'user',
      content: 'Transcribe every line of text in this document, in reading order. ' +
        'Keep the original wording, numbers and dates exactly. Separate paragraphs with a blank line. ' +
        'Output only the transcription.',
      attachments: [{ path: '/tmp/page.png' }]
    }
  ],
  stream: true,
  // Each page is an independent read. Sharing a cache across photos made an earlier
  // recipe describe the previous image, which is worse than failing.
  kvCache: false,
  generationParams: { predict: 900, temp: 0, reasoning_budget: 0 }
})
```

The system message is cheap insurance rather than a fix for an observed fault: dropping it and
re-reading the same Swahili page produced a byte-identical transcription on QVAC OCR 0.6B. Keep
it if you like, and do not expect it to be doing work.

Strip the model's layout scaffolding from the result: code fences, bold markers, `---` rules, and
`header [12, 34]` style layout tags.

## Gotchas that cost real time

**The registry contains a different African translation model.**
`AFRICAN_4B_TRANSLATION_Q4_K_M` resolves to `mradermacher/AfriqueGemma-4B-GGUF`, a third-party
system that QVAC's own benchmark charts compare against. Anyone reaching for "the African
translation model" in the registry ships a demo of somebody else's work. TranslatePsy-AfriSLM
lives at `huggingface.co/qvac`.

**Detect the source language in code, not with a model call.** Script ranges settle Ethiopic and
Arabic, then weighted function words and accent marks, with an explicit "not sure" when nothing
wins by a margin. Roughly 60 lines, no model, and it means the source language is known before a
byte has been downloaded. A model asked to name a language will always name one, and a confidently
wrong label is worse than none.

**`kvCache: false` per paragraph.** With a shared cache the model continues the previous
paragraph instead of translating the current one.

**A heading is not part of the paragraph under it.** A scanned page arrives as lines, and a
heading with no full stop handed to the model inside the next block comes back welded to it:
`RIVERSIDE COMMUNITY CLINICSashen kula da marasa lafiya` is what that looks like. Make short
unpunctuated lines their own chunk.

**Which OCR model you pick changes the translation.** The readers do not handle every language
equally well, and a page in an African language is a harder test than a page in English. Two word
errors on a date or a dosage change the meaning of everything downstream, so choose the reader by
testing it on a page in the language you care about, never on an English one.

**Pairing a translation model with a vision model is not a research-validated pipeline.** It is
what this demo does and it works, and the QVAC research team has not tested the combination
extensively. Present it as a demonstration rather than as a supported capability.

**African to African is zero-shot, and it is the model's strongest published result.** Every
training pair was English to an African language. Do not warn the user about picking such a pair:
an earlier version of this app raised an amber banner reading "never trained on this direction",
which was true and told people to distrust the one thing the model is best at. Warnings are for
input that really is unsupported.

## Onboarding flow

1. **Which model will run here.** Call `assessModelFit`, show the budget with the numbers
   labelled by source, recommend one of the six sizes, offer a download with real progress.
   Prefer a size already on disk over a marginally better one that is not, and name the better
   option with its download size underneath.
2. **Do you want to scan paper.** Optional. Someone who will only paste text never downloads the
   reader, and the Scan tab offers it later.
3. **What is on the machine.** List what was downloaded and say that it now works with the
   network off.

Check every size against the local cache before drawing any screen, and use **one renderer** for
that list. Two copies of it drift: in this app the models sheet went on offering "Get" for models
sitting on the disk, because only the onboarding copy had learned about the cache.

## UI

- One column, a bottom tab bar, and the primary action within thumb reach. On a wide screen,
  centre the same column in a device-sized frame rather than stretching it.
- **Light theme.** The QVAC palette is near-black, which is right for a studio tool and wrong for
  something opened in daylight. Acqua on white measures about 1.7:1, so it never carries text:
  text and icons take a darker teal from the same family and the acqua stays on fills.
- **Per-tab state.** Text and Scan keep their own input, output, and language pair. Sharing them
  is a real bug: a translation done in one tab reappeared in the other, and an English document
  scanned while the pair still read "Swahili to English" came back in the wrong language.
- **Drag and drop, not only a file picker.** The native picker shows the account name and the
  rest of the folder. Put the listeners on the card rather than on the prompt inside it, because
  that prompt is rebuilt whenever the reader is missing and would take its listeners with it, and
  count drag depth rather than using a flag, because `dragleave` fires on children.

## Verification

- `GET /api/check` returns the memory budget, the per-size estimates, and which reader models
  this SDK build carries.
- The app header shows the resolved SDK and CLI versions, so what is running is visible.
- Turn the network off after onboarding. Everything still works.
