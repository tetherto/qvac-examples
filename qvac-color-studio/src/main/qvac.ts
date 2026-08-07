// ============================================================
// QVAC Color Studio — every model call lives here.
//
// This file is the part worth copying. It shows the whole
// on-device lifecycle for a machine with a memory budget:
//
//     download once  →  load  →  run  →  unload
//
// There is one model here today, and the guard is still the point:
// it is what makes adding a second one safe. On a 16 GB MacBook Air
// two models will not fit together, so `withModel` keeps exactly
// ONE resident at a time and no caller can get it wrong.
// ============================================================

import {
  loadModel,
  unloadModel,
  completion,
  downloadAsset,
  GEMMA4_2B_MULTIMODAL_Q8_0,
  MMPROJ_GEMMA4_2B_MULTIMODAL_Q8_0
} from '@qvac/sdk'
import type { ModelsProgress } from '../shared/types.js'

// ---- The model -------------------------------------------------------
//
// Vision: Gemma 4 E2B (Q8_0) plus its projection — about 5.3 GB together,
// and the only model this app loads.
//
// Three models were tried on the same photo before this one, which is
// worth knowing before you swap in something smaller to save the
// download:
//
//   SmolVLM2 500M (0.5 GB) — could not do the job at all. It captions a
//     picture happily but cannot hold a twelve-item structured verdict:
//     it echoed the schema back, or rated one colour then rambled, so
//     every swatch fell through to a neutral rating.
//   Qwen3.5 2B Q8 (2.3 GB) — worse. Returned two entries and copied the
//     prompt's own "..." placeholders as its answer.
//   Qwen3-VL 2B Q4_K (1.5 GB) — the closest call, and workable. It
//     returns all twelve, but it drifts: on some photos the twelve
//     comments collapse into three or four sentences keyed on the rating
//     rather than the colour, and it puts warm colours in the "fit"
//     column on a cool verdict.
//
// Gemma holds warm/cool coherence — no warm colour rated a fit on a cool
// undertone — and writes twelve genuinely distinct comments. That is what
// the extra download buys. Q8 rather than Q4 was NOT the deciding factor:
// Qwen3.5 at Q8 was the worst of the four.

/** Every file we must have on disk before the app can work offline. */
const REQUIRED_ASSETS = [
  { label: 'vision model', src: GEMMA4_2B_MULTIMODAL_Q8_0 },
  { label: 'vision projection', src: MMPROJ_GEMMA4_2B_MULTIMODAL_Q8_0 }
] as const

/**
 * Each descriptor carries its own `expectedSize`, so the setup screen can
 * quote real megabytes instead of a guess. About 5.3 GB all told.
 */
const MB = 1024 * 1024
const ASSET_MB = REQUIRED_ASSETS.map((a) => Math.round((a.src.expectedSize ?? 0) / MB))
const TOTAL_MB = ASSET_MB.reduce((sum, mb) => sum + mb, 0)

// ---- One model at a time --------------------------------------------

/** The single model currently in memory, or null. */
let resident: { modelId: string; label: string } | null = null

/** Serialises everything below — two inferences at once would also blow the budget. */
let queue: Promise<unknown> = Promise.resolve()

/** Runs `job` after whatever is already queued, whether that succeeded or not. */
function serialise<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job)
  // Swallow the result so one failure does not poison the next caller.
  queue = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

async function releaseResident(): Promise<void> {
  if (!resident) return
  const { modelId, label } = resident
  // Clear the handle first: if unload throws we must not keep pointing at
  // a model that may be half gone.
  resident = null
  try {
    // clearStorage: false keeps the downloaded weights cached on disk, so
    // the next load is instant and the app stays offline.
    await unloadModel({ modelId, clearStorage: false })
    console.log(`[qvac] unloaded ${label}`)
  } catch (err) {
    console.warn(`[qvac] failed to unload ${label}:`, err)
  }
}

/**
 * Loads a model, hands it to `run`, and unloads it again — always, even
 * if `run` throws. Any model already resident is evicted first.
 *
 * This is the only way this file loads a model. That is the point: the
 * one-model-at-a-time rule is structural, not a comment someone can miss.
 *
 * `load` is a thunk rather than a plain options object so that each call
 * site's `loadModel(...)` picks its own overload — the SDK types the
 * per-engine `modelConfig` off `modelSrc`, and that inference is lost if
 * the options travel through here as a value.
 */
async function withModel<T>(
  label: string,
  load: () => Promise<string>,
  run: (modelId: string) => Promise<T>
): Promise<T> {
  await releaseResident()
  console.log(`[qvac] loading ${label}…`)
  const modelId = await load()
  resident = { modelId, label }
  console.log(`[qvac] ${label} ready`)
  try {
    return await run(modelId)
  } finally {
    await releaseResident()
  }
}

/** Called on app quit — nothing should outlive the window. */
export async function shutdown(): Promise<void> {
  await releaseResident()
}

// ---- First run: download, do not load -------------------------------

/**
 * Fetches every model file to the local cache without loading any of
 * them into memory. `downloadAsset` exists for exactly this: on the
 * setup screen we want bytes on disk, not a model in RAM.
 *
 * Cheap on later runs — already-cached assets return at once.
 */
export function ensureModels(onProgress: (p: ModelsProgress) => void): Promise<void> {
  return serialise(async () => {
    // Nothing may be resident while we download, or a swap could collide
    // with a load later in the run.
    await releaseResident()

    // Weight the bar by file size, not by file count — otherwise the
    // 2.3 GB diffusion model and the 100 MB projection each get a third
    // of the bar and the progress lies badly.
    let mbBefore = 0

    for (let i = 0; i < REQUIRED_ASSETS.length; i++) {
      const { label, src } = REQUIRED_ASSETS[i]
      const assetMb = ASSET_MB[i]
      const base = mbBefore

      const report = (assetPercent: number): void => {
        const mbDone = base + (assetMb * assetPercent) / 100
        onProgress({
          phase: 'downloading',
          percent: TOTAL_MB ? Math.round((mbDone / TOTAL_MB) * 100) : 0,
          label: `Fetching the ${label}…`,
          mbDone: Math.round(mbDone),
          mbTotal: TOTAL_MB
        })
      }

      report(0)
      await downloadAsset({
        assetSrc: src,
        onProgress: (p) => report(p.percentage || 0)
      })

      mbBefore += assetMb
    }

    onProgress({
      phase: 'ready',
      percent: 100,
      label: 'Ready — works offline from here',
      mbDone: TOTAL_MB,
      mbTotal: TOTAL_MB
    })
  })
}

// ---- Vision: the single structured pass ------------------------------

/**
 * Reads the still and returns the model's raw text. Parsing lives in
 * `analysis.ts` so this stays purely about the model lifecycle.
 *
 * `stillPath` is a real file on disk: multimodal attachments take a
 * path, not bytes.
 */
export function readColors(stillPath: string, prompt: string): Promise<string> {
  return serialise(() =>
    withModel(
      'vision model',
      () =>
        loadModel({
          modelSrc: GEMMA4_2B_MULTIMODAL_Q8_0,
          modelConfig: {
            // The projection model is what turns pixels into tokens the
            // language model can attend to. Loaded in the same step.
            projectionModelSrc: MMPROJ_GEMMA4_2B_MULTIMODAL_Q8_0,
            // Sized from measurement, not hope. A 512x640 still plus this
            // prompt is ~615 tokens, and a full twelve-colour reply runs
            // ~750 more. 8192 leaves roughly five times the headroom.
            //
            // Bigger is NOT safer here. Asking for 16384 made the app throw
            // CONTEXT_OVERFLOW on a prompt of 615 tokens: the KV cache for
            // that window could not be allocated on the GPU — MediaPipe's
            // own GPU delegate has just been running in the renderer — and
            // the real window ended up smaller than the request. A modest
            // ask that actually fits beats a generous one that silently
            // does not.
            ctx_size: 8192,
            // Metal. `gpu_layers: 99` offloads every layer.
            device: 'gpu',
            gpu_layers: 99,
            // Near-greedy: we want valid JSON, not invention.
            temp: 0.2,
            // Enough for twelve commentaries with room over, and bounded so
            // the engine reserves a known amount rather than the whole
            // context (which is what `-1` asks for).
            predict: 1600
          }
        }),
      async (modelId) => {
        const result = completion({
          modelId,
          history: [{ role: 'user', content: prompt, attachments: [{ path: stillPath }] }],
          // We want the whole reply in one piece — it is JSON, and half a
          // JSON object is no use to anyone.
          stream: false
        })
        const text = await result.text

        // Worth logging: an image is most of the prompt, and the token count
        // is the number you need when tuning `ctx_size`. Guessing at it is
        // how the overflow above happened in the first place.
        const stats = await result.stats
        if (stats) {
          console.log(
            `[qvac] read the still — prompt ${stats.promptTokens} tokens, ` +
              `reply ${stats.generatedTokens} tokens, ${stats.tokensPerSecond?.toFixed(0)} tok/s`
          )
        }
        return text
      }
    )
  )
}

// ---- Not in this version --------------------------------------------
//
// Voice: QVAC also does local text-to-speech (`textToSpeech`), so having
// the studio read your verdict aloud is a small addition — build the
// commentary string, load a TTS model, play the audio. The catch is the
// rule above: TTS is a second model, so it has to load AFTER the vision
// model unloads, never beside it. `withModel` already guarantees that.
//
// Diffusion: an earlier version rendered a "full look" — img2img over
// the same still with the person in their best colour, via SD 2.1. It
// was dropped because the output was not good enough to be worth 2.3 GB
// of download and a minute of waiting: SDEdit-style img2img either drifts
// off the person's face or barely changes the shirt. The drape band does
// the same job honestly, and instantly.
