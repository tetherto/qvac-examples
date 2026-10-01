// Does the event build's three-choice composer produce captions ACE-Step actually expects?
//
//   node bin/compose-check.mjs        # exits non-zero if any gate fails
//
// This is the prompt side of the event build, tested exhaustively rather than sampled. The
// composer is imported from lib/stand-styles.mjs, the same file the /stand page imports, so the
// rules tested here are the rules that ship.
//
// Five gates, three of which have already caught a real fault:
//
//   1. vocabulary     every option is a term in lib/vocab.mjs, the list the desk prompts with
//   2. cross product  all 6 x 5 x 5 = 150 plain combinations land in the authors' 5 to 12
//                     keyword window AFTER conformCaption(), which APPENDS "no vocals" to an
//                     instrumental take. Capping the composer at 12 therefore emits 13-keyword
//                     captions: 3 of the first 24 combinations measured did exactly that.
//   3. adversarial    what a visitor can type into the free field, including the things the
//                     authors name as failure modes: tempo and key in the style, a lead vocal
//                     in an instrumental take, a third genre, prose instead of keywords
//   4. structure      genre stays at the front and never exceeds two; tempo, key and time
//                     signature never appear; no empty or duplicate tags
//   5. determinism    the same picks always compose the same caption, because a demo that
//                     cannot be reproduced cannot be debugged on the day
import { conformCaption, countTags, TAG_TARGET } from '../lib/caption.mjs'
import { CHIPS } from '../lib/vocab.mjs'
// The cards and the composer are imported, never copied: this test and the page it tests
// load the same module, so they cannot drift apart.
import { STYLES, compose } from '../lib/stand-styles.mjs'
export const CARDS = STYLES
export { compose }

const V = {}
for (const [g, w] of CHIPS) (V[g] = V[g] || []).push(...w)
const inGroup = (grp, w) => V[grp].some((s) => s.toLowerCase() === String(w).toLowerCase())
const GENRES = new Set(V.Genre.map((w) => w.toLowerCase()))

/** What the engine would receive: composed, then conformed the way the desk already does it. */
function final (args) {
  // the shared composer names it `style`; this file's cases say `card`
  const c = compose({ ...args, style: args.style || args.card })
  const r = conformCaption(c.caption, { instrumental: true })
  return { ...c, ...r, count: countTags(r.caption) }
}

// ---------------------------------------------------------------------------
// The gates run only when this file is executed, so CARDS and compose() can also be imported
// (the UI-versus-test comparison does exactly that).
const RUN = process.argv[1] && process.argv[1].endsWith('compose-check.mjs')
if (!RUN) { /* imported: expose the composer and stop here */ }

let failures = 0
const fail = (gate, msg) => { failures++; console.log(`  FAIL  [${gate}] ${msg}`) }
const head = (n) => console.log(`\n${n}\n${'-'.repeat(n.length)}`)

// ---- gate 1: vocabulary ---------------------------------------------------
if (RUN) { head('1. Every option is a word in lib/vocab.mjs')
let checked = 0
for (const c of CARDS) {
  for (const g of c.genre) { checked++; if (!inGroup('Genre', g)) fail('vocabulary', `${c.name}: genre "${g}"`) }
  for (const m of c.moods) { checked++; if (!inGroup('Mood', m)) fail('vocabulary', `${c.name}: mood "${m}"`) }
  for (const i of c.instruments) {
    checked++
    if (!inGroup('Instruments', i) && !inGroup('Voice', i)) fail('vocabulary', `${c.name}: instrument "${i}"`)
  }
  checked++; if (!inGroup('Production', c.production)) fail('vocabulary', `${c.name}: production "${c.production}"`)
  if (c.era) { checked++; if (!inGroup('Era', c.era)) fail('vocabulary', `${c.name}: era "${c.era}"`) }
  if (c.genre.length > 2) fail('vocabulary', `${c.name} names ${c.genre.length} genres, the authors' limit is 2`)
}
console.log(`  ${checked} terms checked across ${CARDS.length} styles`)

// ---- gate 2: the whole cross product -------------------------------------
head('2. All 150 plain combinations, in the 5 to 12 keyword window')
let counts = {}
for (const card of CARDS) {
  for (const mood of card.moods) {
    for (const instrument of card.instruments) {
      const r = final({ card, mood, instrument })
      counts[r.count] = (counts[r.count] || 0) + 1
      if (r.count < TAG_TARGET.low || r.count > TAG_TARGET.high) {
        fail('cross product', `${card.name} / ${mood} / ${instrument} -> ${r.count} keywords`)
      }
      if (r.notes.length) fail('cross product', `${card.name} / ${mood} / ${instrument} -> unexpected note: ${r.notes[0]}`)
    }
  }
}
console.log('  keyword counts:', Object.entries(counts).map(([k, v]) => `${v} at ${k}`).join(', '))

// ---- gate 3: what a visitor types ----------------------------------------
head('3. Adversarial free text')
const card = CARDS[0]
const TYPED = [
  { typed: 'rainy night',                            want: 'kept as a keyword' },
  { typed: 'rainy night, wide, tape hiss',           want: 'three keywords kept' },
  { typed: '140 bpm',                                want: 'tempo removed, it has its own field' },
  { typed: 'in C minor',                             want: 'key removed' },
  { typed: '4/4',                                    want: 'time signature removed' },
  { typed: '120bpm, dreamy',                         want: 'tempo removed, the real keyword kept' },
  { typed: 'male vocals',                            want: 'lead vocal dropped, this take is instrumental' },
  { typed: 'layered choir',                          want: 'rewritten to the wordless "choir ooh"' },
  { typed: 'no vocals',                              want: 'not duplicated' },
  { typed: 'techno',                                 want: 'third genre dropped, two is the limit' },
  { typed: 'techno, house, drum and bass',           want: 'all extra genres dropped' },
  { typed: 'rhodes piano',                           want: 'duplicate of a pick, deduplicated' },
  { typed: 'a song for my dog birthday party',       want: 'prose dropped, not a keyword' },
  { typed: ',,,   ,',                                want: 'no empty tags' },
  { typed: '',                                       want: 'unchanged' },
  { typed: 'a, b, c, d, e, f, g, h, i, j, k, l',     want: 'capped at the budget' },
  { typed: 'wide'.repeat(40),                        want: 'one very long token, still one keyword' }
]
for (const t of TYPED) {
  const r = final({ card, mood: 'nostalgic', instrument: 'rhodes piano', typed: t.typed })
  const tags = r.caption.split(',').map((s) => s.trim())
  const ok = r.count >= TAG_TARGET.low && r.count <= TAG_TARGET.high
  if (!ok) fail('adversarial', `"${t.typed.slice(0, 30)}" -> ${r.count} keywords`)
  if (tags.some((s) => !s)) fail('adversarial', `"${t.typed.slice(0, 30)}" -> produced an empty tag`)
  if (new Set(tags.map((s) => s.toLowerCase())).size !== tags.length) {
    fail('adversarial', `"${t.typed.slice(0, 30)}" -> duplicate tag in "${r.caption}"`)
  }
  console.log(`  ${JSON.stringify(t.typed.slice(0, 34)).padEnd(38)} ${String(r.count).padStart(2)} kw  ${t.want}`)
  if (r.notes.length) console.log(`  ${' '.repeat(38)}       engine note: ${r.notes.join('; ')}`)
}

// ---- gate 4: structure ---------------------------------------------------
head('4. Structure held on every combination, including typed input')
const META = /(\b\d{2,3}\s*bpm\b|\bbpm\s*\d{2,3}\b|\b[A-G][#b]?\s+(major|minor)\b|\b\d\s*\/\s*\d\b|\btempo\b)/i
const LEAD = /(lead vocal|male vocals?|female vocals?|rap vocals?|spoken word|gang vocals?|child vocals?|\bsinger\b|\bsinging\b|falsetto|harmonies)/i
let structChecked = 0
for (const c of CARDS) {
  for (const mood of c.moods) {
    for (const typed of ['', 'rainy night', '140 bpm, male vocals, techno', 'a, b, c, d, e, f, g, h']) {
      const r = final({ card: c, mood, instrument: c.instruments[2], typed })
      const tags = r.caption.split(',').map((s) => s.trim())
      structChecked++
      if (tags[0].toLowerCase() !== c.genre[0].toLowerCase()) {
        fail('structure', `${c.name}: caption does not open on its genre, it opens on "${tags[0]}"`)
      }
      const nGenres = tags.filter((t) => GENRES.has(t.toLowerCase())).length
      if (nGenres > 2) fail('structure', `${c.name} / "${typed}" -> ${nGenres} genres`)
      if (tags.some((t) => META.test(t))) fail('structure', `${c.name} / "${typed}" -> tempo or key survived in "${r.caption}"`)
      if (tags.some((t) => LEAD.test(t))) fail('structure', `${c.name} / "${typed}" -> lead vocal in an instrumental take`)
      if (!tags.includes('no vocals')) fail('structure', `${c.name} / "${typed}" -> instrumental take without "no vocals"`)
    }
  }
}
console.log(`  ${structChecked} captions checked for genre position, genre count, metadata leakage and vocals`)

// ---- gate 6: typed words claim a slot instead of fighting the pick --------
head('6. A typed word takes the slot it names, and never sits beside its opposite')
const SLOT = [
  { typed: 'sad',                   expect: 'melancholic', gone: 'aggressive', slot: 'mood' },
  { typed: 'sad rainy music',       expect: 'melancholic', gone: 'aggressive', slot: 'mood' },
  { typed: 'happy',                 expect: 'upbeat',      gone: 'aggressive', slot: 'mood' },
  { typed: 'make me a happy song',  expect: 'upbeat',      gone: 'aggressive', slot: 'mood' },
  { typed: 'piano',                 expect: 'grand piano', gone: 'square lead synth', slot: 'instrument' },
  { typed: 'grand piano',           expect: 'grand piano', gone: 'square lead synth', slot: 'instrument' },
  { typed: 'slow sad piano',        expect: 'melancholic', gone: 'aggressive', slot: 'mood' },
  { typed: '70s',                   expect: '70s',         gone: null,         slot: 'era' },
  { typed: 'vinyl crackle',         expect: 'vinyl crackle', gone: 'bright modern master', slot: 'production' }
]
const boss = CARDS.find((c) => c.name === 'Boss fight')
for (const t of SLOT) {
  const r = final({ card: boss, mood: 'aggressive', instrument: 'square lead synth', typed: t.typed })
  const tags = r.caption.split(',').map((x) => x.trim())
  if (!tags.includes(t.expect)) fail('slots', `"${t.typed}" -> "${t.expect}" missing from ${r.caption}`)
  if (t.gone && tags.includes(t.gone)) {
    fail('slots', `"${t.typed}" -> the picked ${t.slot} "${t.gone}" is still there, beside "${t.expect}"`)
  }
  if (r.count < TAG_TARGET.low || r.count > TAG_TARGET.high) fail('slots', `"${t.typed}" -> ${r.count} keywords`)
  console.log(`  ${JSON.stringify(t.typed).padEnd(26)} ${t.slot.padEnd(11)} -> ${t.expect}`)
}
// Filler words must not reach the model.
const filler = final({ card: boss, typed: 'a song with some music please' })
if (/\b(song|music|please|some|with|a)\b/.test(filler.caption)) {
  fail('slots', `filler words survived: ${filler.caption}`)
}
console.log(`  ${JSON.stringify('a song with some music please').padEnd(26)} filler      -> nothing added`)

// ---- gate 5: determinism -------------------------------------------------
head('5. The same picks compose the same caption')
const a = final({ card: CARDS[2], mood: 'hypnotic', instrument: 'acid bass', typed: 'rainy night' })
const b = final({ card: CARDS[2], mood: 'hypnotic', instrument: 'acid bass', typed: 'rainy night' })
if (a.caption !== b.caption) fail('determinism', 'two identical calls produced different captions')
console.log(`  ${JSON.stringify(a.caption)}`)
console.log(`  ${a.count} keywords, stable across calls`)

// ---- what the stand will actually send -----------------------------------
head('What the engine receives, one example per style')
for (const c of CARDS) {
  const r = final({ card: c, mood: c.moods[0], instrument: c.instruments[0], typed: '' })
  console.log(`  ${c.name.padEnd(14)} ${String(r.count).padStart(2)} kw  ${r.caption}`)
}

console.log(`\n${failures === 0 ? 'ALL GATES PASS' : failures + ' FAILURE(S)'}`)
process.exit(failures === 0 ? 0 : 1)
}
