// ============================================================
// Grading. Pure functions over an Exam and an Attempt.
//
// A question is right only when the picked set equals the key exactly: a
// "pick all that apply" with one of three missed is wrong, as on a real
// paper. Questions the user marked "this question isn't right" leave the
// score altogether, in both the numerator and the denominator.
// ============================================================

import { topicOf, topicPath } from './topics'
import type { Attempt, Difficulty, Exam, Question } from './types'

export function isRight(q: Question, picked: string[] | undefined): boolean {
  if (!picked?.length) return false
  const a = [...new Set(picked)].sort()
  const b = [...q.correct].sort()
  return a.length === b.length && a.every((x, i) => x === b[i])
}

/** right: picked and in the key. missed: in the key, not picked. wrong: picked, not in the key. */
export type OptionMark = 'right' | 'missed' | 'wrong' | 'none'

export function optionMarks(q: Question, picked: string[] | undefined): Record<string, OptionMark> {
  const p = new Set(picked ?? [])
  return Object.fromEntries(
    q.options.map((o) => {
      const key = q.correct.includes(o.id)
      return [o.id, key && p.has(o.id) ? 'right' : key ? 'missed' : p.has(o.id) ? 'wrong' : 'none']
    })
  )
}

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five']
const word = (n: number): string => WORDS[n] ?? String(n)

/** The one-line verdict shown under a checked practice question. */
export function feedbackLine(q: Question, picked: string[] | undefined): string {
  const marks = Object.values(optionMarks(q, picked))
  const right = marks.filter((m) => m === 'right').length
  const off = marks.filter((m) => m === 'missed' || m === 'wrong').length
  if (!off) return q.correct.length > 1 ? `All ${word(right).toLowerCase()} right.` : 'Right.'
  if (!right) return q.type === 'multi' ? 'None of these were right.' : 'Not this one.'
  return `${word(right)} right, and ${word(off).toLowerCase()} worth a second look.`
}

export interface TopicScore {
  topic: string
  right: number
  total: number
  /** Second-level headings the topic's questions came from. */
  subtopics: string[]
  questionIds: string[]
  missedIds: string[]
}

export interface Grade {
  right: number
  /** Questions that count: all of them minus the ones marked faulty. */
  total: number
  removed: number
  unanswered: number
  topics: TopicScore[]
  /** Wrong or unanswered, in paper order. */
  toReread: string[]
  difficulty: Difficulty
}

export function grade(exam: Exam, attempt: Attempt): Grade {
  const counted = exam.questions.filter((q) => !attempt.duds[q.id])
  const topics = new Map<string, TopicScore>()
  const toReread: string[] = []
  let right = 0
  let unanswered = 0
  for (const q of counted) {
    const picked = attempt.answers[q.id]
    const ok = isRight(q, picked)
    if (ok) right++
    else toReread.push(q.id)
    if (!picked?.length) unanswered++
    const name = topicOf(q.headingTrail)
    const t = topics.get(name) ?? { topic: name, right: 0, total: 0, subtopics: [], questionIds: [], missedIds: [] }
    t.total++
    t.questionIds.push(q.id)
    if (ok) t.right++
    else t.missedIds.push(q.id)
    const sub = topicPath(q.headingTrail)[1]
    if (sub && !t.subtopics.includes(sub)) t.subtopics.push(sub)
    topics.set(name, t)
  }
  return {
    right,
    total: counted.length,
    removed: exam.questions.length - counted.length,
    unanswered,
    topics: [...topics.values()],
    toReread,
    difficulty: exam.config.difficulty
  }
}

/** Topics with a miss, worst first; then the solid ones, biggest first. */
export function splitTopics(g: Grade): { reread: TopicScore[]; solid: TopicScore[] } {
  const reread = g.topics.filter((t) => t.right < t.total).sort((a, b) => a.right / a.total - b.right / b.total || b.total - a.total)
  const solid = g.topics.filter((t) => t.right === t.total).sort((a, b) => b.total - a.total)
  return { reread, solid }
}

export function verdict(g: Grade): string {
  if (!g.total) return 'Nothing left to score.'
  const pct = g.right / g.total
  if (pct >= 0.9) return 'An excellent paper.'
  if (pct >= 0.7) return 'A solid paper.'
  if (pct >= 0.5) return 'Getting there.'
  return 'A paper to learn from.'
}

const list = (names: string[]): string => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0])

/** "Strong on Workflow and Modules. Reread State: 4 of 6 misses." */
export function summary(g: Grade): string {
  const { reread, solid } = splitTopics(g)
  const misses = g.total - g.right
  const parts: string[] = []
  if (solid.length) parts.push(`Strong on ${list(solid.slice(0, 2).map((t) => t.topic))}.`)
  if (!misses) parts.push('No misses. Try a harder depth next.')
  else if (reread.length) {
    const worst = [...reread].sort((a, b) => b.missedIds.length - a.missedIds.length)[0]
    const m = worst.missedIds.length
    if (m === 1) parts.push(misses === 1 ? `One to reread: ${worst.topic}.` : `${misses} to reread, each in a different topic.`)
    else parts.push(m === misses ? `Reread ${worst.topic}: every miss was there.` : `Reread ${worst.topic}: ${m} of ${misses} misses.`)
  }
  return parts.join(' ')
}
