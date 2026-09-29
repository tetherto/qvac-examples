// ============================================================
// QVAC Biomarkers: every model call lives here.
//
// One model, pinned in one place, running in the Electron main process.
// The renderer never imports @qvac/sdk: it asks over IPC and gets text back.
//
//     download once  ->  load  ->  run, run, run  ->  unload on quit
//
// Unlike an app that juggles a vision model and a TTS model, this one has a
// single model and keeps it resident between requests. Loading 2.7 GB takes
// long enough that unloading after every marker would make the app feel
// broken. Requests are still serialised: two completions at once on a
// 16 GB machine is how you meet the out-of-memory killer.
// ============================================================

import {
  loadModel,
  unloadModel,
  completion,
  downloadAsset,
  HEALTHCARE_4B_MEDICAL_Q8_0,
  HEALTHCARE_4B_MEDICAL_Q5_K_M,
  HEALTHCARE_4B_MEDICAL_Q4_K_M,
  HEALTHCARE_4B_MEDICAL_IQ3_M,
  HEALTHCARE_1_7B_MEDICAL_Q4_K_M
} from '@qvac/sdk'
import type { ModelProgress as DownloadProgress } from '../shared/types.js'

// Progress reporting is the same shape whether we are fetching bytes or
// loading them, and the renderer already has that type.
export type { DownloadProgress }

// ---- The model -------------------------------------------------------
//
// QVAC MedPsy: Tether's own medical model family, built on Qwen3 backbones
// and post-trained on synthetic medical data with reasoning traces from a
// 235B teacher, then two RL stages. Apache 2.0, released for research and
// educational use. Text-only and English-only.
//
// WHY THIS APP USES IT THE WAY IT DOES
//
// MedPsy-4B's HealthBench scores, by dimension, say where it is strong:
//
//   Emergency Referrals               81.7   (not used here)
//   Expertise-Tailored Communication  79.3   <- this app's entire use of it
//   Responding Under Uncertainty      76.3   <- the hedging in the cards
//   Context Seeking                   71.7
//   Response Depth                    63.7
//   Health Data Tasks                 60.7   <- its WEAKEST, and it is what
//                                              this app is about
//
// So the split is deliberate. Code does the health-data task: parsing,
// ranges, status, direction, trend, scores. The model does the communication
// task: choose among facts we hand it, order them, and phrase them. That
// puts it on its best-measured ground and keeps it off its worst.
//
// It also means we do not need its reasoning. MedPsy is a thinking model
// (trained and evaluated with thinking on, ~909 tokens a reply), and the
// JSON grammar we impose gives it no room for a <think> block. Measured on
// this app's own prompts, letting it think first produced answers of the
// same quality, because selecting and phrasing from a given list is not a
// reasoning problem. See README. Extraction in foodlib/ IS a reasoning
// problem, which is one reason its output goes to a human for review.

/**
 * The catalogue is documentation, so it only needs the fields we display.
 * Keeping it structural matters: the SDK derives `modelConfig` from the
 * LITERAL type of `modelSrc`, so a union of registry constants makes
 * `loadModel` pick the wrong overload. The active model is therefore its own
 * narrowly-typed constant below, and a check keeps the two in step.
 */
interface RegistryEntry {
  readonly modelId: string
  readonly expectedSize?: number
  readonly params?: string
  readonly quantization?: string
}

interface Tier {
  key: string
  label: string
  src: RegistryEntry
  /** Drop in average benchmark score against the unquantized BF16 model. */
  avgLoss: string
  note: string
}

const TIERS: Tier[] = [
  {
    key: 'medpsy-4b-q8',
    label: 'MedPsy 4B',
    src: HEALTHCARE_4B_MEDICAL_Q8_0,
    avgLoss: '-0.15',
    note: 'Effectively lossless. Pick it only if disk is free and you want no doubt.'
  },
  {
    key: 'medpsy-4b-q5',
    label: 'MedPsy 4B',
    src: HEALTHCARE_4B_MEDICAL_Q5_K_M,
    avgLoss: '-0.29',
    note:
      'Near-lossless, but only 0.04 closed-ended points ahead of Q4_K_M for 440 MB. ' +
      'If quality is the priority, Q8_0 is the better spend.'
  },
  {
    key: 'medpsy-4b-q4',
    label: 'MedPsy 4B',
    src: HEALTHCARE_4B_MEDICAL_Q4_K_M,
    avgLoss: '-0.81',
    note:
      "The default here, and Tether's own recommended size/quality trade-off. Under " +
      'one point of loss, and this app only uses the model to phrase facts it is given.'
  },
  {
    key: 'medpsy-4b-iq3m',
    label: 'MedPsy 4B',
    src: HEALTHCARE_4B_MEDICAL_IQ3_M,
    avgLoss: '-1.50',
    note: 'A 3-bit build that still matches BF16 on HealthBench Hard. Best value per byte.'
  },
  {
    key: 'medpsy-1.7b-q4',
    label: 'MedPsy 1.7B',
    src: HEALTHCARE_1_7B_MEDICAL_Q4_K_M,
    avgLoss: '-0.73',
    note:
      'Phone-class. Beats MedGemma-27B on HealthBench Hard at 1.28 GB, but weaker once ' +
      'the prompt carries a trend, a range and a fact list at once. Do not go below ' +
      '4-bit at this size: the 1.7B loses roughly twice as much as the 4B to aggressive ' +
      'quantization.'
  }
]

// ---- To swap tiers, change these two lines together ------------------
const MODEL = HEALTHCARE_4B_MEDICAL_Q4_K_M
const ACTIVE_TIER = 'medpsy-4b-q4'
// ----------------------------------------------------------------------
//
// Why Q4_K_M and not the "near-lossless" Q5_K_M: the label flatters Q5 more
// than the numbers do. Against Q4 it gains 0.04 points of closed-ended
// average, plus 1 and 2 points of HealthBench and HealthBench Hard, which are
// integers from an LLM judge on a sample. For 440 MB.
//
// And none of those benchmarks measure what this app asks of the model. It
// picks from a list it is handed and writes one sentence; it cannot get a
// fact wrong, because the grammar and the validator will not let it. Half a
// benchmark point can only buy slightly better prose.
//
// If you do want more quality, skip Q5 and take Q8_0: -0.15, effectively
// lossless. Q5 is the awkward middle.

const TIER = TIERS.find((t) => t.key === ACTIVE_TIER) ?? TIERS[1]
if (TIER.src.modelId !== MODEL.modelId) {
  // Cheap guard against the two lines above drifting apart, which would show
  // the wrong size and quality note beside the model that is actually loaded.
  console.warn(
    `[qvac] ACTIVE_TIER is ${ACTIVE_TIER} but MODEL is ${MODEL.modelId}. The header chip will lie.`
  )
}

/** The catalogue, for the README and for anyone wondering what else there is. */
export const tiers = TIERS.map((t) => ({
  key: t.key,
  label: t.label,
  sizeLabel: `${((t.src.expectedSize ?? 0) / 1e9).toFixed(2)} GB`,
  params: String(t.src.params ?? ''),
  quantization: String(t.src.quantization ?? ''),
  avgLoss: t.avgLoss,
  note: t.note,
  active: t.key === ACTIVE_TIER
}))

/** Everything the header chip needs, read off the registry entry itself. */
export interface ModelInfo {
  label: string
  params: string
  quantization: string
  bytes: number
  sizeLabel: string
}

export const modelInfo: ModelInfo = {
  label: TIER.label,
  params: String(MODEL.params ?? '4B'),
  quantization: String(MODEL.quantization ?? 'q5_k_m'),
  bytes: MODEL.expectedSize ?? 0,
  sizeLabel: `${((MODEL.expectedSize ?? 0) / 1e9).toFixed(1)} GB`
}

// ---- One at a time --------------------------------------------------------

let resident: string | null = null
let queue: Promise<unknown> = Promise.resolve()

/**
 * Runs `job` after whatever is already queued, whether that succeeded or not.
 * Exported so OCR (importer/ocr.ts) waits its turn behind a completion too.
 */
export function serialise<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job)
  queue = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

/**
 * Fetches the weights to the local cache WITHOUT loading them into memory.
 * `downloadAsset` exists for exactly this: the welcome screen wants bytes
 * on disk, not a model in RAM. Cheap on later runs: a cached asset returns
 * at once.
 */
export function ensureModel(onProgress: (p: DownloadProgress) => void): Promise<void> {
  return serialise(async () => {
    onProgress({ phase: 'downloading', percent: 0, label: `Fetching ${modelInfo.label}…` })
    await downloadAsset({
      assetSrc: MODEL,
      onProgress: (p) =>
        onProgress({
          phase: 'downloading',
          percent: Math.round(p.percentage || 0),
          label: `Fetching ${modelInfo.label} · ${modelInfo.sizeLabel}`
        })
    })
    onProgress({ phase: 'ready', percent: 100, label: 'Ready. Works offline from here.' })
  })
}

/** True when the weights are already on disk, so the UI can skip the setup step. */
export async function isModelCached(): Promise<boolean> {
  try {
    const { readdir } = await import('node:fs/promises')
    const { homedir } = await import('node:os')
    const { join } = await import('node:path')
    // The registry stores each blob as "<16 hex>_<modelId>".
    const files = await readdir(join(homedir(), '.qvac', 'models'))
    return files.some((f) => f.replace(/^[0-9a-f]{16}_/, '') === MODEL.modelId)
  } catch {
    return false
  }
}

async function ensureLoaded(onProgress?: (p: DownloadProgress) => void): Promise<string> {
  if (resident) return resident
  onProgress?.({ phase: 'loading', percent: 0, label: `Loading ${modelInfo.label}…` })
  resident = await loadModel({
    modelSrc: MODEL,
    modelConfig: {
      // Sized by the LARGER of the two jobs, which is reading a Food Library
      // source, not writing recommendations:
      //
      //   recommendations  ~1100 prompt tokens + ~400 reply
      //   reading a source ~2800 prompt tokens (page text plus the 56-marker
      //                    menu) + up to ~1200 reply
      //
      // At 4096 the second one had only ~220 tokens left to answer in, and
      // came back as truncated JSON. 8192 fits it with room over. Bigger is
      // NOT safer: 16384 has been seen to fail outright on this hardware,
      // because the KV cache for that window cannot be allocated and the real
      // window ends up smaller than the request.
      ctx_size: 8192,
      device: 'gpu',
      gpu_layers: 99,
      // Near-greedy. We want the model choosing among given facts, not
      // being creative about food.
      temp: 0.3,
      // Enough for a five-fact extraction with a quote on each. A
      // recommendation reply uses well under half of it.
      predict: 1200
    },
    onProgress: (p) =>
      onProgress?.({
        phase: 'downloading',
        percent: Math.round(p.percentage || 0),
        label: `Fetching ${modelInfo.label}…`
      })
  })
  onProgress?.({ phase: 'ready', percent: 100, label: `${modelInfo.label} ready` })
  return resident
}

export interface Message {
  role: 'system' | 'user'
  content: string
}

/** A chat turn. Unlike `Message` this one has an assistant side. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * One structured completion.
 *
 * `schema` is a JSON Schema, handed to the SDK as `responseFormat:
 * json_schema`, which constrains generation with a grammar rather than
 * merely asking nicely. That is what lets ai/index.ts pin every food name
 * to an enum: the model physically cannot emit a food that is not on the
 * list. Prompt instructions alone would not survive a 4B model.
 */
export function generate(
  history: Message[],
  schema: Record<string, unknown>,
  schemaName: string,
  onProgress?: (p: DownloadProgress) => void,
  /** Called with the running character count as the reply streams in. */
  onChars?: (chars: number) => void
): Promise<string> {
  return serialise(async () => {
    const modelId = await ensureLoaded(onProgress)
    const run = completion({
      modelId,
      history,
      // Streaming is what makes a real progress reading possible. Without it
      // the whole reply lands at once and there is nothing to report but a
      // spinner. We still only use the aggregated text at the end.
      stream: Boolean(onChars),
      responseFormat: { type: 'json_schema', json_schema: { name: schemaName, schema } }
    })
    if (onChars) {
      let chars = 0
      for await (const event of run.events) {
        if (event.type === 'contentDelta') {
          chars += event.text.length
          onChars(chars)
        }
      }
    }
    const final = await run.final
    return final.contentText
  })
}

/**
 * One free-form completion, streamed.
 *
 * The opposite of `generate` above: no schema, so no grammar holding the
 * model to a shape. That is the point of a chat and it is also its risk, so
 * nothing calls this directly. `chat/index.ts` wraps it in the sentence
 * guard, which is what actually keeps a dosage off the screen.
 *
 * `onDelta` receives text as it arrives, with any <think> block stripped
 * out. MedPsy is a thinking model, and while it has not opened one on these
 * prompts, a reasoning trace is not an answer and must never be rendered as
 * one.
 */
export function converse(
  history: ChatMessage[],
  onDelta: (text: string) => void,
  onProgress?: (p: DownloadProgress) => void
): Promise<void> {
  return serialise(async () => {
    const modelId = await ensureLoaded(onProgress)
    const run = completion({ modelId, history, stream: true })
    const filter = new ThinkFilter(onDelta)
    for await (const event of run.events) {
      if (event.type === 'contentDelta') filter.push(event.text)
    }
    await run.final
    filter.flush()
  })
}

/**
 * Drops anything between <think> and </think> from a stream, without
 * stalling the text that surrounds it.
 *
 * Holding back only as much as a tag could span (a few characters) keeps the
 * reply arriving smoothly; anything longer would make the window stutter
 * once a sentence.
 */
class ThinkFilter {
  private held = ''
  private thinking = false
  constructor(private readonly emit: (text: string) => void) {}

  push(delta: string): void {
    this.held += delta
    for (;;) {
      const tag = this.thinking ? '</think>' : '<think>'
      const at = this.held.indexOf(tag)
      if (at >= 0) {
        if (!this.thinking) this.emit(this.held.slice(0, at))
        this.held = this.held.slice(at + tag.length)
        this.thinking = !this.thinking
        continue
      }
      // Emit everything that cannot still turn out to be the start of a tag.
      const keep = longestTagPrefix(this.held, tag)
      const safe = this.held.slice(0, this.held.length - keep)
      if (safe && !this.thinking) this.emit(safe)
      this.held = this.held.slice(this.held.length - keep)
      return
    }
  }

  flush(): void {
    if (this.held && !this.thinking) this.emit(this.held)
    this.held = ''
  }
}

/** Length of the longest suffix of `text` that is a prefix of `tag`. */
function longestTagPrefix(text: string, tag: string): number {
  const max = Math.min(text.length, tag.length - 1)
  for (let n = max; n > 0; n--) {
    if (text.endsWith(tag.slice(0, n))) return n
  }
  return 0
}

/**
 * True when the weights are already in memory, so a caller can tell whether
 * the next request has to pay the load cost first.
 */
export function isResident(): boolean {
  return resident !== null
}

/** Called on quit: nothing should outlive the window. */
export async function shutdown(): Promise<void> {
  const modelId = resident
  resident = null
  if (!modelId) return
  try {
    // clearStorage: false keeps the weights cached, so the next launch is
    // fast and the app stays offline.
    await unloadModel({ modelId, clearStorage: false })
  } catch (err) {
    console.warn('[qvac] unload failed:', err)
  }
}
