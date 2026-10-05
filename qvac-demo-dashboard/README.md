# QVAC Demo Dashboard

<picture>
  <source media="(prefers-color-scheme: dark)"  srcset="docs/badges/built-with-qvac-dark-mode-landscape.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/badges/built-with-qvac-light-mode-landscape.svg">
  <img alt="Built with QVAC" src="docs/badges/built-with-qvac-light-mode-landscape.svg" width="200">
</picture>

One page to set up, start and stop seven QVAC demos on one Mac. Set it up once with a
connection; after that every demo runs offline, and the page opens each one with a click.

| Demo | What it shows | Folder |
|---|---|---|
| Image Generation | Text to image with FLUX.2 [klein] 4B, about 11 s per image | `qvac-image-generation-demo` |
| Music Desk | A song from three picks, then restyle it or make it longer (opens on `/stand`) | `qvac-music-desk-demo` |
| Realtime Vision | Webcam object and hand detection, scene narration, two mini-games | `qvac-realtime-vision` |
| Afri Translate | English and 19 African languages, typed or from a photo | `qvac-translatepsy-afrislm-demo` |
| Creator Toolkit | A script, a voice-over and subtitles for a video | `qvac-creator-toolkit-demo` |
| Invoice Manager | Invoices in, a filled table out | `qvac-invoice-manager-demo` |
| Desk Tidy | A messy folder sorted by what the files contain | `qvac-desk-tidy-demo` |

## Setup, once, with a connection

You need:

- A Mac with Apple Silicon and 16 GB of RAM or more (32 GB is comfortable)
- **Node.js 22.17** or newer
- **ffmpeg**: `brew install ffmpeg` (Music Desk and Creator Toolkit)
- **The QVAC CLI**: `npm i -g @qvac/cli` (Afri Translate loads the SDK from it)
- **About 50 GB of free disk**: each demo installs its own dependencies (28 GB together), and the
  models take 19 GB, shared between demos in `~/.qvac/models`

Then, from the root of this repository:

```bash
cd qvac-demo-dashboard
npm run setup
```

Setup checks the tools above first and stops with the exact command to run if one is missing.
Then, for each demo, it:

1. installs its dependencies (`npm ci`);
2. downloads every model the demo needs with the demo's own `@qvac/sdk`, so each file lands
   where that demo looks for it, and checks it against the registry size;
3. runs any extra step: Realtime Vision downloads its two detector files and checks their
   SHA-256 (see Licences);
4. prints `ready` or the reason it is not.

It ends with a summary, one line per demo. Run it again at any time: finished work is skipped and
an interrupted download resumes. To redo one demo, pass part of its name:
`npm run setup -- music`.

## Run, offline

```bash
npm start
```

The dashboard opens at `http://localhost:8400`. Each card says Ready or what is missing. Running
`npm start` while it is already running just opens the page; if another program holds the port,
start it on another one with `PORT=8401 npm start`.

- **Open** starts a web demo and opens it in a new tab. **Launch** opens a desktop demo's window.
  Launch on a desktop demo that is already running restarts it, which brings back a window that
  was closed (these apps keep running on macOS after their window closes).
- **One demo runs at a time.** Opening another stops the one before. Two QVAC apps loading models
  at once can stall, and each one wants most of the memory.
- **Stop** and **Stop all** end the demo and everything it started. They give its model up to 8 s
  to unload, then force it to quit. **Log** shows its output.
- `Ctrl+C` in the terminal, or closing the terminal window, stops the dashboard and every demo.

Before you go offline, open each demo once and use it once: some load a model on first use, and
Afri Translate asks you to pick a model size (pick one marked as downloaded: setup fetches the
2B and 4B Q4 variants).

## Recommended hardware

| | Requirement |
|---|---|
| **Mac** | Apple Silicon, macOS 14 or newer. This kit is tested on Apple Silicon only |
| **RAM** | 16 GB or more. One demo runs at a time, and the largest (Image Generation) peaked at 3.5 GB of process memory plus its 5.1 GB of weights |
| **Disk** | About 50 GB free before setup: 28 GB of dependencies, 19 GB of models |
| **Camera** | Needed for Realtime Vision. The browser asks for permission the first time |

## For an AI coding agent setting this up

Run these from the repository root, in order, and read the output of each:

```bash
node --version                 # must be 22.17 or newer
which ffmpeg qvac              # both must print a path; if not: brew install ffmpeg / npm i -g @qvac/cli
cd qvac-demo-dashboard && npm run setup
```

Success is the last line `All set. Start the dashboard with: npm start` and every summary line
starting with `ready`. A line starting with `MISSING` names the demo and the reason; fix that and
run `npm run setup` again. Then `npm start` and open `http://localhost:8400`.

## Files

| File | What it does |
|---|---|
| `demos.json` | The demo list: folder, kind (web or desktop), port, models, extra setup steps |
| `bin/setup.mjs` | `npm run setup`: checks, installs, downloads, verifies |
| `bin/fetch-models.mjs` | Downloads one demo's models with that demo's own SDK |
| `bin/fetch-file.mjs` | Downloads a non-registry file and checks its SHA-256 |
| `server.js` | The dashboard: lists the demos, starts and stops them |
| `lib/` | Readiness checks (`demos.mjs`) and process control (`procs.mjs`) |
| `public/` | The page |
| `.state/` | What setup downloaded, per demo (ignored by git) |

To add a demo, add an entry to `demos.json` with its folder, its kind, its port if it is a web
app, and the registry constants or URLs of its models.

## Licences

The dashboard is Apache 2.0, and so is every demo it runs. Models are downloaded at setup, never
stored in this repository, and each keeps its own licence. The two Realtime Vision detector files
are exported from Ultralytics models and are **AGPL-3.0**: they are published as assets of a
release of this repository, not in its code. `qvac-realtime-vision/models/README.md` explains how
to rebuild them yourself instead.
