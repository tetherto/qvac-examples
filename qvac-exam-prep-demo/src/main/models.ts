// ============================================================
// THE MODELS. The only place a model is named.
//
// Three rungs, one constant each. Change a line here and the dropdown, the
// sizes it quotes, the download and the loader all follow. Sizes come from
// each descriptor's own `expectedSize`, never typed by hand.
//
// All three are Qwen3, so one prompt behaves the same way on every rung
// and the only thing that changes is how good the questions are. Qwen3 is
// a thinking model; the JSON grammar gives it no room to think, and the
// prompt also sends Qwen's `/no_think` switch.
// ============================================================

import { QWEN3_1_7B_INST_Q4, QWEN3_4B_INST_Q4_K_M, QWEN3_8B_INST_Q4_K_M } from '@qvac/sdk'
import type { ModelChoice, ModelKey } from '../core/types'

interface Rung {
  key: ModelKey
  label: string
  name: string
  src: typeof QWEN3_1_7B_INST_Q4 | typeof QWEN3_4B_INST_Q4_K_M | typeof QWEN3_8B_INST_Q4_K_M
}

export const MODELS: Rung[] = [
  // ~1.1 GB. The spec's "~1B" rung. Qwen3 1.7B over Llama 3.2 1B because it
  // follows a JSON schema and a long rule list far more reliably, for 300 MB.
  { key: 'fast', label: 'Fast', name: 'Qwen3 1.7B', src: QWEN3_1_7B_INST_Q4 },
  // ~2.5 GB.
  { key: 'balanced', label: 'Balanced', name: 'Qwen3 4B', src: QWEN3_4B_INST_Q4_K_M },
  // ~5.0 GB. The default: distractor quality is where small models fail
  // first, and it is the part of a question a candidate notices most.
  { key: 'best', label: 'Best quality', name: 'Qwen3 8B', src: QWEN3_8B_INST_Q4_K_M }
]

export const DEFAULT_MODEL: ModelKey = 'best'

export function rung(key: ModelKey): Rung {
  const r = MODELS.find((m) => m.key === key)
  if (!r) throw new Error(`Unknown model key: ${key}`)
  return r
}

export const MODEL_CHOICES: ModelChoice[] = MODELS.map((m) => ({
  key: m.key,
  label: m.label,
  name: m.name,
  quant: String(m.src.quantization ?? '').toUpperCase(),
  bytes: m.src.expectedSize ?? 0,
  isDefault: m.key === DEFAULT_MODEL
}))

// ---- Load settings ---------------------------------------------------
//
// PARALLEL: decode slots for batchCompletion (it needs at least 2).
// Measured on an Apple M4 (16 GB), four drafts at once against one:
// Qwen3 4B went from ~14 to ~19 tok/s in total, the 1.7B stayed at ~80.
// So batching pays a little on the bigger rungs and costs nothing on the
// small one. Two slots made a 3-question paper on the 4B take 89 s
// instead of 48 s.
//
// CONTEXT: llama.cpp splits ctx_size across the slots, so each gets
// 12288 / 4 = 3072 tokens. One prompt needs about 700 (rules) + 650
// (a 500-token chunk, estimated) + up to PREDICT for the reply, which
// leaves room. The KV cache for 12k tokens on the 8B is about 1.8 GB.
export const PARALLEL = 4
export const CTX_SIZE = 12288
export const PREDICT = 900
