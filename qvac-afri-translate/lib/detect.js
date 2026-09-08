// Which language is this?
//
// The obvious answer was to ask the model, since the family is documented as
// retaining language identification. Measured on the 0.8B GGUF with a constrained
// prompt, it answered "Amharic" for Swahili, Hausa, Yoruba, Afrikaans, Shona AND
// plain English, and "Hausa" for a longer Swahili sentence. A confidently wrong
// language label in the interface is worse than no label, so detection here is
// deterministic: script first, then distinctive function words, and an honest
// "not sure" when nothing wins by a margin.
//
// This is a small, old and well understood technique, and for these languages it is
// far better than a 0.8B model's guess on one sentence. It is also instant and needs
// no model loaded, which means the source language is known before anything is
// downloaded.

/** Scripts that settle the question on their own. */
const SCRIPTS = [
  { code: 'am', name: 'Amharic', re: /[\u1200-\u137F]/ },          // Ethiopic
  { code: 'apd', name: 'Sudanese Arabic', re: /[\u0600-\u06FF]/ }  // Arabic, incl. Ajami
]

/**
 * Function words and orthographic marks, weighted.
 *
 * Bantu languages share a lot of short morphemes (na, ku, mu, ka), so those score 1
 * while the words that actually separate one language from its neighbours score 3.
 * A tie is reported as a tie rather than broken arbitrarily.
 */
const MARKERS = {
  sw: { name: 'Swahili', strong: ['katika', 'sana', 'nina', 'kwa sababu', 'hii', 'kuwa', 'watu', 'siku', 'nataka', 'daktari'], weak: ['na', 'ya', 'wa', 'ni', 'kwa'] },
  ha: { name: 'Hausa', strong: ['wannan', 'kuma', 'amma', 'sau', 'yana', 'ciki', 'zuwa', 'shi', 'ita', 'fama'], weak: ['da', 'ba', 'ne', 'ce', 'ya', 'ta'] },
  yo: { name: 'Yoruba', strong: ['awon', 'àwọn', 'ati', 'àti', 'kan', 'fun', 'fún', 'ninu', 'nínú', 'mo ni', 'jowo'], weak: ['ni', 'ti', 'se', 'ki'], marks: /[ẹọṣ]|[àèìòù]|[áéíóú]/ },
  ig: { name: 'Igbo', strong: ['ndi', 'ndị', 'nke', 'ihe', 'maka', 'gị', 'anyi', 'anyị', 'ka o', 'biko'], weak: ['na', 'ya', 'di', 'ma'], marks: /[ịọụṅ]/ },
  af: { name: 'Afrikaans', strong: ['die', 'nie', 'het', 'van', 'met', 'vir', 'dit', 'ek', 'jy', 'ons', 'baie', 'moet'], weak: ['en', 'is', 'te'] },
  zu: { name: 'Zulu', strong: ['ukuthi', 'futhi', 'kodwa', 'ngiya', 'abantu', 'izinto', 'lokhu', 'nge', 'khona'], weak: ['nga', 'uku', 'kwa', 'ngi', 'aba', 'izi'] },
  xh: { name: 'Xhosa', strong: ['kwaye', 'ukuba', 'ndiya', 'abantu', 'izinto', 'nje', 'kakhulu'], weak: ['nga', 'uku', 'kwa', 'ndi', 'nge'] },
  sn: { name: 'Shona', strong: ['uye', 'ndine', 'kuti', 'wangu', 'vanhu', 'zvinhu', 'asi', 'ndiri', 'musoro'], weak: ['ari', 'ndi', 'zvi', 'ku'] },
  so: { name: 'Somali', strong: ['waa', 'laakiin', 'sidoo', 'iyo', 'ayaa', 'baan', 'markii', 'wuxuu'], weak: ['oo', 'ka', 'ku', 'aan', 'uu', 'ay'] },
  ln: { name: 'Lingala', strong: ['mpe', 'biso', 'bino', 'azali', 'mokili', 'likolo', 'nini', 'kasi'], weak: ['na', 'ya', 'te', 'ko'] },
  lg: { name: 'Luganda', strong: ['era', 'nti', 'abantu', 'ebintu', 'nnyo', 'naye', 'okuba'], weak: ['ne', 'mu', 'ku', 'oku', 'aba', 'ye'] },
  rw: { name: 'Kinyarwanda', strong: ['cyane', 'ariko', 'kandi', 'abantu', 'ibintu', 'ubu', 'iki', 'nshuti'], weak: ['na', 'mu', 'ku', 'ni', 'aba'] },
  ny: { name: 'Nyanja', strong: ['koma', 'ndipo', 'anthu', 'zinthu', 'kwambiri', 'ndine', 'chifukwa'], weak: ['ndi', 'kwa', 'ku', 'mu'] },
  mg: { name: 'Malagasy', strong: ['ary', 'amin', 'izy', 'aho', 'tsy', 'izany', 'ireo', 'fa ny'], weak: ['ny', 'ao', 'an', 'no'] },
  om: { name: 'Oromo', strong: ['akka', 'isaa', 'jira', 'keessa', 'garuu', 'hin', 'nama', 'kana'], weak: ['fi', 'kan', 'irra'] },
  st: { name: 'Southern Sotho', strong: ['hore', 'empa', 'batho', 'lintho', 'haholo', 'hape', 'eaba'], weak: ['le', 'ho', 'ka', 'ba', 'ea', 'tse'] },
  tn: { name: 'Tswana', strong: ['gore', 'mme', 'batho', 'dilo', 'thata', 'jaanong', 'fela'], weak: ['le', 'go', 'ka', 'ba', 'mo', 'tsa'] },
  wo: { name: 'Wolof', strong: ['dafa', 'ci', 'ak', 'lu', 'waaw', 'jamm', 'ndax', 'yow'], weak: ['bi', 'na', 'la', 'mu'], marks: /[ëñŋ]/ },
  en: {
    name: 'English',
    strong: ['the', 'and', 'that', 'with', 'your', 'this', 'have', 'from', 'not', 'please', 'should', 'must', 'you', 'they', 'their', 'there', 'when', 'what', 'because'],
    weak: ['of', 'to', 'is', 'in', 'for', 'a', 'an', 'on', 'at', 'by', 'as', 'or', 'if', 'it', 'be', 'are', 'was', 'were', 'has', 'had', 'do', 'does', 'will', 'can', 'one', 'two', 'three', 'day', 'days', 'after', 'before', 'each', 'my', 'me', 'we', 'all', 'take', 'bring', 'return', 'twice', 'food', 'no', 'yes']
  }
}

const words = (text) => String(text).toLowerCase().match(/[\p{L}\p{M}']+/gu) || []

/**
 * @returns {{code, name, confidence, runnerUp, method}} or a null code when unsure.
 */
export function detect (text) {
  const raw = String(text || '').trim()
  if (raw.length < 3) return { code: null, name: null, confidence: 0, method: 'too short' }

  for (const s of SCRIPTS) {
    if (s.re.test(raw)) return { code: s.code, name: s.name, confidence: 1, method: 'script' }
  }

  const ws = words(raw)
  const set = new Set(ws)
  const scores = []
  for (const [code, m] of Object.entries(MARKERS)) {
    let score = 0
    for (const t of m.strong) {
      if (t.includes(' ') ? raw.toLowerCase().includes(t) : set.has(t)) score += 3
    }
    for (const t of m.weak) if (set.has(t)) score += 1
    if (m.marks && m.marks.test(raw)) score += 4
    if (score > 0) scores.push({ code, name: m.name, score })
  }
  if (!scores.length) return { code: null, name: null, confidence: 0, method: 'no marker matched' }
  scores.sort((a, b) => b.score - a.score)
  const top = scores[0]
  const next = scores[1] || { score: 0, name: null }
  // A margin, not a maximum. Bantu neighbours share function words, and answering
  // "Zulu" when Zulu beat Xhosa by one weak match would be a coin toss with a label.
  const margin = top.score - next.score
  const confident = top.score >= 4 && margin >= 2
  return {
    code: confident ? top.code : null,
    name: confident ? top.name : null,
    confidence: Math.min(1, Math.round((margin / Math.max(top.score, 1)) * 100) / 100),
    best: top.name,
    runnerUp: next.name,
    method: confident ? 'function words' : 'not sure'
  }
}
