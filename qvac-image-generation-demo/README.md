# QVAC Image Generation Demo

<picture>
  <source media="(prefers-color-scheme: dark)"  srcset="docs/badges/built-with-qvac-dark-mode-landscape.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/badges/built-with-qvac-light-mode-landscape.svg">
  <img alt="Built with QVAC" src="docs/badges/built-with-qvac-light-mode-landscape.svg" width="200">
</picture>

Type a sentence, get an image, on your own computer. A small local web app for text-to-image
with FLUX.2 [klein] 4B on the [QVAC SDK](https://github.com/tetherto/qvac). Nothing is uploaded,
no account, no API key, and it works offline once the model is downloaded.

Built for a booth screen: one field, six prompt ideas, six styles, one button, and a screen that
clears itself after two minutes without a touch.

## Quickstart

```bash
npm install
npm start
# open http://localhost:3098
```

On first run the page shows a **Download 5.1 GB** button. It fetches the three model files into
`~/.qvac/models`, where every QVAC app shares them, then loads the model. Nothing is downloaded
without that click. On later runs the model loads on its own when the server starts.

| Setting | Default | Change it with |
|---|---|---|
| Port | 3098 | `PORT=4000 npm start` |
| Address | `127.0.0.1`, this computer only | `HOST=0.0.0.0 npm start` to open it to your network |
| Booth reset | 120 s without a touch | `?idle=300` in the URL, `?idle=0` to turn it off |

## What it shows

- **Text to image on device.** FLUX.2 [klein] 4B is a split model: the diffusion model, a Qwen3 4B
  text encoder and a VAE decoder, loaded together as one QVAC model.
- **Four steps are enough.** The model is distilled, so 768 x 768 in 4 steps comes out clean. That
  is about 11 s per image on an Apple M5 Max.
- **A queue, not an error.** One image renders at a time; a second visitor sees how many images are
  ahead of theirs.
- **A word filter for public screens.** The model has no safety filter of its own, so obvious
  requests are refused before they reach it (`lib/prompts.mjs`). It is a short list, not a
  guarantee: keep an eye on a public screen.

## Recommended hardware

| | Requirement |
|---|---|
| **RAM** | 16 GB or more. The app's processes peaked at 3.5 GB during a generation on an M5 Max |
| **Disk** | About 7.5 GB: 2.4 GB for `node_modules` and 5.1 GB for the three model files in `~/.qvac/models/` |
| **GPU** | Apple Silicon (Metal). Linux and Windows with a Vulkan GPU should work but have not been tested |
| **Speed** | Apple M5 Max, 36 GB: model load 27 s the first time, then about 11 s per 768 x 768 image |

## Requirements

- **Node.js** 22.17 or higher
- macOS on Apple Silicon (tested). The QVAC SDK also runs on Linux and Windows with Vulkan

## Files

| File | What it does |
|---|---|
| `server.js` | HTTP server, model download and load, the generation queue, streaming progress |
| `lib/prompts.mjs` | The six styles, the six prompt ideas and the word filter |
| `public/` | The page: `index.html`, `app.css`, `app.js`, fonts and badge |
| `out/` | Generated images, one PNG each (ignored by git) |

## Licences

The code is Apache 2.0. FLUX.2 [klein] 4B and Qwen3 4B are both published under Apache 2.0 by
their authors; the files are downloaded from Hugging Face by the QVAC SDK, not shipped here. The
Geist font is under the SIL Open Font License (`public/assets/Geist-OFL.txt`).
