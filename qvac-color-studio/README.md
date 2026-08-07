# QVAC Color Studio

A Korean-salon-style personal colour analysis that runs entirely on your own machine. Take a webcam photo, and a local vision model reads your skin undertone and season. Then drape twelve colours under your chin, one at a time, and read how each one sits on you. No cloud, no API keys, no photo upload.

Everything intelligent runs on your device. The reading — undertone, season, and a comment on each of the twelve colours — comes from a local Gemma 4 vision model via the QVAC SDK, in the Electron main process. The drape itself is canvas work in the renderer. Nothing touches the internet except the one-time model download.

> **This is an example, not a product.** It's a self-contained prototype that demonstrates what the QVAC SDK makes possible. It ships as-is, with **no support, no warranty, and no SLA**. See [About this example](#about-this-example).

## What you get

- **A colour reading of your own face.** Capture from the webcam (or upload a photo instead) and a local vision model returns your undertone, your season, and a verdict on all twelve drape colours in a single pass.
- **The drape, which is the whole point.** Click a swatch and a band of that colour appears under your chin over your own photo. The band runs edge to edge and starts at the jaw, so the top you happen to be wearing doesn't sit next to your face and skew the comparison.
- **Twelve colours, two groups.** Six cool and six warm, sorted by fit within each group — best matches first — each with a dot and a one-line comment about what that colour does to your face.
- **No model call per click.** The whole analysis arrives in one `completion()`. Clicking a swatch recolours a canvas and swaps a cached sentence; it never goes near the model.
- **Offline after first run.** Once the model is cached, the entire flow works with the network off. The face mesh runtime and weights are vendored into the app at install time, so nothing is fetched from a CDN either.

## How it works

```
┌───────────────────── Electron main process ─────────────────────┐
│  @qvac/sdk                                                       │
│    downloadAsset(...)  ── progress ──►  "models:progress"  ──┐   │
│                                                              │   │
│    ipcMain "analyze"  (the frozen still, as PNG bytes)       │   │
│      └─ withModel(vision):                                   │   │
│           loadModel  →  completion()  →  unloadModel          │   │
│           └─ parseAnalysis(): the reply, as a typed Analysis  │   │
└──────────────────────────────────────────────────────────┬───┴───┘
                     contextBridge (2 calls, 1 event stream)│
┌──────────────────────────── renderer ─────────────────────┴───────┐
│  webcam → freeze a 512×640 still                                   │
│  MediaPipe FaceMesh (CPU, once) → chin landmarks → drape geometry  │
│  canvas: composite the band, recoloured per swatch click           │
└────────────────────────────────────────────────────────────────────┘
```

Four steps, in order:

1. **Capture.** The webcam frame is frozen to a 512×640 still in the renderer. That one image is what everything downstream uses.
2. **Find the chin.** MediaPipe FaceMesh runs once over the still. From the chin and jaw landmarks the app computes a drape band — full frame width, starting just above the chin — and caches that geometry.
3. **Read the colours.** The still goes to the main process, which loads the vision model, makes one `completion()` call asking for strict JSON, and unloads. The reply carries the undertone, the season, a note on the skin, and a rating plus a sentence for each of the twelve colours.
4. **Drape.** Clicking a swatch recolours the cached band over the frozen still on a canvas and shows that colour's cached comment. No model involved.

The lifecycle is the part worth copying. `src/main/qvac.ts` routes every model call through one `withModel` helper that loads, runs, and unloads in a `finally`:

```
Capture  →  load vision  →  completion()  →  unload
```

One model, one call. The helper looks like overkill for that, and it is exactly what makes adding a second model safe: the one-model-at-a-time rule is structural rather than something to remember. Local text-to-speech would slot in without a rewrite (see the note at the foot of `qvac.ts`).

### The single analysis pass

Everything the UI needs arrives in one call, which is why the interactive part costs nothing. `parseAnalysis` in `src/main/analysis.ts` turns the reply into a typed `Analysis`: it strips fences and prose, matches loose colour names back onto real swatches (`"gold"` → `"Mustard/Gold"`), and derives the recommended and avoid lists from the ratings so the two can never disagree. Local models produce untidy JSON, so it also reads the fields individually when a strict parse fails.

If the reply isn't a reading at all, the app says so and offers a retake rather than filling twelve rows with invented verdicts — a plausible-looking analysis that means nothing would be the worst outcome here.

Treat every verdict as an estimate. It is a local model on your laptop, not a colour analyst.

### The prompt

`buildAnalysisPrompt` asks for one JSON object: the three scalar fields first, then the twelve colours last. A few things it does deliberately, which are worth keeping if you adapt it:

- The JSON example shows **real values for the enum fields** (`"cool"`, `"Winter"`, `"green"`) and `"..."` for the free-text ones. A small model treats a filled-in example sentence as the answer and repeats it.
- Each colour is listed **with its family** — `True Blue (cool)` — so the model doesn't reason from a wrong premise.
- Calibration is phrased as a **rule about consistency**: if the skin reads cool, most warm colours cannot also be a fit. Left open, the model marks almost everything a fit, which is no palette at all.
- `why` has its **own instruction** that it describes the skin, and the parser drops it if it comes back describing the rating scale instead.

### The drape

The QVAC SDK covers language, vision, diffusion and speech, but not face landmarks — so the chin comes from MediaPipe FaceMesh (`@mediapipe/tasks-vision`) in the renderer. Both its runtime and its weights are copied into the app bundle by `scripts/fetch-face-landmarker.mjs` at install time, so nothing is fetched from a CDN at runtime and the offline promise holds.

Detection runs once per capture, on the CPU delegate, and the geometry is cached for all twelve swatches. Re-detecting per click would make the band twitch between colours, and the GPU is better left to the vision model.

## Why local AI matters here

This app looks at your face. A cloud version would mean uploading a photo of yourself to a stranger's server for a novelty reading — not a trade most people would make twice. On-device it is free, private by construction, and instant after the first run. The photo reaches the Electron main process and stops there; the temp file the model reads is deleted as soon as it is done.

## What it currently runs

Everything the app loads, and the settings it loads it with. All of this lives in `src/main/qvac.ts`; if this section and that file ever disagree, the file wins.

**Vision model** — the only model the app loads.

```
modelSrc            GEMMA4_2B_MULTIMODAL_Q8_0            4737 MB
projectionModelSrc  MMPROJ_GEMMA4_2B_MULTIMODAL_Q8_0      532 MB
engine              llamacpp-completion (multimodal)
on disk             ~5.3 GB, cached in ~/.qvac/models/
```

**Load settings**

```
ctx_size     8192   the still plus this prompt is ~600 tokens, and a full
                    twelve-colour reply about 1200 more
device       gpu    Metal on Apple Silicon, Vulkan elsewhere
gpu_layers   99     offload every layer
temp         0.2    near-greedy — the reply is JSON, not prose
predict      1600   ample for twelve comments, and bounded
stream       false  the reply is one JSON object; half of one is no use
unload       clearStorage: false, so the weights stay cached
```

**Face landmarks** — not a QVAC model.

```
@mediapipe/tasks-vision   FaceLandmarker, delegate: "CPU", runningMode: "IMAGE"
face_landmarker.task      ~3.6 MB, fetched once by scripts/fetch-face-landmarker.mjs
```

**Built and tested against**

```
@qvac/sdk               0.16.0
@mediapipe/tasks-vision 1.0.1
electron                43.x
node                    22.17+ (25 verified)
hardware                MacBook Air M4, 16 GB, macOS
```

**Other models considered.** Gemma was chosen for consistency: it returns twelve distinct, colour-specific comments and keeps its warm/cool verdicts coherent across runs.

- `QWEN3VL_2B_MULTIMODAL_Q4_K` + projection (1.5 GB) — a reasonable alternative, and about twice as fast. Its per-colour comments are less consistent: they sometimes converge on one sentence per rating rather than per colour.
- `SMOLVLM2_500M_MULTIMODAL_Q8_0` (0.5 GB) — too small for a twelve-item structured reply.
- `QWEN3_5_2B_MULTIMODAL_Q8_0` (2.3 GB) — returned partial replies on this task.

Swapping means changing two constants in `src/main/qvac.ts` — the import and `REQUIRED_ASSETS` — and nothing else; the prompt and the parser are model-agnostic. Worth testing any swap against a real photo rather than an illustration, since the two give noticeably different results.

An earlier version also rendered a "full look" with `SD_V2_1_1B_Q8_0` img2img (2.3 GB, `sdcpp-generation`). It was cut: the drape does the same job instantly.

## Requirements

- **Node.js** 22.17 or higher (Node 25 verified)
- A GPU-capable machine. QVAC supports all three major platforms:
  - **macOS** (Apple Silicon) with Metal: primary target here
  - **Linux** (x64 or arm64) with a Vulkan-capable GPU: supported
  - **Windows** (x64) with a Vulkan-capable GPU: supported
  - CPU fallback works but inference is slow
- **A webcam**, or any photo of yourself to upload instead
- **About 6 GB free disk** for the model cache
- **No API keys**, no cloud account
- Verify the machine with `npx -y @qvac/sdk doctor` before running

## Recommended hardware

One resident vision model (see [What it currently runs](#what-it-currently-runs)). The face mesh and the drape compositing run on the CPU and canvas, so they add no meaningful GPU cost.

| | Minimum | Recommended |
|---|---|---|
| RAM | 8 GB (use the smaller model) | 16 GB or more |
| GPU | integrated / CPU fallback (slow) | Apple Silicon (Metal), or a discrete Vulkan GPU |
| Disk free | about 6 GB | about 8 GB |
| OS | macOS 14+, Windows 10+, Linux | same |

Tested on a MacBook Air M4 with 16 GB. The app's peak is one 5.3 GB model, and `withModel` keeps it that way as the app grows: any second model waits for the first to unload.

## Install & run

```bash
npm install     # also fetches the face-mesh runtime and weights
npm run dev
```

First launch downloads about **5.3 GB**, shown as real megabytes on a setup screen. That happens once; everything after is offline. The analysis itself takes roughly 40 seconds.

If `npm run dev` stops with `Error: Electron uninstall`, npm skipped Electron's own binary download:

```bash
node node_modules/electron/install.js
```

Other scripts:

```bash
npm run typecheck   # both TypeScript projects
npm run build       # typecheck, then bundle main + preload + renderer
npm run package     # a runnable app in out/
npm run make        # a distributable zip
```

## Project structure

```
qvac-color-studio/
├── electron.vite.config.ts   ← main / preload / renderer builds
├── forge.config.cjs          ← packaging via @qvac/sdk/electron-forge
├── qvac.config.json          ← SDK runtime config (download timeouts)
├── scripts/
│   └── fetch-face-landmarker.mjs   ← vendors the MediaPipe runtime + weights
└── src/
    ├── main/                 ← the ONLY place @qvac/sdk is used
    │   ├── qvac.ts             load → run → unload, and the one-model guard
    │   ├── analysis.ts         the vision prompt, and reading the reply
    │   └── index.ts            window, IPC, temp file for the still
    ├── preload/              ← contextBridge: 2 calls, 1 event stream
    ├── renderer/             ← React: webcam, face mesh, canvas, all the UI
    │   └── src/lib/            faceMesh.ts (chin), drape.ts (compositing)
    └── shared/               ← types and the twelve colours, used by both sides
```

The twelve colour names in `src/shared/palette.ts` are the join key between the swatch list, the model's reply and the palette lists, so they match verbatim everywhere.

## Running fully offline

After the first launch, pull the network and everything still works: the model is cached in `~/.qvac/models/`, and the face mesh runtime and weights live in the app bundle. The renderer's Content-Security-Policy has no remote origin in it, so a stray fetch would fail rather than quietly succeed.

`qvac.config.json` raises the SDK's download stall timeout and retry count, which suits a multi-gigabyte first download over an ordinary connection:

```json
{ "registryStreamTimeoutMs": 600000, "registryDownloadMaxRetries": 8 }
```

The SDK finds that file by walking up from the working directory, so `src/main/index.ts` sets the working directory to the app path before any model call.

## How to extend

- **Smaller download:** swap in `QWEN3VL_2B_MULTIMODAL_Q4_K` (1.5 GB), about twice as fast, with the trade-off noted above.
- **Read the verdict aloud:** QVAC has local text-to-speech. Build the commentary string, load a TTS model, play the audio. TTS is a second model, so it must load after the vision model unloads — `withModel` already guarantees that.
- **Stream the reading:** use `stream: true` and forward `tokenStream` over IPC to fill the swatch list as the model writes, instead of a spinner. That means parsing partial JSON.
- **The twelve-subtype seasonal system:** this app stops at the four seasons. Extending it means more swatches and a longer reply.

## Privacy & safety notes

- The still crosses the IPC bridge, because the model has to look at the face. It reaches the Electron main process and stops there. The temp file main writes — multimodal attachments take a path, not bytes — is deleted as soon as the model is done.
- No cloud fallback exists. If the local model can't produce a reading, the app says so and offers a retake; it never reaches out to a remote model.
- `contextIsolation: true`, `nodeIntegration: false`, and a Content-Security-Policy with no remote origin.
- Object URLs for the photo are tracked and revoked on unmount, so the capture doesn't outlive the session.

## About this example

This app is a **prototype and demonstration**, part of the [QVAC Examples](../README.md) collection. It is provided **as-is, with no support, no warranty, and no SLA**, is **not maintained as a product**, and is **not security-audited** — do not use it in production or with real, sensitive data. It exists to illustrate a use case and teach. See [LICENSE](./LICENSE) for the full Apache 2.0 terms.

It is also not a clinical or professional colour analysis, and the reading should not be treated as one.

## License

Code licensed under the Apache License, Version 2.0. See [LICENSE](./LICENSE).

This example depends on `@qvac/sdk` and `@mediapipe/tasks-vision` (**Apache-2.0**), and at runtime it loads the Gemma 4 model from the QVAC registry and the MediaPipe face-landmark weights. Using it is subject to each of their respective licenses.

Copyright © 2026 Tether Data, S.A. de C.V.
