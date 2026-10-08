// ============================================================
// The domain model, shared by main, preload, renderer and tests.
//
// Nothing in src/core imports Electron or @qvac/sdk. That is what lets the
// chunker, the junk filter, the sampler and the validation gate run under
// plain `node --test`, with no model and no window.
// ============================================================

export type SourceType = 'pdf' | 'markdown' | 'text' | 'url'

export type SourceStatus = 'parsing' | 'ready' | 'unsupported_scanned' | 'fetch_failed'

export interface Source {
  id: string
  type: SourceType
  ref: string // file path or URL
  title: string
  status: SourceStatus
  addedAt: string
  /** A plain-English line for the UI when status is not 'ready'. */
  message?: string
  /** PDFs: page count. */
  pages?: number
  /** Files: size on disk when imported. */
  bytes?: number
}

export interface Chunk {
  id: string
  sourceId: string
  text: string
  headingTrail: string[] // e.g. ['The water cycle', 'Precipitation', 'Hail']
  pageNumber?: number // PDFs
  anchor?: string // HTML heading anchor
  tokenEstimate: number
}

/** A chunk the junk filter threw out, kept so the debug screen can say why. */
export interface DroppedChunk extends Chunk {
  dropReason: JunkReason
}

export type JunkReason =
  | 'too_short'
  | 'symbol_heavy'
  | 'no_heading'
  | 'table_of_contents'
  | 'navigation'
  | 'licence_boilerplate'
  | 'references'

export type QuestionType = 'single' | 'multi' | 'truefalse'

export type Difficulty = 'recall' | 'applied' | 'scenario'

export interface Question {
  id: string
  type: QuestionType
  stem: string
  options: { id: string; text: string }[]
  correct: string[] // always an array, even for single-answer
  explanation: string
  sourceChunkId: string // set by OUR code, never by the model
  /** Copied from the chunk by our code: the topic a question counts toward. */
  headingTrail: string[]
  /** The sentence the model quoted; the gate checked it is in the chunk. */
  evidence: string
}

export interface ExamConfig {
  /** The paper's name, shown at the top of the paper and in results. */
  title?: string
  questionCount: number
  difficulty: Difficulty
  /** Which question types to mix. The pipeline assigns them round-robin. */
  types: QuestionType[]
  /** Empty or missing means every ready source. */
  sourceIds?: string[]
  /** Free text (the CLI): case-insensitive match against a heading trail. */
  topicFocus?: string
  /** Topic paths picked from the heading tree, e.g. ['Precipitation › Hail', 'Collection']. */
  topics?: string[]
  mode: 'exam' | 'practice'
  modelKey: ModelKey
}

export interface Exam {
  id: string
  createdAt: string
  config: ExamConfig
  questions: Question[]
  /** "Practice paper 4": numbered in the order papers were made. */
  number?: number
  /** The main source's title, e.g. "Water cycle study notes". */
  title?: string
  /**
   * Every passage a question was written from, copied in at creation, so
   * review still works after a source file moves or a page changes.
   */
  passages?: Record<string, Passage>
}

export interface Passage {
  chunkId: string
  text: string
  headingTrail: string[]
  sourceId: string
  sourceTitle: string
  sourceRef: string
  sourceType: SourceType
  pageNumber?: number
  anchor?: string
}

export type DudReason = 'wrong_key' | 'several_fit' | 'not_in_material' | 'unclear'

export interface Attempt {
  id: string
  examId: string
  mode: 'exam' | 'practice'
  startedAt: string
  updatedAt: string
  /** Set when the paper was finished and graded. */
  finishedAt?: string
  elapsedMs: number
  /** The question on screen when last saved, so a paused paper resumes there. */
  current: number
  answers: Record<string, string[]>
  /** "Flag for later" while taking the paper. */
  flagged: string[]
  /** Practice mode: questions already checked. */
  checked: string[]
  /** "This question isn't right": removed from the score. */
  duds: Record<string, DudReason>
}

export interface Settings {
  theme: 'dark' | 'light' | 'system'
  modelKey: ModelKey
  onboarded: boolean
  /** Measured on this machine, per model, after each generation. */
  secondsPerQuestion: Partial<Record<ModelKey, number>>
}

// ---- Models ----------------------------------------------------------
//
// Only the keys and the display facts live here. The SDK constants behind
// them live in src/main/models.ts, because the renderer must never import
// @qvac/sdk.

export type ModelKey = 'fast' | 'balanced' | 'best'

export interface ModelChoice {
  key: ModelKey
  label: string // 'Fast'
  name: string // 'Qwen3 1.7B'
  quant: string // 'Q4_0'
  bytes: number
  isDefault: boolean
}

export interface DownloadProgress {
  key: ModelKey
  downloaded: number
  total: number
  percent: number
  /** Bytes per second, smoothed over the last few seconds. */
  speed: number
}

export type ModelPhase =
  | 'not_downloaded'
  | 'downloading'
  | 'paused'
  | 'downloaded'
  | 'loading'
  | 'loaded'
  | 'error'

export interface ModelStatus {
  key: ModelKey
  phase: ModelPhase
  progress?: DownloadProgress
  error?: string
}

// ---- Generation events (main -> renderer, over webContents.send) -------

export interface Rejection {
  at: string
  promptIndex: number
  chunkId: string
  sourceTitle: string
  headingTrail: string[]
  type: QuestionType
  reasons: RejectReason[]
  detail: string
  raw: string
}

export type RejectReason =
  | 'parse_error'
  | 'schema_mismatch'
  | 'option_count'
  | 'empty_option'
  | 'duplicate_options'
  | 'unknown_correct_id'
  | 'correct_count'
  | 'answer_in_stem'
  | 'empty_explanation'
  | 'stem_too_short'
  | 'mentions_passage'
  | 'stem_not_a_question'
  | 'copied_from_passage'
  | 'explanation_cites_letter'
  | 'length_parity'
  | 'absolutes_only_in_distractors'
  | 'all_or_none_of_the_above'
  | 'evidence_not_in_passage'
  | 'duplicate_question'
  | 'wrong_language'
  | 'explanation_cut_off'
  | 'generation_failed'

export type GenEvent =
  | { type: 'started'; target: number; prompts: number; poolSize: number }
  | { type: 'produced'; promptIndex: number }
  | { type: 'accepted'; question: Question; accepted: number; target: number }
  | { type: 'rejected'; rejection: Rejection }
  | { type: 'topup'; prompts: number }
  | {
      type: 'done'
      exam: Exam
      target: number
      accepted: number
      rejected: number
      /** Set when the exam is shorter than asked, and why. */
      shortBy?: { missing: number; reason: string }
      seconds: number
      /** Added by the main process: how the pool and the questions split by topic. */
      topics?: { topic: string; sections: number; questions: number }[]
    }
  | { type: 'cancelled'; accepted: number }
  | { type: 'error'; message: string }
