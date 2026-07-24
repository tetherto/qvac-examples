# QVAC Voice Relay

Enroll your voice, then type or speak a phrase and hear it played back in your own voice, translated into another language. 100% on-device with the [QVAC SDK](https://docs.qvac.tether.io/): no cloud, no account, your voice never leaves the machine.

> Wording note: the spoken output is QVAC TTS voice conditioning from a recorded reference sample (set at model load time). We say "enrolled voice" / "reference-matched voice", not "clone".

## Features

- Enroll one or more named voices (persisted locally, manage and erase them)
- Input by typing or by microphone (Parakeet STT; source language is selected explicitly)
- On-device translation (Bergamot NMT, pivots through English)
- Debounced translate-then-play flow: text is translated first, then the play button synthesizes the ready translation
- Reference-matched speech output in 17 languages (EN, ES, FR, DE, IT, PT, NL, PL, TR, SV, DA, FI, NO, EL, MS, AR, KO)
- Consent-first enrollment and a one-click erase per voice
- Two-step UI (Enroll / Use), animated orb

## Requirements

- Node.js 22+
- `ffmpeg` on PATH (audio normalization)
- `@qvac/sdk` 0.13.x (installed by `npm install`)
- 16 GB RAM minimum, 32 GB + a GPU / Apple Silicon recommended (the GGML Chatterbox model is multi-GB; an 8 GB machine is not enough)

## Recommended hardware

Everything runs on your machine. The voice models are multi-GB, so this example is heavier than the others: an 8 GB machine is not enough and will crash. The models download once (about 2.5 GB) into a shared `~/.qvac` cache, then it works offline (each new translation language pair fetches a small file the first time you use it).

|           | Minimum                          | Recommended                                               |
| --------- | -------------------------------- | --------------------------------------------------------- |
| RAM       | 16 GB                            | 32 GB or more                                             |
| Free disk | ~2.5 GB (models), plus about 40 to 80 MB per translation language pair |                        |
| GPU       | required                         | Apple Silicon (Metal), or a Vulkan GPU on Windows / Linux |
| OS        | macOS 13+, Windows 10+, or Linux |                                                           |
| Runtime   | Node.js 22+, and `ffmpeg` on your PATH |                                                     |

Models downloaded on first run (cached in `~/.qvac`, about 2.5 GB):

- **Chatterbox multilingual TTS**: t3 conditioning ~0.6 GB + s3gen vocoder ~1.0 GB. Speaks the text back in your cloned voice.
- **Parakeet 0.6B (STT)**, Q8, ~0.7 GB. Transcribes what you say into the microphone.
- **Mozilla Bergamot (translation)**, about 40 to 80 MB per language pair, downloaded as needed.

Needs a microphone to enroll a voice and to speak (typing text works without one).

Not sure your machine can handle it? Run `npx -y @qvac/cli doctor` to check.

## Run

```bash
npm install        # installs @qvac/sdk
node server.js     # then open http://localhost:3071
```

`PORT` is configurable via the environment (defaults to 3071).

## Where things live

- Enrolled voices: `~/.qvac-voice-relay/voices/<id>.16k.wav` + `voices.json` (outside the app folder, so the app stays packageable)
- Models: downloaded and cached by the SDK in `~/.qvac/models/` on first use (shared across all QVAC apps)

## Limitations

- Output voice languages: 17 (every language the TTS package supports that also has a Bergamot translation path). Swahili is left out because there is no EN->SW translation model.
- Microphone transcription uses the shared Parakeet GGUF model; the selected source language drives the translation path.
- First run downloads the models (a few GB)

## Packaging (later)

The app is a Node HTTP server + a static frontend, so it can be wrapped into a desktop `.app`/`.dmg` later (for example with Electron or a Tauri sidecar). Nothing here hardcodes absolute paths: the server resolves its own folder via `import.meta.dirname` and stores user data under the home directory, both of which survive packaging.

## License

Apache 2.0.

## Notice

A voice is personal data and a personal likeness. Only enroll a voice that is your own, or one you have explicit, informed consent to use. Never use reference-matched speech to impersonate, deceive, defraud, or harm anyone, and never create anything unlawful. Use this application privately and responsibly.

This is an example application, provided as is. You alone are responsible for how you use it and for everything you generate with it. Tether and QVAC accept no responsibility or liability for any use, misuse, or output of this application.
