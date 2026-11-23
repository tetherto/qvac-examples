# QVAC Creator Toolkit Demo

<picture>
  <source media="(prefers-color-scheme: dark)"  srcset="docs/badges/built-with-qvac-dark-mode-landscape.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/badges/built-with-qvac-light-mode-landscape.svg">
  <img alt="Built with QVAC" src="docs/badges/built-with-qvac-light-mode-landscape.svg" width="200">
</picture>

An Electron desktop app that does everything around a video **except generating the video**: it writes the script, performs it with expressive voices, subtitles any video you already shot, and composes background music, all on your own machine with [QVAC](https://github.com/tetherto/qvac).

Built with QVAC. This is an example, not a product (see the note at the bottom).

## Why local

Unreleased footage and unpublished scripts are exactly the assets you do not want sitting on someone else's server before launch. Every task here is also metered per minute or per character by the cloud tools that own this space today. On your own machine, the same jobs cost nothing, and a take you throw away costs nothing either.

The app deliberately does **not** generate video: it targets the four jobs around the footage.

## The tools

| Tool | Input | Output | Runs on |
|---|---|---|---|
| **Script** | An idea, a format, a length, a tone | A spoken-word script, narration or dialogue | Any local LLM (`completion`): Qwen3 4B by default, Qwen3 8B, gpt-oss 20B, Qwen3.6 35B-A3B, or a GGUF you already have |
| **Voice-over** | A script or a multi-speaker conversation | One narrated `.wav`, or one per line | **Expressive**: MOSS-TTSD by OpenMOSS performs the whole dialogue in one pass (up to 5 speakers, 7 languages). **Fast**: Supertonic 3 (31 languages, 6 voices) |
| **Subtitles** | Any video or audio file | Timed captions, exported as `.srt` or `.vtt` | **TranscribePsy**, QVAC's 254M speech recognition model, built on NVIDIA's Parakeet-TDT (Dutch, English, French, German, Italian, Polish, Portuguese, Spanish) |
| **Music** | A style, an energy, a length | An instrumental track, 48 kHz stereo `.wav` | ACE-Step 1.5 through AudioGen: Studio (sft DiT) or Draft (turbo DiT) |

What each tool does:

- **Script**: choose **Dialogue** (a conversation with `Name:` prefixes that flows into the multi-voice voice-over), **Narration** (one voice, HOOK/BEAT/OUTRO structure) or **Auto**. Beyond the download list, Settings can point at a folder of chat GGUFs you already have; they load by path, with no re-download.
- **Voice-over**: the tool detects the speakers from the `Name:` prefixes and gives each one a voice picker with a play button, so you hear a voice before you choose it. Section labels (HOOK, BODY, OUTRO...) are stripped so they are never spoken. In the **Expressive** style, each speaker clones a short reference line that Supertonic speaks in the voice picked in the cast, and MOSS-TTSD performs the whole conversation at once, so each reply picks up the tone of the line before it. Every expressive take is transcribed back with TranscribePsy and compared with the script: when more than one word in five is wrong, missing or extra, the app records it again with another seed, up to three takes, then falls back to the Fast voices and says so. Output as one file or one file per line; the lines light up as they are spoken.
- **Subtitles**: choose a video or an audio file (or the latest voice-over). TranscribePsy finds the language itself and transcribes it, the audio is cut at its pauses to time the captions, and every caption stays within 42 characters, ending at a sentence, a comma or a pause. A video plays with its captions drawn over it; click a caption to jump to it. Export as `.srt` or `.vtt`.
- **Music**: pick a style (Lo-fi study, Chillhop groove, Ambient bed, Acoustic morning, Downtempo, Bossa café), an energy and a length. The app writes the prompt and shows it under "Prompt sent to the model". Every take is kept in the Takes list.

Every generated file lands in your **output folder** and shows up in the **Session** rail with play and show-in-folder. Paths on screen are shown relative to your home folder (`~/Downloads/...`), so the account name never appears in a recording.

## Recommended hardware

| | Fast voices | Expressive voices |
|---|---|---|
| **Memory** | 16 GB (8 GB is enough without the music) | 32 GB or more: MOSS-TTSD and its codec take about 20 GB |
| **Disk** (models, downloaded once) | About 6 GB: Qwen3 4B, Supertonic, TranscribePsy, ACE-Step Draft | About 31 GB: adds MOSS-TTSD (20 GB) and ACE-Step Studio (8 GB) |
| **GPU** | Used when there is one (Metal on Apple Silicon); the CPU works, slower | Same |
| **Software** | Node.js 22.17 or newer, ffmpeg on your PATH, macOS, Windows or Linux | Same |

Measured on a MacBook Pro with an Apple M5 Max and 36 GB: an eight-line dialogue script in about 7 s (model load included), 20 s of expressive dialogue in about 23 s (load and take check included), six captions for a 15 s clip in about 4 s, and a 30 s track in 29 s (Studio).

## Run it

```bash
git clone https://github.com/tetherto/qvac-examples
cd qvac-examples/qvac-creator-toolkit-demo
npm install
npm start
```

ffmpeg must be on your PATH (`brew install ffmpeg` on a Mac): the Subtitles tool uses it to decode media, and the app tells you if it is missing.

Models download the first time you use their tool, into the shared `~/.qvac/models/` cache, with a progress bar. The first **Expressive** take downloads MOSS-TTSD (16.7 GB) from the QVAC Registry plus its codec (3.6 GB); the app says so next to the button before you click. The Fast style needs none of that.

**Studio** music uses the 4B planner when `acestep-5Hz-lm-4B-Q8_0.gguf` (from [Serveurperso/ACE-Step-1.5-GGUF](https://huggingface.co/Serveurperso/ACE-Step-1.5-GGUF), MIT) sits in `~/.qvac/models/acestep-hf/`, and the 0.6B planner from the SDK otherwise. The bigger planner gives tracks that move more instead of a short loop.

Two headless checks are wired into the app (no clicking needed):

```bash
npm run selftest   # runs the script tool through the SDK inside Electron's main process, then exits
npm run uitest     # drives the real renderer -> preload -> main -> SDK path, then exits
```

## Offline

Once a tool has downloaded its model, it runs entirely from the local cache. The strongest way to confirm it: cache the models, turn on airplane mode, and generate a voice-over.

## Architecture

- **Main process** (`main/`) owns the SDK. Every `loadModel` and inference call happens there, serialized so the single native worker never has two operations overlapping, unloads included.
- **Renderer** (`renderer/`) is UI only. It talks to main over a small IPC bridge (`preload/preload.js`) and never imports the SDK.
- MOSS-TTSD with its codec (about 20 GB) and the Studio music model (about 8 GB) are never resident together: loading one unloads the other.

## Music details

- **Captions in the shape the ACE-Step authors publish**: genre first, then moods, then four sound sources, as comma-separated keywords, never BPM or key in the caption. Every style names its instruments, and the ambient one says "no percussion".
- **Described sections in `lyrics`**, for example `[Bridge - drums drop out, rhodes only]`, scaled to the length. With the same caption, seeds and model, harmonic repetition at the best lag measured 0.76 and 0.79 with `[Instrumental]` against 0.45 and 0.24 with described sections.
- **Energy is a real BPM** (ACE-Step honours `bpm`: asked 90, measured 90.7). The ambient style sends none.
- **The tail is shaped.** ACE-Step ends early and pads the rest with a low rumble, so the app asks for more than the length chosen, trims the rumble, caps the take near the length asked and fades it out. A take that comes back silent is rejected.

## Packaging

For a distributable app, use the Electron plugin the SDK ships (`@qvac/sdk/electron-forge`), which bundles only what the project needs. Notarizing a macOS build needs an Apple Developer ID.

---

This is an example project demonstrating the QVAC SDK, not a finished product. It is provided as is, without warranty of any kind. Local models write and speak imperfectly, so read and listen to what they produce before you publish it. You are responsible for using it lawfully, including for any content you generate, any audio or video you transcribe, and the rules on synthetic voices where you publish.
