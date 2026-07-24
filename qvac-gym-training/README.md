# QVAC Gym Training

A desktop app: drop a short video of one set — a bench press, a squat, a curl — and
a local vision-language model watches it and coaches your form: what you are doing
well, and what to work on. The video is turned into frames inside the app and read by
Qwen3.5-VL 4B running entirely on your own machine through the QVAC SDK. No cloud, no
API keys, and after a one-time model download, no network. Your video never leaves the
device.

> **This is an example, not a product.** It is a self-contained prototype that shows
> what the QVAC SDK makes possible. It ships as-is, with **no support, no warranty, and
> no SLA**, and it is **not** a substitute for a qualified coach.

## What you get

An Electron desktop window with a three-step flow:

1. **Upload.** Drop or pick a clip of a single set, filmed from the side (10–30s works
   best). It is validated in the app — type, size, and length.
2. **Analysis.** The app samples ten evenly spaced frames from the clip on a `<canvas>`,
   downscales them, and hands the JPEG bytes to the main process. Nothing is uploaded.
3. **Results.** Your clip replays on the left; on the right the model's feedback stacks in
   two short lists — **Strengths** in green and **Work on this** in amber — plus its best
   guess at the exercise. Each line is a plain, direct cue.

## Why local AI matters here

A training video is you, half-dressed, in your home or gym. It is exactly the kind of
footage you do not want sitting on someone else's servers to get a bit of form feedback.
Here the frames are created and read on the same machine and are never uploaded. That is
the whole point of running the model on-device.

## Architecture

A single Electron app. The **main process** loads the model and runs inference through
`@qvac/sdk`; the **renderer** is the UI and does the frame sampling. They talk over a
small preload bridge (IPC) — the video file itself never crosses it, only the sampled
frames.

| Piece | Runs in | Detail |
|-------|---------|--------|
| Frame sampling (not AI) | renderer | browser `<canvas>`, no model, no library |
| Form analysis | main process | Qwen3.5-VL 4B (GGUF, Q4_K_M) via `@qvac/sdk` (llama.cpp) |

```
video (renderer)
  '--> sample 10 frames on a <canvas>  --IPC-->  main process
        --> @qvac/sdk --> Qwen3.5-VL 4B --> { exercise, strengths, improvements }
```

The model is chosen as the sweet spot for a 16 GB machine: about 3.4 GB on disk with its
vision projector, small enough to run comfortably yet strong enough to reason about a
lift across a sequence of frames. All ten frames go to the model in a single completion,
read as one ordered movement, and the reply is grammar-constrained to valid JSON.

## Requirements

- **Node.js 20 or higher.**
- A **GPU-capable machine** helps (Apple Silicon / Windows with a discrete GPU); CPU
  works but is slower.
- **About 3.5 GB free disk** for the model, downloaded once on first launch and cached in
  your home folder (not the project).
- An **internet connection on first run only**, to download that model.

## Recommended hardware

Everything runs on your machine, so the model files and your RAM are what matter. The first run downloads the model once (about 3.6 GB) into a shared `~/.qvac` cache, then it works fully offline.

|           | Minimum                          | Recommended                                               |
| --------- | -------------------------------- | --------------------------------------------------------- |
| RAM       | 16 GB                            | 16 GB or more                                             |
| Free disk | ~3.6 GB (one-time model download) |                                                          |
| GPU       | works on CPU (slower)            | Apple Silicon (Metal), or a Vulkan GPU on Windows / Linux |
| OS        | macOS 13+, Windows 10+, or Linux |                                                           |
| Runtime   | Node.js 20+                      |                                                           |

Models downloaded on first run (cached in `~/.qvac`, about 3.6 GB total):

- **Qwen3.5-4B multimodal (VLM)**, Q4_K_M, ~2.7 GB. Reads the video frames and writes the coaching feedback.
- **Qwen3.5-4B vision projector** (mmproj), F16, ~0.8 GB. The image encoder the VLM needs.

You provide a short video (no webcam needed). One model runs at a time on the GPU; on a CPU-only machine it still works, each check just takes longer.

Not sure your machine can handle it? Run `npx -y @qvac/cli doctor` to check.

## Setup

```bash
npm install      # installs the QVAC SDK, its native engine, and Electron
npm run warmup   # optional: pre-download the model (~3.4 GB) before first launch
npm start        # launches the desktop app
```

On first launch the app shows a "getting the model ready" screen while it downloads
(~3.4 GB, once) and loads into memory. After that it opens straight to the drop screen.
Drop a side-on clip of one set and wait for the two columns of feedback.

## Build it yourself

Want to build this from scratch with your own AI coding agent? See [`RECIPE.md`](./RECIPE.md).
It pins the exact QVAC SDK calls — the one part an agent cannot guess — and guides the rest.

## Notes and limits

- **One camera angle at a time.** A side view is best for bar path, range of motion, and
  joint stacking. A small model reading stills is a coach's rough first pass, not a
  biomechanics lab.
- **Frames, not motion.** The model sees ten stills, not the full video, so very fast
  movements between frames can be missed. Shorter clips of a single set give the cleanest
  read.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](../LICENSE).

This example depends on `@qvac/sdk` and, at runtime, downloads the Qwen3.5-VL model from
the QVAC registry. Using it is subject to their respective licenses.

Copyright © 2026 Tether Data, S.A. de C.V.
