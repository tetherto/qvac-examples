# QVAC Smart Camera

Point a camera at a doorway, a driveway, or a parking spot and watch a local AI understand what
it sees. It draws boxes around people, vehicles, animals, and bags, and for every person it
reaches a **risk verdict on-device**: a resident walking up in daylight and unlocking the door
reads as **normal**, while a masked stranger prowling a parked car at night is flagged
**high risk** and raises an alarm. Detection, reasoning, and the alarm all run on your own
machine through the QVAC SDK. No cloud, no API keys, and no frame ever leaves the device.

> **This is an example, not a product.** It is a self-contained prototype showing what the QVAC
> SDK can do. It is **not a QVAC or Tether product**, is **not a real security or surveillance
> system**, and ships **as-is with no support, no warranty, and no SLA**. Do not rely on it to
> protect people or property. **You alone are responsible for how you use it**, including
> complying with all applicable privacy, recording, and surveillance laws and obtaining any
> consent required. See [About this example](#about-this-example).

## What you get

A single page, one shared on-device pipeline:

- **Source.** Load a video file (a doorway, driveway, street, or nature clip) or point a webcam
  at a scene. Nobody has to be on camera to try it.
- **Watch list.** Toggle what you care about: People, Vehicles, Animals, Bags & packages.
- **Live boxes.** A fast object detector draws colour-coded boxes for the COCO classes as they
  move through the frame.
- **Risk verdict.** When a person appears, a vision-language model judges the scene and the app
  reacts:
  - **Normal** (calm, green): a resident coming home, everyday daytime activity. No alarm.
  - **High risk** (red alarm): a masked or hooded person lurking at a car or door, or someone
    prowling at night. An on-screen alert, a border flash, and an alarm sound fire at once.
- **Alert feed.** Every event is logged with a timestamp, a cropped thumbnail, the object label,
  and a one-sentence on-device description of what happened.

## How it works

Two QVAC models cooperate, both 100% on-device:

| Job | Model | QVAC engine |
|-----|-------|-------------|
| Object boxes (people, vehicles, animals, bags) | **YOLOv10-M** (ONNX, COCO-80) | `@qvac/onnx` (CoreML / DirectML GPU) |
| Risk verdict + scene description | **Qwen3-VL 2B** (GGUF) | `@qvac/sdk` → llama.cpp |

The risk verdict is a **hybrid** so it stays reliable on a small model:

1. The vision-language model is asked for `RISK: NORMAL | ALERT` plus a one-line reason.
2. A deterministic rule also fires an alert when the browser sees a person **right next to a
   vehicle** **at night** (night is inferred from the average brightness of the frame). This
   guarantees the alarm triggers on the classic "someone at the car in the dark" case even when
   the small model is too conservative, while the model still writes the human-readable reason.

The browser does only box smoothing and the day/night brightness check. Nothing else runs
outside QVAC, and the page loads no external CDN. Verify it yourself at
`http://localhost:3080/api/engines`.

## Run it

```bash
npm install
```

Generate the object model once (Ultralytics, AGPL-3.0 — see [`models/README.md`](./models/README.md)):

```bash
cd models/export
uv venv --python 3.11 venv
uv pip install --python venv/bin/python ultralytics onnx onnxslim onnxruntime
./venv/bin/python export-yolov10.py
mv yolov10*.onnx ../yolov10m.onnx
cd ../..
```

Then:

```bash
npm start
```

Open **http://localhost:3080**. Choose a video file (or a webcam), pick what to alert on, and
start monitoring. The Qwen3-VL model downloads once from the QVAC registry on first run (~2 GB),
then the app runs offline.

Tips:

- For a clean "intruder at night" run, leave **People** and **Vehicles** on; a low-light frame
  can occasionally give a low-confidence stray label on other categories.
- Turn on **Sound** to hear the alarm.

## Footage

You do not need to appear on camera. Use a webcam pointed at a static scene (a doorway, a
window, a desk) and stage a couple of events, or drop in any video clip. Make sure you have the
right to record and process whatever you point it at.

## About this example

This app lives in [`qvac-examples`](https://github.com/tetherto/qvac-examples), Tether's
open-source collection of focused prototypes that show what the QVAC SDK can do with local AI.
It is:

- **An example, not a product.** Small, readable, and meant to be run from clean.
- **Not a security system.** It is a demonstration of on-device vision, not a safety device.
  Do not depend on it.
- **Unsupported.** Provided as-is, with no support, warranty, or guarantees.
- **Your responsibility to use lawfully.** Cameras, recording, and object recognition are
  regulated differently everywhere. Complying with privacy, recording, and surveillance law,
  and getting any required consent, is on you.
- **A starting point.** Fork it, read it, adapt it. The point is to make the local-AI pattern
  concrete.

## License

Code licensed under the Apache License, Version 2.0. See [LICENSE](./LICENSE).

This example depends on `@qvac/sdk` and `@qvac/onnx`, and at runtime it loads an ONNX model you
generate with [Ultralytics](https://github.com/ultralytics/ultralytics) (**AGPL-3.0**) and the
Qwen3-VL model from the QVAC registry. Using it is subject to each of their respective licenses.

## About QVAC

QVAC is an open-source, cross-platform ecosystem for building local-first, peer-to-peer AI
applications. With QVAC you can run AI tasks like LLMs, vision, speech, and RAG locally across
Linux, macOS, Windows, Android, and iOS. Learn more at [qvac.tether.io](https://qvac.tether.io).
