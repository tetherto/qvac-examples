# QVAC Image Generation Demo

<picture>
  <source media="(prefers-color-scheme: dark)"  srcset="docs/badges/built-with-qvac-dark-mode-landscape.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/badges/built-with-qvac-light-mode-landscape.svg">
  <img alt="Built with QVAC" src="docs/badges/built-with-qvac-light-mode-landscape.svg" width="200">
</picture>

Type a sentence, get an image, on your own computer. A small local web app for text-to-image on
the [QVAC SDK](https://github.com/tetherto/qvac), with three models: FLUX.2 [klein] 4B, SDXL 1.0
and Stable Diffusion 2.1. Nothing is uploaded, no account, no API key, and it works offline once a
model is downloaded.

Built for a booth screen: one field, six prompt ideas, six styles, one button, and a screen that
clears itself after two minutes without a touch. A Settings panel, closed by default, has the
model, steps, size and seed.

## Quickstart

```bash
npm install
npm start
# open http://localhost:3098
```

On first run the page shows a **Download FLUX.2 klein 4B (5.1 GB)** button. It fetches the model
files into `~/.qvac/models`, where every QVAC app shares them, then loads the model. Nothing is
downloaded without a click. On later runs FLUX loads on its own when the server starts. Pick
another model in Settings and the page offers its own Download button.

| Setting | Default | Change it with |
|---|---|---|
| Port | 3098 | `PORT=4000 npm start` |
| Address | `127.0.0.1`, this computer only | `HOST=0.0.0.0 npm start` to open it to your network |
| Booth reset | 120 s without a touch | `?idle=300` in the URL, `?idle=0` to turn it off |

## The models

| Model | Download | Default | Range | Time on an Apple M5 Max |
|---|---|---|---|---|
| FLUX.2 klein 4B (default) | 5.1 GB: diffusion model, Qwen3 4B text encoder, VAE | 768 px, 4 steps | 512 to 1024 px, 1 to 12 steps | about 11 s |
| SDXL 1.0 | 3.9 GB | 1024 px, 30 steps | 768 or 1024 px, 10 to 50 steps | about 70 to 95 s |
| SD 2.1 | 2.3 GB | 768 px, 30 steps | 512 or 768 px, 10 to 50 steps | about 40 s (512 px: about 12 to 19 s, weaker) |

Each model gets the settings it was trained for: its native size, its usual number of steps, and
its guidance (FLUX is guidance-distilled and runs at `cfg_scale: 1`, the two Stable Diffusion
models at 7). Choosing a model resets the size and steps to its defaults. One model is in memory
at a time: generating with another one unloads the current model and loads the new one first.
A fixed seed gives the same image again (the same settings and prompt return identical bytes).

## What it shows

- **Text to image on device.** FLUX.2 [klein] 4B is a split model: the diffusion model, a Qwen3 4B
  text encoder and a VAE decoder, loaded together as one QVAC model.
- **Four steps are enough for FLUX.** The model is distilled, so 768 x 768 in 4 steps comes out
  clean. 8 steps doubles the time with no visible gain.
- **A queue, not an error.** One image renders at a time; a second visitor sees how many images are
  ahead of theirs.
- **A word filter for public screens.** The model has no safety filter of its own, so obvious
  requests are refused before they reach it (`lib/prompts.mjs`). It is a short list, not a
  guarantee: keep an eye on a public screen.

## Recommended hardware

| | Requirement |
|---|---|
| **RAM** | 16 GB or more. The app's processes peaked at 3.5 GB during a FLUX generation on an M5 Max; SDXL at 1024 px needs more |
| **Disk** | About 7.5 GB with FLUX only: 2.4 GB for `node_modules` and 5.1 GB of model files in `~/.qvac/models/`. SDXL adds 3.9 GB, SD 2.1 adds 2.3 GB |
| **GPU** | Apple Silicon (Metal). Linux and Windows with a Vulkan GPU should work but have not been tested |
| **Speed** | Apple M5 Max, 36 GB: FLUX loads in 27 s the first time, then about 11 s per 768 x 768 image. See the model table for the others |

## Requirements

- **Node.js** 22.17 or higher
- macOS on Apple Silicon (tested). The QVAC SDK also runs on Linux and Windows with Vulkan

## Files

| File | What it does |
|---|---|
| `server.js` | HTTP server, the three models and their settings, download, load and switch, the generation queue, streaming progress |
| `lib/prompts.mjs` | The six styles, the six prompt ideas and the word filter |
| `public/` | The page: `index.html`, `app.css`, `app.js`, fonts and badge |
| `out/` | Generated images, one PNG each (ignored by git) |

## Licences

The code is Apache 2.0. FLUX.2 [klein] 4B and Qwen3 4B are published under Apache 2.0 by their
authors; SDXL 1.0 and Stable Diffusion 2.1 under the CreativeML Open RAIL++-M licence. The files
are downloaded from Hugging Face by the QVAC SDK, not shipped here. The
Geist font is under the SIL Open Font License (`public/assets/Geist-OFL.txt`).
