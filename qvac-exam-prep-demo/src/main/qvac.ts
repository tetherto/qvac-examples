// ============================================================
// Every @qvac/sdk call in the app lives in this file.
//
// It runs in the Electron main process (and in the CLI under plain Node),
// never in the renderer. No Electron import here, on purpose.
//
//   download (pausable)  ->  load ONE model  ->  batches  ->  unload
//
// One model is resident at a time. Switching unloads the current one
// before loading the next, so two multi-gigabyte models never share RAM.
// ============================================================

import { batchCompletion, cancel, downloadAsset, loadModel, unloadModel } from '@qvac/sdk'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readdir, stat } from 'node:fs/promises'
import type { BatchHandle, Engine, PromptSpec } from '../core/pipeline'
import type { DownloadProgress, ModelKey, ModelStatus } from '../core/types'
import { CTX_SIZE, PARALLEL, PREDICT, rung } from './models'

// ---- Status, pushed to whoever listens (the window, or the CLI) --------

const status = new Map<ModelKey, ModelStatus>()
let listener: (s: ModelStatus) => void = () => {}

export function onModelStatus(fn: (s: ModelStatus) => void): void {
  listener = fn
}

function setStatus(s: ModelStatus): void {
  status.set(s.key, s)
  listener(s)
}

export async function isDownloaded(key: ModelKey): Promise<boolean> {
  try {
    // The registry cache stores each blob as "<16 hex>_<file name>".
    const files = await readdir(join(homedir(), '.qvac', 'models'))
    const id = rung(key).src.modelId
    return files.some((f) => f.replace(/^[0-9a-f]{16}_/, '') === id)
  } catch {
    return false
  }
}

/** Bytes the model's weights take on disk; 0 when not downloaded. */
export async function bytesOnDisk(key: ModelKey): Promise<number> {
  try {
    const dir = join(homedir(), '.qvac', 'models')
    const id = rung(key).src.modelId
    const file = (await readdir(dir)).find((f) => f.replace(/^[0-9a-f]{16}_/, '') === id)
    return file ? (await stat(join(dir, file))).size : 0
  } catch {
    return 0
  }
}

export async function getStatus(key: ModelKey): Promise<ModelStatus> {
  const known = status.get(key)
  if (known && known.phase !== 'not_downloaded') return known
  return { key, phase: (await isDownloaded(key)) ? 'downloaded' : 'not_downloaded' }
}

// ---- Download, with pause and resume -----------------------------------
//
// The SDK has no separate pause call. Pausing is cancel() on the download's
// requestId WITHOUT clearCache, which keeps the partial file; downloading
// again resumes from it. That is the lifecycle the SDK's own
// download-with-cancel example uses.

const downloads = new Map<ModelKey, { requestId: string; paused: boolean }>()

function speedMeter(): (bytes: number) => number {
  const samples: { t: number; b: number }[] = []
  return (bytes) => {
    const t = Date.now()
    samples.push({ t, b: bytes })
    while (samples.length > 2 && t - samples[0].t > 4000) samples.shift()
    const first = samples[0]
    const dt = (t - first.t) / 1000
    return dt > 0.2 ? Math.max(0, (bytes - first.b) / dt) : 0
  }
}

export async function download(key: ModelKey): Promise<void> {
  if (downloads.has(key)) return
  const r = rung(key)
  const speed = speedMeter()
  const op = downloadAsset({
    assetSrc: r.src,
    onProgress: (p: { downloaded: number; total: number; percentage: number }) => {
      const progress: DownloadProgress = {
        key,
        downloaded: p.downloaded,
        total: p.total || (r.src.expectedSize ?? 0),
        percent: Math.round((p.percentage || 0) * 10) / 10,
        speed: speed(p.downloaded)
      }
      setStatus({ key, phase: 'downloading', progress })
    }
  })
  downloads.set(key, { requestId: op.requestId, paused: false })
  setStatus({ key, phase: 'downloading', progress: status.get(key)?.progress })
  try {
    await op
    setStatus({ key, phase: 'downloaded' })
  } catch (err) {
    const paused = downloads.get(key)?.paused
    if (paused) setStatus({ key, phase: 'paused', progress: status.get(key)?.progress })
    else setStatus({ key, phase: 'error', error: (err as Error).message })
  } finally {
    downloads.delete(key)
  }
}

export async function pauseDownload(key: ModelKey): Promise<void> {
  const d = downloads.get(key)
  if (!d) return
  d.paused = true
  await cancel({ requestId: d.requestId })
}

// ---- Load / switch / unload -----------------------------------------------

let resident: { key: ModelKey; modelId: string } | null = null
let loading: Promise<string> | null = null

export function residentKey(): ModelKey | null {
  return resident?.key ?? null
}

/** Loads `key`, unloading whatever else is resident first. */
export async function ensureLoaded(key: ModelKey): Promise<string> {
  if (resident?.key === key) return resident.modelId
  if (loading) await loading.catch(() => undefined)
  if (resident?.key === key) return resident.modelId

  loading = (async () => {
    if (resident) await unload()
    setStatus({ key, phase: 'loading' })
    const r = rung(key)
    const speed = speedMeter()
    const modelId = await loadModel({
      modelSrc: r.src,
      modelType: 'llm',
      modelConfig: { ctx_size: CTX_SIZE, parallel: PARALLEL, device: 'gpu', gpu_layers: 99 },
      // Fires only if the weights are not on disk yet.
      onProgress: (p: { downloaded: number; total: number; percentage: number }) =>
        setStatus({
          key,
          phase: 'downloading',
          progress: { key, downloaded: p.downloaded, total: p.total, percent: Math.round(p.percentage * 10) / 10, speed: speed(p.downloaded) }
        })
    })
    resident = { key, modelId }
    setStatus({ key, phase: 'loaded' })
    return modelId
  })()
  try {
    return await loading
  } catch (err) {
    setStatus({ key, phase: 'error', error: (err as Error).message })
    throw err
  } finally {
    loading = null
  }
}

export async function unload(): Promise<void> {
  const r = resident
  resident = null
  if (!r) return
  try {
    // clearStorage: false keeps the weights on disk for the next launch.
    await unloadModel({ modelId: r.modelId, clearStorage: false })
  } catch (err) {
    console.warn('[qvac] unload failed:', err)
  }
  setStatus({ key: r.key, phase: 'downloaded' })
}

// ---- Step 1 of the build: one plain completion, streamed ------------------

export async function ping(key: ModelKey, prompt: string, onDelta: (text: string) => void): Promise<string> {
  const modelId = await ensureLoaded(key)
  // Through batchCompletion with one prompt, not completion(). On SDK
  // 0.21.0 a plain completion() on a model loaded with parallel > 1
  // returns its whole reply twice (reproduced outside this app). The batch
  // path is the one generation uses, and it does not double.
  // captureThinking moves Qwen3's (empty) <think> block into its own events.
  const run = batchCompletion({
    modelId,
    stream: true,
    captureThinking: true,
    prompts: [{ id: 'ping', history: [{ role: 'user', content: `${prompt}\n/no_think` }], generationParams: { predict: 200 } }]
  })
  let text = ''
  for await (const { event } of run.events) {
    if (event.type === 'contentDelta') {
      text += event.text
      onDelta(event.text)
    }
  }
  await run.results
  return text
}

// ---- The Engine the pipeline uses ----------------------------------------

/** Set false if a runtime ever rejects json_schema; prompts then carry the shape alone. */
let grammarSupported = true

export function engineFor(key: ModelKey): Engine {
  return {
    runBatch(prompts: PromptSpec[], onResult): BatchHandle {
      let requestId: string | null = null
      let stopped = false
      const done = (async () => {
        const modelId = await ensureLoaded(key)
        if (stopped) return
        const start = (structured: boolean): ReturnType<typeof batchCompletion> =>
          batchCompletion({
            modelId,
            stream: true,
            prompts: prompts.map((p) => ({
              id: `p${p.index}`,
              history: p.history,
              generationParams: { temp: 0.7, top_p: 0.9, predict: PREDICT, seed: 1000 + p.index },
              ...(structured
                ? { responseFormat: { type: 'json_schema' as const, json_schema: { name: p.schemaName, schema: p.schema, strict: true } } }
                : {})
            }))
          })

        let run = start(grammarSupported)
        try {
          await consume(run)
        } catch (err) {
          const msg = (err as Error).message
          if (grammarSupported && /response.?format|grammar|json.?schema/i.test(msg)) {
            console.warn('[qvac] structured output rejected, falling back to prompt-only JSON:', msg)
            grammarSupported = false
            run = start(false)
            await consume(run)
          } else if (!stopped) {
            throw err
          }
        }

        async function consume(r: ReturnType<typeof batchCompletion>): Promise<void> {
          requestId = r.requestId
          if (stopped) {
            await cancel({ requestId }).catch(() => undefined)
          }
          const texts = new Map<string, string>()
          let ids: string[] | null = null
          const reported = new Set<number>()
          const indexOf = (id: string): number => {
            // Ids are addon-assigned, in prompt order; fall back to ours.
            const i = ids?.indexOf(id) ?? -1
            if (i >= 0) return prompts[i].index
            const m = id.match(/^p(\d+)$/)
            return m ? Number(m[1]) : -1
          }
          for await (const { id, event } of r.events) {
            if (event.type === 'contentDelta') {
              texts.set(id, (texts.get(id) ?? '') + event.text)
            } else if (event.type === 'completionDone') {
              if (!ids) ids = await r.ids
              const index = indexOf(id)
              if (index < 0 || reported.has(index)) continue
              reported.add(index)
              if (event.stopReason === 'cancelled') continue
              if (event.stopReason === 'error') {
                onResult(index, null, 'error' in event ? event.error.message : 'generation error')
              } else {
                // A reply cut off by `predict` is passed on as is: the gate
                // rejects it as a parse error and the log shows the stub.
                onResult(index, texts.get(id) ?? event.raw?.fullText ?? '')
              }
            }
          }
          await r.results.catch(() => undefined)
        }
      })()

      return {
        done,
        async cancel(): Promise<void> {
          stopped = true
          if (requestId) await cancel({ requestId }).catch(() => undefined)
        }
      }
    }
  }
}

/** Called on quit: nothing should outlive the window. */
export async function shutdown(): Promise<void> {
  for (const key of downloads.keys()) await pauseDownload(key)
  await unload()
}
