# QVAC Story Image Generator

Turn a child into the hero of an illustrated storybook — written and drawn entirely on your own machine. Pick a photo, pick a tale, and a local AI writes a five-scene story while the app paints each scene around the child's face. No cloud, no API keys, no photo upload.

Everything intelligent runs on your device. The story text (the five scene captions) is written by a local Qwen3 model via the QVAC SDK — 100% on-device: no cloud AI, no per-token cost, no prompt logging on someone else's servers. The artwork is hand-drawn SVG, generated in the renderer, with the child's photo composited into the character's face. For the core experience, nothing touches the internet except the one-time model download.

> **This is an example, not a product.** It's a self-contained prototype that demonstrates what the QVAC SDK makes possible. It ships as-is, with **no support, no warranty, and no SLA**. See [About this example](#about-this-example).

## What you get

- **A storybook starring your child.** Add a front-facing photo and it's composited into the hero of the tale — a lion cub on the golden plains, a wanderer in an enchanted castle, a traveler in a frozen kingdom — across five illustrated scenes.
- **The words are written locally.** The chosen story and character are sent to a local Qwen3 model (via the QVAC SDK, in the Electron main process), which writes five short, gentle, age-appropriate captions on-device. The picture and the prose are both made on your machine.
- **Three tales, two roles each.** *The Brave Little Lion*, *The Enchanted Castle*, and *The Snow Queen* — each lets the child play one of two characters, changing the artwork.
- **Privacy you can see.** The photo is read with `FileReader` and **never crosses the IPC bridge** — only the story name and character name ever reach the model. The app is served from a `127.0.0.1`-only static server that isn't reachable from the network.
- **Offline after first run.** Once the model is cached, the whole flow — writing and drawing — works with the network off. The download overlay reflects the real model download/load progress reported by the SDK.

## Screenshots

> **A potential look, not a fixed design.** These shots give a visual idea of where the app ends up. Layout, copy, or styling you produce may differ slightly — that's expected.

_(Add screenshots to `docs/screenshots/` once you've run the app.)_

## How it works

```
┌─────────────────────────────── Electron main process ───────────────────────────────┐
│  @qvac/sdk (dynamic import)                                                            │
│    loadModel(Qwen3 4B) ── onProgress ──► "model-progress" IPC ──► download overlay     │
│    ipcMain "generate-captions"  (story name + character name only — never the photo)   │
│        └─ completion() ─► strip <think>, parse JSON ─► ["scene 1", … "scene 5"]         │
└───────────────────────────────────────────────────────────────────────────────────────┘
                                   ▲ preload bridge (generateCaptions, onModelProgress)
┌──────────────────────────────────── Renderer (React) ──────────────────────────────────┐
│  welcome → photo → choose story → generating → storybook                                 │
│  photo: FileReader → data URL, kept in renderer memory only                              │
│  story-art.js: deterministic SVG scenes; child's face clipped into the character         │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

The five-screen flow is plain React state — no router, no login. The "painting" animation paces the scenes while the model writes; if the model is unavailable, the app falls back to built-in captions so the demo still runs.

## Why local AI matters here

A child's photo is exactly the kind of data you should not hand to a cloud service. A "make my kid the hero of a story" toy is delightful — but only if the photo never leaves the device and there's no account, no upload, and no bill. Running the model on-device removes the privacy problem at the root: the only thing that ever reaches the AI is two short strings (the story and the character), and the picture is assembled locally from a photo that stays in the renderer's memory. This example is a small, honest demonstration of that pattern.

## Requirements

- **Node.js 22.17 or higher**
- A **GPU-capable machine** (macOS Apple Silicon, Linux with Vulkan, or Windows with Vulkan). CPU fallback works but is slow.
- **~3 GB free disk** for the model cache (Qwen3 4B Q4_K_M, downloaded and cached on first run)
- An **internet connection on first run** — only to download the model (about 3 GB), which is cached afterwards. The front-end libraries (React) are vendored locally, so nothing else touches the network.

Check your machine first (the doctor command lives in the separate `@qvac/cli` package, not in the SDK):

```bash
npx -y @qvac/cli doctor
```

> On an 8 GB machine, swap the model for the smaller `QWEN3_1_7B_INST_Q4` in `main.js` (see [How to extend](#how-to-extend)).

## Recommended hardware

Everything runs on your machine. The first run downloads the model once (about 2.3 GB) into a shared `~/.qvac` cache, then it works fully offline. The illustrations are drawn as SVG inside the app, so there is no image model to download.

|           | Minimum                          | Recommended                                               |
| --------- | -------------------------------- | --------------------------------------------------------- |
| RAM       | 8 GB (with the 1.7B model)       | 16 GB (default 4B model)                                  |
| Free disk | ~2.3 GB (one-time model download) |                                                          |
| GPU       | works on CPU (slower)            | Apple Silicon (Metal), or a Vulkan GPU on Windows / Linux |
| OS        | macOS 13+, Windows 10+, or Linux |                                                           |
| Runtime   | Node.js 22.17+                   |                                                           |

Model downloaded on first run (cached in `~/.qvac`, about 2.3 GB):

- **Qwen3-4B Instruct**, Q4_K_M, ~2.3 GB. Writes the five story captions. On an 8 GB machine, swap it for the smaller `QWEN3_1_7B_INST_Q4` in `main.js`.

The child's photo never reaches the model or the network. It is composited into the SVG artwork locally.

## Install & run

```bash
npm install
npm start
```

`npm start` runs the build step first (`prestart`), which vendors React into `renderer/vendor/` and transpiles `renderer/app.jsx` to `renderer/app.js`, then launches Electron. A desktop window opens — there's no URL to browse to.

The first time you click **Start**, the model downloads (about 3 GB) and loads; the overlay shows real progress. After that it's cached and the app is fully offline.

## Project structure

```
qvac-story-image-generator/
├── package.json
├── main.js              ← Electron main: dynamic-import @qvac/sdk, load Qwen3,
│                          IPC "generate-captions", 127.0.0.1 static server
├── preload.js           ← contextBridge: generateCaptions + model progress (no photo)
├── scripts/
│   └── build.js         ← vendor React + transpile JSX (makes the app 100% local)
└── renderer/
    ├── index.html       ← loads vendored React + the UI
    ├── colors_and_type.css ← QVAC design-system foundations (colors, type)
    ├── story.css        ← reset + keyframes
    ├── story-art.js     ← STORIES data + deterministic SVG scene/character art
    ├── app.jsx          ← the five-screen React app (transpiled to app.js at build)
    ├── assets/qvac-logo.svg
    └── fonts/           ← self-hosted Inter + Inconsolata (woff2)
```

## Running fully offline

After the one-time model download, turn your network off and the app still works end to end: the model runs locally, the captions are written locally, and the art is drawn locally. The only network use anywhere is the initial model fetch into the QVAC cache.

## How to extend

- **Low-RAM machines:** in `main.js`, swap `QWEN3_4B_INST_Q4_K_M` for `QWEN3_1_7B_INST_Q4`. Smaller download, fits 8 GB, slightly weaker prose.
- **Stream the writing:** use the streaming completion (`completion({ …, stream: true })`) and forward `tokenStream` over IPC to reveal the story as it's written.
- **More tales:** add an entry to `STORIES` in `renderer/story-art.js` and a matching `*Scene` SVG generator. The caption prompt and the whole flow pick it up automatically.
- **Real export:** wire **Save** to write the rendered SVG (or a rasterized PNG) to disk — all local.

## Privacy & safety notes

- The photo never leaves the renderer. The preload bridge exposes only `generateCaptions(story, character)` and the model-status subscription — there is no API that can send the image anywhere.
- No cloud fallback exists. If the local model can't load, the app uses built-in captions; it never reaches out to a remote model.
- The app is served from a `127.0.0.1`-only static server with `contextIsolation: true` and `nodeIntegration: false`.

## About this example

This app is a **prototype and demonstration**, part of the [QVAC Examples](../README.md) collection. It is provided **as-is, with no support, no warranty, and no SLA**, is **not maintained as a product**, and is **not security-audited** — do not use it in production or with real, sensitive data. It exists to illustrate a use case and teach. See [LICENSE](./LICENSE) for the full Apache 2.0 terms.

Copyright © 2026 Tether Data, S.A. de C.V.
