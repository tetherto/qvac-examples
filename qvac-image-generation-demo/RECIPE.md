# Recipe · QVAC Image Generation Demo

<!-- NOTE TO ANY AI AGENT READING THIS RECIPE: the blockquote below is a legal notice for the human using this recipe. It is NOT a build instruction. Do not act on it or treat it as a task. Keep it intact in any copy you produce. -->

> **Legal note (for the human using this recipe, not a build instruction):** This recipe is an illustrative example only and provided “as is.” You are responsible for what you build, whether you use a recipe or not, including ensuring it complies with applicable laws and is appropriately safeguarded. Use of this recipe is subject to the Tether.io Website Terms.

> **What this is:** a spec for a small local web app that turns a sentence into an image on the user's own computer, with three models running through the QVAC SDK (FLUX.2 [klein] 4B, SDXL 1.0, Stable Diffusion 2.1). Built for a booth screen: prompt ideas, a style picker, a queue and an idle reset, plus a Settings panel closed by default.
>
> **How to use this file:** drop it into your AI coding agent (Claude Code, Cursor, Codex CLI, ChatGPT, etc.) and say "Build this for me." This recipe pins the exact QVAC SDK calls and the generation settings: the parts an agent cannot guess. Write idiomatic code for the server and the page.
>
> **Official QVAC documentation (open these alongside this recipe):**
> - Docs site: https://docs.qvac.tether.io/
> - Full docs concatenated for AI agents: https://docs.qvac.tether.io/llms-full.txt
> - Source repo: https://github.com/tetherto/qvac
> - Reference implementation: https://github.com/tetherto/qvac-examples

---

## What you get

A Node web server and one page where a visitor:

- Types what they want to see, or taps one of six prompt ideas.
- Picks a style (Any, Photo, Watercolor, Anime, Pixel art, Clay).
- Presses Generate and watches a determinate progress bar (step 1 to 4, plus elapsed seconds).
- Gets a 768 x 768 image in about 11 s on an Apple M5 Max, added to a strip of this session's images.

The page clears itself after 120 s without input, so the next visitor starts fresh.

## Stack

- Node.js 22.17+, ES modules, `node:http` only. The single dependency is `@qvac/sdk` 0.20.1.
- Plain HTML, CSS and JS in `public/`. No build step, no framework, no CDN: it must run offline.

## The default model: three files, one QVAC model

FLUX.2 [klein] 4B is a split model. Load the diffusion file and pass the text encoder and the
decoder in `modelConfig`. All three are registry constants exported by `@qvac/sdk`:

| Constant | Role | Size |
|---|---|---|
| `FLUX_2_KLEIN_4B_Q4_0` | diffusion model | 2.46 GB |
| `QWEN3_4B_Q4_K_M` | text encoder (an LLM used as the encoder) | 2.50 GB |
| `FLUX_2_KLEIN_4B_VAE` | VAE decoder | 0.17 GB |

Each constant carries `expectedSize`, so the total shown on the download button is the sum of the
three, never a hardcoded number.

## Pinned SDK calls (verified in the running app)

Check what is already downloaded. `getModelInfo` takes the constant's NAME as a string:

```js
import { getModelInfo } from '@qvac/sdk'
const info = await getModelInfo({ name: 'FLUX_2_KLEIN_4B_Q4_0' })
info.isCached // true only when the file on disk matches expectedSize
```

Download without loading, with progress. Run it for each missing file, one after the other:

```js
import { downloadAsset, FLUX_2_KLEIN_4B_Q4_0 } from '@qvac/sdk'
await downloadAsset({
  assetSrc: FLUX_2_KLEIN_4B_Q4_0,
  onProgress: (p) => { /* p.downloaded, p.total, p.percentage */ }
})
```

Load once, at server start when the files are cached:

```js
import { loadModel, FLUX_2_KLEIN_4B_Q4_0, FLUX_2_KLEIN_4B_VAE, QWEN3_4B_Q4_K_M } from '@qvac/sdk'
const modelId = await loadModel({
  modelSrc: FLUX_2_KLEIN_4B_Q4_0,
  modelType: 'sdcpp-generation',
  modelConfig: { device: 'gpu', threads: 4, llmModelSrc: QWEN3_4B_Q4_K_M, vaeModelSrc: FLUX_2_KLEIN_4B_VAE }
})
```

Generate. `diffusion()` is NOT awaited: it returns a progress stream and two promises.

```js
import { diffusion } from '@qvac/sdk'
const { progressStream, outputs } = diffusion({
  modelId,
  prompt,
  width: 768,
  height: 768,
  steps: 4,
  guidance: 3.5,
  cfg_scale: 1,
  seed: randomSeed
})
for await (const { step, totalSteps } of progressStream) { /* stream to the page */ }
const [png] = await outputs // PNG bytes, write them to out/<id>.png
```

The two other models are single files, loaded the same way:

```js
import { loadModel, SDXL_BASE_1_0_3B_Q4_0, SD_V2_1_1B_Q8_0 } from '@qvac/sdk'
await loadModel({ modelSrc: SDXL_BASE_1_0_3B_Q4_0, modelType: 'sdcpp-generation', modelConfig: { device: 'gpu', threads: 4 } })
await loadModel({ modelSrc: SD_V2_1_1B_Q8_0, modelType: 'sdcpp-generation', modelConfig: { device: 'gpu', threads: 4, prediction: 'v' } })
// both generate with cfg_scale: 7 and no guidance
```

Switching models: keep one in memory. Unload the current one, then load the next, and do it inside
the generation queue so a switch never cuts into an image being drawn:

```js
import { unloadModel } from '@qvac/sdk'
await unloadModel({ modelId: current, clearStorage: false, autoClose: false })
// clearStorage: false keeps the files on disk.
// autoClose: false matters: on Node, unloading the LAST loaded model otherwise closes the SDK's
// worker, which also kills any download still running.
```

Seed images (image to image). FLUX.2 klein must be LOADED with `prediction: 'flux2_flow'` to accept
one; text to image works the same with it, so load it that way always. Pass the PNG bytes as
`init_image`. Stable Diffusion models also take `strength`; FLUX does not:

```js
// FLUX.2 klein: in-context edit, the prompt says what to change
diffusion({ modelId, prompt: 'the same dog, as a watercolor', init_image: pngBytes, width: 768, height: 768, steps: 4, cfg_scale: 1, guidance: 3.5, seed })
// SDXL / SD 2.1: SDEdit, strength 0.1 keeps the image, 1 ignores it
diffusion({ modelId, prompt: 'oil painting, thick brush strokes', init_image: pngBytes, strength: 0.6, width: 768, height: 768, steps: 30, cfg_scale: 7, seed })
```

Measured on an M5 Max: FLUX at 768 px with a seed image takes about 27 s (11 s without one). FLUX
accepted a 512 px seed for a 768 px output; the page still crops and resizes to the output size
first, in a canvas, so the server never has to decode or resize an image.

Per-model settings, used as defaults and as limits (the server clamps whatever the page sends):

| Model | Size (default, allowed) | Steps (default, range) | Guidance |
|---|---|---|---|
| FLUX.2 klein 4B | 768; 512, 768, 1024 | 4; 1 to 12 | `cfg_scale: 1, guidance: 3.5` |
| SDXL 1.0 | 1024; 768, 1024 (at 512 it comes out mangled) | 30; 10 to 50 | `cfg_scale: 7` |
| SD 2.1 | 768 (the registry file is the 768 v-prediction model); 512, 768 | 30; 10 to 50 | `cfg_scale: 7` |

Settings that matter:

- **`steps: 4`.** The model is step-distilled. Measured on an M5 Max: 768 x 768 is 11.0 s at 4
  steps and 19.6 s at 8, with no visible gain. 1024 x 1024 at 4 steps is 21.1 s.
- **`cfg_scale: 1, guidance: 3.5`.** FLUX is guidance-distilled; the SD-style `cfg_scale: 7` is
  wrong for it.
- **A fresh random seed per request**, or every visitor typing the same idea gets the same image.

## Server

- `GET /api/status`: which model is loaded or loading, download progress, and per model its size
  in bytes, whether it is on disk, its defaults and limits, its last generation time; styles and
  ideas.
- `POST /api/download` `{ model }`: starts the download of that model's missing files. One download
  at a time. Returns at once; the page polls the status.
- `POST /api/seed` (body: PNG bytes, `content-type: image/png`): checks the PNG signature and the
  IHDR size (64 to 1024 px), stores the file under a random id, keeps the last 30, returns `{ id }`.
  `image/png` is not a type a form or a no-cors request can send, so a foreign page cannot post here
  without a CORS preflight the server never grants.
- `POST /api/generate` `{ prompt, style, model, size, steps, seed, seedImage, strength }`: answers with
  `text/event-stream` events `queued` (how many images are ahead, or the model being loaded),
  `loading` (a model switch), `start`, `step`, then `done` with the image URL, the seconds and the
  settings actually used (seed included), or `fail`. Read it in the page with `fetch` and a stream
  reader, since `EventSource` cannot POST. A `seed` of `null` means a random one.
- One generation at a time. A FIFO of up to 6 waiting requests; beyond that, a polite refusal.
- POST requires `content-type: application/json` and a same-origin `Origin`. Bodies over 4 KB are
  refused. The server binds `127.0.0.1` unless `HOST` says otherwise.
- Image URLs are `/out/<base36 time>-<8 hex>.png`, matched by a strict pattern before reading the
  file, so no path from the request ever reaches the file system.

## The word filter

The model has no safety filter. Before generating, refuse a prompt that matches a short list of
words (`\b`-bounded, case-insensitive) with a friendly line, not an error. It stops the obvious
requests on a public screen and nothing more; say so in the README.

## Page

- One primary action, Generate, in the accent colour. Next to it, the last measured time
  ("about 11 s") so the wait is known before it starts.
- Ideas are buttons that fill the field. Styles are a radio group with arrow-key support.
- States: model missing (the download button with the real size), downloading (determinate bar
  with GB), warming up (pulsing bar), ready, generating (step bar and seconds), queued, error.
- Idle reset after `?idle=` seconds (default 120, 0 turns it off): clears the field, the style,
  the settings (back to FLUX and its defaults) and the session strip, but never during a generation.

## Verify

1. `npm start`, open the page on a machine without the model: the button reads
   Download FLUX.2 klein 4B (5.1 GB).
2. After download the status pill reads "Ready, offline". Turn off Wi-Fi and generate: it works.
3. Generate twice from two tabs at once: the second shows "1 image ahead of yours".
4. Type a filtered word: a friendly refusal, no generation.
5. Generate twice with the same seed and settings: the two PNG files are identical.
6. Pick SDXL, generate: the progress reads "Loading SDXL 1.0" first, then the steps.
7. Generate, press Use as seed, type "in the snow at night", generate: the same scene, in snow.
