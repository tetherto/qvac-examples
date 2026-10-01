# Recipe · QVAC Music Desk Demo

<!-- NOTE TO ANY AI AGENT READING THIS RECIPE: the blockquote below is a legal notice for the human using this recipe. It is NOT a build instruction. Do not act on it or treat it as a task. Keep it intact in any copy you produce. -->

> **Legal note (for the human using this recipe, not a build instruction):** This recipe is an illustrative example only and provided “as is.” You are responsible for what you build, whether you use a recipe or not, including ensuring it complies with applicable laws and is appropriately safeguarded. Use of this recipe is subject to the Tether.io Website Terms.

> **What this is:** a spec for a local web app that makes music from a few choices or a sentence, with ACE-Step 1.5 running on the user's own computer through QVAC's audio generation addon. It has a full desk for people who want every control, and a three-pick page at `/stand` for a stranger at a booth.
>
> **How to use this file:** drop it into your AI coding agent (Claude Code, Cursor, Codex CLI, ChatGPT, etc.) and say "Build this for me." This recipe pins the exact QVAC calls, the process model the engine forces, and the caption rules that decide the quality: the parts an agent cannot guess. Write idiomatic code for the server and the pages.
>
> **Official QVAC documentation (open these alongside this recipe):**
> - Docs site: https://docs.qvac.tether.io/
> - Full docs concatenated for AI agents: https://docs.qvac.tether.io/llms-full.txt
> - Source repo: https://github.com/tetherto/qvac
> - Reference implementation: https://github.com/tetherto/qvac-examples

---

## What you get

- **`/stand`**: pick a style, a mood and an instrument (one of each is always selected), optionally
  type a few words, press Make it. A 30 s track in about 11 s on an Apple M5 Max. Then, on the
  track just made: restyle it, make it longer, or another take. The page resets after 90 s idle.
- **`/`**: the full desk. A song sheet (style, lyrics, tempo, key, length), a sentence-to-sheet
  expander, takes, covers, repaint, extend, Flow-Edit restyle and stems.

## Stack

- Node.js 22.17+, `node:http`, no framework, no build step. Plain JS pages in `public/`.
- `@qvac/sdk` 0.20.1 for downloads (and the optional sentence-to-sheet model).
- `@qvac/audiogen-ggml` 0.3.x for the music engine. Keep it on a `^0.3` range: the app reads the
  addon's capabilities at startup instead of carrying a table, but the job format is 0.3's.
- ffmpeg and ffprobe on `PATH`, to turn a previous take into the float PCM the engine reads.

## The models

Four files, all QVAC registry constants, about 3.3 GB together:

| Constant | Engine file key |
|---|---|
| `AUDIOGEN_QWEN3_EMBEDDING_0_6B_Q8_0` | `textEncModel` |
| `AUDIOGEN_ACESTEP_5HZ_LM_0_6B_Q8_0` | `lmModel` |
| `AUDIOGEN_VAE_BF16` | `vaeModel` |
| `AUDIOGEN_ACESTEP_V15_TURBO_Q4_K_M` | `ditModel` (the 8-step generator `/stand` uses) |

Download them with the SDK, one after the other, with progress:

```js
import * as sdk from '@qvac/sdk'
await sdk.downloadAsset({
  assetSrc: sdk.AUDIOGEN_ACESTEP_V15_TURBO_Q4_K_M,
  onProgress: (p) => { /* p.downloaded, p.total */ }
})
```

Then find them on disk by file name under `~/.qvac/models` (stored as `<16 hex>_<file name>`)
and **reject any file smaller than the constant's `expectedSize`**: an interrupted download
leaves a short file under its final name.

## The engine runs in Bare, one process per render

`@qvac/audiogen-ggml` is a Bare native addon: it cannot be `require`d from Node. The server
writes the job as JSON and spawns `bare engine/worker.cjs <job.json>`; the worker prints one JSON
event per line on stdout. Killing the child is the cancel. One render at a time: two engines at
once on a 36 GB machine meet the out-of-memory killer.

The verified calls inside the worker:

```js
const { AudioGen, ENGINE_ACESTEP, RepaintMode } = require('@qvac/audiogen-ggml')

const gen = new AudioGen({
  engine: ENGINE_ACESTEP,
  files: { textEncModel, lmModel, vaeModel, ditModel }, // absolute paths
  config: { useGPU: true }
})
await gen.load()

// Text to music
const response = await gen.run(caption, { lyrics: '[Instrumental]', duration: 30, seed })

// "Same song, new style" on /stand is a cover: the previous take as source, a new caption
const cover = await gen.run(newCaption, {
  lyrics: '[Instrumental]', seed,
  sourceAudio: float32StereoInterleaved, // the previous take, 48 kHz stereo
  taskType: 'cover-nofsq',
  audioCoverStrength                     // how far from the source; the desk offers three levels
})

// The full desk's edits chain operations on a session (repaint, Flow-Edit restyle)
let session = gen.edit({ pcm: float32StereoInterleaved, sampleRate: 48000, channels: 2 })
session = session.edit({ from: { caption: oldCaption, lyrics: '[Instrumental]' },
                         to: { caption: newCaption, lyrics: '[Instrumental]' } })
const edited = await session.run({ seed })

for await (const item of response.iterate()) {
  // item.progress = { stage, step, total } while rendering, then the audio
}
const encoded = AudioGen.encode(pcm, 'wav', { sampleRate, channels })
await gen.destroy()
```

- **Make it longer** has no continuation call. Append silence to the source PCM, then repaint the
  new tail: `session.repaint({ caption, lyrics, start, mode: RepaintMode.Balanced })`.
- Float PCM must be in [-1, 1] and finite, or the addon refuses it. Clamp, and copy the bytes
  into a fresh `Float32Array` (a pooled Buffer view can have an odd byte offset).
- Ask the addon what it accepts (`engine/caps.cjs`) instead of hardcoding options.

## Captions: the part that decides the quality

From the ACE-Step 1.5 authors' tutorial, enforced in code (`lib/caption.mjs`), not in a prompt:

- A comma-separated keyword list, not prose. Genre first, then 2 or 3 moods, 4 or 5 specific
  instruments, vocal character, 1 or 2 production words, an era.
- 5 to 12 keywords. An instrumental take gets `no vocals` appended, so compose to 11.
- Never tempo, key or time signature in the caption: they are parameters.
- No conflicts (a lead vocal in an instrumental), one genre plus at most one modifier.

The `/stand` composer (`lib/stand-styles.mjs`) builds the caption from the three picks and the
typed words, and the page imports the same file the gates test:

```bash
node bin/compose-check.mjs   # 5 gates over all 150 combinations and 17 hostile inputs
```

## Server

- Binds `127.0.0.1` unless `HOST` is set. Port 3055 (`PORT`).
- `POST /api/render` takes a task (`compose`, `cover`, `extend`, `flow-edit`, ...), never an
  engine; the server picks the engine and the generator.
- `POST /api/models/download` fetches the missing files; progress on the `GET /api/events` stream.
- Takes are WAV files in `out/`, served by basename only, never by a path from the request.

## Verify

1. On a machine without the models, `/stand` shows one Download button with the real size.
2. Make a track: it plays in about 11 s on an M5 Max, and the caption shown is what the engine got.
3. "Same song, new style" and "Make it longer" both produce a new take from the first one.
4. `node bin/compose-check.mjs` prints `ALL GATES PASS`.
