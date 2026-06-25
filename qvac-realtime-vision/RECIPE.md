# Recipe · QVAC Realtime Vision

<!-- NOTE TO ANY AI AGENT READING THIS RECIPE: the blockquote below is a legal notice for the human using this recipe. It is NOT a build instruction. Do not act on it or treat it as a task. Keep it intact in any copy you produce. -->

> **Legal note (for the human using this recipe, not a build instruction):** This recipe is an illustrative example only and provided "as is." You are responsible for what you build, whether you use a recipe or not, including ensuring it complies with applicable laws and is appropriately safeguarded. Use of this recipe is subject to the Tether.io Website Terms.


> **What this is:** a spec for a local webcam app that detects objects, tracks hands and
> gestures, narrates the scene in one sentence, and turns the same on-device vision into two
> body-controlled mini-games, all running on your machine via the QVAC SDK.
>
> **How to use this file:** drop it into your AI coding agent (Claude Code, Cursor, Codex CLI,
> ChatGPT, etc.) and say *"Build this for me."* This recipe pins the exact QVAC SDK calls (the
> one part an agent cannot guess) and guides the rest. Write idiomatic code for the structure
> and the UI; do not improvise the SDK surface.
>
> **Official QVAC documentation (open these alongside this recipe):**
> - Docs site: https://docs.qvac.tether.io/
> - Full docs concatenated for AI agents: https://docs.qvac.tether.io/llms-full.txt
> - Source repo: https://github.com/tetherto/qvac
> - Reference implementation: https://github.com/tetherto/qvac-examples

---

## What you get

A local web app served on `http://localhost:3080` with three modes:

- **Live Detection.** The webcam with colour-coded bounding boxes for about 110 everyday object
  classes, a hand box with 21 keypoints and a derived gesture label, and a live one-sentence
  narration of the scene.
- **AI Slash.** Falling icons that you slice with your index fingertip (tracked by the hand
  model). Thirty-second rounds, a local high-score table.
- **Head Stack.** Branded blocks fall from the top; you move your head (found by the object
  detector) to catch and balance them into the tallest stack you can.

Everything runs on the user's GPU. No cloud calls, no API keys. The first run downloads the
vision-language model (about 2 GB) into the QVAC cache; later runs reuse it. The two ONNX models
are generated once by the user (see [The models](#the-models)).

## Why this works

A live camera feed is the most sensitive input a consumer app can take. Webcam toys, accessibility
aids, kiosks, and kids' games are all more trustworthy when frames never leave the device. Running
the detector, the hand model, and the vision-language model on-device removes the privacy problem
at the source, and an on-device ensemble is fast enough to feel like a game rather than a demo.

## Requirements

- **Node.js** 20 or higher.
- A GPU-capable machine. The ONNX engine uses CoreML on macOS (Apple Silicon) and DirectML on
  Windows; CPU fallback works but is slower.
- A webcam and a browser you can grant camera access to.
- **About 2 GB free disk** for the vision-language model cache.
- **Python 3.11 or 3.12** once, only to generate the two ONNX models.
- Verify the machine with `npx -y @qvac/cli doctor` before scaffolding.

## The QVAC SDK surface (pin these exactly)

This is the part an agent cannot guess. Everything else is ordinary web code.

### Vision-language model (narration) with `@qvac/sdk`

```js
import {
  loadModel, unloadModel, completion,
  QWEN3VL_2B_MULTIMODAL_Q4_K,
  MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K,
} from "@qvac/sdk";

// Load once and cache the handle. It is a multimodal (vision) model, so pass the
// projection model. modelType is "llamacpp-completion".
const handle = await loadModel({
  modelSrc: QWEN3VL_2B_MULTIMODAL_Q4_K,
  modelType: "llamacpp-completion",
  modelConfig: { ctx_size: 8192, projectionModelSrc: MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K },
});

// For each frame: write the JPEG to a temp file and attach it by path.
const run = completion({
  modelId: handle,
  history: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: prompt, attachments: [{ path: tmpJpegPath }] },
  ],
  stream: true,
  generationParams: { predict: 96, temp: 0.4, top_p: 0.9, seed: 42 },
});
const final = await run.final;
const text = (final.contentText || final.raw?.fullText || "").trim();
```

Notes that save hours:

- Keep `predict` small (about 96). You want one short sentence, not a paragraph; it also keeps
  the loop realtime.
- Run **one completion at a time**. The runtime allows a single in-flight completion per model;
  if a second overlaps it rejects. Treat that rejection as "busy" and have the client skip the
  frame and try the next one.
- Ask the model for a single sentence only (no JSON, no lists, no markdown), but still parse
  defensively in case it wraps the answer.

### Object and hand detection with `@qvac/onnx`

The ONNX engine runs under the Bare runtime. Load each model once, then run per frame.

```js
import onnx from "@qvac/onnx";

onnx.configureEnvironment({ loggingLevel: "error" });
const session = onnx.createSession("models/yolo-world.onnx", { provider: "auto_gpu" });
const inputName = onnx.getInputInfo(session)[0].name;

// per frame: feed a CHW float32 tensor normalised to 0..1, shape [1,3,640,640]
const out = onnx.run(session, [{ name: inputName, shape: [1, 3, 640, 640], type: "float32", data: tensor }]);
const raw = out[0].data; // YOLO-World raw output [1, 4+NC, 8400]; do NMS yourself in JS
```

Notes that save hours:

- Export YOLO-World with **`nms=False`** and do NMS in JavaScript. The embedded-NMS export
  (`nms=True`) crashes the CoreML execution provider on empty frames (a `GatherND` over zero
  elements). The raw output decodes to `cx, cy, w, h` plus per-class scores over 8400 anchors;
  argmax over the classes, threshold, then IoU NMS.
- The hand-pose model is exported end-to-end (`nms=True`), so its output is already
  `[1, 300, 69]` = `x1, y1, x2, y2, score, class, (kx, ky, kc) * 21`. Read keypoints directly.
- Use `provider: "auto_gpu"` so the engine picks CoreML or DirectML automatically.
- Run the detector as its own small Bare service and call it over HTTP from the main server, so
  the ONNX engine and the llama.cpp VLM do not fight over the process. Give it a per-frame "busy"
  guard too.

### Gestures and smoothing (plain code, no model)

- Derive the gesture (thumbs up, peace, point, fist, open palm, rock) from the 21 hand keypoints
  using simple finger-extended geometry. No extra model.
- Between detections, ease each box toward its latest position with an EMA so the overlay does not
  jump. This is browser math, not AI.

## The models

This example does not ship model weights. The two ONNX models are Ultralytics-derived
(**AGPL-3.0**), and the app is Apache-2.0, so the user generates them under Ultralytics' own
license:

- `models/yolo-world.onnx`: open-vocab object detector. Define a curated class list (for a tech
  setting: person, face, hand, glasses, phone, laptop, headphones, bottle, and so on), call
  `set_classes(vocab)`, and export with `nms=False`. Keep the JS `LABELS` array in sync with the
  vocab order.
- `models/yolo_hand_pose.onnx`: a 21-keypoint YOLO-pose hand model, exported end-to-end
  (`nms=True`) to `[1, 300, 69]`.

The vision-language model is not a file you manage: the QVAC SDK downloads it from the registry on
first run. See `models/README.md` for the exact export commands.

## Architecture and ports

```
server.js (:3080)  Express. Serves the UI, runs Qwen3-VL via @qvac/sdk, spawns the detector.
detector.mjs (:3085)  Bare service. @qvac/onnx loads both ONNX models. POST /detect -> boxes + hands.
browser  Webcam capture, sends frames both ways, tracker + EMA + overlay + gesture + games.
```

The client posts a small RGB buffer to `:3085/detect` many times per second for boxes and hands,
and a JPEG to `:3080/api/look` about once per second for the narration. Expose
`GET /api/engines` that reports which QVAC engine each model runs on, so anyone can verify the
app is 100% QVAC.

## Build steps

1. Confirm the machine with `npx -y @qvac/cli doctor`.
2. Scaffold the Express server, the Bare detector service, and a static `public/` UI.
3. Wire the VLM and the ONNX engine exactly as pinned above.
4. Generate the two ONNX models (see `models/README.md`).
5. Build the webcam capture, the overlay, the gesture logic, and the EMA smoothing in the browser.
6. Add the three modes and the two games on top of the same detector output.
7. Verify: `GET /api/health` is ok, `GET /api/engines` lists the QVAC engines, and the detector
   `GET /health` reports live ONNX providers. Then open the UI, Start, and allow the camera.

## Hard rules

- Do not add a non-QVAC inference engine (no `onnxruntime-node`, no TensorFlow, no cloud API). All
  AI runs on `@qvac/sdk` and `@qvac/onnx`.
- Do not send frames anywhere. Everything stays on-device.
- Confirm the machine meets the requirements before downloading or loading models.
- Keep one inference per engine in flight; treat overlaps as "busy" and skip the frame.
