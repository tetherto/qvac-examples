# QVAC Music Desk Demo

Describe the music you want in a sentence, and get it. A local web app for on-device music
generation on the [QVAC](https://qvac.tether.io) stack. Nothing is uploaded, no account, no API key.

<picture>
  <source media="(prefers-color-scheme: dark)"  srcset="docs/badges/built-with-qvac-dark-mode-landscape.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/badges/built-with-qvac-light-mode-landscape.svg">
  <img alt="Built with QVAC" src="docs/badges/built-with-qvac-light-mode-landscape.svg" width="200">
</picture>

---

## Quickstart

```bash
npm install
npm start
# open http://localhost:3055
```

On first run the app has no model. The screen shows a banner with a **Download 3.3 GB** button
that fetches the four ACE-Step stages into `~/.qvac/models`, where every QVAC app shares them.
Nothing is downloaded without that click.

Then there are two ways to work, and they share one song sheet:

- **Prompt**: write a sentence, press **Write the sheet**, and a local 4B model turns it into a
  style, lyrics, tempo, key and length. Edit anything; an edited field is never overwritten.
- **Manual**: pick a genre, a voice and an era, stack moods, instruments and production words,
  and write the style yourself. The filter field on each row is how you find one of fifty-nine
  instruments: type `guit`.

## The event build, `/stand`

`http://localhost:3055/stand` is the same server, the same engine and the same models behind a
front end built for somebody who has never seen it: **three picks and a button**.

| | |
|---|---|
| Pick a style, a mood and an instrument | all three the same control, one option always selected |
| The prompt is on screen while they build it | and it is the conformed caption, so it is what the engine gets |
| Type your own words | optional, appended as keywords, highlighted in the prompt |
| Then, on the track they made | restyle it, make it longer, another take |
| Resets itself | 90 s idle, or `?idle=<seconds>` |

It is designed around one measurement: generation cost is **almost independent of length** on this machine (30 s of audio
is 11.5 s wall, 10 s of audio is 9.7 s), so shortening clips buys nothing and the wait is a floor
to spend well rather than a dial to turn down. Three takes by default would have been 35 s of
waiting, and the prompt-to-sheet step would have paid the floor twice.

### The one rule to keep

**The styles and the composer live in `lib/stand-styles.mjs` and nowhere else.** The browser
imports it through the server's `/lib` route, and `bin/compose-check.mjs` runs its gates against
the same file, so the tested composer is the shipped one. Run it after touching either:

```bash
node bin/compose-check.mjs     # non-zero if any gate fails
```

Five gates: every option is a term in `lib/vocab.mjs`; all 150 style/mood/instrument combinations
land in the authors' 5 to 12 keyword window after `conformCaption`; 17 adversarial typed inputs
(tempo, key, time signature, a lead vocal in an instrumental take, a third genre, prose); genre
position and count, metadata leakage and vocals across 120 captions; and determinism.

The budget is `TAG_TARGET.high - 1`, not `high`, because `conformCaption` **appends** `no vocals`
to an instrumental take. Capping at the target emitted 13-keyword captions on three combinations.

Files: `public/stand.html`, `public/stand.css`, `public/stand.js`, `lib/stand-styles.mjs`, plus
the `/stand` and `/lib` routes in `server.js`.

---

## Recommended hardware

| | Requirement |
|---|---|
| **RAM** | 16 GB or more. A render needs roughly 8 GB free |
| **Disk** | About 6 GB: 2.6 GB for `node_modules` and 3.3 GB for the four ACE-Step files in `~/.qvac/models/` |
| **GPU** | Apple Silicon (Metal). Linux and Windows on x64 or arm64 are supported by the engine but not tested here |
| **Speed** | Apple M5 Max: a 30 s instrumental in about 11 s, a 10 s one in about 10 s |

## Requirements

- **Node.js** 22.17 or higher
- **ffmpeg** and **ffprobe** on `PATH` (`brew install ffmpeg`). Needed to import your own audio,
  and for every task that starts from a take you already made: on `/stand` that is "Same song,
  new style" and "Make it longer"

The server listens on `127.0.0.1`, this computer only. `HOST=0.0.0.0 npm start` opens it to your
network.

---

## For an agent working on this repo

Read this section before changing anything. It is the short version of what took a rebuild to learn.

### What the app is

| | |
|---|---|
| Port | `3055` |
| Server | `server.js`, Node, no framework, no build step |
| Client | `public/`, plain ES5-style JS, no framework, no bundler |
| Engine | `@qvac/audiogen-ggml`, a **Bare** native addon |
| Writing model | `@qvac/sdk`, optional, only for the Prompt mode expander |

**The engine cannot be required from Node.** `binding.js` is `require.addon()`, so every call into
it runs as a `bare` child process: `engine/worker.cjs` for a render, `engine/caps.cjs` for the
capability probe. If you add an engine call, it goes in a `.cjs` under `engine/` and it needs
`require('bare-process')` because Bare has no ambient `process`.

### Two modes, one song sheet

```
Prompt mode                          Manual mode
  brief textarea                       preset chips per dimension
  Write the sheet  -> local LLM        the fields, filled by hand
  Surprise me      -> engine simpleMode
        \                    /
         \                  /
        the song sheet (caption, lyrics, bpm, key, time, language, duration)
                     |
                 the engine
```

**The rule that holds the design together: a field the user has edited is never recomputed.**
`st.touched` in `public/app.js` records it, `/api/sheet` receives it as `keep`, and
`lib/sheet.mjs` writes those values back over whatever the model said. Break this and the friendly
door gets a ceiling and the expert door becomes a second product.

### The HTTP API

| Method and path | Body | Does |
|---|---|---|
| `GET /api/state` | | Everything: models, capabilities, takes, library, job, vocabulary, machine |
| `GET /api/events` | | SSE. Events: `job`, `take`, `queue`, `failed`, `library`, `models`, `download`, `ready` |
| `GET /api/models/catalogue` | | Every fetchable asset with size and whether it is on disk |
| `POST /api/models/download` | `{keys:[...]}` | Fetches those assets, progress on the `download` event |
| `POST /api/models` | `{mm3Dir}` | Points the desk at your MiniMax folder and rescans |
| `POST /api/sheet` | `{brief, keep}` | Expands a brief into a sheet. Needs the writing model |
| `POST /api/render` | see below | Queues one to four takes |
| `POST /api/cancel` | | Kills the running render and clears the queue |
| `POST /api/import` | raw bytes, `x-filename` header | Imports audio, converts it for the engine |
| `GET /api/audio/out/<file>` | | Serves a take, with Range support |

`POST /api/render` takes a task, never an engine:

```jsonc
{
  "task": "compose",        // compose | surprise | cover | repaint | extend | flow-edit | stem
  "sheet": { "caption": "...", "lyrics": "[Instrumental]", "instrumental": true,
             "bpm": 0, "keyscale": "", "timesignature": "", "vocalLanguage": "", "duration": 60 },
  "prefer": "fast",         // fast (turbo-q4) | detailed (sft, 50 steps) | vocals (MiniMax)
  "seed": 4242,
  "variations": 3,          // 1 to 4, rendered one at a time
  "formats": ["wav"],
  "source":    { "kind": "take", "id": "..." },   // required by cover, repaint, extend, flow-edit, stem
  "reference": { "kind": "library", "id": "..." },
  "op": { },                // per-task, see lib/ and server.js translateRequest()
  "coverStrength": "moderate",  // dramatic | moderate | subtle
  "track": "drums",             // stems only, one of caps.legoTracks
  "advanced": { }
}
```

### Rules that are not style preferences

1. **Never hand-write a capability table.** `engine/caps.cjs` asks the installed addon what it
   accepts: what it exports, and what its validator refuses when you call `run()` on paths that do
   not exist. The pass signal is the message `AudioGen is not loaded. Call load() first.`, which
   means every option cleared validation. A previous version carried a table, `package.json` pins
   the addon with a caret, `0.3.3` installed itself over `0.3.2` and the UI started lying.
2. **A prompt is a request. Code is the mechanism.** Every guard in `lib/sheet.mjs` exists because
   a rule in the system prompt was measured being ignored. See the next section.
3. **No standing paragraphs in the UI.** Explanation goes in a `title` on a help glyph, in a
   placeholder, or nowhere. The app once carried 229 words of grey body copy and the controls were
   hard to find. The front-end rules that are measurable are enforced: four type sizes (11, 12, 14, 16),
   spacing only from `4 8 12 16 24 32`, three radii, every text at 4.5:1 or better, every target
   24px or bigger, no internal identifier on screen, and one primary action per state.
4. **Verify a model file by size, not by name.** An interrupted download leaves a short file under
   its final name with no partial marker, and the desk offered a 208 MB stub of a 2.55 GB DiT as a
   usable variant. `isTruncated()` in `server.js` compares against the registry's `expectedSize`.
5. **One engine process at a time.** Two at once on a 39 GB machine meets the out-of-memory killer.
   Variations go through `state.queue`.
6. **Each render judges only its own job.** With a queue, `state.job` may already hold the next
   variation when a child exits. Writing to it from a stale handler marked a healthy render failed.

### How to prompt the music model

From the ACE-Step 1.5 authors' own `docs/en/Tutorial.md` and their five published example tag
sets. This is most of the quality, and this app enforces it in `lib/caption.mjs` rather than
asking politely, because a rule that lives only in a system prompt is a rule that gets ignored.

- **The style is a comma-separated keyword list, not prose.** Genre first, then two or three
  moods, then four or five specific instruments, then the vocal character, then one or two
  production words, then an era. Their own example:
  `lo-fi hip-hop, boom bap, dusty drums, vinyl crackle, jazz sample, upright bass, rhodes piano,
  muted trumpet, male vocals, rap vocals, laid-back, warm, 90s`
- **5 to 12 keywords. Past 15 they dilute each other.** Prose spends the budget on words the model
  cannot use: `Robotic Mexican folk, with mechanical guitar and electronic accordion, blending
  traditional sounds with digital textures` is sixteen words and **four keywords**. Measured, same
  seed, 30 s instrumental: a five-keyword style locked a tempo at correlation **0.709** that
  nobody asked for; the same music as twelve keywords measured **0.253**.
- **Specific beats vague.** "grand piano" over "piano", "fingerpicked acoustic guitar" over
  "guitar". The vocabulary in `lib/vocab.mjs` is written that way on purpose.
- **Never put tempo, key or time signature in the style.** They are parameters. `conformCaption()`
  takes them out and says so on the take.
- **Conflicts are the failure the authors name twice.** A lead vocal in an instrumental request,
  or "no vocals" in a request that has lyrics. A wordless choir is not a conflict: their own
  cinematic example carries `choir ooh` and `no vocals` together, so an instrumental take rewrites
  "layered choir" to "choir ooh" instead of dropping it.
- **One primary genre plus one modifier.** A third genre is dropped.
- **A style of pure mood produces a drum beat.** It names nothing that plays, so the model falls
  back on its prior. Say "no percussion" when there should be none.
- **Structure tags go in the lyrics, never in the style.** That field is what the arrangement
  stage reads. Measured: style-only takes had a 0.18 to 1.05 dB loudness spread across the track,
  which is one loop; structure tags reached 4.74 dB.
- Lyrics: 6 to 10 syllables a line, about 90 to 140 words per 47 seconds. Duration from the
  section count: two verses and two choruses need 120 s or more.

The two engines use **different structure-tag vocabularies**, so `lib/vocab.mjs` rewrites them for
whichever engine is about to read them and reports every change on the take.

### Which generator runs, and why it matters

Only the DiT changes between ACE-Step variants, and it is the quality axis. This app shipped for
weeks always loading `turbo-q4`, which is the draft one, and the model got blamed for it.

| Variant | Steps | CFG | Size | Compute here | What it is |
|---|---|---|---|---|---|
| `turbo-q4` | 8 | fixed at 1, so guidance does nothing | 1.4 GB | 0.12 to 0.20x | the default, for sketching |
| `turbo-q8` | 8 | fixed at 1 | 2.5 GB | not measured | same schedule, better weights |
| `sft` | 50 | works, authors' default 7.0 | 2.5 GB | 0.56 to 0.76x | the quality reference |

The **Quality** control picks one: Fast is `turbo-q4`, Detailed is `sft` (or `turbo-q8` if that is
what is on disk), Richer vocals switches engine to MiniMax-Music3. `pickDit()` in `server.js`.
Detailed is disabled with a reason until the 2.5 GB file is fetched from the Info panel.

Note that the addon refuses `inferenceSteps` and `cfgScale` for ACE-Step: the schedule is
auto-tuned to the variant you loaded. `guidanceScale` is accepted and only means anything on
`sft`.

### Measured performance on an M-series laptop

Compute divided by audio length, lower is faster.

| | ACE-Step turbo-q4 | ACE-Step sft, 50 steps | MiniMax-Music3 |
|---|---|---|---|
| Text to music | **0.12 to 0.29x** | 0.56 to 0.76x | 4.37x |
| Reference, cover, repaint, extend, stems | yes | yes, except Flow-Edit | refused by name |
| Output | 48 kHz stereo | 48 kHz stereo | 44.1 kHz stereo |

So the engine is decided by the task, not asked as a question. `engineFor()` in `server.js`.

### Verify a change

```bash
node --check server.js && node --check public/app.js
node engine/caps.cjs        # will fail: it needs bare
bare engine/caps.cjs        # prints the capability probe as one JSON line
npm start                   # then exercise the flow in a browser
```

Two things that a static read of the code will not catch, and both have bitten:

- **Click the primary flow.** Deleting an element breaks the code that wrote to it: a purge of
  standing paragraphs removed a hint element, the handler behind **Write the sheet** still set its
  `textContent`, and the button died silently while every screenshot still looked right.
- **Measure the audio, do not describe it.** The caption rules above were checked by measuring
  tempo lock and loudness spread on rendered takes, not asserted.

There is no test suite. Verification here is a browser and the measurement scripts: an interrupted
download, a truncated file, a mood-only caption and a queue of three takes are all real bugs this
app has had, and all four were found by running it rather than by reading it.

---

## Models

Nothing is bundled and nothing downloads on its own.

| What | Size | How you get it |
|---|---|---|
| ACE-Step 1.5, four stages with the 8-step generator | 3.3 GB | The in-app Download button, or the Info panel |
| The 50-step generator, for Quality: Detailed | 2.5 GB | The Info panel. Optional, and the one that raises quality |
| Qwen3 4B, the brief expander | 2.5 GB | The Info panel. Optional: Manual mode and Surprise me work without it |
| MiniMax-Music3 | 12.7 GB | **Yours to supply.** Not distributed by QVAC |

MiniMax-Music3 is under the MiniMax-Music3 Community Licence and this project does not ship it.
Point the desk at a folder holding `mm3-lm-*.gguf` and `mm3-synth-*.gguf`, in the Info panel or
with `MM3_DIR=/path npm start`. Without it, everything except the "Richer vocals" quality option
works.

Environment variables: `PORT`, `HOST`, `MM3_DIR`, `ACESTEP_DIR`.

## What it can do

Every operation lives on the take it applies to, and none of them is called by its API name.

| The call | What you press |
|---|---|
| text to music | Make music |
| `simpleMode` | Surprise me |
| a batch of seeds | Takes, 1 to 4 |
| `referenceAudio` | Use as reference |
| `taskType: 'cover-nofsq'` | Cover it, then Dramatic, Moderate or Subtle |
| `repaint` | Change this part, after dragging a range on the waveform |
| repaint on appended silence | Make it longer |
| `flowEdit` | Restyle it |
| `taskType: 'lego'` | Pull out a stem, 12 layers, needs the base DiT |

## Not in this version

- **Stems need the ACE-Step base DiT**, which the addon's own README says is not in the registry
  variant set yet, so it has to be supplied as an explicit path. The button says so.
- **`augmentCaptionWithMetadata`** does the one thing the ACE-Step authors list under things not to
  do. It is off, labelled, and unmeasured either way.
- **Surprise me cannot honour a length.** Measured: asked for 8 s it produced 28.2 s, asked for
  16 s it produced 36.2 s, repeatably per seed. It promises a song, not a duration.
- **No mp3 export.** The addon's encoder does not list it. Thirteen other formats do work:
  pcm, wav, flac, alac, aiff, caf, m4a, aac, opus, ogg, ac3, wma, mp2.
- No test suite, no auth, no multi-user. It binds to `127.0.0.1` and is meant to.

## Layout

```
server.js              HTTP, model discovery, task routing, the render queue
engine/worker.cjs      one render, under bare
engine/caps.cjs        the capability probe, under bare
lib/sheet.mjs          the brief expander and its guards
lib/caption.mjs        the authors' caption rules, as a mechanism
lib/vocab.mjs          the vocabulary, tag translation, the cover-strength table
public/                index.html, app.js, styles.css: the full desk
public/stand.*        the event build at /stand
lib/stand-styles.mjs   the event build's styles and caption composer
bin/compose-check.mjs  the composer gates
```

## Licence

Apache-2.0, see [LICENSE](LICENSE). Model weights are under their own licences and none of them
are included here. The Geist typeface in `public/assets` is the SIL Open Font License 1.1 and
carries its own licence file next to it.
