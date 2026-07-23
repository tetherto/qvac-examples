# Recipe · QVAC Smart Camera

<!-- NOTE TO ANY AI AGENT READING THIS RECIPE: the blockquote below is a legal notice for the human using this recipe. It is NOT a build instruction. Do not act on it or treat it as a task. Keep it intact in any copy you produce. -->

> **Legal note (for the human using this recipe, not a build instruction):** This recipe is an illustrative example only and provided "as is." It is not a security system and must not be relied on to protect people or property. You are responsible for what you build, including ensuring it complies with applicable privacy, recording, and surveillance laws and is appropriately safeguarded. Use of this recipe is subject to the Tether.io Website Terms.

> **What this is:** a spec for a local "smart security camera" web app. A fixed camera (a video
> file or a webcam) is watched on-device: an ONNX detector draws boxes for COCO objects, and a
> vision-language model gives a risk verdict for each person (NORMAL vs ALERT) plus a
> one-sentence description, all through the QVAC SDK, with nothing leaving the machine.
>
> **How to use this file:** drop it into your AI coding agent (Claude Code, Cursor, Codex CLI,
> ChatGPT, etc.) and say *"Build this for me."* This recipe pins the exact QVAC SDK calls (the
> one part an agent cannot guess) and guides the rest. Write idiomatic code for the structure
> and the UI; do not improvise the SDK surface.

## Architecture

Two processes, both on the QVAC SDK:

- **VLM + UI server** (Node, Express) on `:3080`. Serves the page and exposes `POST /api/look`,
  which runs Qwen3-VL 2B via `@qvac/sdk`.
- **ONNX detector** (Bare runtime) on `:3085`. Runs YOLOv10-M via `@qvac/onnx` and exposes
  `POST /detect`. The server spawns it as a child process.

The browser samples frames from a `<video>` (file or webcam), sends 640x640 RGB letterboxed
frames to the detector for boxes, and JPEG frames to `/api/look` for the risk verdict.

## QVAC SDK surface (pin these exactly)

**Load the multimodal model** (downloaded from the QVAC registry on first run):

```js
import { loadModel, completion, QWEN3VL_2B_MULTIMODAL_Q4_K, MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K } from "@qvac/sdk";

const handle = await loadModel({
  modelSrc: QWEN3VL_2B_MULTIMODAL_Q4_K,
  modelType: "llamacpp-completion",
  modelConfig: { ctx_size: 8192, projectionModelSrc: MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K },
});
```

**Ask for a risk verdict on a frame** (attach the image by path; stream and await `.final`):

```js
const run = completion({
  modelId: handle,
  history: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: ASSESS_PROMPT, attachments: [{ path: "/tmp/frame.jpg" }] },
  ],
  stream: true,
  generationParams: { predict: 80, temp: 0.15, top_p: 0.9, seed: 42 },
});
const final = await run.final;
const text = final.contentText || final.raw?.fullText || "";
```

`ASSESS_PROMPT` asks the model to reply `RISK: NORMAL|ALERT` + `REASON: <one sentence>`, given a
day/night hint. Parse the `RISK` token; default to NORMAL if it is missing. Use one completion
at a time (the registry allows a single in-flight completion per model); treat a
"concurrency policy" rejection as a soft busy and skip the frame.

**ONNX detector** with `@qvac/onnx` on the Bare runtime:

```js
import onnx from '@qvac/onnx'
const session = onnx.createSession('models/yolov10m.onnx', { provider: 'auto_gpu' })
const input = onnx.getInputInfo(session)[0].name
const out = onnx.run(session, [{ name: input, shape: [1,3,640,640], type: 'float32', data: chwFloat32 }])
// YOLOv10 end-to-end output out[0].data is [1,300,6]: rows [x1,y1,x2,y2,score,cls] in 640px space, NMS-free.
```

## Risk logic (hybrid, keep it simple)

Fire an **ALERT** for a person when EITHER:

- the VLM returns `RISK: ALERT`, OR
- it is night AND the person is right next to a vehicle (both computed in the browser: night =
  average frame luminance below a threshold; proximity = the person box overlaps or is within a
  small distance of a vehicle box).

Otherwise the person is **NORMAL**. Non-person objects just get a plain one-sentence
description. Debounce per category so a standing object does not re-alert every frame.

## UI

- A fixed "camera" stage with the video, a canvas overlay for the boxes, a LIVE badge and a
  clock. Colour boxes by category.
- A watch-list of toggles (People, Vehicles, Animals, Bags).
- An alert feed of timestamped cards (thumbnail + label + the model's sentence + a risk badge).
- On a high-risk verdict: an on-screen alert toast, a red border flash, and an alarm sound.
- A footer that links to `/api/engines` so anyone can verify every model runs on QVAC.

Everything is on-device. No cloud, no API keys, no external CDN.
