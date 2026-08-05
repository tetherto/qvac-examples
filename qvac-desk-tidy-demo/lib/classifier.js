// Zero-shot file classifier, 100% on-device.
//
// Documents: EmbeddingGemma 300M -> cosine against the DOCUMENT category vectors -> calibrated
// softmax probability. Images: Qwen3-VL 2B answers a focused question. No LLM, no generation for text.
//
// CONFIDENCE, and why it is a softmax and not a raw margin (measured, not assumed): EmbeddingGemma
// packs every cosine into a high narrow band. On a real Desktop the raw top-vs-second margins came out
// at 0.001 to 0.085, so a 0.10 margin cut rejected 26 files out of 26, including an obvious invoice
// (0.078). The top-1 answer was usually right; the GATE was wrong. A softmax over the candidate scores
// with a small temperature turns that narrow band into a real probability: obvious invoice 0.88,
// codebase doc 0.62, generic manual 0.45, genuinely ambiguous floorplan 0.30. That is a threshold a
// user can reason about ("only move what I am 45% sure of") and it keeps the ambiguous files put.
"use strict";
// The QVAC SDK is ESM; load it via dynamic import (the pattern the QVAC Electron examples use) so it
// works identically under Node and under Electron's main process, packaged or not.
let _sdk = null;
async function sdk() { if (!_sdk) _sdk = await import("@qvac/sdk"); return _sdk; }

// EmbeddingGemma is prompt-conditioned: it needs a task prefix or similarity is mush. Same asymmetric
// scheme proven in the Obsidian plugin work, here with the classification task.
const QUERY_PREFIX = "task: classification | query: ";
const DOC_PREFIX = "task: classification | query: ";
// Softmax temperature over the cosine band. Small on purpose: the band is narrow (~0.4 to 0.6), so a
// large T would flatten every file to 1/N and a tiny T would make noise look certain. 0.03 was picked
// against measured scores from a real Desktop (see the header note).
const TEMPERATURE = 0.03;
const DEFAULT_THRESHOLD = 0.45; // minimum probability to move a file; below this it stays put

function cosine(a, b) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// scores -> probabilities (numerically stable softmax at temperature T)
function softmax(scores, T) {
  const max = Math.max(...scores);
  const exps = scores.map((s) => Math.exp((s - max) / T));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / sum);
}

class Classifier {
  constructor() {
    this.embedId = null;    // EmbeddingGemma modelId (lazy)
    this.vlmId = null;      // Qwen3-VL modelId (lazy)
    this.categories = [];   // [{ id, label, desc, kinds, vec }]
    this.threshold = DEFAULT_THRESHOLD;
    this._loadingEmbed = null;
    this._loadingVlm = null;
  }

  async ensureEmbedder() {
    if (this.embedId) return this.embedId;
    if (!this._loadingEmbed) {
      this._loadingEmbed = sdk().then((S) => S.loadModel({ modelSrc: S.EMBEDDINGGEMMA_300M_Q4_0.src, modelType: S.EMBEDDINGGEMMA_300M_Q4_0.engine }))
        .then((id) => { this.embedId = id; return id; })
        .finally(() => { this._loadingEmbed = null; });
    }
    return this._loadingEmbed;
  }

  async ensureVlm() {
    if (this.vlmId) return this.vlmId;
    if (!this._loadingVlm) {
      this._loadingVlm = sdk().then((S) => S.loadModel({
        modelSrc: S.QWEN3VL_2B_MULTIMODAL_Q4_K.src,
        modelType: S.QWEN3VL_2B_MULTIMODAL_Q4_K.engine,
        modelConfig: { device: "gpu", projectionModelSrc: S.MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K.src, ctx_size: 4096 },
      })).then((id) => { this.vlmId = id; return id; }).finally(() => { this._loadingVlm = null; });
    }
    return this._loadingVlm;
  }

  // Change the confidence threshold without re-embedding the categories (per-folder tuning).
  setThreshold(t) { if (typeof t === "number" && t > 0) this.threshold = t; }

  // categories: [{ id, label, desc, kinds }]. Embeds each description once and caches the vector.
  async setCategories(categories, threshold) {
    if (typeof threshold === "number") this.threshold = threshold;
    const S = await sdk();
    await this.ensureEmbedder();
    const list = Array.isArray(categories) ? categories : [];
    const texts = list.map((c) => DOC_PREFIX + (c.desc || c.label || c.id));
    const { embedding } = await S.embed({ modelId: this.embedId, text: texts });
    this.categories = list.map((c, i) => ({ ...c, vec: embedding[i] }));
  }

  // The categories a given modality is allowed to compete for. Restricting this is what made the
  // scores separable: a PDF should never be scored against "installers" or "archives".
  candidatesFor(kind) {
    const c = this.categories.filter((x) => Array.isArray(x.kinds) && x.kinds.includes(kind));
    return c.length ? c : this.categories;
  }

  // Classify already-extracted text snippets against the categories for `kind` (default "doc").
  // Returns per input: { category, confidence, scores, sure }.
  async classifyTexts(texts, kind = "doc") {
    if (!this.categories.length) throw new Error("categories not set");
    const cands = this.candidatesFor(kind);
    const S = await sdk();
    await this.ensureEmbedder();
    const arr = Array.isArray(texts) ? texts : [texts];
    const { embedding } = await S.embed({ modelId: this.embedId, text: arr.map((t) => QUERY_PREFIX + String(t || "").slice(0, 1200)) });
    return embedding.map((vec) => {
      const raw = cands.map((c) => ({ id: c.id, label: c.label, score: cosine(vec, c.vec) }));
      const probs = softmax(raw.map((r) => r.score), TEMPERATURE);
      const scores = raw.map((r, i) => ({ ...r, p: probs[i] })).sort((a, b) => b.p - a.p);
      const best = scores[0];
      // A leading "_" marks a null category (see `_other`): winning it means "none of these", so the
      // file is never moved however confident the score is.
      const isNull = String(best.id).startsWith("_");
      const sure = !isNull && best.p >= this.threshold;
      return { category: sure ? best.id : "not-sure", confidence: best.p, cosine: best.score, scores, sure };
    });
  }

  // Images: let the VLM DESCRIBE the image, then classify that description with the embedder.
  //
  // Measured on real files: asking the 2B VLM to pick from a labelled menu is unreliable (a 3-way A/B/C
  // menu answered "B" for every single image, a SCREENSHOT-or-PHOTO binary flip-flopped between two
  // near-identical thumbnails). Open description is what a small VLM is actually good at, and scoring
  // that description against the image categories got 5/5 right on a real Desktop, including telling a
  // designed title card apart from a UI capture. The description is also what the UI can show the user
  // as the reason for the decision.
  async classifyImage(imagePath) {
    const S = await sdk();
    await this.ensureVlm();
    const prompt = "Describe this image in one short sentence. Say whether it shows a computer screen interface, a real-world photograph, or a designed graphic with overlaid text.";
    const run = S.completion({
      modelId: this.vlmId,
      history: [{ role: "user", content: prompt, attachments: [{ path: imagePath }] }],
      stream: false,
      kvCache: false, // each image is independent; a shared cache bleeds the previous answer
      generationParams: { predict: 60, temp: 0 },
    });
    const final = await run.final;
    const desc = String((final && final.contentText) || "").replace(/\s+/g, " ").trim();
    if (!desc) return { category: "not-sure", confidence: 0, sure: false, raw: "" };
    const [res] = await this.classifyTexts([desc], "image");
    return { ...res, raw: desc.slice(0, 160) };
  }

  async unload() {
    const S = await sdk();
    try { if (this.embedId) await S.unloadModel({ modelId: this.embedId, clearStorage: false }); } catch { /* */ }
    try { if (this.vlmId) await S.unloadModel({ modelId: this.vlmId, clearStorage: false }); } catch { /* */ }
    this.embedId = null; this.vlmId = null;
  }
}

module.exports = { Classifier, DEFAULT_THRESHOLD, TEMPERATURE, softmax };
