import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterPool, mulberry32, sampleSpread, topicKey } from '../src/core/sample'
import type { Chunk } from '../src/core/types'

const mk = (sourceId: string, n: number, trailFor: (i: number) => string[]): Chunk[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${sourceId}:${i}`, sourceId, text: `text ${i}`, headingTrail: trailFor(i), tokenEstimate: 100 }))

test('one big source cannot dominate', () => {
  const big = mk('big', 100, (i) => ['Big', `Ch${i % 5}`])
  const small = mk('small', 4, () => ['Small', 'Only'])
  const picked = sampleSpread([...big, ...small], 8, mulberry32(1))
  assert.equal(picked.length, 8)
  assert.equal(picked.filter((c) => c.sourceId === 'small').length, 4)
})

test('within a source, topics are spread', () => {
  const doc = mk('d', 50, (i) => ['Doc', i < 45 ? 'Huge chapter' : `Small ${i}`])
  const picked = sampleSpread(doc, 6, mulberry32(2))
  const topics = new Set(picked.map((c) => topicKey(c.headingTrail)))
  assert.equal(topics.size, 6)
})

test('never picks the same chunk twice, and stops when the pool is empty', () => {
  const pool = mk('a', 5, (i) => ['A', `T${i}`])
  const picked = sampleSpread(pool, 20, mulberry32(3))
  assert.equal(picked.length, 5)
  assert.equal(new Set(picked.map((c) => c.id)).size, 5)
})

test('exclude skips used chunks', () => {
  const pool = mk('a', 5, (i) => ['A', `T${i}`])
  const picked = sampleSpread(pool, 5, mulberry32(4), new Set(['a:0', 'a:1']))
  assert.equal(picked.length, 3)
})

test('source filter and topic focus', () => {
  const pool = [...mk('a', 3, () => ['A', 'State', 'Locking']), ...mk('b', 3, () => ['B', 'Workspaces'])]
  assert.equal(filterPool(pool, { sourceIds: ['b'] }).length, 3)
  assert.equal(filterPool(pool, { topicFocus: 'locking' }).length, 3)
  assert.ok(filterPool(pool, { topicFocus: 'locking' }).every((c) => c.sourceId === 'a'))
})

test('topic key is the first two trail segments', () => {
  assert.equal(topicKey(['The water cycle', 'Precipitation', 'Hail']), 'The water cycle › Precipitation')
})

test('decided answer shapes are balanced: true/false and 2-or-3 correct', async () => {
  const { pickShape } = await import('../src/core/prompt')
  const rng = mulberry32(9)
  const tf = Array.from({ length: 200 }, () => pickShape('truefalse', rng))
  const trues = tf.filter((s) => s.type === 'truefalse' && s.answer === 'true').length
  assert.ok(trues > 70 && trues < 130, `${trues} of 200 true`)
  const multi = Array.from({ length: 200 }, () => pickShape('multi', rng))
  assert.ok(multi.some((s) => s.type === 'multi' && s.correct === 2) && multi.some((s) => s.type === 'multi' && s.correct === 3))
})
