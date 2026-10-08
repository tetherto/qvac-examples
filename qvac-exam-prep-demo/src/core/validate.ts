// ============================================================
// The validation gate. Pure code, and EVERY question goes through it.
//
// An unvalidated question never reaches the user. One question with two
// identical options does more damage to trust than ten dull ones, so the
// gate is strict and the pipeline over-generates to pay for it.
//
// The gate collects every failure rather than stopping at the first, so a
// rejection log line says everything that was wrong with a question. That
// log is the main debugging surface of the whole app.
//
// The only repair is order: options are shuffled and re-lettered after the
// checks, so neither position nor the model's own letter can hint at the
// answer.
// ============================================================

import { OPTION_COUNT, type Shape } from './prompt'
import { shuffle } from './sample'
import type { Chunk, Question, QuestionType, RejectReason } from './types'

export type GateResult =
  | { ok: true; question: Question }
  | { ok: false; reasons: RejectReason[]; detail: string }

const ABSOLUTES = /\b(always|never|all|none)\b/i
const ALL_OR_NONE = /\b(all|none|both|neither) of the (above|options|answers|choices)\b/i
/**
 * Qwen models now and then slip into Chinese mid-sentence. The material is
 * read in one language and the questions must be in it too; for now any
 * CJK, Hangul or Cyrillic in an English-looking draft is a reject.
 */
const OTHER_SCRIPT = /[\u0400-\u04ff\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/
/** The grammar caps the explanation's length; one that hit the cap ends mid-sentence. */
const ENDS_SENTENCE = /[.!?)"'`\]]$/

/** Drops a cut-off last sentence, if at least one whole sentence comes before it. */
export function wholeSentences(text: string): string {
  const t = text.trim()
  if (!t || ENDS_SENTENCE.test(t)) return t
  const m = t.match(/^[\s\S]*[.!?](?=\s)/)
  return m && m[0].length >= 20 ? m[0] : t
}

const MENTIONS_PASSAGE = /\b(the|this) (passage|text|excerpt|document|article|author)\b/i
// Options are shuffled and re-lettered after the gate, so an explanation
// that says "A is correct" would point at the wrong option. Case-sensitive:
// the letter is a capital, and "is a" is just English.
const CITES_LETTER = [
  /\b(?:[Oo]ptions?|[Aa]nswers?|[Cc]hoices?)\s*\(?[A-E](?![\w'])/,
  /\(\s*[A-E]\s*\)/,
  /(?:^|\s)[A-E]\)/,
  /\b(?:is|are|and|or|not|than|choose|chose|select)\s+[A-E](?=[\s.,;:)]|$)/,
  // "B is wrong because…", "D refers to…"
  /(?:^|[.;:!?]\s+)[A-E]\s+(?:is|are|was|would|does|do|refers|describes|suggests|states|correctly|incorrectly)\b/,
  // "the first option", "option 2", "the last answer"
  /\b(?:first|second|third|fourth|fifth|last)\s+(?:option|answer|choice)\b/i,
  /\b(?:option|answer|choice)\s+[1-5]\b/i
]
/** Words too common to tell two options apart. */
const STOP = new Set('a an the of to in on for and or is are be by with it its that this as at from into than then'.split(' '))

/** Lowercase, no punctuation, single spaces, no leading article. */
export function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(a|an|the) /, '')
}

function wordSet(s: string): Set<string> {
  return new Set(normalise(s).split(' ').filter(Boolean))
}

/** Content words with a crude stem, so "migrates" and "migrate" match. */
function stemSet(s: string): Set<string> {
  return new Set(
    normalise(s)
      .split(' ')
      .filter((w) => w && !STOP.has(w))
      .map((w) => (w.length > 4 ? w.replace(/(ing|ed|es|e|s)$/, '') : w))
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0
  for (const w of a) if (b.has(w)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 1 : inter / union
}

/** Two option texts a candidate would read as the same answer. */
export function nearDuplicate(a: string, b: string): boolean {
  const na = normalise(a)
  const nb = normalise(b)
  if (na === nb) return true
  const wa = stemSet(a)
  const wb = stemSet(b)
  return wa.size >= 3 && wb.size >= 3 && jaccard(wa, wb) >= 0.8
}

/** Length of the longest run of consecutive words the two texts share. */
export function longestSharedRun(a: string, b: string): number {
  const wa = normalise(a).split(' ')
  const wb = normalise(b).split(' ')
  let best = 0
  let prev = new Array<number>(wb.length + 1).fill(0)
  for (let i = 1; i <= wa.length; i++) {
    const cur = new Array<number>(wb.length + 1).fill(0)
    for (let j = 1; j <= wb.length; j++) {
      if (wa[i - 1] === wb[j - 1]) {
        cur[j] = prev[j - 1] + 1
        if (cur[j] > best) best = cur[j]
      }
    }
    prev = cur
  }
  return best
}

/** A stem that lifts this many words in a row from the passage is fill-in-the-blank. */
export const MAX_COPIED_RUN = 10

/** Two stems that ask the same thing, for de-duplicating within one exam. */
export function sameQuestion(a: string, b: string): boolean {
  return jaccard(wordSet(a), wordSet(b)) >= 0.8
}

/**
 * The reply as an object. With a grammar it is already bare JSON; in the
 * prompt-only fallback a model may wrap it in a code fence or prose, so we
 * take the outermost braces. Nothing inside the object is repaired.
 */
function parse(raw: string): unknown {
  const text = raw.trim()
  try {
    return JSON.parse(text)
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('no JSON object in the reply')
    return JSON.parse(text.slice(start, end + 1))
  }
}

function isStr(v: unknown): v is string {
  return typeof v === 'string'
}

function exactKeys(o: Record<string, unknown>, keys: string[]): boolean {
  const have = Object.keys(o).sort()
  return have.length === keys.length && [...keys].sort().every((k, i) => k === have[i])
}

interface Draft {
  evidence: string
  stem: string
  options: { id: string; text: string }[]
  correct: string[]
  explanation: string
}

/** Shape check, exactly as schemaFor() describes it. Null when it fails. */
function toDraft(obj: unknown, shape: Shape): { draft: Draft | null; why: string } {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { draft: null, why: 'not an object' }
  const o = obj as Record<string, unknown>
  const keysWere = (): string => `keys were ${Object.keys(o).join(', ')}`

  if (shape.type === 'truefalse') {
    if (!exactKeys(o, ['evidence', 'stem', 'explanation'])) return { draft: null, why: keysWere() }
    if (!isStr(o.evidence) || !isStr(o.stem) || !isStr(o.explanation)) return { draft: null, why: 'a field is not a string' }
    return {
      draft: {
        evidence: o.evidence.trim(),
        stem: o.stem.trim(),
        options: [
          { id: 'true', text: 'True' },
          { id: 'false', text: 'False' }
        ],
        // Decided by our code before asking, never by the model.
        correct: [shape.answer],
        explanation: o.explanation.trim()
      },
      why: ''
    }
  }

  if (!exactKeys(o, ['evidence', 'stem', 'correct_options', 'wrong_options', 'explanation'])) return { draft: null, why: keysWere() }
  if (!isStr(o.evidence) || !isStr(o.stem) || !isStr(o.explanation)) return { draft: null, why: 'a field is not a string' }
  const right = o.correct_options
  const wrong = o.wrong_options
  if (!Array.isArray(right) || !Array.isArray(wrong) || ![...right, ...wrong].every(isStr)) {
    return { draft: null, why: 'correct_options and wrong_options must be lists of strings' }
  }
  // Ids here are only for the log; the reader sees new ones after the shuffle.
  const options = [...right, ...wrong].map((text, i) => ({ id: 'ABCDEFGH'[i] ?? String(i), text: (text as string).trim() }))
  return {
    draft: {
      evidence: o.evidence.trim(),
      stem: o.stem.trim(),
      options,
      correct: options.slice(0, right.length).map((x) => x.id),
      explanation: o.explanation.trim()
    },
    why: ''
  }
}

/** Most of the evidence's words must actually occur in the chunk. */
function evidenceFound(evidence: string, chunkText: string): boolean {
  const words = [...wordSet(evidence)].filter((w) => w.length > 3)
  if (words.length < 3) return false
  const pool = wordSet(chunkText)
  return words.filter((w) => pool.has(w)).length / words.length >= 0.8
}

/** Is the correct set markedly longer, or markedly shorter, than every distractor? */
function lengthTell(correct: string[], distractors: string[]): string | null {
  if (!correct.length || !distractors.length) return null
  const c = correct.map((t) => t.length)
  const d = distractors.map((t) => t.length)
  const minC = Math.min(...c)
  const maxC = Math.max(...c)
  const minD = Math.min(...d)
  const maxD = Math.max(...d)
  if (minC > maxD * 1.5 && minC - maxD >= 12) return `correct is ${minC} chars, longest distractor ${maxD}`
  if (maxC < minD * 0.6 && minD - maxC >= 12) return `correct is ${maxC} chars, shortest distractor ${minD}`
  return null
}

export function validateQuestion(
  raw: string,
  shape: Shape,
  chunk: Chunk,
  questionId: string,
  rng: () => number
): GateResult {
  let obj: unknown
  try {
    obj = parse(raw)
  } catch (err) {
    return { ok: false, reasons: ['parse_error'], detail: (err as Error).message }
  }
  const type: QuestionType = shape.type
  const { draft, why } = toDraft(obj, shape)
  if (!draft) return { ok: false, reasons: ['schema_mismatch'], detail: why }

  const reasons: RejectReason[] = []
  const notes: string[] = []
  const fail = (r: RejectReason, note: string): void => {
    if (!reasons.includes(r)) reasons.push(r)
    notes.push(`${r}: ${note}`)
  }

  const { stem, options, correct, evidence } = draft
  // An explanation that hit the length cap keeps its complete sentences;
  // only one with no complete sentence left is rejected below.
  const explanation = wholeSentences(draft.explanation)
  const isTF = type === 'truefalse'

  // ---- Structural ------------------------------------------------------
  if (stem.length < 15) fail('stem_too_short', `${stem.length} chars`)
  if (!explanation) fail('empty_explanation', 'explanation is empty')
  else if (!ENDS_SENTENCE.test(explanation.trim())) fail('explanation_cut_off', `the explanation stops mid-sentence: "…${explanation.trim().slice(-40)}"`)
  if (OTHER_SCRIPT.test(chunk.text) === false && [stem, explanation, ...options.map((o) => o.text)].some((t) => OTHER_SCRIPT.test(t))) {
    fail('wrong_language', 'part of the draft is in another script than the material')
  }
  if (!isTF && !stem.includes('?')) fail('stem_not_a_question', 'the stem asks no question')
  if (isTF && /\?\s*$/.test(stem)) fail('stem_not_a_question', 'a true/false stem must be a statement, not a question')
  const run = longestSharedRun(stem, chunk.text)
  if (run >= MAX_COPIED_RUN) fail('copied_from_passage', `the stem repeats ${run} words of the passage in a row`)
  if (!isTF && CITES_LETTER.some((re) => re.test(explanation))) {
    fail('explanation_cites_letter', 'the explanation names an option by letter or position, and options are reshuffled')
  }

  if (!isTF) {
    const n = OPTION_COUNT[type]
    if (options.length !== n) fail('option_count', `${options.length} options, expected ${n}`)
    options.forEach((o) => {
      if (!o.text) fail('empty_option', `option ${o.id} is empty`)
    })
    for (let i = 0; i < options.length; i++) {
      for (let j = i + 1; j < options.length; j++) {
        if (options[i].text && options[j].text && nearDuplicate(options[i].text, options[j].text)) {
          fail('duplicate_options', `${options[i].id} "${options[i].text}" ~ ${options[j].id} "${options[j].text}"`)
        }
      }
    }
  }

  const unknown = correct.filter((c) => !options.some((o) => o.id === c))
  if (unknown.length) fail('unknown_correct_id', `correct names ${unknown.join(',')}`)
  const uniqueCorrect = [...new Set(correct)]
  if (uniqueCorrect.length !== correct.length) fail('correct_count', 'the same id is marked correct twice')
  if ((type === 'single' || isTF) && uniqueCorrect.length !== 1) {
    fail('correct_count', `${uniqueCorrect.length} correct, expected exactly 1`)
  }
  if (type === 'multi' && (uniqueCorrect.length < 2 || uniqueCorrect.length >= options.length)) {
    fail('correct_count', `${uniqueCorrect.length} correct, expected 2 or more and not all`)
  }

  const correctTexts = options.filter((o) => uniqueCorrect.includes(o.id)).map((o) => o.text)
  const distractorTexts = options.filter((o) => !uniqueCorrect.includes(o.id)).map((o) => o.text)

  if (!isTF) {
    const nStem = ` ${normalise(stem)} `
    for (const t of correctTexts) {
      const nt = normalise(t)
      if (nt.length >= 4 && nStem.includes(` ${nt} `)) fail('answer_in_stem', `"${t}" appears in the stem`)
    }
  }

  if ([stem, ...options.map((o) => o.text)].some((t) => MENTIONS_PASSAGE.test(t))) {
    fail('mentions_passage', 'refers to a passage the candidate never sees')
  }

  if (!evidenceFound(evidence, chunk.text)) {
    fail('evidence_not_in_passage', `evidence "${evidence.slice(0, 80)}" is not in the chunk`)
  }

  // ---- Anti-giveaway ---------------------------------------------------
  if (!isTF) {
    const tell = lengthTell(correctTexts, distractorTexts)
    if (tell) fail('length_parity', tell)

    const absInDistractor = distractorTexts.some((t) => ABSOLUTES.test(t))
    const absInCorrect = correctTexts.some((t) => ABSOLUTES.test(t))
    if (absInDistractor && !absInCorrect) fail('absolutes_only_in_distractors', 'absolute words appear only in wrong options')

    if (options.some((o) => ALL_OR_NONE.test(o.text))) fail('all_or_none_of_the_above', 'uses all/none of the above')
  }

  if (reasons.length) return { ok: false, reasons, detail: notes.join('; ') }

  // ---- Passed: shuffle and re-letter -----------------------------------
  // True/false keeps its fixed True, False order: position there carries no
  // information because both answers always appear in the same place.
  let finalOptions = options
  let finalCorrect = uniqueCorrect
  if (!isTF) {
    const shuffled = shuffle(options, rng)
    const letters = 'abcde'
    const remap = new Map(shuffled.map((o, i) => [o.id, letters[i]]))
    finalOptions = shuffled.map((o, i) => ({ id: letters[i], text: o.text }))
    finalCorrect = uniqueCorrect.map((c) => remap.get(c)!).sort()
  }

  return {
    ok: true,
    question: {
      id: questionId,
      type,
      stem,
      options: finalOptions,
      correct: finalCorrect,
      // The one wording repair: the reader sees this next to a link to the
      // source, so "the passage" becomes "the source".
      explanation: explanation.replace(/\b(the|this) passage\b/gi, (_m, the: string) => `${the} source`),
      sourceChunkId: chunk.id,
      headingTrail: chunk.headingTrail,
      evidence
    }
  }
}
