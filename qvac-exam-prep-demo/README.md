# QVAC Exam Prep Demo

<picture>
  <source media="(prefers-color-scheme: dark)"  srcset="docs/badges/built-with-qvac-dark-mode-landscape.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/badges/built-with-qvac-light-mode-landscape.svg">
  <img alt="Built with QVAC" src="docs/badges/built-with-qvac-light-mode-landscape.svg" width="200">
</picture>

Turn your own study material into practice exams, on your own machine. Add notes, PDFs or links to docs pages, pick how many questions and how hard, and a local model writes a paper from that material alone. Sit it as a timed exam or as practice with feedback on every answer. Then see which topics to reread, with a link to the exact page each missed question came from.

Every question passes a check in code before you see it, and anything that fails never reaches you. Text generation runs on **Qwen3** through **`@qvac/sdk`**, in a choice of three sizes. There is no cloud, no account and no API key, and after a one-time model download it works offline.

> **This is an example, not a product.** It is a self-contained prototype that shows what the QVAC SDK makes possible. It ships as-is, with **no support, no warranty, and no SLA**. See [About this example](#about-this-example).

## What you get

- **Any subject, from your own material.** Markdown, plain text, PDFs with a text layer, and web pages. Paste a whole list of links at once; the app fetches them four at a time. The app knows nothing about any subject in advance: the questions and the topics come from what you give it.
- **Topics from your own headings.** The app builds a topic tree from the headings in your material, so you can aim a paper at one part of it, and results come back by topic.
- **Questions spread across the material.** Passages are sampled across sources, then across topics within each source, so one long PDF cannot take over the paper.
- **Three depths that are three different prompts, not a dial:** Recall (what X is), Applied (what happens when you do X) and Scenario (given this situation, what do you do).
- **Single answer, multiple answer and true/false**, all marked by code.
- **Exam and practice modes.** Exam mode marks the paper at the end, with a timer, flags and question navigation in the top bar. Practice mode checks each answer as you go and shows right, missed and wrong picks apart.
- **Results that say what to reread.** Each missed topic links to the passage it came from: a PDF opens at the page, a web page at the heading. A **New exam on…** button sets up a paper on your weakest topic.
- **Review that shows its source.** Every question shows the sentence it was written from, the heading trail and the file. Mark a question "this question isn't right" and it leaves your score.
- **Clear failures.** A scanned PDF with no text layer is refused with a reason, and a page that will not load says why. Nothing turns into junk quietly.
- **Stop at any time and keep what's done**, through the SDK's own `requestId` cancellation.
- **Everything saved locally**: library, papers and sittings, so a paper can be paused and resumed.
- **A dark and a light theme**, built on the QVAC design-system tokens.

## How it works

```
 sources ──► Blocks ──► chunks (~500 tokens, overlap, heading trail) ──► junk filter
                                                                            │
          ┌─────────────────────────────────────────────────────────────────┘
          ▼
 sample N + 40 %, spread ──► ONE batchCompletion, json_schema grammar ──► gate ──► keep first N
                                                                           │
                         short? one top-up batch ◄─────────────────────────┘
                         still short? a shorter exam, and the reason
```

### Ingestion becomes one shape early

Each importer turns its input into a flat list of **Blocks**: headings and runs of text, in reading order, with a page number or an anchor where there is one. From there one chunker and one junk filter handle every source. `src/core/` holds all of that and imports neither Electron nor the SDK, so it runs under `node --test`.

- **PDF**: a PDF has no headings, only text drawn at sizes. The body size is the size that carries the most characters; short lines set clearly larger are headings, ranked by size into levels. Running headers and footers are found by repetition across pages and removed. Fewer than 80 characters a page on average means a scan.
- **Web page**: Mozilla's Readability (Firefox Reader View) strips the page to its article. Anchors are read off the **original** page, since those are the ids a link can jump to. Tables are read a row at a time, footnote markers like `[edit]` and `[3]` are removed, and runs of short link-only list items ("See also") are dropped.

### Chunking and the junk filter

Chunks aim for about 500 tokens (estimated at four characters a token) with 60 tokens of overlap, and **never cross a heading**, so the heading trail on each chunk is exact. A section too short to stand alone is folded into its next sibling, unless it is junk itself: folding a contents list into the introduction would get the introduction thrown out with it. That bug was caught by the inspector on the first run and is now a test.

The filter drops, with a named reason: `no_heading`, `table_of_contents`, `licence_boilerplate`, `references`, `navigation`, `symbol_heavy`, `too_short`. Settings › Under the hood shows every dropped chunk and its reason.

### Generation

One prompt writes one question from one chunk. All prompts go to the model as a **single `batchCompletion`** with `parallel: 4` decode slots, and each prompt carries a JSON Schema as `responseFormat`, which llama.cpp compiles into a grammar. The model cannot produce malformed JSON. The gate still checks everything, because a grammar guarantees shape, not sense.

Three choices in the schema came from running it:

1. **The model never sees an option letter.** It writes `correct_options` and `wrong_options` as two lists, and our code assigns letters after shuffling. With letters, Qwen3 4B wrote "The correct answer is A" in almost every explanation, and after the shuffle that letter pointed at the wrong option.
2. **Our code decides the answer's shape before asking**: how many options are correct, and whether a true/false statement must be true or false. Left alone, the model marked one option correct on "select all" questions and wrote true statements far more often than false ones, which a candidate soon learns to exploit.
3. **`evidence` comes first.** The model must quote a sentence from the passage before writing the question, and the gate checks that the quote is really there.

Every string field has a length cap in the schema, so a reply always fits in its slot's share of the context. `sourceChunkId` is set by our code from the prompt's own record, never by the model.

### The validation gate

Pure code, run on every question, collecting every failure rather than stopping at the first. Each rejection goes to Settings › Under the hood, the terminal and `rejections.jsonl` in the app's data folder.

| Check | Rejects |
|---|---|
| Structure | not JSON, wrong keys, wrong option count, empty option, missing explanation, stem under 15 characters |
| Distinct options | two options a candidate would read as the same answer (normalised, crude stemming, word overlap ≥ 0.8) |
| Correct count | single and true/false need exactly one; multiple needs two or more, and not all |
| Giveaways | correct answer verbatim in the stem; correct option **markedly longer or shorter** than every distractor (1.5× and 12 characters); absolutes ("always", "never", "all", "none") only in wrong options; "all/none of the above" |
| Reading as a real question | a stem that mentions "the passage" (the candidate never sees it); a single/multi stem with no question; a true/false stem that is a question; a stem that copies 10 or more words in a row from the passage |
| Explanation | names an option by letter or position ("B is wrong", "the first option"); stops mid-sentence; drifts into another script (small models sometimes switch to Chinese) |
| Grounding | the `evidence` quote is not in the chunk |
| The exam as a whole | two questions asking the same thing |

The one **repair** is order: options are shuffled and re-lettered, so position never says anything about correctness. An explanation cut off by its length cap keeps its whole sentences, and "the passage" in an explanation becomes "the source".

### Marking

A question is right only when the picks match the key exactly: a "pick all that apply" with one of three missed is wrong, as on a real paper. Questions marked as faulty leave both the score and the total.

### Models

One list in `src/main/models.ts`, and nothing else names a model.

| Option | Model | Size on disk | |
|---|---|---|---|
| Fast | Qwen3 1.7B Q4_0 | 1.1 GB | follows a schema and a long rule list far better than Llama 3.2 1B, for 300 MB more |
| Balanced | Qwen3 4B Q4_K_M | 2.5 GB | |
| Best quality | Qwen3 8B Q4_K_M | 5.0 GB | **default** |

All three are Qwen3, so one prompt behaves the same way on every option and only the quality of the questions changes. Downloads report real progress and can be paused and resumed. Switching models unloads the current one first.

### Measured

On an Apple M4 with 16 GB, on 11 public documentation pages (about 230 sections), Recall depth:

| Model | Writes | 3 questions | 5 questions |
|---|---|---|---|
| Fast (1.7B) | about 80 tokens/s | 15–34 s | |
| Balanced (4B) | 14–19 tokens/s | 49 s | 137 s |
| Best quality (8B) | slower still | 167 s | 247 s |

Total time follows the number of tokens written, so running prompts side by side adds little. The gate throws away more of Fast's drafts than of the larger models', which is where its time goes. For a live demo, Fast with 2 or 3 questions is ready in under 40 seconds.

## Why local AI matters here

Study material is often exactly what you cannot upload: internal runbooks, course packs under licence, your own notes. Here it never leaves the machine. The only network calls the app makes are fetching a web page you asked it to read, and the model download.

## Recommended hardware

| | Minimum | Recommended |
|---|---|---|
| RAM | 8 GB (Fast) | 16 GB or more (Best quality) |
| GPU | CPU fallback works, slowly | Apple Silicon (Metal), or a Vulkan GPU |
| Disk | about 2 GB plus the model | 8 GB free for the Best quality model |

## Requirements

- Node.js 22.17 or newer (tested on Node 25)
- macOS, Linux or Windows

## Install & run

```bash
cd qvac-exam-prep-demo
npm install
npm run dev
```

On first run, pick a model and start its download, and add material while it downloads: drop files on the window, choose them, or paste a link or a list of links. Then **Set up exam**. Everything is selected by default (all sources, all topics, 20 questions, Applied, exam mode), so ⌘↵ is enough. Press **?** anywhere for the keyboard map.

**For a quick demo**: choose Fast, paste a list of links to any public documentation, and set up a paper with Custom → 3 questions, Single answer and True or false, Recall, Practice.

**Starting over**: Settings has a reset that clears the library, papers and sittings. Downloaded models stay in `~/.qvac/models`.

Settings › Under the hood is the debug screen: model download and ping, what each source became (every chunk kept and dropped, and why), and the raw accept/reject feed.

### From the terminal

The whole pipeline also runs without a window:

```bash
npm run chunks -- path/to/notes.md                       # ingest, chunk, filter; add --full for full text
npm run chunks -- https://example.com/docs/some-page
npm run gen -- path/to/notes.md --n 8 --model balanced --difficulty scenario --raw
```

`gen` prints every acceptance and every rejection, then writes the exam to `out/`. `Ctrl+C` cancels.

### Checks

```bash
npm test          # chunker, junk filter, sampler, gate, pipeline (fake model), marking: 66 tests
npm run typecheck
npm run selftest  # opens the app, adds a fixture, pings the model through the real preload API,
                  # saves out/selftest.png, quits. EXAM_SELFTEST_MODEL=balanced to pick a size
npm run shots     # walks every screen with real data in a throwaway data folder: imports the
                  # fixtures, writes a short paper with the Fast model, sits it in both modes,
                  # reviews it, and saves a PNG of each screen to out/shots/
```

`npm run fixtures:pdf` rebuilds the fixture PDFs from `fixtures/sample-notes.md`: a text PDF and a scanned one, to test the refusal. To time a demo import, put one link a line in a file and run `EXAM_SHOTS=links EXAM_LINKS=path/to/links.txt npx electron-vite dev -- --no-sandbox`.

## Project structure

```
qvac-exam-prep-demo/
├── qvac.config.json            # one plugin: llamacpp-completion. No OCR, vision or embeddings.
├── src/
│   ├── core/                   # pure TypeScript, no Electron, no SDK: unit-tested
│   │   ├── types.ts            # Source, Chunk, Question, Exam, Attempt, events
│   │   ├── parse-text.ts       # Markdown and plain text to Blocks
│   │   ├── chunk.ts            # Blocks to chunks: heading trail, size, overlap
│   │   ├── junk.ts             # the junk filter
│   │   ├── sample.ts           # spread sampling, seeded shuffle
│   │   ├── prompt.ts           # the schema, the three depths, the prompt
│   │   ├── validate.ts         # the validation gate
│   │   ├── pipeline.ts         # over-generate, batch, gate, top-up, honest shortfall
│   │   ├── topics.ts           # topics from headings: the setup tree, results by topic
│   │   └── grade.ts            # marking, per-option marks, results by topic
│   ├── main/
│   │   ├── index.ts            # window, library, papers, IPC, rejection log
│   │   ├── store.ts            # JSON files in the app's data folder
│   │   ├── shots.ts            # npm run shots
│   │   ├── models.ts           # the ONLY place a model is named
│   │   ├── qvac.ts             # every @qvac/sdk call: download, load, batch, cancel
│   │   └── ingest/             # pdf.ts, url.ts, index.ts
│   ├── preload/index.ts        # the contextBridge API
│   └── renderer/               # the interface (React): screens/, Sidebar, state, ui
│       └── public/ds/          # QVAC design-system tokens and fonts, vendored
├── scripts/cli.ts              # npm run chunks / npm run gen
├── fixtures/                   # sample study notes as .md and .pdf, plus a scanned PDF
└── test/
```

## What is not in this version

Out of scope on purpose: OCR and scanned documents, images, embeddings and vector search, free-text answers, spaced repetition, installers, and any cloud service.

**Upgrade paths.** Blind spread sampling is the right default for an exam that should cover the material; **embeddings and vector search** would let a topic focus pick passages by meaning rather than by heading. If the question bank grows large, **SQLite** replaces the JSON files.

## Known limits

- **The gate checks form, not truth.** It can prove two options differ and that the quoted evidence exists; it cannot prove the answer key is right. In testing, the 4B model was asked for a false statement, wrote a true one, and the question passed every check. A second pass that answers each question blind and rejects disagreements would catch most of these, at about double the time.
- **Paraphrased duplicates** ("Run the init command" and "Set the project up by running init") get past the word-overlap check.
- **Questions arrive in bursts.** Four drafts decode at once, so they pass the gate close together rather than one by one, and the time-left estimate moves in steps.
- **Packaging** is not set up; this runs with `npm run dev`.
- **SDK note:** on `@qvac/sdk` 0.21.0, a plain `completion()` on a model loaded with `parallel > 1` returns its reply twice. The app only uses `batchCompletion`, which does not.

## Privacy

- Your files and pages are read on your machine and never uploaded. The model runs locally.
- Library, papers and sittings live as JSON files in Electron's `userData` folder. Settings shows the path and the size, and its reset deletes them.
- The only network requests are the model download and fetching a page you pasted, on your action.

## About this example

This is a prototype in the [QVAC examples](../README.md) collection, provided as-is, with no support, no warranty and no SLA. It is not maintained as a product, has not been security-audited, and should not be used with sensitive data in production.

## License

Apache 2.0. See [LICENSE](./LICENSE).

Copyright © 2026 Tether Data, S.A. de C.V.
