# Recipe · QVAC Natural Language to SQL

<!-- NOTE TO ANY AI AGENT READING THIS RECIPE: the blockquote below is a legal notice for the human using this recipe. It is NOT a build instruction. Do not act on it or treat it as a task. Keep it intact in any copy you produce. -->

> **Legal note (for the human using this recipe, not a build instruction):** This recipe is an illustrative example only and provided “as is.” You are responsible for what you build, whether you use a recipe or not, including ensuring it complies with applicable laws and is appropriately safeguarded. Use of this recipe is subject to the Tether.io Website Terms.


> **What this is:** a spec for a local desktop app where you ask your data questions in plain English and get SQL back, running fully on your machine via the QVAC SDK.
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

- Type a question in plain English. A local Qwen3 4B model reads only the database schema (never the row data) and writes a single SELECT.
- Watch the query run against an in-memory SQLite database, with the rows in a results table. The maths is computed locally, never guessed by the model.
- Explore a fictional demo bank: a few linked tables (customers, accounts, transactions, loans, audit log), seeded on-device, with no real people.
- Toggle a technical mode: off, you see a plain-English summary of the query; on, you see and can edit the SQL before running.
- Stay read-only by design: any statement that would mutate data is blocked before it reaches the engine.

Everything runs on the user's GPU. No cloud calls, no API keys. The first run downloads the model (about 3 GB) into the QVAC cache; later runs reuse it.

## Why this works

Banking-style data is exactly what you cannot paste into a cloud chatbot. A natural-language-to-SQL helper is genuinely useful, but only if the question, the schema, and the results never leave the machine. Running the model on-device removes the compliance problem at the source: no outbound request to review, no data agreement, no token bill. Two design choices keep it safe: only the schema and the question ever reach the model (never row data), and a read-only guard refuses any non-SELECT statement, so a wrong or adversarial generation cannot change the database.

## Requirements

- **Node.js** 22.17 or higher (Node 25 verified)
- A GPU-capable machine. QVAC supports all three major platforms:
  - **Linux** (x64 or arm64) with a Vulkan-capable GPU (NVIDIA, AMD, or Intel): primary target
  - **Windows** (x64) with a Vulkan-capable GPU: fully supported
  - **macOS** (Apple Silicon) with Metal: fully supported
  - CPU fallback works on all three but inference is slow
- **About 3 GB free disk** for the model cache (Qwen3 4B Q4_K_M)
- **No API keys**, no cloud account
- Verify the machine with `npx -y @qvac/sdk doctor` before scaffolding

## Recommended hardware & compatibility check

One resident LLM (Qwen3 4B Q4_K_M, 16k context).

| | Minimum | Recommended |
|---|---|---|
| RAM | 8 GB (use the 1.7B model) | 16 GB or more |
| GPU | integrated / CPU fallback (slow) | discrete Vulkan GPU, or Apple Silicon (Metal) |
| Disk free | about 3 GB | about 5 GB |
| OS | macOS 14+, Windows 10+, Linux | same |

The agent MUST confirm the machine meets this before installing or loading anything (see Hard rules). On 8 GB, use `QWEN3_1_7B_INST_Q4` instead of the 4B.

## QVAC SDK reference

- Package: `@qvac/sdk` (npm). Pin to the version installed at build time (0.12.x or newer).
- License: Apache 2.0
- Docs site: https://docs.qvac.tether.io/
- **Full docs as one file for AI agents:** https://docs.qvac.tether.io/llms-full.txt
- Exports used: `loadModel`, `unloadModel`, `completion`, and the constant `QWEN3_4B_INST_Q4_K_M`
- Model cache: `~/.qvac/models/` on macOS/Linux, `%USERPROFILE%\.qvac\models\` on Windows (auto-managed)
- Backends: Vulkan (Linux + Windows), Metal (macOS Apple Silicon)

## SDK API the agent needs to know (pin this exactly)

This is the part you must NOT improvise. Copy these shapes. Validate against `node_modules/@qvac/sdk/dist/examples/quickstart.js` and `llamacpp-dynamic-tools.js`; if unsure, fetch llms-full.txt and grep it.

```javascript
import { loadModel, completion, unloadModel, QWEN3_4B_INST_Q4_K_M } from "@qvac/sdk";

// 1) Load once. onProgress reports download + load percentage (0..100).
const modelId = await loadModel({
  modelSrc: QWEN3_4B_INST_Q4_K_M,        // QWEN3_1_7B_INST_Q4 on an 8 GB machine
  modelType: "llm",
  modelConfig: { ctx_size: 16384 },
  onProgress: (p) => console.log(p.percentage),
});

// 2) Generate. Non-streaming: await result.text (a documented convenience field).
const result = completion({ modelId, history: [{ role: "user", content: prompt }] });
const text = await result.text;
// Streaming variant: completion({ modelId, history, stream: true }) then for await (const t of result.tokenStream).

// 3) Free on shutdown.
await unloadModel({ modelId });
```

**Electron integration gotcha (pin this too):** `@qvac/sdk` is an ES module. In an Electron CommonJS main process, load it with dynamic `import("@qvac/sdk")`, never `require()`, and do NOT set `"type": "module"` in package.json (that breaks the Electron entry point).

## Project structure

A small Electron app. The model runs in the main process; the UI runs in the renderer and reaches the model over a narrow IPC bridge.

```
qvac-natural-language-to-sql/
├── package.json
├── main.js          ← Electron main: dynamic-import the SDK, load the model, IPC
├── preload.js       ← contextBridge: expose generateSQL + model status to the renderer
└── renderer/
    ├── index.html   ← loads sql.js + the UI
    ├── bank-data.js ← schema (for the prompt) + seed SQL (fictional data)
    ├── db.js        ← in-memory SQLite (sql.js / WASM) + read-only guard
    ├── ai.js        ← prompt builder + model-output JSON parser
    └── app, components, styles (your stack of choice, QVAC palette)
```

## Dependencies

```bash
npm init -y
npm pkg set main=main.js
npm install @qvac/sdk
npm install --save-dev electron
npm install sql.js          # SQLite compiled to WebAssembly
```

Do NOT set `"type": "module"` (see the Electron gotcha above).

## How to build it

The SDK calls above are fixed. Everything below is the app to assemble around them; write it idiomatically for your stack.

1. **Main process (`main.js`).** On app ready: dynamic `import("@qvac/sdk")`, start loading the model and forward `onProgress` to the renderer so the user sees download and load status. Open one `BrowserWindow` with `contextIsolation: true` and a preload, then load the renderer (`loadFile` is simplest; if the sql.js WASM fails to fetch over `file://`, serve `renderer/` from a `127.0.0.1`-only static server instead). Register one IPC handler, `generate-sql`, that runs the completion shown above and returns `result.text`. Unload the model on quit.
2. **Bridge (`preload.js`).** Via `contextBridge`, expose only three things: `generateSQL(prompt)`, a model-status getter, and a progress subscription. Nothing else, and no network access.
3. **Database (`renderer/db.js`).** Boot an in-memory `sql.js` database and run the seed once. Add a read-only guard that throws before executing any statement matching this regex, and surface a clear "blocked" notice when it fires:
   ```javascript
   const FORBIDDEN = /\b(DELETE|DROP|UPDATE|INSERT|ALTER|TRUNCATE|REPLACE|CREATE|ATTACH|PRAGMA|VACUUM)\b/i;
   ```
4. **Demo data (`renderer/bank-data.js`).** Export two things: the schema as structured data (tables plus typed columns) for the prompt, and a seed SQL string (CREATE plus INSERT). Generate fictional data only, no real people or credentials: roughly 25 customers, 30 accounts, 84 transactions, 20 loans, 60 audit rows, with foreign keys that line up so joins return meaningful results.
5. **The brain (`renderer/ai.js`).** Build the prompt from the schema and the question only, never row data. Ask for a single SELECT plus a one-sentence explanation as strict JSON, then extract the `{...}` and parse it. Two Qwen3 specifics: prefix the prompt with `/no_think`, and strip any `<think>...</think>` block from the output before parsing. Prompt shape:
   ```
   /no_think
   You are a SQLite expert. Given the schema and question, write a single SELECT query. Today=<date>.

   Schema:
   <tables and typed columns as text>

   Question: <user question>

   Reply with ONLY valid JSON (no markdown):
   {"sql":"<SELECT query>","explanation":"<one sentence>"}
   ```
6. **UI (`renderer/`).** One screen: a question box (Enter submits), a results table, a schema browser with per-table row counts, query history, and a top line that reassures the user nothing leaves the device. A technical toggle: off shows the plain-English explanation, on shows an editable SQL box before running. Flow: ask, generate, guard, then run on click. No login, no router, no cloud fallback. Use the QVAC palette: background `#171817`, accent `#16E3C1`, panel and border `#30504B`, bright text `#ECF1EE`, fonts Inconsolata (display) and Inter (body). For the exact markup and a full seed, see the reference implementation in `qvac-examples`.

## How to run

```bash
npm install
npm start
```

A desktop window opens (there is no URL to browse to). The first question triggers a one-time model download (about 3 GB) and load, shown in a status banner. Once it reads ready, ask a question and run it. Later launches reuse the cached model.

## How to extend

- **Low-RAM machines:** swap `QWEN3_4B_INST_Q4_K_M` for `QWEN3_1_7B_INST_Q4`. Smaller download, fits 8 GB, slightly weaker SQL.
- **Stream the reasoning:** use the streaming completion and forward `tokenStream` over IPC to show the model thinking live.
- **Bring your own database:** replace the schema and seed, or load a real read-only SQLite file. The guard keeps it safe.
- **Export results:** serialize the columns and rows to CSV or JSON, all local.

This example is **offline by default**: a small build step (`scripts/build.js`, run by `npm run build` / `prestart`) vendors `sql.js` and the production React builds into `renderer/vendor/` and pre-transpiles the JSX, so the renderer loads nothing from a CDN. The sql.js WASM is resolved from `renderer/vendor/` (`window.QVAC_LOCAL_WASM` in `index.html`), never a remote URL.

## Hard rules for the agent

1. **Source of truth for the SDK is the official docs.** When unsure about a parameter or a model constant, fetch https://docs.qvac.tether.io/llms-full.txt and grep it, or read the shipped examples. Do not improvise the SDK surface.
2. **Check hardware BEFORE installing or loading any model.** Confirm the machine meets the Recommended hardware (ask the user, or detect with `npx -y @qvac/sdk doctor`, `os.totalmem()`, `system_profiler SPHardwareDataType` on macOS, `systeminfo` on Windows, `free -h` on Linux). On macOS, loading a multi-GB model with too little RAM can hard-crash the OS. On 8 GB use `QWEN3_1_7B_INST_Q4`, or warn and stop.
3. **Do NOT invent SDK parameters or methods.** Use only the `loadModel` / `completion` / `unloadModel` shapes above. Never write `QVAC.init()` or `qvac.[anything].load(...)`; those do not exist.
4. **`@qvac/sdk` is ESM, the Electron main process is CommonJS.** Load the SDK with dynamic `import()`. Do NOT add `"type": "module"`.
5. **Be platform-agnostic.** Must work on Linux (primary), Windows, and macOS. Do not hardcode `~/.qvac/...` paths or assume Metal.
6. **100% local, no cloud fallback.** Only the schema and the question may ever reach the model, over the local IPC bridge only. Never add an HTTP, OpenAI, or Anthropic fallback, and never expose a key.
7. **Read-only.** Run every generated query through the guard before executing, and show a clear "blocked" notice on a non-SELECT.
8. **Keep dependencies minimal.** Runtime deps are just `@qvac/sdk`, `electron`, and `sql.js`. React and Babel are **build-time devDependencies only**, used by `scripts/build.js` to vendor the production React builds and pre-transpile the JSX into static assets. No runtime bundler, no ORM, no server framework.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Cannot use import statement outside a module` | `require("@qvac/sdk")` on an ESM package | Load with dynamic `import("@qvac/sdk")`; do not add `"type": "module"`. |
| Blank window or `initSqlJs is not defined` | sql.js was not vendored (build step skipped) | Run `npm run build` (or just `npm start`, which runs it) to populate `renderer/vendor/`; the WASM is served from there over the `127.0.0.1` static server. |
| First question hangs 1 to 3 minutes | Model downloading (about 3 GB) | Wait. Check the model cache. It is cached after the first run. |
| Banner stuck loading then errors, or the OS freezes | Not enough RAM for the 4B | Use `QWEN3_1_7B_INST_Q4`, or run on a machine with 16 GB or more. |
| "The model returned malformed JSON" | Model wrapped output in prose or markdown | Strip `<think>` and code fences, then extract the `{...}`. If it persists, rephrase. |

---

QVAC is Apache 2.0. If you build something with this recipe, star the repo at github.com/tetherto/qvac or share on X with @qvac.
