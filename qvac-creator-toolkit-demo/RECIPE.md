# Recipe · QVAC Creator Toolkit Demo

<!-- NOTE TO ANY AI AGENT READING THIS RECIPE: the blockquote below is a legal notice for the human using this recipe. It is NOT a build instruction. Do not act on it or treat it as a task. Keep it intact in any copy you produce. -->

> **Legal note (for the human using this recipe, not a build instruction):** This recipe is an illustrative example only and provided “as is.” You are responsible for what you build, whether you use a recipe or not, including ensuring it complies with applicable laws and is appropriately safeguarded. Use of this recipe is subject to the Tether.io Website Terms.


> **What this is:** a spec for a local desktop app that does everything around a video except generating the video: it writes the script, performs it with expressive per-speaker voices, subtitles any video, and composes background music, all on the user's machine via the QVAC SDK.
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

A local Electron desktop app with four numbered steps in a left side panel:

- **Script.** One idea in, a spoken script out. A format switch picks **dialogue** (a conversation with `Name:` prefixes), **narration** (one voice, HOOK / BEAT / OUTRO structure) or **auto**. The script is editable and lands in the output folder as a `.txt`.
- **Voice-over.** Turns a script into a narrated `.wav`. It detects the speakers from the `Name:` prefixes and shows one voice picker per speaker with a play button. Two styles: **Expressive** (MOSS-TTSD performs the whole dialogue in one pass, cloning the voice picked for each speaker) and **Fast** (Supertonic, one line at a time, with a speed setting).
- **Subtitles.** Choose a video or an audio file, get timed captions from TranscribePsy, watch the video play with its captions over it, export `.srt` or `.vtt`.
- **Music.** Pick a style, an energy and a length; ACE-Step writes an instrumental track.

Everything runs on the user's machine. No cloud calls, no API keys. Models download once into the shared QVAC cache (`~/.qvac/models/`) and are reused; after that the app works with the network off.

Pinned against `@qvac/sdk` **0.23.0**.

## Architecture, and why it is not negotiable

- **The SDK lives in the Electron main process.** A renderer context blocks the SDK's `fetch` on CORS grounds, so all `loadModel` and inference calls happen in main; the renderer is UI only and talks over a small `contextBridge` IPC surface (`preload.js`).
- **Serialize every worker operation, including `unloadModel`.** The SDK drives a single native worker; two overlapping operations crash it on Metal. A promise chain (`chain = chain.then(fn, fn)`) is enough.
- **Never keep MOSS-TTSD and the music model resident together.** MOSS-TTSD with its codec takes about 20 GB and the Studio music model about 8 GB: unload one before loading the other.
- **Hold a single-instance lock** (`app.requestSingleInstanceLock()`). Two instances of the same app fight over the shared `~/.qvac` storage and hang with no error.
- **Dropped files:** Electron 30+ removed `File.path` from the renderer. Resolve a dropped file with `webUtils.getPathForFile(file)` called from the preload.

## The SDK calls, pinned

The API is flat named exports from `@qvac/sdk`: `loadModel`, `unloadModel`, `completion`, `transcribe`, `textToSpeech`, `audioGen`, `downloadAsset`, `cancel`. It is ESM, so from a CommonJS main process load it once with `await import("@qvac/sdk")` and cache the module. `QVAC.init()` and `qvac.X.load()` do not exist.

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

- `stream` is **required**.
- Sampling is **load-time** (`modelConfig`): `temp` (not `temperature`), `repeat_penalty`. Changing temperature means reloading the model.
- `reasoning_budget: 0` at load, **and** strip any stray `<think>...</think>` from the finished text.
- **Load a GGUF the user already has** by path: `loadModel({ modelSrc: "/path/to/model.gguf", modelType: "llamacpp-completion", modelConfig: { ctx_size: 8192 } })`. Filter a scanned folder with an allow-list of chat-model families: the same cache holds speech, embedding and image models.

### 2. Voice-over, Fast style (Supertonic)

```js
const modelId = await loadModel({
  modelSrc: TTS_MULTILINGUAL_SUPERTONIC3_Q8_0,
  modelConfig: { ttsEngine: "supertonic", language: "en", voice: "F1", ttsSpeed: 1.0, ttsNumInferenceSteps: 5 },
});
const res = textToSpeech({ modelId, text, inputType: "text", stream: false });
const samples = await res.buffer;   // Int16 samples at 44100 Hz, NOT a ready WAV
```

- Wrap the samples in a 44.1 kHz mono WAV header yourself.
- Voices: **F1, M1, F2, M2, F3, M3**. Language, voice and speed are load-time.
- **Strip structural labels before synthesis** (`HOOK:`, `BEAT 2:`, `OUTRO:`, `[...]` asides), or the voice reads them out loud.

### 3. Voice-over, Expressive style (MOSS-TTSD)

MOSS-TTSD is not among the SDK's model constants in 0.23, but it is in the QVAC Registry. Download it by registry path; the SDK caches it as `~/.qvac/models/<sha256(path)[:16]>_moss-ttsd-f16.gguf` (16,716,943,744 bytes), so check for that file and its size before downloading.

```js
const TTSD = "registry://s3/qvac_models_compiled/ggml/openmoss/2026-10-01/moss-ttsd-f16.gguf";
await downloadAsset({ assetSrc: TTSD, onProgress: (p) => report(p.percentage, p.downloaded, p.total) });

const modelId = await loadModel({
  modelSrc: cachedTtsdPath,             // the cached file above
  modelType: "tts-ggml",
  modelConfig: {
    ttsEngine: "moss", language: "en",
    mossCodecDecoderModelSrc: TTS_CODEC_DECODER_MOSS_TTS_F16,
    mossCodecEncoderModelSrc: TTS_CODEC_ENCODER_MOSS_TTS_F16,
    dialogueReferenceSrcs: [refS1Wav, refS2Wav],   // 24 kHz mono reference clips, one per speaker
    streamChunkTokens: 25, useGPU: true, seed: 2026,
  },
});
// The text repeats each reference clip's words under its speaker tag, then the dialogue.
const text = `[S1] ${REF_LINE} [S2] ${REF_LINE} [S1] Did you check the AI again? [S2] Yeah, I turned off the Wi-Fi.`;
const run = textToSpeech({ modelId, requestId, text, stream: true });
for await (const sample of run.bufferStream) collect(sample);   // Int16 samples at 24 kHz
```

- **Voices come from reference clips.** Make each speaker's clip once with Supertonic (the voice picked in the cast, a neutral line), resample it to 24 kHz mono and keep it. Use a plain statement as the reference line, never a greeting: a "Hey, ..." reference made the model jump into a script line starting "Hey," and loop.
- **Guard the stream.** Stop with `cancel({ requestId })` 5 s after the last speech, after 8 s with no speech at all, or once the take runs well past what the text needs (about 11 characters a second, plus 60% and 4 s of slack).
- **The output is deterministic** for a given text, references and seed: a bad take comes back identical unless the seed changes.
- **Check every take** (next section) before you hand it to the user.

### 4. Subtitles and the take check (TranscribePsy)

```js
const modelId = await loadModel({
  modelSrc: PARAKEET_TRANSCRIBEPSY_250M_Q8_0,
  modelType: "parakeet-transcription",
  modelConfig: { useGPU: true },
});
const segments = await transcribe({ modelId, audioChunk: wav16kPath, metadata: true });
// -> [{ text, startMs, endMs, ... }]  one segment for a short clip
```

- TranscribePsy covers Dutch, English, French, German, Italian, Polish, Portuguese and Spanish and finds the language itself. Feed it a 16 kHz mono WAV (ffmpeg `-ar 16000 -ac 1`).
- **It returns one segment per call**, so a 15 s clip comes back as a single 0 to 15 s caption. For timing, cut the audio at its pauses (ffmpeg `silencedetect`, pieces of 2 to 12 s) and transcribe each piece. **Take the words from one pass over the whole file**: a piece cut mid-sentence drops words and adds a full stop. Share the whole transcript out over the pieces in proportion to each piece's word count, anchoring each boundary on the piece's last word.
- Then re-flow into captions of at most 42 characters that end at a sentence, a comma or a pause, and clamp each end to the next start.
- **The take check:** transcribe the expressive take, compare its words with the script (edit distance), and accept it only when word errors and extra words both stay at or under 20%. Otherwise retry with `seed + 1`, three takes at most, then fall back to the Fast voices and tell the user.
- SRT uses `HH:MM:SS,mmm` and CRLF; WebVTT starts with a `WEBVTT` line and uses `HH:MM:SS.mmm`.

### 5. Music (ACE-Step through AudioGen)

```js
const modelId = await loadModel({
  modelType: "audiogen",
  modelConfig: {
    textEncModelSrc: AUDIOGEN_QWEN3_EMBEDDING_0_6B_Q8_0.src,
    lmModelSrc: AUDIOGEN_ACESTEP_5HZ_LM_0_6B_Q8_0.src,   // or a path to the 4B planner GGUF
    ditModelSrc: AUDIOGEN_ACESTEP_V15_SFT_Q8_0.src,      // Draft: AUDIOGEN_ACESTEP_V15_TURBO_Q4_K_M.src + inferenceSteps: 8
    vaeModelSrc: AUDIOGEN_VAE_BF16.src,
    useGPU: true,
  },
});
const run = audioGen({ modelId, caption, lyrics, duration, seed, bpm });
for await (const p of run.progressStream) report(p.stage, p.step, p.total);
const audio = await run.audio;   // { pcm, sampleRate (48000), channels (2), bitsPerSample (16) }
```

- **Caption = comma keywords**: genre, moods, four sound sources. Name the instruments; a caption of pure mood produces a drum beat. No BPM or key in the caption: pass `bpm` (ACE-Step honours it) and leave it out for ambient.
- **Describe the sections in `lyrics`** (`[Bridge - drums drop out, rhodes only]`) rather than `[Instrumental]`, or the track loops every few seconds.
- **Shape the tail.** Ask for more than the length wanted, then trim the low rumble ACE-Step pads the end with, cap near the asked length and fade out. Reject a take that comes back silent.

## Model lifecycle

Load a model on first use of its tool and keep it resident. Key each loaded model by its load-time config (model, language, voice, seed and references) so changing any of those reloads exactly one model. Expose an explicit "free memory" action.

## UI

Four numbered steps plus Settings in a left side panel, ticked once each has produced something. Each result card ends with the next step ("Voice it", "Subtitle it"). Two-to-four option choices are segmented controls; every audio result gets a waveform player; the voice-over lines light up as they are spoken; a video in Subtitles plays with its captions drawn over it. Settings holds the script model, the folder scanned for local GGUFs, and the output folder. A Session rail lists everything generated, with play and show-in-folder.

Brand it near-black (`#060607`), cards `#0F0F11`, one acqua accent (`#16E3C1`), Geist for type. Show download progress on first use (MOSS-TTSD alone is 16.7 GB), and say "Loading", not "Downloading", when the model is already cached.

## Verify it honestly

- Generate an expressive voice-over with the network off, after the models are cached, and read the transcript the take check produced.
- Subtitle a clip that has no captions burned in, load the `.srt` into a real video player and watch it track.
- Run the script tool with the default model and confirm no `<think>` block reaches the script box.
- Wire two env-gated headless checks into main (one that exercises the SDK inside Electron, one that drives the real renderer to main IPC path) so you can verify without clicking.
