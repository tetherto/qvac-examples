import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateExam, type Engine, type PromptSpec } from '../src/core/pipeline'
import type { Chunk, ExamConfig, GenEvent } from '../src/core/types'

const text =
  'Hail forms only in thunderstorms with strong updrafts; a hailstone that grows too heavy for the updraft to hold falls to the ground as ice. '
const chunks: Chunk[] = Array.from({ length: 30 }, (_, i) => ({
  id: `s:${i}`,
  sourceId: 's',
  text,
  headingTrail: ['The water cycle', `Topic ${i % 6}`],
  tokenEstimate: 120
}))

const question = (i: number) =>
  JSON.stringify({
    evidence: 'a hailstone that grows too heavy for the updraft to hold falls to the ground',
    stem: `Scenario number ${i}: a hailstone outgrows its updraft with ${'x'.repeat(i % 3)} unique detail ${i * 7919}. What happens?`,
    correct_options: [`It falls to the ground as ice ${i}`],
    wrong_options: [`It melts and falls as rain ${i}`, `It rises and turns to snow ${i}`, `It stays up and evaporates ${i}`],
    explanation: 'The updraft cannot hold it.'
  })

/** A fake engine: replies for each prompt; `bad` decides which ones are junk. */
function fakeEngine(bad: (index: number) => boolean, calls: PromptSpec[][]): Engine {
  return {
    runBatch(prompts, onResult) {
      calls.push(prompts)
      let stopped = false
      const done = (async () => {
        for (const p of prompts) {
          await new Promise((r) => setTimeout(r, 1))
          if (stopped) return
          onResult(p.index, bad(p.index) ? '{"stem": "broken"}' : question(p.index))
        }
      })()
      return { done, cancel: async () => void (stopped = true) }
    }
  }
}

const config: ExamConfig = { questionCount: 10, difficulty: 'applied', types: ['single'], mode: 'exam', modelKey: 'fast' }

test('over-generates by 40% and keeps exactly N', async () => {
  const calls: PromptSpec[][] = []
  const events: GenEvent[] = []
  const exam = await generateExam({ config, chunks, sourceTitles: { s: 'TF' }, engine: fakeEngine(() => false, calls), emit: (e) => events.push(e), seed: 1 })
  assert.equal(calls[0].length, 14)
  assert.equal(exam?.questions.length, 10)
  assert.ok(exam!.questions.every((q) => q.sourceChunkId.startsWith('s:')))
  assert.equal(events.filter((e) => e.type === 'accepted').length, 10)
})

test('rejections trigger exactly one top-up batch', async () => {
  const calls: PromptSpec[][] = []
  const events: GenEvent[] = []
  const exam = await generateExam({ config, chunks, sourceTitles: { s: 'TF' }, engine: fakeEngine((i) => i % 2 === 0, calls), emit: (e) => events.push(e), seed: 2 })
  assert.equal(calls.length, 2)
  assert.ok(events.some((e) => e.type === 'topup'))
  assert.ok(events.filter((e) => e.type === 'rejected').length > 0)
  assert.ok(exam!.questions.length <= 10)
})

test('thin material returns a shorter exam and says why, never pads', async () => {
  const calls: PromptSpec[][] = []
  const events: GenEvent[] = []
  const exam = await generateExam({ config, chunks: chunks.slice(0, 4), sourceTitles: { s: 'TF' }, engine: fakeEngine(() => false, calls), emit: (e) => events.push(e), seed: 3 })
  assert.equal(exam?.questions.length, 4)
  const done = events.find((e) => e.type === 'done')
  assert.ok(done && done.type === 'done' && done.shortBy?.missing === 6)
})

test('cancel stops the run and returns nothing', async () => {
  const controller = new AbortController()
  const events: GenEvent[] = []
  const p = generateExam({ config, chunks, sourceTitles: { s: 'TF' }, engine: fakeEngine(() => false, []), emit: (e) => events.push(e), signal: controller.signal, seed: 4 })
  setTimeout(() => controller.abort(), 3)
  assert.equal(await p, null)
  assert.ok(events.some((e) => e.type === 'cancelled'))
})

test('the first round drops a lone draft past the last full set of slots', async () => {
  const { firstRound } = await import('../src/core/pipeline')
  assert.equal(firstRound(3, 4), 4) // 5 would leave one draft waiting a whole round
  assert.equal(firstRound(5, 4), 7)
  assert.equal(firstRound(20, 4), 28)
  assert.equal(firstRound(3, 1), 5)
  assert.equal(firstRound(1, 4), 2)
})
