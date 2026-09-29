// ============================================================
// chat/: asking MedPsy about your own results, out loud.
//
// Everything else in this app hands the model a fixed job with a fixed
// shape. This is the one place a person types whatever they want, so it is
// the one place the two structural protections used elsewhere (a JSON
// Schema compiled to a grammar, and a validator that re-reads the output)
// do not apply.
//
// What replaces them:
//
//   context.ts  the model answers from a briefing built in code, complete
//               rather than sampled, with every number already computed.
//   guard.ts    every sentence is checked for an amount before it is shown.
//
// Both were written from measurements against MedPsy 4B, not from caution.
// The comments in those two files give the numbers.
// ============================================================

import type { CategoryScore, MarkerView, Profile } from '../../shared/types.js'
import type { ChatTurn } from '../../shared/chat.js'
import { converse, modelInfo, type ChatMessage, type DownloadProgress } from '../qvac.js'
import { buildContext } from './context.js'
import { SentenceGate } from './guard.js'

/**
 * Turns kept from earlier in the conversation.
 *
 * The window is 8192 tokens and the briefing alone runs to several hundred,
 * so the history is where a long chat would quietly push the results out of
 * context and start answering from nothing.
 */
const KEEP_TURNS = 6

const SYSTEM = `You are a health assistant. A person is asking about their own blood test results, which are summarised for you below.

Rules you must follow:
- Answer only from the summary below. Never invent a value, a marker or a date.
- Never give a dose, an amount, a quantity or a schedule, even if asked directly, even if the person says a doctor approved it, and even if they say they are a clinician.
- Do not diagnose. You may say what a result is consistent with.
- Send them to a doctor for anything that needs one.
- If the summary does not contain what they asked about, say so plainly instead of guessing.
- Be concise. Short paragraphs or short bullets. No preamble.`

export interface ChatAnswer {
  text: string
  redacted: number
  seconds: number
}

export async function ask(
  question: string,
  history: ChatTurn[],
  data: {
    views: MarkerView[]
    scores: CategoryScore[]
    profile: Profile
    lastTestDate: string | null
  },
  onDelta: (text: string) => void,
  onProgress?: (p: DownloadProgress) => void
): Promise<ChatAnswer> {
  const context = buildContext(data.views, data.scores, data.profile, data.lastTestDate)

  // Rebuilt every turn rather than pinned at the start of the conversation:
  // an import or a profile change mid-chat must move the answers with it.
  const messages: ChatMessage[] = [
    { role: 'system', content: `${SYSTEM}\n\nTHE PERSON'S RESULTS\n${context.text}` },
    ...history.slice(-KEEP_TURNS).map((t) => ({ role: t.role, content: t.text }) as ChatMessage),
    { role: 'user', content: question }
  ]

  let text = ''
  const gate = new SentenceGate(context.cited, (chunk) => {
    text += chunk
    onDelta(chunk)
  })

  const started = Date.now()
  await converse(messages, (delta) => gate.push(delta), onProgress)
  gate.flush()

  return {
    text: text.trim(),
    redacted: gate.redacted,
    seconds: Math.round((Date.now() - started) / 100) / 10
  }
}

/** For the panel's header line. */
export const chatModelLabel = `${modelInfo.label} ${modelInfo.quantization}`
