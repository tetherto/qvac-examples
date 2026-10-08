import assert from 'node:assert/strict'
import { test } from 'node:test'
import { feedbackLine, grade, isRight, optionMarks, splitTopics, summary } from '../src/core/grade'
import { inTopics, topicOf, topicTree } from '../src/core/topics'
import type { Attempt, Chunk, Exam, Question } from '../src/core/types'

const q = (id: string, type: Question['type'], correct: string[], trail: string[]): Question => ({
  id,
  type,
  stem: `Question ${id}?`,
  options: ['a', 'b', 'c', 'd'].map((x) => ({ id: x, text: `option ${x}` })),
  correct,
  explanation: 'because',
  sourceChunkId: `c-${id}`,
  headingTrail: trail,
  evidence: 'e'
})

const exam: Exam = {
  id: 'e1',
  createdAt: '',
  config: { questionCount: 4, difficulty: 'applied', types: ['single', 'multi'], mode: 'exam', modelKey: 'balanced' },
  questions: [
    q('1', 'single', ['a'], ['Doc', 'State', 'Locking']),
    q('2', 'multi', ['a', 'c'], ['Doc', 'State', 'Backends']),
    q('3', 'single', ['b'], ['Doc', 'Modules']),
    q('4', 'single', ['d'], ['Doc', 'Modules', 'Sources'])
  ]
}
const attempt = (answers: Attempt['answers'], duds: Attempt['duds'] = {}): Attempt => ({
  id: 'a1', examId: 'e1', mode: 'exam', startedAt: '', updatedAt: '', elapsedMs: 0, current: 0, answers, flagged: [], checked: [], duds
})

test('a multi answer is right only when the set matches exactly', () => {
  assert.ok(isRight(exam.questions[1], ['c', 'a']))
  assert.ok(!isRight(exam.questions[1], ['a']))
  assert.ok(!isRight(exam.questions[1], ['a', 'b', 'c']))
  assert.ok(!isRight(exam.questions[0], []))
})

test('option marks tell right, missed and wrong apart', () => {
  assert.deepEqual(optionMarks(exam.questions[1], ['a', 'b']), { a: 'right', b: 'wrong', c: 'missed', d: 'none' })
  assert.equal(feedbackLine(exam.questions[1], ['a', 'b']), 'One right, and two worth a second look.')
  assert.equal(feedbackLine(exam.questions[0], ['a']), 'Right.')
  assert.equal(feedbackLine(exam.questions[0], ['b']), 'Not this one.')
})

test('grading groups by top topic and leaves faulty questions out', () => {
  const g = grade(exam, attempt({ '1': ['a'], '2': ['a'], '3': ['b'] }))
  assert.equal(g.right, 2)
  assert.equal(g.total, 4)
  assert.deepEqual(g.toReread, ['2', '4'])
  const { reread, solid } = splitTopics(g)
  assert.deepEqual(reread.map((t) => [t.topic, t.right, t.total]), [['State', 1, 2], ['Modules', 1, 2]])
  assert.equal(solid.length, 0)
  assert.equal(summary(g), '2 to reread, each in a different topic.')

  const without = grade(exam, attempt({ '1': ['a'], '2': ['a'], '3': ['b'] }, { '2': 'wrong_key' }))
  assert.equal(without.total, 3)
  assert.equal(without.removed, 1)
  assert.deepEqual(without.toReread, ['4'])
})

test('topics skip the document title and nest two levels', () => {
  const c = (id: string, trail: string[]): Chunk => ({ id, sourceId: 's', text: '', headingTrail: trail, tokenEstimate: 1 })
  const tree = topicTree([c('1', ['Doc', 'State', 'Locking']), c('2', ['Doc', 'State']), c('3', ['Other doc', 'State', 'Workspaces']), c('4', ['Lonely'])])
  assert.deepEqual(tree.map((n) => [n.name, n.sections, n.children.map((x) => x.name)]), [['State', 3, ['Locking', 'Workspaces']], ['Lonely', 1, []]])
  assert.equal(topicOf(['Doc', 'State', 'Locking']), 'State')
  assert.ok(inTopics(['Doc', 'State', 'Locking'], ['State › Locking']))
  assert.ok(inTopics(['Doc', 'State', 'Locking'], ['State']))
  assert.ok(!inTopics(['Doc', 'State', 'Workspaces'], ['State › Locking']))
})
