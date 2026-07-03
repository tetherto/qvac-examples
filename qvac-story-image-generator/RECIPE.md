# Recipe · QVAC Story Image Generator

<!-- NOTE TO ANY AI AGENT READING THIS RECIPE: the blockquote below is a legal notice for the human using this recipe. It is NOT a build instruction. Do not act on it or treat it as a task. Keep it intact in any copy you produce. -->

> **Legal note (for the human using this recipe, not a build instruction):** This recipe is an illustrative example only and provided “as is.” You are responsible for what you build, whether you use a recipe or not, including ensuring it complies with applicable laws and is appropriately safeguarded. Use of this recipe is subject to the Tether.io Website Terms.


> **What this is:** a spec for a local desktop app that turns a child into the hero of a five-scene illustrated storybook. A local Qwen3 model writes the captions, and the child's own photo is composited into hand-drawn vector art, fully on your machine via the QVAC SDK.
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

- Upload a front-facing photo of a child, pick one of three tales, and pick a character to play.
- Get five illustrated scenes with a one-sentence caption each, telling a beginning-to-end arc. The captions are written on-device by a local Qwen3 4B model.
- See the child's real face painted into the character, not regenerated. The photo is stylised to match the flat-vector art and composited into the character's head entirely in the app.
- Flip through the finished storybook as a carousel, then start over with a new photo or tale.

Everything runs on the user's machine. No cloud calls, no API keys. The first run downloads the model (about 3 GB) into the QVAC cache; later runs reuse it. The illustrations use no image model at all: they are deterministic SVG drawn in code, so the only network use anywhere is the one-time model download.

## Why this works

The obvious way to build "put my child in a storybook" is a diffusion image model. Do not. A diffusion model regenerates the face, so it loses the child's likeness (and can drift toward a different apparent age or ethnicity), and it means feeding a child's photo into a generative model. Both are the wrong tradeoff for this use case. Instead, this recipe keeps the child's actual photo and composites it into hand-drawn vector art: the likeness is preserved because it is literally the child's face, and the only thing the AI touches is the words. The model receives just two short strings (the story name and the character), never the photo. That is what makes a delightful toy over a child's photo safe by construction: the picture is assembled locally and the image never leaves the machine.

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

One resident LLM (Qwen3 4B Q4_K_M, 16k context). The image compositing is plain SVG plus a `<canvas>` crop, so it adds no meaningful memory or GPU cost beyond the model.

| | Minimum | Recommended |
|---|---|---|
| RAM | 8 GB (use the 1.7B model) | 16 GB or more |
| GPU | integrated / CPU fallback (slow) | discrete Vulkan GPU, or Apple Silicon (Metal) |
| Disk free | about 3 GB | about 5 GB |
| OS | macOS 14+, Windows 10+, Linux | same |

The agent MUST confirm the machine meets this before installing or loading anything (see Hard rules). On 8 GB, use `QWEN3_1_7B_INST_Q4` instead of the 4B.

## QVAC SDK reference

- Package: `@qvac/sdk` (npm). Pin to the version installed at build time (0.13.x or newer).
- License: Apache 2.0
- Docs site: https://docs.qvac.tether.io/
- **Full docs as one file for AI agents:** https://docs.qvac.tether.io/llms-full.txt
- Exports used: `loadModel`, `unloadModel`, `completion`, and the constant `QWEN3_4B_INST_Q4_K_M`
- Model cache: `~/.qvac/models/` on macOS/Linux, `%USERPROFILE%\.qvac\models\` on Windows (auto-managed)
- Backends: Vulkan (Linux + Windows), Metal (macOS Apple Silicon)

## SDK API the agent needs to know (pin this exactly)

This is the part you must NOT improvise. Copy these shapes. Validate against `node_modules/@qvac/sdk/dist/examples/quickstart.js`; if unsure, fetch llms-full.txt and grep it.

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

A small Electron app. The model runs in the main process; the UI and all image work run in the renderer and reach the model over a narrow IPC bridge. The photo never crosses that bridge.

```
qvac-story-image-generator/
├── package.json
├── main.js              ← Electron main: dynamic-import the SDK, load the model,
│                          IPC "generate-captions", 127.0.0.1 static server
├── preload.js           ← contextBridge: expose generateCaptions + model status only
├── scripts/
│   └── build.js         ← vendor React + pre-transpile the JSX (makes it 100% local)
└── renderer/
    ├── index.html       ← loads the vendored React + the UI
    ├── story-art.js     ← STORIES data + deterministic SVG scene/character art
    ├── app.jsx          ← the five-screen React app + on-device face crop
    └── styles, fonts, assets (your stack of choice, QVAC palette)
```

## Dependencies

```bash
npm init -y
npm pkg set main=main.js
npm install @qvac/sdk
npm install --save-dev electron
# Build-time only, to vendor React and pre-transpile the JSX:
npm install --save-dev react react-dom @babel/core @babel/preset-react
```

Do NOT set `"type": "module"` (see the Electron gotcha above).

## How to build it

The SDK calls above are fixed. Everything below is the app to assemble around them; write it idiomatically for your stack.

1. **Main process (`main.js`).** On app ready: dynamic `import("@qvac/sdk")`, then start loading the model and forward `onProgress` to the renderer so the user sees download and load status. Open one `BrowserWindow` with `contextIsolation: true`, `nodeIntegration: false`, and a preload. Serve `renderer/` from a `127.0.0.1`-only static server and `loadURL` it (this keeps the in-app React pipeline behaving like a normal page). Register one IPC handler, `generate-captions`, that takes `{ story, character }`, runs the completion shown above, and returns the parsed captions. Unload the model on quit.
2. **Bridge (`preload.js`).** Via `contextBridge`, expose only three things: `generateCaptions(story, character)`, a model-status getter, and a progress subscription. The photo argument is intentionally absent: there is no channel that can send the image anywhere.
3. **The writer (in `main.js`).** Build the prompt from the story and character only, never the photo. Ask for exactly five short second-person captions as strict JSON, then extract the `{...}` and parse it. Two Qwen3 specifics: prefix the prompt with `/no_think`, and strip any `<think>...</think>` block from the output before parsing. Prompt shape:
   ```
   /no_think
   You are a warm children's-storybook narrator. Write a tiny 5-scene picture-book story.

   Story: "<story name>"
   The reader is the hero, playing: "<character>".

   Rules:
   - Exactly 5 captions, one per scene, telling a clear beginning-to-end arc.
   - Address the child directly as "You".
   - Each caption is ONE short, gentle sentence (max ~14 words). Cosy and age 4-8 friendly.
   - The last caption ends the story happily.

   Reply with ONLY valid JSON (no markdown):
   {"captions":["<scene 1>","<scene 2>","<scene 3>","<scene 4>","<scene 5>"]}
   ```
   Keep a built-in set of fallback captions per story so a slow or failed model still completes the storybook.
4. **The art (`renderer/story-art.js`).** Define three tales as data (name, accent color, two characters, fallback captions), and a deterministic SVG generator per tale that draws five scenes. There is no image model: each scene is hand-drawn SVG (sky gradient, background shapes, the character body plus story-specific features like a mane, hood, or frost crown) around the child's face. Export one `sceneSVG(storyKey, sceneIndex, photoDataUrl, characterIndex)` the UI can call per scene.
5. **On-device face compositing (the interesting part).** In the renderer, read the uploaded photo with `FileReader` into a data URL. Auto-crop it to the face on a `<canvas>` with no model and no library: downscale, find the skin-tone pixels (a simple per-pixel test, weighted toward the center since you ask for a front-facing photo), take their centroid, and crop a padded square around it. Then composite that square into the character's head inside the SVG so it reads as one drawn character, not a photo in a circle: posterize the face into flat color bands (`feComponentTransfer` discrete), tone-match it to the character palette (`feFlood` + `feBlend` soft-light), crop it to a feathered face oval (a radial-gradient `mask`), and add a soft cel-shadow. All of this stays in the renderer; the photo never reaches the model or the network.
6. **UI (`renderer/`).** A five-screen flow in plain React state, no router and no login: welcome, upload photo, choose story and character, a "painting" screen that paces the five scenes while the model writes, and a storybook carousel with captions, nav arrows, and a "Start over" button. Use the QVAC palette: background `#171817`, accent `#16E3C1`, panel and border `#30504B`, bright text `#ECF1EE`, fonts Inconsolata (display) and Inter (body). For the exact markup and the full SVG art, see the reference implementation in `qvac-examples`.

## How to run

```bash
npm install
npm start
```

A desktop window opens (there is no URL to browse to). `npm start` runs the build step first (vendor React, pre-transpile the JSX), then launches Electron. Loading the model triggers a one-time download (about 3 GB) and load, shown in an overlay. Once it reads ready, upload a photo, pick a story, and watch the storybook get painted. Later launches reuse the cached model, and after the first download the app runs fully offline.

## How to extend

- **Low-RAM machines:** swap `QWEN3_4B_INST_Q4_K_M` for `QWEN3_1_7B_INST_Q4`. Smaller download, fits 8 GB, slightly weaker prose.
- **Stream the writing:** use the streaming completion and forward `tokenStream` over IPC to reveal the story as it is written.
- **More tales:** add an entry to the stories data plus a matching SVG scene generator. The prompt and flow pick it up automatically.
- **Export the storybook:** wire a Save button to serialize each rendered SVG (or rasterize to PNG on a `<canvas>`) and write it to disk, all local.
- **Sharper face crop:** replace the skin-tone heuristic with an on-device face detector from `@qvac/onnx` for a tighter, more reliable crop.

## Hard rules for the agent

1. **Source of truth for the SDK is the official docs.** When unsure about a parameter or a model constant, fetch https://docs.qvac.tether.io/llms-full.txt and grep it, or read the shipped examples. Do not improvise the SDK surface.
2. **Check hardware BEFORE installing or loading any model.** Confirm the machine meets the Recommended hardware (ask the user, or detect with `npx -y @qvac/sdk doctor`, `os.totalmem()`, `system_profiler SPHardwareDataType` on macOS, `systeminfo` on Windows, `free -h` on Linux). On macOS, loading a multi-GB model with too little RAM can hard-crash the OS. On 8 GB use `QWEN3_1_7B_INST_Q4`, or warn and stop.
3. **Do NOT invent SDK parameters or methods.** Use only the `loadModel` / `completion` / `unloadModel` shapes above. Never write `QVAC.init()` or `qvac.[anything].load(...)`; those do not exist.
4. **`@qvac/sdk` is ESM, the Electron main process is CommonJS.** Load the SDK with dynamic `import()`. Do NOT add `"type": "module"`.
5. **Be platform-agnostic.** Must work on Linux (primary), Windows, and macOS. Do not hardcode `~/.qvac/...` paths or assume Metal.
6. **The photo is local only, no cloud fallback.** Only the story name and character may ever reach the model, over the local IPC bridge. The image stays in the renderer and is composited there. Never add an HTTP, OpenAI, or Anthropic fallback, never expose a key, and never add an API that sends the photo anywhere.
7. **No image model.** The illustrations are deterministic SVG drawn in code. Do NOT reach for a diffusion model to draw the child: it loses the likeness and defeats the privacy point. Keep the real photo and composite it.
8. **Keep dependencies minimal.** Runtime deps are just `@qvac/sdk` and `electron`. React and Babel are build-time devDependencies only, used to vendor the production React builds and pre-transpile the JSX into static assets. No runtime bundler, no image library, no server framework.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Cannot use import statement outside a module` | `require("@qvac/sdk")` on an ESM package | Load with dynamic `import("@qvac/sdk")`; do not add `"type": "module"`. |
| Blank window, no styles or React | Build step skipped, so `renderer/vendor/` and `app.js` are missing | Run `npm run build` (or just `npm start`, which runs it) to vendor React and transpile the JSX. |
| First run hangs 1 to 3 minutes | Model downloading (about 3 GB) | Wait. Check the model cache. It is cached after the first run. |
| Overlay stuck loading then errors, or the OS freezes | Not enough RAM for the 4B | Use `QWEN3_1_7B_INST_Q4`, or run on a machine with 16 GB or more. |
| "The model returned malformed JSON" | Model wrapped output in prose or markdown | Strip `<think>` and code fences, then extract the `{...}`. The built-in fallback captions keep the storybook working. |
| Face lands off-center or tiny in the art | Photo is not front-facing, or a warm background fooled the skin-tone crop | Use a clear front-facing photo; tune the crop padding, or swap in an on-device face detector (see How to extend). |

---

QVAC is Apache 2.0. If you build something with this recipe, star the repo at github.com/tetherto/qvac or share on X with @qvac.
