// Lightweight, dependency-free language ID for short spoken utterances (coffee demo: EN/FR/ES/IT).
// Parakeet transcribes any language but returns no language label, so we infer it from the text to
// pick the translate pair + TTS voice. English is the default when nothing scores.
//
//   detectLang(text)          -> best guess (first utterance)
//   decideLanguage(text, cur) -> STICKY: keep the conversation language unless another wins clearly.
//
// Key signals (learned the hard way): French ELISIONS (m', qu', c', j', s', n', est-ce) are
// near-unique to French and decisive; Spanish ¿¡ñ + hola/gracias/quiero; Italian vorrei/grazie/
// buongiorno. Ambiguous shared words (que, tu, me, una, con, el) are NOT used as discriminators -
// they were the cause of "Est-ce que tu m'entends ?" scoring as Spanish.

export type DetectedLang = "en" | "es" | "fr" | "de" | "it" | "pt";

// Distinctive words per language (deliberately avoiding cross-language collisions). Whole-word hits.
const WORDS: Record<DetectedLang, string[]> = {
  en: ["the", "please", "would", "like", "want", "can", "you", "hello", "thanks", "thank", "milk", "water", "hot", "cold", "give", "recommend", "how", "much", "yes", "menu", "coffee", "large", "small"],
  es: ["hola", "gracias", "quiero", "quisiera", "puedes", "por", "favor", "leche", "agua", "caliente", "gustaria", "recomienda", "cuanto", "buenos", "dias", "muestrame", "quisiera", "cafe", "pequeno", "grande"],
  fr: ["je", "vous", "voudrais", "peux", "pourrais", "aimerais", "bonjour", "merci", "avec", "pour", "voir", "montrer", "lait", "eau", "chaud", "recommande", "combien", "entends", "comprends", "salut", "oui", "voudriez", "puis"],
  de: ["ich", "mochte", "bitte", "danke", "milch", "wasser", "gross", "klein", "kaffee", "hallo", "guten", "moglich", "empfehlen"],
  it: ["vorrei", "grazie", "buongiorno", "ciao", "posso", "latte", "acqua", "caldo", "vorrebbe", "mostrami", "consigli", "quanto", "prego", "vorrei", "piccolo", "grande", "caffe"],
  pt: ["ola", "obrigado", "obrigada", "quero", "queria", "leite", "agua", "quente", "gostaria", "voce", "bom", "dia", "cardapio", "pode"],
};

// Near-unique strong markers: one hit is decisive (weight 3). Run on the ORIGINAL text (accents intact).
const STRONG: Array<[DetectedLang, RegExp]> = [
  // French elisions + signature words (m'entends, qu'est, c'est, j'ai, s'il, est-ce, n'est)
  ["fr", /(\bj'|\bm'|\bt'|\bn'|qu'|c'est|s'il|est-ce|\b(je|vous|voudrais|bonjour|aimerais|pourrais|merci|combien|entends|comprends)\b)/i],
  ["es", /[¿¡ñ]|\b(hola|gracias|quiero|quisiera|por favor|gustar[ií]a|buenos d[ií]as|puedes|recomienda)\b/i],
  ["it", /\b(vorrei|grazie mille|buongiorno|ciao|per favore|posso|vorrebbe|mostrami|consigli|prego)\b/i],
  ["de", /\b(ich|m[oö]chte|bitte|danke|guten tag|hallo)\b|[ßä]/i],
  ["pt", /[ãõ]|\b(obrigad[oa]|voc[eê]|gostaria|bom dia|card[aá]pio)\b/i],
  ["en", /\b(please|would like|can i|i'd|hello|thank you|thanks|recommend|the)\b/i],
];

// Normalize curly/variant apostrophes to a straight ' so French elisions (m', qu', c'...) always match.
const apos = (s: string) => s.replace(/[’ʼ´`]/g, "'");
const norm = (s: string) =>
  apos(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}'\s]/gu, " ").replace(/\s+/g, " ").trim();

function scoreLangs(text: string, allow: DetectedLang[]): Record<DetectedLang, number> {
  const raw = apos(text);   // apostrophe-normalized, accents intact (for the STRONG markers)
  const toks = new Set(norm(text).split(" ").filter(Boolean));
  const score = {} as Record<DetectedLang, number>;
  for (const lang of allow) {
    let s = 0;
    for (const w of WORDS[lang]) if (toks.has(norm(w))) s += 1;
    score[lang] = s;
  }
  for (const [lang, re] of STRONG) if (allow.includes(lang) && re.test(raw)) score[lang] = (score[lang] || 0) + 3;
  return score;
}

export function detectLang(text: string, allowed?: DetectedLang[]): DetectedLang {
  const allow = allowed && allowed.length ? allowed : (Object.keys(WORDS) as DetectedLang[]);
  if (!text || !norm(text)) return allow.includes("en") ? "en" : allow[0];
  const score = scoreLangs(text, allow);
  let best: DetectedLang = allow.includes("en") ? "en" : allow[0], bestScore = -1;
  for (const lang of allow) if (score[lang] > bestScore) { best = lang; bestScore = score[lang]; }
  return bestScore <= 0 ? (allow.includes("en") ? "en" : best) : best;
}

// Confident detection: returns the best language ONLY if there is a real signal (score > 0),
// otherwise null. Used to decide WHEN to lock: a short ambiguous first word ("Serieux.", a name)
// must NOT lock the conversation to the default language - we keep listening until a real signal
// appears (e.g. "Est-ce que tu peux me montrer le menu" -> fr). Fixes "spoke French, replied English".
export function detectLangConfident(text: string, allowed?: DetectedLang[]): DetectedLang | null {
  const allow = allowed && allowed.length ? allowed : (Object.keys(WORDS) as DetectedLang[]);
  if (!text || !norm(text)) return null;
  const score = scoreLangs(text, allow);
  let best: DetectedLang | null = null, bestScore = 0;
  for (const lang of allow) if (score[lang] > bestScore) { best = lang; bestScore = score[lang]; }
  return bestScore > 0 ? best : null;
}

// Sticky: keep `current` unless another language wins by a clear margin (>=3). Prevents mid-order flips.
export function decideLanguage(text: string, current: DetectedLang | null | undefined, allowed?: DetectedLang[]): DetectedLang {
  const allow = allowed && allowed.length ? allowed : (Object.keys(WORDS) as DetectedLang[]);
  if (!current) return detectLang(text, allow);
  if (!text || !norm(text)) return current;
  const score = scoreLangs(text, allow);
  let best: DetectedLang = current, bestScore = -1;
  for (const lang of allow) if (score[lang] > bestScore) { best = lang; bestScore = score[lang]; }
  if (best === current) return current;
  const margin = bestScore - (score[current] || 0);
  return (bestScore >= 3 && margin >= 3) ? best : current;
}
