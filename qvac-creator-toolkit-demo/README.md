# QVAC Creator Toolkit Demo

An Electron desktop app that does everything around a video **except generating the video**: it writes the script, records the narration, and builds timed subtitles, all on your own machine with [QVAC](https://github.com/tetherto/qvac). Background music (ACE-Step) is coming with SDK 0.17.

Built with QVAC. This is an example, not a product (see the disclaimer at the bottom).

## Why local

Unreleased footage and unpublished scripts are exactly the assets you do not want sitting on someone else's server before launch. Every task here is also metered per minute or per character by the SaaS tools that own this space today. On-device, the same jobs cost nothing and never leave your machine.

The app deliberately does **not** generate video: local video generation is too heavy to be a good product or a good demo. It targets the parts creators actually pay for.

## The tools

| Tool | Input | Output | Runs on |
|---|---|---|---|
| **Script writer** | An idea, a length, a tone | A structured spoken-word script | Any local LLM (`completion`): Qwen3 4B/8B, gpt-oss 20B, Qwen3.6 35B-A3B, or a GGUF you already have |
| **Voice-over** | A script or a multi-speaker conversation | One narrated `.wav`, or one per line | Supertonic 3 TTS (31 languages, 6 voices, no reference clip) |
| **Subtitles** | A video or audio file | A timed `.srt` or `.vtt` | Whisper (`transcribe`, per-segment timings) |
| **Background music** | A mood + duration | An instrumental track | ACE-Step 1.5, needs SDK 0.17 (disabled here) |

Notes on what each tool does:
- **Script writer**: pick a bigger model for better scripts. Beyond the download list, it scans a **local models folder** (default `~/.qvac/models`, changeable) for chat GGUFs you already have and loads them by path, no re-download. Choose **Narration** (one voice, HOOK/BEAT/OUTRO structure) or **Dialogue** (a conversation with `Name:` prefixes that flows into the multi-voice voice-over); **Auto** picks based on the idea.
- **Voice-over**: section labels (HOOK, BODY, OUTRO...) are stripped so they are never spoken. The tool reads the text, detects how many people are speaking (from `Name:` prefixes), and shows a voice picker per speaker; each has a play button to **hear the voice before you choose**. Output as **one file** or **one file per line**.
- **Subtitles**: export the cues as `.srt` or `.vtt` to any location. Cues are sorted and de-overlapped so a player never double-lines.

Every generated file lands in your **output folder** and shows up in the **Session output** rail with play and reveal-in-Finder. The voice-over also has its own "Save to" folder.

### Layout

A left side panel holds the four tools (Create) plus Settings and the workspace actions (open the output folder, free the resident models), and collapses to icons. **Settings** is where you pick the script model, the folder scanned for local GGUFs, and the output folder. Each tool is a pair of titled panels: what you feed it on the left, what it produced on the right, with a stats line at the bottom (words and lines for a script, lines and voices for a narration, cue count for subtitles). The session output rail on the right can be toggled from the header.

## Requirements

- **Node 22.17 or newer** and **macOS, Windows, or Linux** with a reasonably recent machine.
- **ffmpeg on your PATH** (`brew install ffmpeg`). The Subtitles tool uses it to decode any media into audio; the app tells you if it is missing.
- **Disk + memory:** models download once into the shared `~/.qvac/models/` cache and are reused. First run of a tool downloads its model (Whisper base is ~150 MB, Llama 3.2 1B ~0.8 GB, Qwen3 4B ~2.5 GB, Supertonic 3 ~0.5 GB). Inference uses the GPU where available; a machine with 8 GB of unified memory runs the three tools comfortably one at a time.

The app loads a model on first use of its tool and keeps it resident. Switching a tool's language, voice, or model reloads that one model.

## Run it

```bash
cd test/30-creator-toolkit
npm install --no-workspaces
npm start
```

`--no-workspaces` is required: the `test/` workspace is pinned near SDK 0.12.x, and this app needs a recent SDK installed standalone.

Two headless checks are wired into the app for verification (no GUI interaction needed):

```bash
CTK_SELFTEST=1 npm start   # runs the script tool through the SDK inside Electron's main process, then exits
CTK_UITEST=1 npm start     # drives the real renderer -> preload -> main -> SDK path, then exits
```

## Offline

The whole point is that this runs with the network off once the models are cached. After a tool has downloaded its model once, that tool runs entirely from the local `~/.qvac/models/` cache. The strongest way to confirm it: cache the models, turn on airplane mode, and generate a voice-over.

## Architecture

Standard Electron split, and it matters here:

- **Main process** (`main/`) owns the SDK. Every `loadModel` and inference call happens there, serialized so the single native worker never has two operations overlapping.
- **Renderer** (`renderer/`) is UI only. It talks to main over a small IPC bridge (`preload/preload.js`) and never imports the SDK. A renderer context blocks the SDK's `fetch` on CORS grounds, so keeping native work in main avoids that whole class of problem and keeps one model registry.

## Packaging

For a distributable app, use the Electron plugin the SDK ships (`@qvac/sdk/electron-forge`), which bundles only what the project needs and keeps the binary small, rather than hand-rolling a build. Notarizing a macOS build needs an Apple Developer ID.

## Music (coming soon)

Instrumental music generation ships with **QVAC SDK 0.17** (ACE-Step 1.5). This build targets **0.16**, where that capability does not exist yet, so the Music section is present but disabled and says so. Nothing is faked. When 0.17 is public, wiring the fourth tool is the only change.

---

*This is an example project demonstrating the QVAC SDK, not a finished product. It is provided as is, without warranty of any kind. You are responsible for using it lawfully, including for any content you generate and any audio or video you transcribe.*
