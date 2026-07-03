# QVAC Examples

Example applications and code samples built with the [QVAC SDK](https://docs.qvac.tether.io/) — Tether's toolkit for running AI locally, privately, and on-device.

Each example here is a focused, self-contained app demonstrating one real-world use case for local AI: what becomes possible when intelligence runs on your own machine instead of someone else's cloud — no data leaving the device, no permission required.

## ⚠️ These are examples, not products

The apps in this repository are **prototypes and demonstrations**.

- Provided **as-is, with no support, no warranty, and no SLA**.
- **Not maintained as products** — they may break, lag behind the SDK, or be removed.
- **Not security-audited** — do **not** use them in production or with real, sensitive data.
- They exist to **illustrate use cases and teach**.

See [LICENSE](./LICENSE) for the full Apache 2.0 terms, including the disclaimer of warranty.

## What's inside

Every example lives in its own directory named `qvac-{app-name}` and is fully self-contained — its own code, its own setup steps, and its own README explaining what it does and why local AI matters for that use case.

| App | Description |
|-----|-------------|
| [`qvac-natural-language-to-sql`](./qvac-natural-language-to-sql) | Ask a banking database questions in plain English and watch a local AI (Qwen3 4B) write the SQL, then run it on-device against an in-memory SQLite bank. The schema and your question are the only things the model ever sees — no row data, no cloud, no API keys. |
| [`qvac-story-image-generator`](./qvac-story-image-generator) | Turn a child into the hero of a five-scene illustrated storybook, fully on-device. A local AI (Qwen3 4B) writes the captions while the child's own photo is composited into hand-drawn vector art right in the app. Only the story name and character ever reach the model — the photo never leaves the machine, and there is no image model to regenerate (and lose) the child's face. No cloud, no API keys. |
| [`qvac-realtime-vision`](./qvac-realtime-vision) | Point your webcam at the world and a local AI draws boxes around objects, tracks your hands and reads your gestures, and narrates the scene in one sentence, then turns the same on-device vision into two body-controlled mini-games. Detection and hands run on `@qvac/onnx`, narration on Qwen3-VL via `@qvac/sdk`. No cloud, no API keys, and offline after a one-time model download. |
| [`qvac-coffee-conversation`](./qvac-coffee-conversation) | Walk up to a coffee kiosk and just talk. A local voice agent hears you in your own language (English, French, Spanish, Italian), reasons and calls tools in a small on-device LLM (Qwen3 8B), reads your order back, and settles it in Bitcoin sats with a Lightning QR. Speech recognition (Parakeet), translation (Bergamot), the agent, and the voice (Chatterbox) all run on `@qvac/sdk`. Hands-free with barge-in, push-to-talk fallback, mock payments by default. No cloud, no API keys, your voice never leaves the machine. |
| [`qvac-voice-relay`](./qvac-voice-relay) | Enroll your own voice once, then type or speak a phrase and hear it played back in your voice, translated into another language. Speech recognition (Whisper), translation (Bergamot, pivoting through English), and reference-matched speech in 17 languages (Chatterbox) all run on `@qvac/sdk`. Consent-first enrollment, one-click erase, and your voice never leaves the device. |

## Running an example

Each app documents its own prerequisites and run steps:

1. Open the app's directory (`qvac-{app-name}/`).
2. Read its `README.md`.
3. Follow the install and run instructions there.

## About QVAC

QVAC is an open-source, cross-platform ecosystem for building local-first, peer-to-peer AI applications and systems. With QVAC, you can run AI tasks like LLMs, speech, RAG, and more locally across Linux, macOS, Windows, Android, and iOS — or delegate inference to peers using its built-in P2P capabilities.

Learn more at [qvac.tether.io](https://qvac.tether.io/), read the docs at [docs.qvac.tether.io](https://docs.qvac.tether.io/), or explore the SDK on [GitHub](https://github.com/tetherto/qvac).

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](./LICENSE).

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

Copyright © 2026 Tether Data, S.A. de C.V.
