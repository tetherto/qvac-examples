import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mulberry32 } from '../src/core/sample'
import { validateQuestion } from '../src/core/validate'
import type { Shape } from '../src/core/prompt'
import type { Chunk } from '../src/core/types'

const chunk: Chunk = {
  id: 'wc:3',
  sourceId: 'wc',
  headingTrail: ['The water cycle', 'Precipitation', 'Hail'],
  tokenEstimate: 120,
  text:
    'Hail forms only in thunderstorms with strong updrafts; a hailstone that grows too heavy for the updraft to hold falls to the ground as ice. ' +
    'Snow forms when ice crystals in a cloud below freezing grow and stick together, and it only arrives as snow when the air near the ground stays cold.'
}

const good = {
  evidence: 'a hailstone that grows too heavy for the updraft to hold falls to the ground as ice',
  stem: 'A hailstone keeps growing inside a thunderstorm cloud. What happens once the updraft can no longer hold it?',
  options: [
    { id: 'A', text: 'It falls to the ground as a lump of ice' },
    { id: 'B', text: 'It melts at once and falls as warm rain' },
    { id: 'C', text: 'It rises higher and turns into snow crystals' },
    { id: 'D', text: 'It stays in the cloud and slowly evaporates' }
  ],
  correct: ['A'],
  explanation: 'The updraft can no longer hold it, so it falls as ice. It does not melt or rise.'
}

/**
 * Tests are written with lettered options, a `correct` list and a
 * true/false `answer`, because that reads best. This turns them into what
 * the model actually emits (right and wrong option lists, no letters) plus
 * the shape our code decided before asking.
 */
type T = 'single' | 'multi' | 'truefalse'
function toModel(obj: unknown, type: T): { json: string; shape: Shape } {
  if (typeof obj === 'string') return { json: obj, shape: type === 'truefalse' ? { type, answer: 'true' } : type === 'multi' ? { type, correct: 2 } : { type, correct: 1 } }
  const o = obj as { options?: { id: string; text: string }[]; correct?: string[]; answer?: 'true' | 'false' }
  if (type === 'truefalse') {
    const { answer = 'true', ...rest } = o
    return { json: JSON.stringify(rest), shape: { type, answer } }
  }
  if (!Array.isArray(o.options)) return { json: JSON.stringify(obj), shape: type === 'multi' ? { type, correct: 2 } : { type, correct: 1 } }
  const { options, correct = [], ...rest } = o
  const json = JSON.stringify({
    ...rest,
    correct_options: options.filter((x) => correct.includes(x.id)).map((x) => x.text),
    wrong_options: options.filter((x) => !correct.includes(x.id)).map((x) => x.text)
  })
  return { json, shape: type === 'multi' ? { type, correct: correct.length === 3 ? 3 : 2 } : { type, correct: 1 } }
}

const run = (obj: unknown, type: T = 'single') => {
  const { json, shape } = toModel(obj, type)
  return validateQuestion(json, shape, chunk, 'q1', mulberry32(7))
}

const reasonsOf = (obj: unknown, type?: 'single' | 'multi' | 'truefalse') => {
  const r = run(obj, type)
  return r.ok ? [] : r.reasons
}

test('a good question passes, is shuffled, re-lettered and sourced by us', () => {
  const r = run(good)
  assert.ok(r.ok, r.ok ? '' : r.detail)
  if (!r.ok) return
  assert.equal(r.question.sourceChunkId, 'wc:3')
  assert.deepEqual(r.question.options.map((o) => o.id), ['a', 'b', 'c', 'd'])
  const right = r.question.options.find((o) => r.question.correct.includes(o.id))!
  assert.equal(right.text, 'It falls to the ground as a lump of ice')
})

test('shuffle moves the correct answer around', () => {
  const positions = new Set<number>()
  for (let seed = 0; seed < 30; seed++) {
    const m = toModel(good, 'single')
    const r = validateQuestion(m.json, m.shape, chunk, 'q', mulberry32(seed))
    if (r.ok) positions.add(r.question.options.findIndex((o) => r.question.correct.includes(o.id)))
  }
  assert.ok(positions.size >= 3)
})

test('not JSON', () => assert.deepEqual(reasonsOf('here is your question: {'), ['parse_error']))
test('extra keys', () => assert.deepEqual(reasonsOf({ ...good, difficulty: 'hard' }), ['schema_mismatch']))
test('missing keys', () => assert.deepEqual(reasonsOf({ stem: good.stem }), ['schema_mismatch']))

test('duplicate options', () => {
  const opts = [...good.options]
  opts[2] = { id: 'C', text: 'It falls to the ground as a lump of ice.' }
  assert.ok(reasonsOf({ ...good, options: opts }).includes('duplicate_options'))
})

test('empty option', () => {
  const opts = [...good.options]
  opts[3] = { id: 'D', text: '' }
  assert.ok(reasonsOf({ ...good, options: opts }).includes('empty_option'))
})

test('wrong option count', () => assert.ok(reasonsOf({ ...good, options: good.options.slice(0, 3) }).includes('option_count')))
test('an option list holding a non-string is a schema mismatch', () => {
  const bad = JSON.stringify({ ...good, options: undefined, correct: undefined, correct_options: [1], wrong_options: ['x', 'y', 'z'] })
  assert.deepEqual(reasonsOf(bad), ['schema_mismatch'])
})
test('lettered options from the model are refused outright', () => {
  assert.deepEqual(reasonsOf(JSON.stringify(good)), ['schema_mismatch'])
})
test('no option marked correct', () => assert.ok(reasonsOf({ ...good, correct: [] }).includes('correct_count')))
test('two correct on a single', () => assert.ok(reasonsOf({ ...good, correct: ['A', 'B'] }).includes('correct_count')))

test('multi needs two or more, and not all', () => {
  const five = [...good.options, { id: 'E', text: 'It splits into smaller stones that keep rising' }]
  assert.ok(reasonsOf({ ...good, options: five, correct: ['A'] }, 'multi').includes('correct_count'))
  assert.ok(reasonsOf({ ...good, options: five, correct: ['A', 'B', 'C', 'D', 'E'] }, 'multi').includes('correct_count'))
})

test('answer verbatim in stem', () => {
  const stem = 'Which is true: it falls to the ground as a lump of ice, when the updraft fails?'
  assert.ok(reasonsOf({ ...good, stem }).includes('answer_in_stem'))
})

test('empty explanation', () => assert.ok(reasonsOf({ ...good, explanation: '' }).includes('empty_explanation')))

test('length parity: correct markedly longer than every distractor', () => {
  const opts = [
    { id: 'A', text: 'It falls to the ground as solid ice, because the updraft beneath it is no longer strong enough to hold its weight' },
    { id: 'B', text: 'It melts' },
    { id: 'C', text: 'It rises' },
    { id: 'D', text: 'It evaporates' }
  ]
  assert.ok(reasonsOf({ ...good, options: opts }).includes('length_parity'))
})

test('length parity: correct markedly shorter', () => {
  const opts = [
    { id: 'A', text: 'It falls' },
    { id: 'B', text: 'It melts at once on the way down and reaches the ground as warm rain' },
    { id: 'C', text: 'It rises higher into the cloud and turns into fine snow crystals' },
    { id: 'D', text: 'It stays inside the cloud and slowly evaporates back into vapour' }
  ]
  assert.ok(reasonsOf({ ...good, options: opts }).includes('length_parity'))
})

test('absolutes only in distractors', () => {
  const opts = [...good.options]
  opts[1] = { id: 'B', text: 'It always melts at once and falls as rain' }
  assert.ok(reasonsOf({ ...good, options: opts }).includes('absolutes_only_in_distractors'))
})

test('all of the above', () => {
  const opts = [...good.options]
  opts[3] = { id: 'D', text: 'All of the above' }
  assert.ok(reasonsOf({ ...good, options: opts }).includes('all_or_none_of_the_above'))
})

test('mentions the passage', () => {
  assert.ok(reasonsOf({ ...good, stem: 'According to the passage, what happens to a hailstone too heavy for its updraft?' }).includes('mentions_passage'))
})

test('evidence must come from the chunk', () => {
  assert.ok(reasonsOf({ ...good, evidence: 'Volcanoes release ash high into the air during an eruption.' }).includes('evidence_not_in_passage'))
})

test('true/false builds its own options and needs exactly one answer', () => {
  const tf = { evidence: good.evidence, stem: 'A hailstone too heavy for its updraft melts and reaches the ground as rain.', answer: 'false', explanation: 'It falls as ice instead.' }
  const r = run(tf, 'truefalse')
  assert.ok(r.ok, r.ok ? '' : r.detail)
  if (r.ok) {
    assert.deepEqual(r.question.options.map((o) => o.text), ['True', 'False'])
    assert.deepEqual(r.question.correct, ['false'])
  }
  // The truth value is ours: a model that adds its own "answer" is off-schema.
  assert.ok(reasonsOf(JSON.stringify({ ...tf }), 'truefalse').includes('schema_mismatch'))
})

test('a reply wrapped in a code fence still parses (prompt-only fallback)', () => {
  assert.ok(run('```json\n' + toModel(good, 'single').json + '\n```').ok)
})

test('every failure is reported, not just the first', () => {
  const opts = [...good.options]
  opts[3] = { id: 'D', text: 'None of the above' }
  const r = reasonsOf({ ...good, options: opts, explanation: '', stem: 'What does the text say?' })
  assert.ok(r.includes('empty_explanation') && r.includes('all_or_none_of_the_above') && r.includes('mentions_passage'))
})

// ---- Cases taken from a real run on Qwen3 4B ------------------------------

test('explanation that names a letter is rejected (letters are reshuffled)', () => {
  for (const explanation of [
    'The correct answer is A because the updraft cannot hold it.',
    'So the correct options are A and C.',
    'Option B is wrong because it does not melt.',
    'It falls (A); it does not rise.',
    'The updraft fails. B is wrong because it does not melt.',
    'The first option is right: the stone is too heavy.',
    'Answer 2 is tempting but it does not melt.'
  ]) {
    assert.ok(reasonsOf({ ...good, explanation }).includes('explanation_cites_letter'), explanation)
  }
  // Ordinary English with a capital A at a sentence start is fine.
  assert.ok(run({ ...good, explanation: 'A heavy hailstone beats the updraft, so it falls as ice. It does not melt or rise.' }).ok)
})

test('near-duplicate options that differ by one verb form', () => {
  const five = [
    { id: 'A', text: 'The cloud grows taller and darker overhead' },
    { id: 'B', text: 'The cloud drifts away from the coast' },
    { id: 'C', text: 'The cloud releases the stored water as rain' },
    { id: 'D', text: 'The cloud turns into fog at ground level' },
    { id: 'E', text: 'The cloud starts to release the stored water as rain' }
  ]
  assert.ok(reasonsOf({ ...good, options: five, correct: ['C', 'E'] }, 'multi').includes('duplicate_options'))
})

test('a stem copied from the passage is rejected', () => {
  const tf = {
    evidence: good.evidence,
    stem: 'A hailstone that grows too heavy for the updraft to hold falls to the ground as ice.',
    answer: 'true',
    explanation: 'It falls as ice.'
  }
  assert.ok(reasonsOf(tf, 'truefalse').includes('copied_from_passage'))
})

test('a multi stem that asks nothing is rejected', () => {
  const five = [...good.options, { id: 'E', text: 'It splits into smaller stones that keep rising' }]
  const stem = 'A hailstone grows inside a thunderstorm cloud. (Select all that apply.)'
  assert.ok(reasonsOf({ ...good, stem, options: five, correct: ['A', 'E'] }, 'multi').includes('stem_not_a_question'))
})

test('a true/false stem phrased as a question is rejected', () => {
  const tf = { evidence: good.evidence, stem: 'A cloud cools below freezing. What forms first?', answer: 'true', explanation: 'Ice crystals.' }
  assert.ok(reasonsOf(tf, 'truefalse').includes('stem_not_a_question'))
})

test('"the passage" in an explanation becomes "the source"', () => {
  const r = run({ ...good, explanation: 'The passage says the stone falls as ice. This passage never mentions melting.' })
  assert.ok(r.ok)
  if (r.ok) assert.equal(r.question.explanation, 'The source says the stone falls as ice. This source never mentions melting.')
})

test('an explanation cut off by the length cap is rejected', () => {
  assert.ok(reasonsOf({ ...good, explanation: 'A heavy hailstone falls as ice, because the updraft is too weak and the' }).includes('explanation_cut_off'))
})

test('a draft that drifts into another script is rejected', () => {
  assert.ok(reasonsOf({ ...good, explanation: 'A heavy hailstone falls to the ground 作为 ice.' }).includes('wrong_language'))
})

test('a cut-off explanation keeps its whole sentences', async () => {
  const { wholeSentences } = await import('../src/core/validate')
  assert.equal(wholeSentences('The hailstone falls as ice. The updraft below it is too weak to hold it, which'), 'The hailstone falls as ice.')
  assert.equal(wholeSentences('Fine as it is.'), 'Fine as it is.')
  assert.equal(wholeSentences('No full sentence here at all and it'), 'No full sentence here at all and it')
})
