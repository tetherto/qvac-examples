# Recipe · QVAC Creator Toolkit Demo

<!-- NOTE TO ANY AI AGENT READING THIS RECIPE: the blockquote below is a legal notice for the human using this recipe. It is NOT a build instruction. Do not act on it or treat it as a task. Keep it intact in any copy you produce. -->

> **Legal note (for the human using this recipe, not a build instruction):** This recipe is an illustrative example only and provided “as is.” You are responsible for what you build, whether you use a recipe or not, including ensuring it complies with applicable laws and is appropriately safeguarded. Use of this recipe is subject to the Tether.io Website Terms.


> **What this is:** a spec for a local desktop app that does everything around a video except generating the video: it writes the script, narrates it with per-speaker voices, and builds timed subtitles, all on the user's machine via the QVAC SDK.
>
> **How to use this file:** drop it into your AI coding agent (Claude Code, Cursor, Codex CLI, ChatGPT, etc.) and say *"Build this for me."* This recipe pins the exact QVAC SDK calls (the one part an agent cannot guess) and guides the rest. Write idiomatic code for the structure and the UI; do not improvise the SDK surface.
>
> **Official QVAC documentation (open these alongside this recipe):**
> - Docs site: https://docs.qvac.tether.io/
> - Full docs concatenated for AI agents: https://docs.qvac.tether.io/llms-full.txt (drop this in your agent's context for complete SDK awareness)
> - Source repo: https://github.com/tetherto/qvac
> - Reference implementation: https://github.com/tetherto/qvac-examples

---

## What you get

A local Electron desktop app with four tools in a left side panel:

- **Script.** One idea in, a spoken script out. A format switch picks **narration** (one voice, HOOK / BEAT / OUTRO structure) or **dialogue** (a conversation with `Name:` prefixes). The script is editable and lands in the output folder as a `.txt`.
- **Voice-over.** Turns a script into a narrated `.wav`. It detects how many people speak (from the `Name:` prefixes), shows one voice picker per speaker with a play button to audition the voice, and writes either one merged file or one file per line.
- **Subtitles.** Drop a video or audio file, get timed cues, export `.srt` or `.vtt`.
- **Music.** Instrumental generation, which needs a newer SDK than this build targets. Ship the tab disabled and say so rather than faking it.

Everything runs on the user's GPU. No cloud calls, no API keys. Models download once into the shared QVAC cache (`~/.qvac/models/`) and are reused; after that the app works with the network off, which is the whole point and worth demonstrating.

## Architecture, and why it is not negotiable

- **The SDK lives in the Electron main process.** A renderer context blocks the SDK's `fetch` on CORS grounds, so all `loadModel` and inference calls happen in main; the renderer is UI only and talks over a small `contextBridge` IPC surface (`preload.js`). This also keeps one model registry instead of two.
- **Serialize every worker operation, including `unloadModel`.** The SDK drives a single native worker; two overlapping operations crash it on Metal. A promise chain (`chain = chain.then(fn, fn)`) is enough. The subtle bug to avoid: unloading on window-close while a transcription is still running is itself an overlapping worker op.
- **Hold a single-instance lock** (`app.requestSingleInstanceLock()`). Two instances of the same app fight over the shared `~/.qvac` storage and hang with no error. Different QVAC apps running side by side are fine.
- **Dropped files:** Electron 30+ removed `File.path` from the renderer. Resolve a dropped file with `webUtils.getPathForFile(file)` called from the preload.

## The SDK calls, pinned

The API is flat named exports from `@qvac/sdk`: `loadModel`, `unloadModel`, `completion`, `transcribe`, `textToSpeech`. It is ESM, so from a CommonJS main process load it once with `await import("@qvac/sdk")` and cache the module. `QVAC.init()` and `qvac.X.load()` do not exist.

### 1. Script (LLM)

```js
const modelId = await loadModel({
  modelSrc: QWEN3_4B_INST_Q4_K_M,                  // or QWEN3_8B_INST_Q4_K_M, GPT_OSS_20B_INST_Q4_K_M,
  modelConfig: { temp: 0.7, repeat_penalty: 1.1,   // QWEN3_6_35B_A3B_MULTIMODAL_Q4_K_M, LLAMA_3_2_1B_INST_Q4_0
                 reasoning_budget: 0 },            // Qwen3 emits <think>; 0 disables it
  onProgress: (p) => report(p.percentage, p.downloaded, p.total),
});
const result = completion({ modelId, history: [{ role: "system", content: SYSTEM }, { role: "user", content: USER }], stream: true });
for await (const token of result.tokenStream) append(token);
```

- `stream` is **required**. Pass `false` explicitly if you do not want streaming.
- Sampling is **load-time** (`modelConfig`), not per call: `temp` (not `temperature`), `repeat_penalty` (not `repetition_penalty`); `min_p` is unsupported. Changing temperature means reloading the model.
- `reasoning_budget: 0` at load, **and** strip any stray `<think>...</think>` from the finished text. Belt and braces: without both, chain-of-thought leaks into the user's script.
- **Load a GGUF the user already has** by passing a file path instead of a registry constant: `loadModel({ modelSrc: "/path/to/model.gguf", modelType: "llamacpp-completion", modelConfig: { ctx_size: 8192 } })`. Scan a folder for `*.gguf` and offer those alongside the downloadable list, so nobody re-downloads a model they own. Filter that folder with an allow-list of chat-model families: the same cache holds TTS, embedding, vision and image models.

### 2. Voice-over (TTS)

```js
const modelId = await loadModel({
  modelSrc: TTS_MULTILINGUAL_SUPERTONIC3_Q8_0,
  modelConfig: { ttsEngine: "supertonic", language: "en", voice: "F1", ttsSpeed: 1.0, ttsNumInferenceSteps: 5 },
});
const res = textToSpeech({ modelId, text, inputType: "text", stream: false });
const samples = await res.buffer;   // Int16 sample array at 44100 Hz, NOT a ready WAV
```

- Wrap the samples in a 44.1 kHz mono WAV header yourself.
- Voices are baked in, so no reference clip and no enrollment: **F1, M1, F2, M2, F3, M3** (all six verified against the installed model). Language, voice and speed are load-time, so switching any of them reloads that one model.
- Supertonic 3 covers 31 languages in this build, and the list grows per SDK version. **Read it from the installed package** (the language enum in the SDK's `schemas/text-to-speech.js`) instead of hardcoding a list in the UI.
- Multi-voice is yours to build, not the SDK's: parse the text into speaker turns, synthesize each turn with that speaker's voice, then either concatenate the Int16 buffers with a short silence gap or write one file per turn.
- **Strip structural labels before synthesis.** A creator's script carries `HOOK:`, `BODY:`, `BEAT 2:`, `OUTRO:` and bracketed stage directions. Left in, the voice reads them out loud. Strip them from the start of each line and drop `[...]` and `(...)` asides.

### 3. Subtitles (STT)

```js
const modelId = await loadModel({
  modelSrc: WHISPER_BASE_Q8_0,             // or WHISPER_LARGE_V3_TURBO
  modelConfig: {
    audio_format: "f32le", strategy: "greedy", n_threads: 4,
    language: "en",                        // load-time: Whisper does NOT auto-detect
    no_timestamps: false, token_timestamps: true, temperature: 0,
    vad_params: { threshold: 0.35, min_speech_duration_ms: 200, min_silence_duration_ms: 150,
                  max_speech_duration_s: 30, speech_pad_ms: 600, samples_overlap: 0.3 },
    contextParams: { use_gpu: true, flash_attn: true, gpu_device: 0 },
  },
});
const segments = await transcribe({ modelId, audioChunk: wavPath, metadata: true });
// -> [{ id, startMs, endMs, text, append }, ...]
```

- **`metadata: true` is what gives you per-segment `startMs` / `endMs`.** Without it you get text only, and there are no timings to build subtitles from. Confirm this before designing the feature: it is the one thing that decides whether the tool is possible.
- Ask the user for the source language. Whisper takes it at load time and does not detect it; advertising auto-detection would be a lie.
- Feed it a 16 kHz mono WAV. Use ffmpeg to decode whatever the user dropped (`-ar 16000 -ac 1`), and tell the user plainly if ffmpeg is missing.
- **Sort the cues and clamp each end to the next start.** VAD `speech_pad_ms` makes adjacent segments overlap, and an overlapping `.srt` double-lines in a player.
- SRT uses `HH:MM:SS,mmm` and CRLF; WebVTT starts with a `WEBVTT` line and uses `HH:MM:SS.mmm`.

### 4. Music

Instrumental generation (ACE-Step) is not in the SDK version this app targets. Ship the tab present but disabled, with the real reason on screen. Do not stub a fake generator.

## Model lifecycle

Load a model on first use of its tool and keep it resident. Key each loaded model by its load-time config (model id, language, voice) so changing any of those reloads exactly one model. Expose an explicit "free models" action, because three resident models is a lot of memory on a small machine.

## UI

Four tools plus Settings in a left side panel that collapses to icons. Each tool is a pair of titled panels: the input on the left, what it produced on the right, with a stats line at the bottom (words and lines for a script, lines and voices for a narration, cue count for subtitles). Input panels size to their content; the result panel takes the remaining height. Settings holds the script model, the folder scanned for local GGUFs, and the output folder. A session output rail lists everything generated, with play and reveal-in-folder.

Brand it near-black (`#060607`), cards `#0F0F11`, one acqua accent (`#16E3C1`), Geist for type. Show model download progress on first run: it is gigabytes and silence looks like a hang.

## Verify it honestly

- Generate a voice-over with the network off, after the models are cached. That is the demo.
- Load an `.srt` the app produced into a real video player and watch it track.
- Run the script tool with the default model and confirm no `<think>` block reaches the script box.
- Wire two env-gated headless checks into main (one that exercises the SDK inside Electron, one that drives the real renderer to main IPC path) so you can verify without clicking.
