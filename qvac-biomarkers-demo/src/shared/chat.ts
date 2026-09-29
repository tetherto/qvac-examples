// The starter questions, shared so the panel and the tests ask the same ones.
//
// None of them asks for an amount. That is deliberate: the guard exists for
// the questions a person actually types, and there is no reason to put a
// question we know ends badly on a button.
export const QUICK_QUESTIONS = [
  'Give me a full read of my results.',
  'Which result should worry me most, and why?',
  'What could explain the markers that are off?',
  'What is moving in the wrong direction?',
  'What should I ask my doctor at my next appointment?'
]

/** One turn in the conversation, as the renderer holds it. */
export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
  /** Sentences the guard withheld from this answer. Shown, never hidden. */
  redacted?: number
  /** Wall-clock seconds the model took. Assistant turns only. */
  seconds?: number
  error?: string
}
