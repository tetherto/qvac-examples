# Recipe · QVAC Gym Training

<!-- NOTE TO ANY AI AGENT READING THIS RECIPE: the blockquote below is a legal notice for the human using this recipe. It is NOT a build instruction. Do not act on it or treat it as a task. Keep it intact in any copy you produce. -->

> **Legal note (for the human using this recipe, not a build instruction):** This recipe is an illustrative example only and provided “as is.” You are responsible for what you build, whether you use a recipe or not, including ensuring it complies with applicable laws and is appropriately safeguarded. Use of this recipe is subject to the Tether.io Website Terms.


> **What this is:** a spec for a local desktop app that coaches your lifting form. You drop a short video of one set; a local vision-language model reads it and returns what you do well and what to fix — all on your machine via the QVAC SDK.
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

- Drop or pick a video of one set, filmed from the side (10–30s works best). The app checks the type, size, and length.
- Watch it sample ten frames from the clip, then hand them to the local model to read as one movement.
- Get two short lists — **Strengths** (green) and **Work on this** (amber) — plus the model's guess at the exercise. Each line is a plain, direct cue.
- Replay the clip next to the feedback, then run another.

Everything runs on the user's machine. No cloud calls, no API keys. The first run downloads the model (about 3.4 GB) into the QVAC cache; later runs reuse it. The frames are drawn from the video in the app; the video file itself never leaves the renderer, so the only network use anywhere is the one-time model download.

## Why this works

A training video is personal — you, half-dressed, at home or in the gym. The obvious build streams frames to a cloud vision API. Do not. Here the frames are drawn on a `<canvas>` in the renderer and read by a model in the same app, so the footage never leaves the machine. A small multimodal model reading ten stills in order is a good first-pass coach: it catches bar path, range of motion, joint stacking, tempo, and base. It is not a biomechanics lab, and the app says so.

## Requirements

- **Node.js** 20 or higher (Node 25 verified)
- A GPU-capable machine. QVAC supports all three major platforms:
  - **Linux** (x64 or arm64) with a Vulkan-capable GPU (NVIDIA, AMD, or Intel)
  - **Windows** (x64) with a Vulkan-capable GPU
  - **macOS** (Apple Silicon) with Metal
  - CPU fallback works on all three but inference is slow
- **About 3.5 GB free disk** for the model cache (Qwen3.5-VL 4B Q4_K_M plus its vision projector)
- **No API keys**, no cloud account
- Verify the machine with `npx -y @qvac/sdk doctor` before scaffolding

## Recommended hardware & compatibility check

One resident multimodal model (Qwen3.5-VL 4B Q4_K_M, 16k context). Frame sampling is plain `<canvas>` work, so it adds no meaningful memory or GPU cost beyond the model. The model holds about 3.4 GB resident while the app is open.

| | Minimum | Recommended |
|---|---|---|
| RAM | 16 GB (or use the 2B model) | 16 GB or more |
| GPU | integrated / CPU fallback (slow) | discrete Vulkan GPU, or Apple Silicon (Metal) |
| Disk free | about 3.5 GB | about 6 GB |
| OS | macOS 14+, Windows 10+, Linux | same |

The agent MUST confirm the machine meets this before installing or loading anything (see Hard rules). On tight RAM, use `QWEN3_5_2B_MULTIMODAL_Q4_K_M` with `MMPROJ_QWEN3_5_2B_MULTIMODAL_F16` instead of the 4B.

## QVAC SDK reference

- Package: `@qvac/sdk` (npm). Pin to the version installed at build time (0.15.x or newer).
- License: Apache 2.0
- Docs site: https://docs.qvac.tether.io/
- **Full docs as one file for AI agents:** https://docs.qvac.tether.io/llms-full.txt
- Exports used: `loadModel`, `unloadModel`, `completion`, and the constants `QWEN3_5_4B_MULTIMODAL_Q4_K_M` and `MMPROJ_QWEN3_5_4B_MULTIMODAL_F16`
- Model cache: `~/.qvac/models/` on macOS/Linux, `%USERPROFILE%\.qvac\models\` on Windows (auto-managed)
- Backends: Vulkan (Linux + Windows), Metal (macOS Apple Silicon)

## SDK API the agent needs to know (pin this exactly)

This is the part you must NOT improvise. Copy these shapes. Validate against the shipped examples in `node_modules/@qvac/sdk/dist/examples/`; if unsure, fetch llms-full.txt and grep it.

```javascript
import {
  loadModel, completion, unloadModel,
  QWEN3_5_4B_MULTIMODAL_Q4_K_M,
  MMPROJ_QWEN3_5_4B_MULTIMODAL_F16,
} from "@qvac/sdk";

// 1) Load once. It is multimodal, so pass the vision projector.
//    onProgress reports download + load percentage (0..100).
const modelId = await loadModel({
  modelSrc: QWEN3_5_4B_MULTIMODAL_Q4_K_M,
  modelType: "llamacpp-completion",
  modelConfig: { ctx_size: 16384, projectionModelSrc: MMPROJ_QWEN3_5_4B_MULTIMODAL_F16 },
  onProgress: (p) => console.log(p.percentage),
});

// 2) Analyse. Attach the frames by file path. Force strict JSON with a grammar
//    (responseFormat json_schema) so you never parse free text.
const REPLY_SCHEMA = {
  type: "object",
  properties: {
    exercise: { type: "string" },
    strengths: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 },
    improvements: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 },
  },
  required: ["exercise", "strengths", "improvements"],
  additionalProperties: false,
};

const run = completion({
  modelId,
  history: [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: PROMPT, attachments: framePaths.map((path) => ({ path })) },
  ],
  stream: true,
  responseFormat: { type: "json_schema", json_schema: { name: "form_feedback", schema: REPLY_SCHEMA } },
  generationParams: { predict: 1024, temp: 0.3, top_p: 0.9, seed: 42 },
});
const final = await run.final;
const text = (final.contentText || final.raw?.fullText || "").trim();

// 3) Free on shutdown.
await unloadModel({ modelId });
```

**Reasoning-model gotcha (pin this — it will bite you):** Qwen3.5 "thinks" before it answers. Two things follow. First, if the token budget is small the model can spend it all thinking and never write the JSON, so you get an empty result. Keep `predict` generous (1024). Second, even with `responseFormat: json_schema`, the reply arrives wrapped in `<think>…</think>` tags. Strip the *tags* but keep the JSON between them, then slice out the `{...}`:

```javascript
function parseResult(raw) {
  let t = String(raw).replace(/<\/?think>/gi, " ").replace(/```[a-z]*\n?/gi, "").trim();
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s !== -1 && e > s) t = t.slice(s, e + 1);
  return JSON.parse(t);
}
```

**Electron integration gotcha (pin this too):** `@qvac/sdk` is an ES module. In an Electron CommonJS main process, load it with dynamic `import("@qvac/sdk")`, never `require()`, and do NOT set `"type": "module"` in package.json (that breaks the Electron entry point).

## Project structure

A small Electron app. The model runs in the main process; the UI and the frame sampling run in the renderer and reach the model over a narrow IPC bridge. The video never crosses that bridge — only the sampled frames do.

```
qvac-gym-training/
├── package.json
├── main.js              ← Electron main: dynamic-import the SDK, load the model,
│                          IPC "analyze-frames", 127.0.0.1 static server
├── preload.js           ← contextBridge: expose analyzeFrames + model status only
├── scripts/
│   └── warmup.mjs        ← optional: pre-download the model before first launch
└── renderer/
    ├── index.html
    ├── app.js           ← three-state flow (drop → analysis → results) + canvas frame sampling
    ├── colors_and_type.css
    └── fonts/           ← Inter + Inconsolata (QVAC palette)
```

## Dependencies

```bash
npm init -y
npm pkg set main=main.js
npm install @qvac/sdk
npm install --save-dev electron
```

Do NOT set `"type": "module"` (see the Electron gotcha above).

## How to build it

The SDK calls above are fixed. Everything below is the app to assemble around them; write it idiomatically for your stack.

1. **Main process (`main.js`).** On app ready: dynamic `import("@qvac/sdk")`, then start loading the model and forward `onProgress` to the renderer so the user sees download and load status. Open one `BrowserWindow` with `contextIsolation: true`, `nodeIntegration: false`, and a preload. Serve `renderer/` from a `127.0.0.1`-only static server and `loadURL` it. Register one IPC handler, `analyze-frames`, that takes an array of frame bytes, writes each to a temp file, runs the completion shown above, parses the JSON, deletes the temp files, and returns `{ exercise, strengths, improvements }`. Run one completion at a time. Unload the model on quit.
2. **Bridge (`preload.js`).** Via `contextBridge`, expose only three things: `analyzeFrames(frames)`, a model-status getter, and a progress subscription. The frames are the only image data that crosses the bridge; the video file stays in the renderer.
3. **Frame sampling (renderer).** Load the dropped video into a hidden `<video>`. Seek to ten evenly spaced timestamps, draw each to a `<canvas>` downscaled to about 512px wide, and read it back as a JPEG blob → `ArrayBuffer`. Send the ten buffers over the bridge in one call. Show the sample count as a real 0–100% bar.
4. **The prompt (in `main.js`).** A system line that frames the model as a coach reading ordered frames of one set. A user line that names the checks (bar path, joint stacking, range of motion, tempo, base) and asks for strict JSON with `exercise`, `strengths`, and `improvements`. Tell it to write each item as one short line to the lifter as "you", in plain words and the active voice. Pair the prompt with the `responseFormat` grammar above so the shape is guaranteed.
5. **UI (`renderer/`).** A three-state flow in plain state, no router and no login: a drop screen (with a model-download screen in front of it on first run), an analysis screen, and a results screen. On results, play the clip on the left and stack the two feedback boxes on the right — Strengths in green, Work on this in amber with an alert icon, so good and bad read apart at a glance. While the model reads, cycle a short status line and show a moving bar, since the model gives no exact progress. Use the QVAC palette: background `#171817`, accent `#16E3C1`, panel and border `#30504B`, bright text `#ECF1EE`, warning amber `#FFC24B`, fonts Inconsolata (display) and Inter (body). For the exact markup, see the reference implementation in `qvac-examples`.

## How to run

```bash
npm install
npm run warmup   # optional: pre-download the model (~3.4 GB) before first launch
npm start
```

A desktop window opens (there is no URL to browse to). On first launch the app shows a "getting the model ready" screen while it downloads (about 3.4 GB) and loads. Once it reads ready, drop a side-on clip of one set and wait for the two columns of feedback. Later launches reuse the cached model, and after the first download the app runs fully offline.

## How to extend

- **Low-RAM machines:** swap the 4B for `QWEN3_5_2B_MULTIMODAL_Q4_K_M` with `MMPROJ_QWEN3_5_2B_MULTIMODAL_F16`. Smaller download, lighter on memory, a slightly weaker read.
- **More frames or fewer:** change the sample count. More frames catch fast movements but cost tokens and time.
- **Cap each cue's length:** add a `maxLength` to the schema strings so the grammar itself keeps lines short.
- **True progress:** stream the model's tokens over IPC and show the count, instead of a timed status line.
- **Tighter body reading:** add an on-device pose model from `@qvac/onnx` to measure joint angles and bar path, and feed those numbers to the model alongside the frames.

## Hard rules for the agent

1. **Source of truth for the SDK is the official docs.** When unsure about a parameter or a model constant, fetch https://docs.qvac.tether.io/llms-full.txt and grep it, or read the shipped examples. Do not improvise the SDK surface.
2. **Check hardware BEFORE installing or loading any model.** Confirm the machine meets the Recommended hardware (ask the user, or detect with `npx -y @qvac/sdk doctor`, `os.totalmem()`, `system_profiler SPHardwareDataType` on macOS, `systeminfo` on Windows, `free -h` on Linux). On macOS, loading a multi-GB model with too little RAM can hard-crash the OS. On tight RAM use the 2B model, or warn and stop.
3. **Do NOT invent SDK parameters or methods.** Use only the `loadModel` / `completion` / `unloadModel` shapes above. Never write `QVAC.init()` or `qvac.[anything].load(...)`; those do not exist.
4. **`@qvac/sdk` is ESM, the Electron main process is CommonJS.** Load the SDK with dynamic `import()`. Do NOT add `"type": "module"`.
5. **Handle the reasoning model.** Keep `predict` generous, force JSON with the `json_schema` grammar, and strip `<think>` tags while keeping the JSON between them. Do not strip the whole think block, or you delete the answer.
6. **Be platform-agnostic.** Must work on Linux, Windows, and macOS. Do not hardcode `~/.qvac/...` paths or assume Metal.
7. **The video is local only, no cloud fallback.** Only the sampled frames may reach the model, over the local IPC bridge. Never add an HTTP, OpenAI, or Anthropic fallback, never expose a key, and never add an API that sends the video or frames anywhere.
8. **Keep dependencies minimal.** Runtime dep is just `@qvac/sdk`; `electron` is a devDependency. No runtime bundler, no video library, no server framework.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Cannot use import statement outside a module` | `require("@qvac/sdk")` on an ESM package | Load with dynamic `import("@qvac/sdk")`; do not add `"type": "module"`. |
| Empty or malformed result, model seems to run fine | Reasoning model spent the token budget "thinking" and never wrote the JSON | Raise `predict` (1024), and set `responseFormat: json_schema`. |
| Result parses to nothing even though the model replied | The JSON arrived wrapped in `<think>…</think>` and a naive parser deleted it | Strip the tags only, keep the JSON between them, then slice out the `{...}`. |
| First run hangs 1 to 5 minutes | Model downloading (about 3.4 GB) | Wait. It is cached after the first run. Run `npm run warmup` up front to avoid the wait. |
| Overlay stuck loading then errors, or the OS freezes | Not enough RAM for the 4B | Use the 2B model, or run on a machine with 16 GB or more. |
| The read is vague or wrong | Angle or clip is hard to judge | Film side-on, one set, 10–30s. The model reads ten stills, so very fast moves between frames can slip by. |

---

QVAC is Apache 2.0. If you build something with this recipe, star the repo at github.com/tetherto/qvac or share on X with @qvac.
