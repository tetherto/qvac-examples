import { test } from 'node:test'
import assert from 'node:assert/strict'
import { junkReason } from '../src/core/junk'
import { estimateTokens } from '../src/core/chunk'
import type { Chunk } from '../src/core/types'

const chunk = (text: string, trail = ['Doc', 'Section']): Chunk => ({
  id: 'c',
  sourceId: 's',
  text,
  headingTrail: trail,
  tokenEstimate: estimateTokens(text)
})

const prose =
  'Hail forms only in thunderstorms with strong updrafts. A small ice pellet is carried up and down through the cloud, and each trip adds a coat of ice, until the hailstone is too heavy for the updraft and falls.'

test('real prose passes', () => assert.equal(junkReason(chunk(prose)), null))
test('no heading', () => assert.equal(junkReason(chunk(prose, [])), 'no_heading'))
test('too short', () => assert.equal(junkReason(chunk('Hail is made of ice.')), 'too_short'))
test('toc by heading', () => assert.equal(junkReason(chunk(prose, ['Doc', 'Table of Contents'])), 'table_of_contents'))
test('toc by dot leaders', () => {
  const toc = ['Introduction ........ 1', 'Evaporation ........ 4', 'Condensation ........ 9', 'Precipitation ........ 12', 'Collection ........ 15', 'People and the cycle ........ 20'].join('\n')
  assert.equal(junkReason(chunk(toc)), 'table_of_contents')
})
test('licence by phrases', () => {
  const lic = 'Copyright 2024 Someone. Licensed under the Apache License. Distributed WITHOUT WARRANTIES OR CONDITIONS of any kind, either express or implied, see the license for details on permissions.'
  assert.equal(junkReason(chunk(lic)), 'licence_boilerplate')
})
test('navigation', () => {
  const nav = ['- Home', '- Docs', '- Blog', '- Pricing', '- Sign in', '- Next', '- Previous', '- Edit this page on GitHub now', '- Back to top', '- Subscribe to updates'].join('\n')
  assert.equal(junkReason(chunk(nav)), 'navigation')
})
test('symbol heavy', () => {
  const code = ['{ "a": 1, "b": [1, 2, 3] };', '{ "c": {}, "d": [4, 5] };', '[[0, 0], [1, 1], [2, 2]];', '{ }; { }; { }; [ ]; [ ];', '=> {} => [] => () => {};'].join('\n')
  assert.equal(junkReason(chunk(code)), 'symbol_heavy')
})
test('references by heading', () => assert.equal(junkReason(chunk(prose, ['Doc', 'References'])), 'references'))
test('references by citation density', () => {
  const refs =
    '"Rivers and Rain". Example Journal. 2014-03-12. Retrieved 2020-01-02. Smith, J. (2019). The Water Cycle. pp. 12-14. ISBN 978-1-23. ' +
    '"Annual Weather Report". Example Institute. Archived from the original on 2021-05-01. Retrieved 2021-06-01.'
  assert.equal(junkReason(chunk(refs)), 'references')
})
