# QVAC Desk Tidy Demo

Sort a messy folder by what its files actually **contain**, not just their extension, and keep it tidy on its own. Invoices, contracts, screenshots, photos, code, installers. It runs entirely on your machine: nothing is uploaded, no account, no cloud.

Built with the [QVAC SDK](https://www.npmjs.com/package/@qvac/sdk). An example, not a product.

## Why local matters here

To sort files by content, something has to read them. A cloud tool means uploading your invoices, contracts and personal documents to be classified, which is exactly the thing nobody should accept. Here the classifier runs on the machine the files are already on, so nothing leaves it.

## How it decides (no LLM)

Text is turned into a vector by **EmbeddingGemma 300M** and matched to the nearest category. This is zero-shot classification with embeddings: no generation, no 4B model over hundreds of files, milliseconds per file. The confidence is the **margin** between the top category and the runner-up, and a small margin means "not sure, leave it alone".

| File type | Signal |
|---|---|
| `.txt`, `.md`, `.csv`, PDFs with text | read the text, embed, match |
| Images and screenshots | a small vision model (Qwen3-VL 2B) reads the image and picks the category |
| Code, installers, archives | their extension is the answer, no AI needed |

Categories are editable and there is always a "not sure" bucket. Below the confidence line, files are left where they are.

## How it fires

- **Manual:** open the window, pick a folder, review the plan, apply, undo. Nothing moves until you click.
- **Every interval:** put a folder on a timer (15 minutes to a day) from the menu bar.
- **When a file lands:** watch a folder and react to new files (it waits for a download to finish before touching it).

Automation has two postures per folder: **Notify-first** (tells you, waits for a click) or **Auto-file** (moves only the files it is confident about, leaves the rest, always with an Undo).

## Safety

Nothing is ever deleted. Name collisions are suffixed, never overwritten. Every move (manual or automatic) is journalled and reversible with Undo. Files below the confidence line are left untouched.

## Requirements

- **Node.js 22.17 or newer.**
- A GPU-capable machine (Apple Silicon with Metal, or a Vulkan GPU on Windows / Linux) is recommended; CPU works but is slower.
- Internet on first run only, to download the models.

### macOS permissions (read this, you will hit it)

macOS protects Desktop, Documents and Downloads with TCC. When you run from a terminal with `npm start`, the permission is attributed to your **terminal**, not this app, so a bare `EPERM` can look like a bug. Two ways around it:

1. Grant your terminal access to the Desktop in **System Settings, Privacy and Security, Files and Folders**, or
2. Just pick folders through the app's **Choose a folder** dialog. A folder chosen through the system dialog comes with consented access, which sidesteps TCC entirely and lets the app work on any folder, not only the Desktop. This is the intended way to use it.

## Recommended hardware

|           | Minimum                          | Recommended                                               |
| --------- | -------------------------------- | --------------------------------------------------------- |
| RAM       | 8 GB                             | 16 GB                                                     |
| Free disk | ~0.3 GB (text only) to ~1.8 GB (with images) |                                              |
| GPU       | works on CPU (slower)            | Apple Silicon (Metal), or a Vulkan GPU on Windows / Linux |
| OS        | macOS 13+, Windows 10+, or Linux |                                                           |
| Runtime   | Node.js 22.17+                   |                                                           |

Models downloaded on first run (cached in the shared `~/.qvac` folder):

- **EmbeddingGemma 300M** (Q4, ~0.3 GB): always. The text classifier.
- **Qwen3-VL 2B** (Q4, ~1.5 GB with its projector): only if the folder has images or scanned PDFs. A text-only folder never downloads it.

## Setup

Install standalone (do not add this to the `test/` workspace, which is pinned to an older SDK):

```bash
cd test/31-desk-tidy
npm install --no-workspaces
npm start
```

Check your machine first with `npx -y @qvac/cli doctor`.

## Try it without risking your real files

Do not point the first run at a Desktop full of important documents. Build the demo folder instead: about
100 realistic files (invoices, contracts, notes, screenshots, banners, photos, recordings, installers,
plus system junk, a private key and a few deliberately vague files) written to
`~/Desktop/Desk Tidy Demo`. Everything in it is synthetic or a repo asset, so it is safe to sort, and
re-running the script resets it for another go.

```bash
node demo/make-demo.cjs
```

There are three test suites, all headless except the last:

```bash
DESK_TIDY_AUTOTEST=/tmp/dt ./node_modules/.bin/electron .   # automation end to end in the real app
```

## Disclaimer

This is a prototype and demonstration, part of the QVAC examples. It is provided as-is, with no support, no warranty, and no SLA, is not maintained as a product, and is not security-audited. It exists to illustrate a use case. See [LICENSE](./LICENSE) for the full Apache 2.0 terms, including the disclaimer of warranty.
