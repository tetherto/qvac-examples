// ============================================================
// What the model is asked, and the shape it must answer in.
//
// One prompt writes one question from one chunk. The JSON Schema below goes
// to the SDK as `responseFormat: json_schema`, which llama.cpp compiles into
// a grammar, so a malformed reply cannot be produced at all. The validation
// gate still checks everything, because a grammar guarantees shape, not
// sense, and because the prompt-only fallback guarantees nothing.
//
// Field order matters with a grammar: the model writes fields in the order
// the schema lists them. `evidence` comes first, so the model commits to a
// sentence from the passage before it writes a question about it.
// ============================================================

import type { Chunk, Difficulty, QuestionType } from './types'

export interface Message {
  role: 'system' | 'user'
  content: string
}

/** How many options each type has. */
export const OPTION_COUNT: Record<QuestionType, number> = { single: 4, multi: 5, truefalse: 2 }

/**
 * The answer's shape, decided by OUR code before the model is asked.
 *
 * Left to itself a small model marks one option correct on a "select all"
 * question and writes true statements far more often than false ones, so a
 * candidate could learn to always answer True. Deciding the count and the
 * truth value here, and pinning them in the grammar, removes both habits.
 */
export type Shape =
  | { type: 'single'; correct: 1 }
  | { type: 'multi'; correct: 2 | 3 }
  | { type: 'truefalse'; answer: 'true' | 'false' }

export function pickShape(type: QuestionType, rng: () => number): Shape {
  if (type === 'single') return { type, correct: 1 }
  if (type === 'multi') return { type, correct: rng() < 0.5 ? 2 : 3 }
  return { type, answer: rng() < 0.5 ? 'true' : 'false' }
}

// Length caps, in characters, enforced by the grammar. Generation time is
// set by how many tokens the model writes, and small models write long
// explanations unless stopped: the 1.7B averaged about 450 tokens a
// question without caps. These leave room for a full sentence or two.
export const MAX_CHARS = { evidence: 280, stem: 320, option: 140, explanation: 300 }
const str = (max: number) => ({ type: 'string', minLength: 1, maxLength: max })
const strings = (n: number) => ({ type: 'array', minItems: n, maxItems: n, items: str(MAX_CHARS.option) })

/**
 * The model never sees an option letter. It writes the right options and
 * the wrong ones as two lists, and our code assigns ids after shuffling. A
 * model given letters cites them in its explanation ("A is correct"), and
 * after the shuffle that letter points at the wrong option.
 *
 * Right options come first so the distractors are written knowing what
 * they must stand next to.
 */
export function schemaFor(shape: Shape): Record<string, unknown> {
  if (shape.type === 'truefalse') {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['evidence', 'stem', 'explanation'],
      properties: { evidence: str(MAX_CHARS.evidence), stem: str(MAX_CHARS.stem), explanation: str(MAX_CHARS.explanation) }
    }
  }
  const n = OPTION_COUNT[shape.type]
  return {
    type: 'object',
    additionalProperties: false,
    required: ['evidence', 'stem', 'correct_options', 'wrong_options', 'explanation'],
    properties: {
      evidence: str(MAX_CHARS.evidence),
      stem: str(MAX_CHARS.stem),
      correct_options: strings(shape.correct),
      wrong_options: strings(n - shape.correct),
      explanation: str(MAX_CHARS.explanation)
    }
  }
}

// ---- Difficulty: three different instructions, not one dial ------------

export const DIFFICULTY_INSTRUCTIONS: Record<Difficulty, string> = {
  recall: [
    'DIFFICULTY: RECALL.',
    'Ask what something IS, or what a specific setting, command, term or rule DOES, as the passage defines it.',
    'A candidate who read and remembered the passage can answer it. Do not invent a scenario.'
  ].join(' '),
  applied: [
    'DIFFICULTY: APPLIED.',
    'Ask what HAPPENS when someone runs, configures or changes something the passage describes:',
    'the effect, the output, the consequence, or which step must come first.',
    'Describe a concrete action in the stem (for example "You run X with Y set to Z.") and ask for its result.',
    'Do not ask for a definition.'
  ].join(' '),
  scenario: [
    'DIFFICULTY: SCENARIO.',
    'Open the stem with a short, realistic situation (two or three sentences) in which a practitioner faces a problem or a decision,',
    'built only from facts the passage supports. Then ask which action is correct, or what they should do next.',
    'Every option must be an action a real person might take. The passage must make one action clearly right,',
    'and each other action wrong for a reason the passage gives or implies.'
  ].join(' ')
}

function formatInstruction(shape: Shape): string {
  switch (shape.type) {
    case 'single':
      return 'FORMAT: single answer. The stem asks a question ending in "?". Write exactly one correct option and exactly three wrong options.'
    case 'multi':
      return (
        `FORMAT: multiple answer. The stem asks a question ending in "?" and then says "(Select all that apply.)". ` +
        `Write exactly ${shape.correct} correct options and exactly ${5 - shape.correct} wrong options.`
      )
    case 'truefalse':
      return shape.answer === 'true'
        ? 'FORMAT: true or false. The stem is ONE declarative statement, in your own words, that the passage shows is TRUE. Not a question.'
        : 'FORMAT: true or false. The stem is ONE declarative statement, in your own words, that the passage shows is FALSE. ' +
            'Make it false in one specific detail a careless reader would miss: a wrong command, value, order or consequence. Not absurd, and not a question.'
  }
}

const SYSTEM = `You write practice exam questions for a candidate preparing for a test on the material they are studying.
You are given one passage from their material. Write exactly one question from it.

Rules for every question:
- Write it as someone who understood the passage would: test understanding of a fact, rule or consequence. Never copy a sentence from the passage as the stem, and never copy a sentence and blank out a word. Use your own words.
- The correct answer must be supported by the passage.
- The candidate will NOT see the passage. Never mention "the passage", "the text", "the document" or "the author" in the stem or options.
- The stem must not contain the text of the correct answer.
- Wrong options (distractors) must be plausible enough that a partially prepared candidate would seriously consider them. Draw them from genuinely neighbouring concepts in the same field: other settings, commands, terms, values or steps a candidate might confuse with the right one. No jokes, no nonsense, no obviously wrong options.
- All options must be about the same length and the same grammatical form. The correct option must not be the longest or the most detailed.
- Do not use "all of the above" or "none of the above".
- Do not put absolute words (always, never, all, none) only in the wrong options.
- Refer to the source material as "the material" if you must, never as "the passage".
- "evidence": copy ONE short sentence, word for word, from the passage that proves the answer.
- "explanation": one or two short sentences (under 40 words) saying why the answer is right and why the most tempting wrong option is wrong. Name options by what they say, never by letter, number or position: the options are shuffled before the candidate sees them.
- Every correct option must be true according to the passage, and every wrong option must be false according to it.
Reply with JSON only.`

/** Prompt-only fallback, for a runtime that cannot apply the schema as a grammar. */
function shapeHint(shape: Shape): string {
  if (shape.type === 'truefalse') return '{"evidence": "...", "stem": "...", "explanation": "..."}'
  const list = (n: number) => `[${Array.from({ length: n }, () => '"..."').join(', ')}]`
  const n = OPTION_COUNT[shape.type]
  return `{"evidence": "...", "stem": "...", "correct_options": ${list(shape.correct)}, "wrong_options": ${list(n - shape.correct)}, "explanation": "..."}`
}

export function buildPrompt(chunk: Chunk, sourceTitle: string, shape: Shape, difficulty: Difficulty): Message[] {
  const where = chunk.headingTrail.length ? chunk.headingTrail.join(' › ') : sourceTitle
  const user = [
    `SOURCE: ${sourceTitle}`,
    `SECTION: ${where}`,
    'PASSAGE:',
    '"""',
    chunk.text,
    '"""',
    '',
    DIFFICULTY_INSTRUCTIONS[difficulty],
    formatInstruction(shape),
    '',
    `Reply with one JSON object of this shape: ${shapeHint(shape)}`,
    // Qwen3's soft switch: no <think> block. The grammar would forbid one
    // anyway, but this also stops the template from opening one.
    '/no_think'
  ].join('\n')
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: user }
  ]
}
