import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chunkBlocks, estimateTokens, type Block } from '../src/core/chunk'
import { filterChunks } from '../src/core/junk'
import { parseMarkdown, parsePlainText } from '../src/core/parse-text'

const para = (n: number, word = 'evaporation'): string =>
  Array.from({ length: n }, (_, i) => `Sentence ${i} explains how ${word} works in some detail here.`).join(' ')

test('heading trail follows the hierarchy', () => {
  const blocks: Block[] = [
    { kind: 'heading', level: 1, text: 'The water cycle' },
    { kind: 'heading', level: 2, text: 'Precipitation' },
    { kind: 'heading', level: 3, text: 'Hail' },
    { kind: 'text', text: para(20) },
    { kind: 'heading', level: 2, text: 'Collection' },
    { kind: 'text', text: para(20, 'runoff') }
  ]
  const chunks = chunkBlocks('s', blocks)
  assert.deepEqual(chunks[0].headingTrail, ['The water cycle', 'Precipitation', 'Hail'])
  assert.deepEqual(chunks.at(-1)!.headingTrail, ['The water cycle', 'Collection'])
})

test('long sections split near the target with overlap', () => {
  const blocks: Block[] = [{ kind: 'heading', level: 1, text: 'T' }, { kind: 'text', text: para(120) }]
  const chunks = chunkBlocks('s', blocks, { targetTokens: 500, overlapTokens: 60, minSectionTokens: 120 })
  assert.ok(chunks.length >= 3)
  for (const c of chunks) assert.ok(c.tokenEstimate <= 560, `chunk of ${c.tokenEstimate}`)
  // The start of each chunk repeats the end of the one before it.
  const lastSentence = chunks[0].text.split('. ').at(-1)!
  assert.ok(chunks[1].text.includes(lastSentence.slice(0, 30)))
})

test('a short section folds into its next sibling under the shared trail', () => {
  const blocks: Block[] = [
    { kind: 'heading', level: 1, text: 'T' },
    { kind: 'heading', level: 2, text: 'A' },
    { kind: 'text', text: 'Tiny bit about A.' },
    { kind: 'heading', level: 2, text: 'B' },
    { kind: 'text', text: para(20) }
  ]
  const chunks = chunkBlocks('s', blocks)
  assert.equal(chunks.length, 1)
  assert.deepEqual(chunks[0].headingTrail, ['T'])
  assert.ok(chunks[0].text.startsWith('A:'))
})

test('page numbers and anchors are carried onto chunks', () => {
  const blocks: Block[] = [
    { kind: 'heading', level: 1, text: 'Guide', anchor: 'guide', page: 3 },
    { kind: 'text', text: para(20), page: 4 }
  ]
  const [c] = chunkBlocks('s', blocks)
  assert.equal(c.pageNumber, 4)
  assert.equal(c.anchor, 'guide')
})

test('estimateTokens is about four characters a token', () => {
  assert.equal(estimateTokens('abcd'.repeat(10)), 10)
})

test('markdown fixture: junk is dropped, material is kept', () => {
  const md = readFileSync(new URL('../fixtures/sample-notes.md', import.meta.url), 'utf8')
  const { kept, dropped } = filterChunks(chunkBlocks('wc', parseMarkdown(md)))
  const reasons = new Set(dropped.map((d) => d.dropReason))
  assert.ok(reasons.has('table_of_contents'), 'contents dropped')
  assert.ok(reasons.has('licence_boilerplate'), 'licence dropped')
  assert.ok(reasons.has('navigation'), 'nav dropped')
  assert.ok(kept.length >= 6, `kept ${kept.length}`)
  assert.ok(kept.some((k) => k.headingTrail.join('/') === 'The water cycle/Precipitation/Hail'))
  assert.ok(!kept.some((k) => /badge|Permission is hereby granted/.test(k.text)))
  for (const k of kept) assert.equal(k.headingTrail[0], 'The water cycle')
})

test('plain text gets the title as root and detects headings', () => {
  const blocks = parsePlainText(`GROUNDWATER\n\n${para(10)}\n\nSurface Runoff\n\n${para(10)}`, 'Notes')
  const chunks = chunkBlocks('t', blocks)
  assert.deepEqual(chunks[0].headingTrail, ['Notes', 'GROUNDWATER'])
  assert.deepEqual(chunks.at(-1)!.headingTrail, ['Notes', 'Surface Runoff'])
})
