# QVAC Realtime Vision

Point your webcam at the world and watch a local AI understand it in real time: it draws boxes
around objects, tracks your hands and reads your gestures, and writes a one-sentence description
of the scene. Then flip into one of two mini-games that you play with your body, no controller.
Everything, the detection, the hand tracking, and the narration, runs on your own machine
through the QVAC SDK. No cloud, no API keys, and after a one-time model download, no network.

> **This is an example, not a product.** It is a self-contained prototype that shows what the
> QVAC SDK makes possible. It ships as-is, with **no support, no warranty, and no SLA**. See
> [About this example](#about-this-example).

## What you get

Three modes, one shared on-device vision pipeline:

- **Live Detection.** A fast object detector draws boxes for about 110 everyday classes (person,
  phone, laptop, glasses, bottle, and so on). A hand model adds a hand box plus 21 keypoints, and
  the gesture (thumbs up, peace, point, fist, open palm, rock) is derived from the keypoint
  geometry. A vision-language model writes one neutral sentence describing the scene. Boxes are
  colour-coded by category.
- **AI Slash.** Falling icons (a robot, a pear, a lock, a shield, a phone) drop down the screen.
  Your index fingertip, tracked by the hand model, is the blade: swipe through an icon to slice it.
  Thirty seconds, one score, a local high-score table.
- **Head Stack.** Branded blocks (QVAC, Keet, Pears, WDK) fall one by one. The object detector
  finds your head and you move it to catch each block and balance the stack. Realistic physics:
  a block held by a tiny corner tips off. Stack as high as you can before the timer ends.

The high scores for both games are kept locally in your browser. Nothing about the games, the
camera, or the scores ever leaves the machine.

## Why local AI matters here

A camera is the most personal sensor you own. Anything that watches a live video feed, a webcam
toy, an accessibility aid, a retail or kiosk display, a kids' game, is exactly the kind of thing
you do not want streaming frames to someone else's servers. Running the vision models on-device
removes the problem at the root: the frames are processed where they are captured and are never
uploaded. This example is a small, honest demonstration of that pattern, fast enough to be fun.

## Architecture

A small ensemble, each model on the QVAC engine it is best suited to, glued together in the
browser in real time.

| Task | Model | QVAC engine | Speed |
|------|-------|-------------|-------|
| Object detection (open-vocab, ~110 classes) | YOLO-World (ONNX) | `@qvac/onnx` (CoreML on macOS, DirectML on Windows) | ~35 ms |
| Hands and gestures (21 keypoints) | YOLO hand-pose (ONNX) | `@qvac/onnx` (GPU) | ~8 ms |
| Scene narration | Qwen3-VL 2B (GGUF) | `@qvac/sdk` running llama.cpp | ~1.3 s |
| Box smoothing (not AI) | EMA (exponential moving average) | in the browser, no model, no library | 60 fps |

```
webcam (browser)
  |--> POST :3085/detect   --> detector.mjs --> @qvac/onnx --> YOLO-World + hand-pose --> boxes + keypoints
  '--> POST :3080/api/look --> server.js    --> @qvac/sdk  --> Qwen3-VL 2B --> one-sentence narration
        client: tracker + EMA smoothing + colour-coded overlay + gesture classification + games
```

The detector is fast and precise, so it owns the boxes and the hand or head tracking that the
games need. The vision-language model does the one thing a 2B model does well here: write a
single clean sentence about the scene. Between detections, a plain EMA eases each box toward its
latest position so nothing jumps. The EMA is ordinary browser math: not AI, no model, no library.

## Requirements

- **Node.js 20 or higher.**
- **Python 3.11 or 3.12** once, only to generate the two ONNX models (see below).
- A **GPU-capable machine** (Apple Silicon with CoreML, or Windows with DirectML). CPU works but
  is slower.
- A **webcam**, and a browser you can grant camera access to.
- **About 2 GB free disk** for the vision-language model, downloaded once on first run and cached.
- An **internet connection on first run only**, to download that model. Everything else, including
  all fonts and logos, is vendored locally.

## Setup

### 1. Generate the two ONNX models

The object and hand models are Ultralytics-derived (AGPL-3.0), so they are not shipped with this
Apache-2.0 example. You generate them once with the scripts in `models/export/`. Full steps are in
[`models/README.md`](./models/README.md). In short:

```bash
cd models/export
uv venv --python 3.11 venv
uv pip install --python venv/bin/python ultralytics onnx onnxslim onnxruntime
uv pip install --python venv/bin/python "git+https://github.com/ultralytics/CLIP.git" ftfy regex
./venv/bin/python export-yolo-world.py && mv yolov8*-worldv2.onnx ../yolo-world.onnx
```

The object model is a single export. The hand model is more involved: it is a 21-keypoint
YOLO-pose model, so unless you already have one, you train it first (for example on Ultralytics'
`hand-keypoints` dataset) and then export it to `../yolo_hand_pose.onnx`. Both steps are spelled
out in [`models/README.md`](./models/README.md).

When both files are in place, `models/` contains `yolo-world.onnx` and `yolo_hand_pose.onnx`.

### 2. Install and run

```bash
npm install      # installs the QVAC SDK and native engines for your OS
                 # (on Windows, a postinstall step also sets up the OpenSSL DLLs the VLM needs)
npm start        # starts the VLM + UI server (:3080) and auto-launches the ONNX detector (:3085)
```

Open **http://localhost:3080**, click **Start**, and allow the camera. On the first Start, the
QVAC SDK downloads the Qwen3-VL model (about 2 GB, once, into your home folder, not the project).
From a phone on the same network, open `http://<your-computer-ip>:3080` (the server listens on
`0.0.0.0`).

## Verify it is all QVAC

Every piece of AI inference runs on the QVAC SDK. You can check it live:

```bash
curl http://localhost:3080/api/engines   # which QVAC engine each model uses, plus execution providers
curl http://localhost:3085/health        # the detector engine and its live ONNX providers
```

`/api/engines` reports, in real time, that object detection and hands run on `@qvac/onnx`, that
narration runs on `@qvac/sdk` (llama.cpp), and that there is no other inference engine. The only
non-AI helper is the browser-side EMA box smoothing, which runs no model and loads no library.

## Running offline

After the first run has cached the vision-language model, the app works with the network fully
disconnected:

- The two ONNX models are local files you generated, loaded from `models/`.
- The vision-language model is served from the QVAC cache in your home folder.
- The UI loads no external CDN: the font (Geist) and the logos are vendored under `public/vendor/`.
- Camera frames are processed on-device and are never sent anywhere.

## Project layout

| Path | Role |
|------|------|
| `server.js` | Express server on `:3080`. Serves the UI and runs Qwen3-VL via `@qvac/sdk`. Endpoints: `/api/look` (narration), `/api/health`, `/api/engines` (the QVAC proof). Spawns the detector. |
| `detector/detector.mjs` | Bare service on `:3085` using `@qvac/onnx`. Loads `models/yolo-world.onnx` and `models/yolo_hand_pose.onnx`. `POST /detect` returns boxes, hands, and keypoints. |
| `public/index.html`, `public/app.js` | UI, webcam capture, tracker, EMA smoothing, colour-coded overlay, gesture classification, mode switching. |
| `public/games.js` | The two mini-games (AI Slash, Head Stack), pure canvas, driven by the detector output. |
| `public/vendor/` | Vendored font and logos. No external CDN. |
| `models/` | Where the two ONNX models go. Not committed: see `models/README.md`. |
| `scripts/postinstall.mjs` | On Windows, copies the two OpenSSL DLLs the VLM engine needs. No-op elsewhere. |

## How it works (and what it is not)

- Each webcam frame is sent two ways: a downscaled RGB buffer to the detector for boxes and
  hands, and a JPEG to the server for the narration. The detector runs many times per second; the
  narration runs about once per second.
- Only one inference per engine runs at a time (the GPU is shared). When an engine is busy the
  server returns `429`/`busy` and the client skips that frame, which keeps everything realtime.
- The narration is always neutral and factual. The vision-language model writes the sentence; it
  does not invent boxes. The boxes come from the detector.
- This is a demo of local-AI orchestration over a live camera, not production software and not an
  accessibility or safety device. Detections and narration can be wrong.

## About this example

This app lives in [`qvac-examples`](https://github.com/tetherto/qvac-examples), Tether's
open-source collection of focused prototypes that show what the QVAC SDK can do with local AI. It
is:

- **An example, not a product.** Small, readable, and meant to be run from clean.
- **Unsupported.** Provided as-is, with no support, warranty, or guarantees.
- **A starting point.** Fork it, read it, adapt it. The point is to make the local-AI pattern
  concrete.

## License

Code licensed under the Apache License, Version 2.0. See [LICENSE](./LICENSE).

This example depends on `@qvac/sdk` and `@qvac/onnx`, and at runtime it loads ONNX models you
generate with [Ultralytics](https://github.com/ultralytics/ultralytics) (**AGPL-3.0**) and the
Qwen3-VL model from the QVAC registry. Using it is subject to each of their respective licenses.
