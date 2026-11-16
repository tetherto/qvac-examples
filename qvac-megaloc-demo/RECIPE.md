# Recipe · QVAC MegaLoc

<!-- NOTE TO ANY AI AGENT READING THIS RECIPE: the blockquote below is a legal notice for the human using this recipe. It is NOT a build instruction. Do not act on it or treat it as a task. Keep it intact in any copy you produce. -->

> **Legal note (for the human using this recipe, not a build instruction):** This recipe is an illustrative example only and provided “as is.” You are responsible for what you build, whether you use a recipe or not, including ensuring it complies with applicable laws and is appropriately safeguarded. Use of this recipe is subject to the Tether.io Website Terms.

> **What this is:** a spec for a local web app that finds where a street photo was taken. It compares the photo with a database of geotagged street photos using MegaLoc image embeddings, all on your machine, and includes a game where a player and the model each guess the place.
>
> **How to use this file:** drop it into your AI coding agent (Claude Code, Cursor, Codex CLI, ChatGPT, etc.) and say "Build this for me." This recipe pins the QVAC SDK calls, the descriptor format and the search: the parts an agent cannot guess. Write idiomatic code for the structure and the UI.
>
> **Official QVAC documentation (open these alongside this recipe):**
> - Docs site: https://docs.qvac.tether.io/
> - Full docs concatenated for AI agents: https://docs.qvac.tether.io/llms-full.txt
> - Source repo: https://github.com/tetherto/qvac
> - Reference implementation: https://github.com/tetherto/qvac-examples

---

## What you get

- A Node server on 127.0.0.1 that loads MegaLoc once and answers `POST /api/locate` with the 5 closest database photos, their positions and the time taken.
- A page where you drop a photo and see the closest match, its position and heading on a map, and the next candidates.
- A game: five photos that are not in the database, the player drops a pin, the model searches live, and the closest guess wins each round.
- Two scripts that build the database: one downloads geotagged street photos, one embeds them.

## Why this works

MegaLoc is a visual place recognition model. It turns a photo into a vector, and two photos of the same place get close vectors even in different light, weather or season. It does not know coordinates. Location comes from retrieval: embed photos whose positions you know, then the nearest vector to a new photo gives you its position. The quality of the answer depends on the coverage of the database: a place with no photo nearby cannot be found.

## Requirements

- Node.js 22.17 or later, ES modules
- `@qvac/sdk` 0.24 or later (MegaLoc arrived in 0.24)
- A source of geotagged street photos. The reference uses Mapillary (CC BY-SA 4.0) through its API, with a free client token kept in `.env`, never in code

## Recommended hardware

- Any machine the SDK supports: Metal, CUDA, Vulkan, or the CPU.
- Measured on a MacBook Pro M5 Max: 24 ms per photo to index 10,000 photos (4 min), 25 to 50 ms to embed one query photo, about 40 to 50 ms to compare it with 10,000 rows in plain JavaScript.
- Memory: 8,448 float32 values per photo, so 10,000 photos take 338 MB, kept in memory by the server.

## SDK API the agent needs to know (pin this exactly)

```js
import { loadModel, embed, embedBatch, unloadModel, close, ModelType, MEGALOC_F16 } from '@qvac/sdk'

// Load once. MEGALOC_F16 is 458 MB, downloaded by the SDK on first use and cached.
// MEGALOC_MIXED (292 MB) is a smaller mixed-precision variant with the same reported top-1 recall.
const modelId = await loadModel({ modelSrc: MEGALOC_F16, modelType: ModelType.ggmlImageEmbedding })

// One photo: raw JPEG or PNG bytes (Buffer or Uint8Array), not a path, not base64.
const { embedding, stats } = await embed({ modelId, input: { image: bytes } })
// embedding: 8,448 numbers, already L2-normalised, so a dot product IS the cosine similarity.
// stats.totalTime (ms, native) and stats.backendId (e.g. the GPU backend) are useful to display.

// Many photos at once (the reference uses batches of 16 while indexing):
const { embedding: rows } = await embedBatch({ modelId, inputs: files.map(f => ({ image: fs.readFileSync(f) })) })
// rows: one 8,448-number array per input, in input order.

// On shutdown:
await unloadModel({ modelId })
await close()
```

Notes verified in the running app:

- The model resizes every input to 322 x 322 without cropping, so a wide photo is squeezed. Do not crop it yourself first.
- In the browser, re-encode an uploaded photo to JPEG through a canvas before sending it (`createImageBitmap` then `toBlob`). That applies the EXIF rotation and caps the size; the reference caps the longest side at 1,600 px.
- The reference runs searches one at a time on the server, chained on a promise, so two uploads never compete for the model.

## Descriptor storage (pin this)

- `data/db.json`: an array of `{ id, lat, lon, heading, captured_at, creator }`, one per photo.
- `data/descriptors.f32`: raw float32, row `i` = `db.json[i]`, 8,448 values per row, no header. Append as you embed, so an interrupted run can resume from `fileSize / (8448 * 4)` rows. Store the list of ids the rows were written for, and restart from zero if the list changed.
- Load it with `new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)` and check that the length equals `db.length * 8448`.

## Search (pin this)

Brute force is enough for tens of thousands of rows. Unroll the dot product by 4 and keep a small sorted top list:

```js
for (let j = 0, o = 0; j < db.length; j++, o += DIM) {
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0
  for (let k = 0; k < DIM; k += 4) {
    s0 += q[k] * desc[o + k]; s1 += q[k + 1] * desc[o + k + 1]
    s2 += q[k + 2] * desc[o + k + 2]; s3 += q[k + 3] * desc[o + k + 3]
  }
  const s = s0 + s1 + s2 + s3   // cosine similarity, higher is closer
  // keep the 5 best
}
```

The answer's position is the position of the top row. Show its similarity, and when the true position of the query is known (an example photo), show the distance in metres.

## Building the database (pin the selection rules)

These rules decide most of the accuracy, more than the model choice:

- Keep ordinary perspective photos only: drop 360 panoramas and fisheye.
- Thin each capture sequence to one frame every 8 m, or when the heading turns by 45 degrees. Neighbouring video frames add nothing.
- Spread the selection over 25 m cells, round robin, so busy streets do not take the whole budget.
- Drop dark and blurry frames. The reference scored them on a 256 px grey version: mean brightness of at least 45 out of 255, and variance of an edge filter of at least 700.
- Mapillary's photo URLs are signed and expire: download each batch right after looking it up.
- Ship the list of picked ids, not the photos. Each user downloads them under the photos' own licence.

## The game (pin the rules)

- Challenge photos must come from somewhere other than the database (the reference uses Wikimedia Commons) and must be inside the covered area, with at least 3 database photos within 25 m.
- Measure each challenge against the user's own database after indexing: first match within 50 m is a photo the model gets right, more than 100 m off is one it gets wrong. Deal 3 of the first kind and 2 of the second per game, shuffled, so the player can win some rounds.
- Hide the database dots while the player guesses, or they give the answer away.
- Score each side by distance to the true position. Show both pins, the true spot and the time each side took.

## Hard rules for the agent

- Never put the Mapillary token in code, in the URL of a logged request or in output. Read it from the environment or `.env`, send it in the `Authorization: OAuth <token>` header.
- Show the contributor's name with the matched database photo, and credit the map data (© OpenStreetMap contributors).
- Bind the server to 127.0.0.1. Check the first bytes of an upload (JPEG `FF D8`, PNG `89 50`) and cap its size.
- Do not claim a location for a photo outside the covered area: the nearest match always exists, so say what area the database covers.

## How to run

```bash
npm install
cp .env.example .env     # paste a Mapillary client token
npm run fetch            # download the street photos
npm run index            # embed them with MegaLoc
npm start                # http://127.0.0.1:3111
```

## How to extend

- Another city: list Mapillary images by bounding box (`graph.mapillary.com/images?bbox=...`, tiles of about 250 m to stay under the 2,000-result cap per call), apply the selection rules above, and rebuild the map from OpenStreetMap.
- Millions of photos: replace the brute-force loop with an approximate nearest-neighbour index.
- Re-ranking: compare the top 20 matches more carefully, or vote by location among the top 5.

## Troubleshooting

- `MAPILLARY_TOKEN is not set`: copy `.env.example` to `.env` and paste the token.
- `Mapillary refused the token (HTTP 401)`: use the client token of a registered application, starting with `MLY|`.
- `descriptors.f32 holds N rows but db.json lists M photos`: the database changed after indexing; run `npm run index` again.
- A confident match that is kilometres off: the photo shows a look-alike street, or a place the database does not cover.
