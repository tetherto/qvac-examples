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
