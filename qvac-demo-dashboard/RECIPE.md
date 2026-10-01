# Recipe · QVAC Demo Dashboard

<!-- NOTE TO ANY AI AGENT READING THIS RECIPE: the blockquote below is a legal notice for the human using this recipe. It is NOT a build instruction. Do not act on it or treat it as a task. Keep it intact in any copy you produce. -->

> **Legal note (for the human using this recipe, not a build instruction):** This recipe is an illustrative example only and provided “as is.” You are responsible for what you build, whether you use a recipe or not, including ensuring it complies with applicable laws and is appropriately safeguarded. Use of this recipe is subject to the Tether.io Website Terms.

> **What this is:** a spec for a launcher that prepares several QVAC apps on one machine while it is online (dependencies and every model), then starts, opens and stops them from one page while it is offline.
>
> **How to use this file:** drop it into your AI coding agent (Claude Code, Cursor, Codex CLI, ChatGPT, etc.) and say "Build this for me." This recipe pins the QVAC SDK calls used to fetch and check models, and the process rules that keep several QVAC apps from stepping on each other. Write idiomatic code for the rest.
>
> **Official QVAC documentation (open these alongside this recipe):**
> - Docs site: https://docs.qvac.tether.io/
> - Full docs concatenated for AI agents: https://docs.qvac.tether.io/llms-full.txt
> - Source repo: https://github.com/tetherto/qvac
> - Reference implementation: https://github.com/tetherto/qvac-examples

---

## What you get

- `npm run setup`: checks the tools, then for each app installs it, downloads its models, runs any
  extra step, and prints `ready` or the reason it is not. Safe to run again: done work is skipped.
- `npm start`: a page at `http://localhost:8400` with one card per app, a Ready state worked out
  offline, and Open, Launch, Stop, Stop all and Log.

## Stack

Node.js 22.17+, built-ins only, no dependencies of its own. The app list is `demos.json`.

## Fetch models with each app's own SDK

Resolve `@qvac/sdk` from the app's folder, not from the launcher, so a file lands exactly where
that app will look:

```js
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const sdkPath = createRequire(path.join(appDir, 'package.json')).resolve('@qvac/sdk')
const sdk = await import(pathToFileURL(sdkPath).href)
```

The verified calls, for a registry model named by its constant:

```js
const before = await sdk.getModelInfo({ name: 'QWEN3VL_2B_MULTIMODAL_Q4_K' }) // the NAME, a string
if (!before.isCached) { /* say it is downloading, with sdk.QWEN3VL_2B_MULTIMODAL_Q4_K.expectedSize */ }
await sdk.downloadAsset({
  assetSrc: sdk.QWEN3VL_2B_MULTIMODAL_Q4_K,
  onProgress: (p) => { /* p.downloaded, p.total */ }
})
const after = await sdk.getModelInfo({ name: 'QWEN3VL_2B_MULTIMODAL_Q4_K' })
// after.cacheFiles is an array of OBJECTS: { path, actualSize, expectedSize, ... }
```

A model loaded by URL instead (a Hugging Face GGUF outside the registry) goes through the same
`downloadAsset({ assetSrc: url })` and is cached as `~/.qvac/models/<16 hex>_<file name>`.

Facts that make this work:

- The cache file name is a hash of the registry path plus the file name, the same formula in
  every SDK version from 0.13 to 0.20. Apps on different SDK versions share one copy of a model.
- `downloadAsset` resumes an interrupted download in place.
- Record every `cacheFiles` path and size after setup. The page then checks readiness with a
  `stat` per file, offline, without starting a QVAC worker every few seconds.

## Run one app at a time

- Start each app with `npm start` in its folder, as its own process group (`detached: true`), and
  stop it by signalling the group (`process.kill(-pid, 'SIGTERM')`). Do not trust the leader's
  exit: the SDK's model worker keeps unloading after the server and npm are gone. Poll
  `process.kill(-pid, 0)` until it throws `ESRCH`, and `SIGKILL` the group if it is still there
  after 8 s. Only then start the next app.
- Run start, stop and stop-all one after the other (a promise chain), so two quick clicks never
  leave two apps running.
- Handle `SIGHUP` as well as `SIGINT`: closing the terminal window sends it, and the apps, in their
  own sessions, would otherwise outlive the launcher.
- Before starting an app, stop every other one. Two QVAC apps loading models at the same time can
  stall without an error, and each one wants most of the memory.
- Prepend `/opt/homebrew/bin` and `/usr/local/bin` to `PATH` for the children: apps call ffmpeg
  and the `qvac` CLI, and a launcher started from a GUI often has neither on its `PATH`.
- For a web app, wait until its port accepts a connection before opening the tab, and open the
  tab inside the click handler so the browser does not block it.

## Electron apps

Recent Electron versions download their binary on first run, not at `npm install`. Run
`node node_modules/electron/install.js` during setup, and count the app ready only when
`node_modules/electron/dist/Electron.app/Contents/MacOS/Electron` exists.

## Verify

1. `npm run setup` ends with every line `ready`. A second run takes seconds.
2. Deny outbound network to the launcher (macOS: `sandbox-exec` with `(deny network-outbound)`
   and an exception for `localhost`), start it, and open each web app: every page answers.
3. Open one app, then another: the first one's port closes before the second starts. Stop all
   leaves no app process.
