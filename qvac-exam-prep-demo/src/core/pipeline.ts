// ============================================================
// The generation pipeline. This is where the app succeeds or fails.
//
//   sample N+40% chunks, spread   ->  one batch through one model
//   ->  every reply through the gate  ->  keep the first N that pass
//   ->  short? one top-up batch  ->  still short? say so, never pad
//
// The model is reached through `Engine`, an interface of one method, so
// the whole pipeline can be driven by a fake in tests and by the real SDK
// in the app and the CLI (src/main/qvac.ts).
// ============================================================

import { buildPrompt, pickShape, schemaFor, type Message, type Shape } from './prompt'
import { filterPool, mulberry32, sampleSpread } from './sample'
import type { Chunk, Exam, ExamConfig, GenEvent, QuestionType, Rejection } from './types'
import { sameQuestion, validateQuestion } from './validate'

export interface PromptSpec {
  index: number
  history: Message[]
  schema: Record<string, unknown>
  schemaName: string
}

export interface BatchHandle {
  /** Stops the batch. Prompts still running end without a result. */
  cancel(): Promise<void>
  /** Settles when every prompt has reported or the batch was cancelled. */
  done: Promise<void>
}

export interface Engine {
  /**
   * Runs the prompts as one batch through one loaded model. `onResult` is
   * called once per prompt as soon as that prompt finishes, in whatever
   * order they finish: `text` is the raw reply, or null with `error` set.
   */
  runBatch(
    prompts: PromptSpec[],
    onResult: (index: number, text: string | null, error?: string) => void
  ): BatchHandle
}

/** Asking for 40% more than needed absorbs what the gate rejects. */
export const OVERGENERATE = 1.4

/**
 * How many drafts the first round asks for: N + 40%, except that a single
 * draft spilling past the last full set of decode slots is dropped. It
 * would wait for a slot and cost a whole extra round for one question.
 * 3 questions on 4 slots: 4 drafts, not 5.
 */
export function firstRound(target: number, slots = 1): number {
  const n = Math.ceil(target * OVERGENERATE)
  return slots > 1 && n % slots === 1 && n - 1 > target ? n - 1 : n
}

export interface GenerateInput {
  config: ExamConfig
  chunks: Chunk[] // already junk-filtered
  sourceTitles: Record<string, string>
  engine: Engine
  emit: (e: GenEvent) => void
  signal?: AbortSignal
  seed?: number
  now?: () => Date
  /** Decode slots on the loaded model; shapes the first round. */
  slots?: number
}

interface Job {
  chunk: Chunk
  shape: Shape
}

export async function generateExam(input: GenerateInput): Promise<Exam | null> {
  const { config, engine, emit, signal } = input
  const now = input.now ?? (() => new Date())
  const started = Date.now()
  const rng = mulberry32(input.seed ?? Date.now())
  const target = config.questionCount
  const types: QuestionType[] = config.types.length ? config.types : ['single']

  const pool = filterPool(input.chunks, { sourceIds: config.sourceIds, topicFocus: config.topicFocus, topics: config.topics })
  if (!pool.length) {
    emit({ type: 'error', message: 'No usable material matches that source filter and topic.' })
    return null
  }

  const examId = `exam-${started.toString(36)}`
  const accepted: Exam['questions'] = []
  const used = new Set<string>()
  const failedChunks = new Set<string>()
  let rejected = 0
  let promptCounter = 0
  let typeCounter = 0
  let cancelled = false

  const runRound = async (chunks: Chunk[]): Promise<void> => {
    const jobs: Job[] = chunks.map((chunk) => ({ chunk, shape: pickShape(types[typeCounter++ % types.length], rng) }))
    const base = promptCounter
    promptCounter += jobs.length
    const prompts: PromptSpec[] = jobs.map((job, i) => ({
      index: base + i,
      history: buildPrompt(job.chunk, input.sourceTitles[job.chunk.sourceId] ?? 'Untitled', job.shape, config.difficulty),
      schema: schemaFor(job.shape),
      schemaName: `exam_question_${job.shape.type}`
    }))
    jobs.forEach((j) => used.add(j.chunk.id))

    let handle: BatchHandle | null = null
    const onAbort = (): void => {
      cancelled = true
      void handle?.cancel()
    }
    signal?.addEventListener('abort', onAbort)

    handle = engine.runBatch(prompts, (index, text, error) => {
      if (cancelled) return
      const job = jobs[index - base]
      if (!job) return
      emit({ type: 'produced', promptIndex: index })
      if (accepted.length >= target) return // surplus: discarded silently

      const reject = (reasons: Rejection['reasons'], detail: string): void => {
        rejected++
        failedChunks.add(job.chunk.id)
        emit({
          type: 'rejected',
          rejection: {
            at: now().toISOString(),
            promptIndex: index,
            chunkId: job.chunk.id,
            sourceTitle: input.sourceTitles[job.chunk.sourceId] ?? 'Untitled',
            headingTrail: job.chunk.headingTrail,
            type: job.shape.type,
            reasons,
            detail,
            raw: text ?? ''
          }
        })
      }

      if (text == null) return reject(['generation_failed'], error ?? 'no reply')
      const result = validateQuestion(text, job.shape, job.chunk, `${examId}-q${index}`, rng)
      if (!result.ok) return reject(result.reasons, result.detail)
      const dup = accepted.find((q) => sameQuestion(q.stem, result.question.stem))
      if (dup) return reject(['duplicate_question'], `same as "${dup.stem.slice(0, 80)}"`)

      accepted.push(result.question)
      failedChunks.delete(job.chunk.id)
      emit({ type: 'accepted', question: result.question, accepted: accepted.length, target })
      // Enough: stop paying for the surplus.
      if (accepted.length >= target) void handle?.cancel()
    })

    try {
      await handle.done
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
  }

  const first = sampleSpread(pool, firstRound(target, input.slots), rng)
  emit({ type: 'started', target, prompts: first.length, poolSize: pool.length })

  try {
    await runRound(first)

    // One top-up, from chunks not yet used, then from chunks whose
    // question was rejected (a second attempt on the same material).
    if (!cancelled && accepted.length < target) {
      const missing = target - accepted.length
      const want = Math.ceil(missing * OVERGENERATE) + 1
      let more = sampleSpread(pool, want, rng, used)
      if (more.length < want) {
        const retry = pool.filter((c) => failedChunks.has(c.id) && !more.includes(c))
        more = [...more, ...retry.slice(0, want - more.length)]
      }
      if (more.length) {
        emit({ type: 'topup', prompts: more.length })
        await runRound(more)
      }
    }
  } catch (err) {
    emit({ type: 'error', message: (err as Error).message })
    return null
  }

  if (cancelled) {
    emit({ type: 'cancelled', accepted: accepted.length })
    return null
  }

  const exam: Exam = { id: examId, createdAt: now().toISOString(), config, questions: accepted.slice(0, target) }
  const missing = target - exam.questions.length
  emit({
    type: 'done',
    exam,
    target,
    accepted: exam.questions.length,
    rejected,
    ...(missing > 0
      ? {
          shortBy: {
            missing,
            reason:
              pool.length < target
                ? `The selected material only has ${pool.length} usable passages.`
                : `Too few questions passed the quality checks (${rejected} rejected). A larger model, or more material, will help.`
          }
        }
      : {}),
    seconds: Math.round((Date.now() - started) / 100) / 10
  })
  return exam
}
