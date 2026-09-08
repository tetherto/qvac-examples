// What to download, and whether it will run here.
//
// Two catalogues, because the app needs two very different models:
//
//   the translator  TranslatePsy-AfriSLM, six Hugging Face GGUFs, NOT in the QVAC
//                   registry, so it is loaded by URL
//   the reader      a registry vision model, only needed if you want to scan paper
//
// The fit question is answered by the SDK where it can be, and by us where it
// cannot. `assessModelFit` (SDK 0.19) rates REGISTRY models by looking up a resource
// profile by checksum, so for AfriSLM it answers, verbatim, "no resource profile in
// the catalog for this checksum" and returns `unknown`. What it always gives is the
// live memory BUDGET for this machine, which is far better evidence than
// os.totalmem: it counts what is in use right now and applies the SDK's own headroom
// policy. So: budget from the SDK, verdicts from the SDK for the vision models, and
// an estimate computed here for the six GGUFs, labelled as such in the interface.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HF = 'https://huggingface.co/qvac'

/**
 * What is already on this machine.
 *
 * Two different questions, because the two catalogues arrive by different routes.
 *
 * A model downloaded from a URL lands in `~/.qvac/models` as `<16 hex>_<original
 * filename>`, so it is found by matching the filename and sanity-checking the size:
 * `2c59c7ff9fdd8369_TranslatePsy-AfriSLM-4B-Q4_K_M-imat.gguf`. There is no registry
 * name to ask `getModelInfo` about.
 *
 * A registry model does have one, so the readers are asked properly and answer with
 * `isCached`.
 *
 * Without this the onboarding offered to download 5 GB of something already sitting
 * on the disk, which is the one thing an offline-first app must never do.
 */
const MODELS_DIR = path.join(os.homedir(), '.qvac', 'models')

function onDisk (filename, expectedBytes) {
  let entries
  try { entries = fs.readdirSync(MODELS_DIR) } catch { return null }
  const hit = entries.find((f) => f === filename || f.endsWith('_' + filename))
  if (!hit) return null
  let size = 0
  try { size = fs.statSync(path.join(MODELS_DIR, hit)).size } catch { return null }
  // A part-finished download is not a download. 95 percent rather than an exact
  // match because the published byte counts are rounded here.
  if (expectedBytes && size < expectedBytes * 0.95) return null
  return { file: hit, bytes: size }
}

export const VARIANTS = [
  { id: '0.8B-Q4', params: '0.8B', quant: 'Q4_K_M', bytes: 670000000, repo: 'TranslatePsy-AfriSLM-0.8B-Q4-GGUF', file: 'TranslatePsy-AfriSLM-0.8B-Q4_K_M-imat.gguf', bouquet: 0.6157 },
  { id: '0.8B-Q8', params: '0.8B', quant: 'Q8_0', bytes: 1080000000, repo: 'TranslatePsy-AfriSLM-0.8B-Q8-GGUF', file: 'TranslatePsy-AfriSLM-0.8B-Q8_0-imat.gguf', bouquet: 0.6207 },
  { id: '2B-Q4', params: '2B', quant: 'Q4_K_M', bytes: 1560000000, repo: 'TranslatePsy-AfriSLM-2B-Q4-GGUF', file: 'TranslatePsy-AfriSLM-2B-Q4_K_M-imat.gguf', bouquet: 0.6299 },
  { id: '2B-Q8', params: '2B', quant: 'Q8_0', bytes: 2550000000, repo: 'TranslatePsy-AfriSLM-2B-Q8-GGUF', file: 'TranslatePsy-AfriSLM-2B-Q8_0-imat.gguf', bouquet: 0.6310 },
  { id: '4B-Q4', params: '4B', quant: 'Q4_K_M', bytes: 3070000000, repo: 'TranslatePsy-AfriSLM-4B-Q4-GGUF', file: 'TranslatePsy-AfriSLM-4B-Q4_K_M-imat.gguf', bouquet: 0.6377 },
  { id: '4B-Q8', params: '4B', quant: 'Q8_0', bytes: 5160000000, repo: 'TranslatePsy-AfriSLM-4B-Q8-GGUF', file: 'TranslatePsy-AfriSLM-4B-Q8_0-imat.gguf', bouquet: 0.6384 }
]

export const variantUrl = (v) => `${HF}/${v.repo}/resolve/main/${v.file}`
/** Is this exact variant already in the local cache? */
export const variantCached = (v) => !!onDisk(v.file, v.bytes)
export const variantById = (id) => VARIANTS.find((v) => v.id === id)

/**
 * Readers, best first, measured on the same two pages: an English clinic notice and
 * the same notice in Swahili. Word accuracy against the text that was printed.
 *
 * | reader                  | English | Swahili |
 * | OCR 0.6B                | 100%    | 100%    |
 * | OCR 3B                  | 100%    | 100%    |
 * | VisionPsy-Nano 460M Q8  | 94.7%   | 78.0%   |
 * | VisionPsy-Nano Q4 Flash | dropped the heading | 68.3% |
 *
 * VisionPsy was the first recommendation here, chosen on an English page alone, and
 * that was the wrong test for this app. On the Swahili page its 17 word errors turned
 * "Jumatatu" into Wednesday and "kidonge kimoja" (one tablet) into "a small dose"
 * once translated: a wrong day and a wrong dose on a clinic letter. The OCR models
 * cost more to download and read African-language text without a mistake, which for
 * an app about African languages is not a trade-off.
 */
export const READERS = [
  {
    id: 'ocr-06b',
    label: 'QVAC OCR 0.6B',
    model: 'OCR_0_6B_MULTIMODAL_Q4_K_M',
    projection: 'MMPROJ_OCR_0_6B_MULTIMODAL_F16',
    note: 'read both pages with every word right, English and Swahili',
    recommended: true
  },
  {
    id: 'ocr-3b',
    label: 'QVAC OCR 3B',
    model: 'OCR_3B_MULTIMODAL_Q4_0',
    projection: 'MMPROJ_OCR_3B_MULTIMODAL_Q8_0',
    note: 'also flawless, and it reports the layout of each block. Twice the download'
  },
  {
    id: 'visionpsy-q8',
    label: 'VisionPsy-Nano 460M, Q8',
    model: 'VISIONPSY_NANO_460M_MULTIMODAL_Q8_0_1',
    projection: 'MMPROJ_VISIONPSY_NANO_460M_MULTIMODAL_Q8_0_1',
    note: 'the smallest that reads English well, but 78 percent of words on a Swahili page'
  },
  {
    id: 'visionpsy-q4',
    label: 'VisionPsy-Nano 460M, Q4, Flash',
    model: 'VISIONPSY_NANO_460M_MULTIMODAL_Q4_K_M',
    projection: 'MMPROJ_VISIONPSY_NANO_460M_MULTIMODAL_Q8_0',
    note: 'smallest of all, and the weakest: 68 percent on the Swahili page'
  }
]
export const readerById = (id) => READERS.find((r) => r.id === id)

/** Every reader whose constants exist in the SDK actually installed. */
export function availableReaders (mod) {
  return READERS
    .filter((r) => mod[r.model] && mod[r.projection])
    .map((r) => ({
      ...r,
      bytes: (mod[r.model].expectedSize || 0) + (mod[r.projection].expectedSize || 0)
    }))
}

const CTX_TRANSLATE = 2048   // the context the published GGUF scores were measured at
const CTX_READ = 4096

/**
 * The machine, as the SDK sees it right now.
 *
 * Any candidate returns the same budget block, so this asks about a tiny registry
 * model purely to read the budget out of the answer. When `assessModelFit` is
 * missing (SDK 0.18 and older) the caller falls back to its own arithmetic.
 */
export async function machineBudget (mod) {
  if (typeof mod.assessModelFit !== 'function') return null
  const probe = mod.QWEN3_600M_INST_Q4 || mod.EMBEDDINGGEMMA_300M_Q4_0
  if (!probe) return null
  try {
    const r = await mod.assessModelFit({
      models: [{ model: probe, workload: { kind: 'llm', contextTokens: CTX_TRANSLATE } }]
    })
    return r.budget ? { ...r.budget, basis: r.basis, assumptions: r.assumptions } : null
  } catch { return null }
}

/** SDK verdicts for the readers, which ARE registry models. */
export async function assessReaders (mod) {
  const readers = availableReaders(mod)
  if (typeof mod.assessModelFit !== 'function') {
    return readers.map((r) => ({ ...r, cached: false, verdict: 'unknown', reasons: ['assessModelFit needs SDK 0.19'] }))
  }
  const out = []
  for (const r of readers) {
    // Both files have to be present, and the projector is the one people forget.
    let cached = false
    try {
      const a = await mod.getModelInfo({ name: r.model })
      const b = await mod.getModelInfo({ name: r.projection })
      cached = !!(a && a.isCached && b && b.isCached)
    } catch { /* leave it as not cached */ }
    try {
      const res = await mod.assessModelFit({
        models: [{
          model: mod[r.model],
          // The projector is a second file the same load needs, which is exactly
          // what `artifacts` is for. Leaving it out under-counts by 109 MB.
          artifacts: [mod[r.projection]],
          workload: { kind: 'llm', contextTokens: CTX_READ }
        }]
      })
      const m = res.models[0] || {}
      out.push({ ...r, cached, verdict: res.verdict, estimate: res.estimate || m.estimate || null, reasons: m.reasons || res.reasons, source: 'assessModelFit' })
    } catch (e) {
      out.push({ ...r, cached, verdict: 'unknown', reasons: [e.message], source: 'error' })
    }
  }
  return out
}

/**
 * The six AfriSLM GGUFs against the budget.
 *
 * Weights plus 15 percent for the runtime and the graph, plus the KV cache. The
 * verdict wording is the SDK's own vocabulary on purpose, so the interface does not
 * teach two different scales for the same question.
 */
export function assessVariants (budgetBytes) {
  return VARIANTS.map((v) => {
    const cached = onDisk(v.file, v.bytes)
    const need = v.bytes * 1.15 + CTX_TRANSLATE * 140000
    const verdict = !budgetBytes ? 'unknown'
      : need <= budgetBytes * 0.8 ? 'likely-fits'
        : need <= budgetBytes ? 'tight'
          : 'likely-too-large'
    return { ...v, url: variantUrl(v), needBytes: Math.round(need), verdict, cached: !!cached, cachedBytes: cached ? cached.bytes : 0 }
  })
}

/**
 * What to recommend. Best benchmark score among those that fit, which is not the
 * largest file: 4B Q4 outscores 2B Q8 and is 1.5 GB smaller.
 */
export function recommend (assessed) {
  const best = (list) => (list.length ? list.reduce((a, b) => (b.bouquet > a.bouquet ? b : a)) : null)
  const fits = assessed.filter((v) => v.verdict === 'likely-fits')
  // Already downloaded and it fits: recommend that, and say why. Offering a 5 GB
  // download when a model of the same family is on the disk is not a recommendation,
  // it is a waste of somebody's data.
  const here = best(fits.filter((v) => v.cached))
  const top = best(fits) || best(assessed.filter((v) => v.verdict === 'tight'))
  if (here && top && !top.cached) return { ...here, alternative: top }
  return here || top
}
