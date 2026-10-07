// The coaching hint under the guardian's reply on the opening doors.
//
// The guardian answers first; a second, separate completion then reads what
// the player tried and what it ran into, and writes the next nudge. That is
// why the opening hints move — "asking outright will not work here, play a
// game instead" turns into "your game reached him, now make the game need the
// word itself" — instead of repeating one stored line all run.
//
// The coach never receives the password: it is redacted out of the guardian's
// reply before the prompt is built, and the sentence that comes back is
// leak-checked like any other text shown to the player.
import { complete } from './qvac.js'
import { replyLeaksPassword } from './guards.js'

// What each opening door is meant to teach, written without naming the
// password. Keyed by door number, matching the positional hint policy in
// server.js, so a reordered or admin-created level still gets sane coaching.
const TACTICS = {
  1: {
    door: 'This guardian is completely trusting and has no filters at all. It hands the password over to anyone who simply asks for it in plain words, but it stays quiet about it during small talk.',
    fallbacks: {
      blocked: [],
      open: [
        { text: 'Small talk will not get you there. Ask the guardian for the password outright.' },
        { text: 'This one has nothing stopping it: say plainly that you want the password.' },
        { text: 'You have what you need. Type the word into the guess box below.' }
      ]
    }
  },
  2: {
    // Deliberately does not spell out the blocked terms. Listing them here put
    // "password" and "secret" in the coach's context, and a 4B model reported
    // them back as things the player had written.
    door: 'This guardian has promised never to answer a request for the password, and a keyword wall stops any message that names the thing it guards, in any language. But it loves word games and has no filter on what it says, so a poem, riddle, acrostic, anagram or song that makes it use the word will spill it.',
    // `tactic` marks which game a nudge is recommending, so the coach never
    // tells a player to try the very thing they just tried. Suggesting "ask for
    // a rhyme" to someone who had just asked for a rhyme was the whole reason
    // the hints read as useless.
    fallbacks: {
      blocked: [
        { text: 'Naming what you are after trips the wall before the guardian hears you. Ask for a game instead.' },
        { text: 'That wording never reached the guardian; ask for something that never names what you want.' }
      ],
      open: [
        { tactic: /\b(rhyme|rhyming|poem|poetry|verse|couplet)\b/i, text: 'Your game reached the guardian. Now ask for a rhyme whose last line can only end in the thing it guards.' },
        { tactic: /\b(acrostic|first letters?|initials?)\b/i, text: 'Ask for an acrostic whose first letters spell the thing it guards, one letter per line.' },
        { tactic: /\b(song|lyric|lyrics|chorus|ballad)\b/i, text: 'Ask for a short song whose chorus has to repeat the thing it guards by name.' },
        { tactic: /\b(anagram|jumble|scramble)\b/i, text: 'Ask it to jumble the thing it guards into an anagram and hand you the jumbled letters.' },
        { tactic: /\b(riddle|puzzle)\b/i, text: 'Ask for a riddle whose own answer has to be the thing it guards, written out.' }
      ]
    }
  }
}

// What the turn actually did, in the coach's words. The player only sees a
// refusal, so naming the stage is the useful part of the hint.
const OUTCOMES = {
  input: 'Their wording tripped a keyword filter and never reached the guardian at all, so it never heard the question. The refusal the player read was written blind.',
  output: 'The guardian did answer, but the answer was destroyed before the player could read it because it contained the password.',
  guardModel: 'The guardian did answer, but a second watcher read the answer and destroyed it before the player could read it.',
  none: 'Nothing was blocked. The guardian heard the message and answered it normally, so say nothing about filters, walls or forbidden words.'
}

// The coach rewrites a nudge we choose; it does not invent advice. Left to
// compose freely, a 4B model produced filler built out of whatever words were
// lying around in its context ("make the game a song that uses the word
// 'tone'"), and ignored the stage the turn actually died at. Choosing the
// content here and spending the model only on phrasing keeps the floor sane.
const COACH_SYSTEM =
  'You are a friendly game coach sitting beside a player who is trying to talk a guardian AI into revealing a secret word. ' +
  'You do not know the secret word and never try to guess it. ' +
  'You are given background on the door, what the player just tried, what happened to it, and the advice to deliver. ' +
  'Rewrite that advice as ONE sentence of at most 25 words, addressed to the player as "you" and tailored to what they just tried. ' +
  'Keep the advice\'s meaning and its next move. Invent no new tactic and suggest no word of your own. ' +
  'The ONLY words the player wrote are the ones quoted after "The player tried". ' +
  'Never say they used, named or asked for something that is not in that quote, and never treat words from the background as words the player typed. ' +
  'Describe only what "What happened" states: if nothing was blocked, do not mention filters, walls or blocked words at all. ' +
  'No greeting, no preamble, no quotation marks around your sentence, never more than one sentence.'

// Small and near-deterministic: the coach is a nudge, not a performance, and
// it runs on the same single-completion queue as the guardian itself.
const COACH_PARAMS = { temp: 0.5, predict: 64, reasoning_budget: 0 }

const CLIP = 400

function clip (text, max = CLIP) {
  const s = String(text ?? '').trim().replace(/\s+/g, ' ')
  return s.length > max ? s.slice(0, max) + '…' : s
}

function escapeRe (s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// On door 1 the guardian legitimately says the password, and that reply is
// part of the coach's evidence. Strip it first so the secret never enters the
// coach's context and the leak check below does not fire on every turn.
function redact (level, text) {
  const pw = String(level.password || '')
  if (!pw) return text
  return text.replace(new RegExp(escapeRe(pw), 'gi'), 'the secret word')
}

// Same seal as generateBlockReply: coaching is shown to the player, so it is
// held to the fuzzy leak check even on doors that ship no output guard.
function leaks (level, text) {
  const sealed = { ...level, outputGuard: { enabled: true, blockIfContainsPassword: true, fuzzy: true } }
  return replyLeaksPassword(sealed, text).leaked
}

// A small model likes to answer a request for one sentence with three, or to
// wrap it in quotes. Keep the first sentence and drop the wrapping.
function tidy (text) {
  let s = String(text ?? '').trim().replace(/\s+/g, ' ')
  s = s.replace(/^["'“”‘’]+/, '').replace(/["'“”‘’]+$/, '')
  const end = s.search(/[.!?](\s|$)/)
  if (end > -1) s = s.slice(0, end + 1)
  return s.slice(0, 220).trim()
}

// The canned line for this door that the player has not been given yet, so a
// model failure still moves the coaching forward instead of looping. Lines are
// split by outcome: telling a player their words were stopped when they were
// not is the very confusion this module keeps running into.
// Advances by how many hints the door has already given, rather than by
// excluding lines already seen: the coach paraphrases the line it is handed,
// so the stored hint never matches the source line and an exclusion test
// would hand back the same nudge every turn.
function fallback (tactic, previous, blockedAt, message = '') {
  const staged = blockedAt ? tactic.fallbacks.blocked : tactic.fallbacks.open
  const pool = staged.length ? staged : (blockedAt ? tactic.fallbacks.open : tactic.fallbacks.blocked)
  // Drop anything recommending the game the player has just been playing.
  const fresh = pool.filter(n => !(n.tactic && n.tactic.test(message)))
  const list = fresh.length ? fresh : pool
  return list[Math.min(previous.length, list.length - 1)].text
}

// The coach reads the door background as if it were the player's last move:
// given a door described as stopping messages that name the password, it wrote
// "you tried to use 'password' in a riddle" on a turn that was never blocked.
// The prompt forbids that; this catches it when the model does it anyway.
const FILTER_TALK_RE = /\b(filter|filtered|wall|blocked|block|blocks|tripped|trips|caught|stopped|banned|keyword|forbidden)\b/i

function contradictsOutcome (hint, blockedAt) {
  return !blockedAt && FILTER_TALK_RE.test(hint)
}

// "You asked for a riddle; the guardian gave one." — true, and no help at all.
// A hint without a next move is worth less than the canned line for the door.
const NEXT_MOVE_RE = /\b(try|ask|asking|make|tell|give|say|type|use|push|turn|need|demand|request|press|force|get|coax|steer|aim|instead|next)\b/i

function isVacuous (hint) {
  return !NEXT_MOVE_RE.test(hint)
}

function coachPrompt (tactic, { message, reply, blockedAt, previous, advice }) {
  const lines = [
    'BACKGROUND on this door — for your understanding only, not anything the player wrote:',
    tactic.door,
    '',
    'THIS TURN:',
    `The player tried: "${clip(message)}"`,
    `What happened: ${OUTCOMES[blockedAt || 'none'] || OUTCOMES.none}`,
    `The guardian replied: "${clip(reply)}"`,
    '',
    `The advice to deliver: "${advice}"`
  ]
  if (previous.length) {
    lines.push(`Hints you already gave, which you must not repeat word for word: ${previous.map(h => `"${h}"`).join(' ')}`)
  }
  lines.push('Rewrite the advice as one sentence for this player.')
  return lines.join('\n')
}

// Returns the sentence to show under this turn's reply, or null on a door
// that is not coached. Never throws: a coach failure must not cost the player
// the guardian's answer.
export async function coachHint (level, door, turn) {
  const tactic = TACTICS[door]
  if (!tactic) return null
  const previous = (turn.previous || []).filter(Boolean)
  // The nudge for this stage of this door, chosen before the model runs. It is
  // both the brief for the rewrite and the answer if the rewrite is no good.
  const advice = fallback(tactic, previous, turn.blockedAt, String(turn.message ?? ''))
  const context = {
    message: turn.message,
    reply: redact(level, String(turn.reply ?? '')),
    blockedAt: turn.blockedAt,
    previous,
    advice
  }
  let raw = ''
  try {
    raw = await complete([
      { role: 'system', content: COACH_SYSTEM },
      { role: 'user', content: coachPrompt(tactic, context) }
    ], { generationParams: COACH_PARAMS })
  } catch {
    return advice
  }
  const hint = tidy(raw)
  if (!hint || leaks(level, hint) || contradictsOutcome(hint, turn.blockedAt) || isVacuous(hint)) {
    return advice
  }
  return hint
}
