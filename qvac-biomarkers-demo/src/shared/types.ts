// ============================================================
// Types shared by the Node side and the renderer.
//
// This file is imported by BOTH processes, so it must stay free of any
// runtime dependency: no Node built-ins, no DOM, no @qvac/sdk.
// ============================================================

/** A reference interval. Inclusive on both ends. */
export interface Range {
  low: number
  high: number
}

/** One row of the built-in reference library (`data/markers.json`). */
export interface Marker {
  id: string
  name: string
  unit: string
  range: Range
  descriptor: string
  /** Names of the categories this marker belongs to. May be empty. */
  categories: string[]
}

/** One of our eight categories (`data/categories.json`). */
export interface Category {
  name: string
  description: string
  /** Marker ids that make up the score. */
  markers: string[]
}

/** One vetted nutrition fact (`data/knowledge-base.json`). */
export interface KbFact {
  nutrient: string
  foods: string[]
  rationale: string
}

/** Which way a marker is off. Also the key into the knowledge base. */
export type Direction = 'low' | 'high'

/**
 * Where a fact came from. Vetted facts ship with the app; the rest were
 * pulled out of a source the user added in the Food Library. The
 * distinction is shown in the UI and never collapsed.
 */
export type FactOrigin = 'vetted' | 'user-source'

/** A knowledge-base fact plus its provenance, as the AI layer sees it. */
export interface GroundedFact extends KbFact {
  markerId: string
  direction: Direction
  origin: FactOrigin
  /**
   * For a fact pulled out of a user's source: the phrase it quoted, checked
   * against the page before the fact was kept. Absent on built-in facts,
   * whose provenance is the file itself.
   */
  evidence?: string
  /**
   * Whether a person has accepted this fact.
   *
   * Built-in facts are vetted by whoever edited the file, so they carry no
   * flag. A fact the model pulled out of a source is a PROPOSAL: pulling
   * structured claims out of arbitrary prose is the weakest thing MedPsy
   * does, and it is the one place the model's own judgement would otherwise
   * reach the fact base unchecked. So it waits here until somebody says yes.
   */
  accepted?: boolean
  /** Food Library source id, when origin is 'user-source'. */
  sourceId?: string
  sourceTitle?: string
}

// ---- Results -------------------------------------------------------------

/**
 * One measurement. The store is keyed by (markerId, date), which is what
 * makes re-importing a file update rows instead of duplicating them.
 */
export interface Reading {
  markerId: string
  /** ISO date, YYYY-MM-DD. */
  date: string
  value: number
}

/** Everything known about one marker, assembled for the UI. */
export interface MarkerView {
  marker: Marker
  /** Effective range: personalized when a rule matched, else baseline. */
  range: Range
  personalized: boolean
  /** Why the range was personalized, for the tooltip. Absent on baseline. */
  personalizedNote?: string
  /** One entry per known test date, oldest first. null = not tested. */
  values: (number | null)[]
  latest: number | null
  latestDate: string | null
  status: Status
  /** Plain-language read of the series, computed not generated. */
  trend: Trend
}

/** Computed from value vs range. Never read from an imported file. */
export type Status = 'green' | 'yellow' | 'red' | 'grey'

/** Direction of travel across the series, and whether that is good news. */
export interface Trend {
  direction: 'rising' | 'falling' | 'flat' | 'unknown'
  /** Date the current run of movement started. */
  since: string | null
  /** True when the movement is heading towards the range. */
  improving: boolean | null
  /** One sentence, built by code: the model gets given this, not asked for it. */
  sentence: string
}

// ---- Category scores -----------------------------------------------------

export type Band = 'Needs work' | 'Fair' | 'Good' | 'Optimal'

/** One member marker's contribution, shown verbatim in the explainer. */
export interface ScoreTerm {
  markerId: string
  name: string
  value: number | null
  range: Range
  status: Status
  /** 0-100. See `subScore` in scoring.ts for the formula. */
  sub: number | null
  /** Equal for every scored marker; kept explicit so the explainer can show it. */
  weight: number
}

export interface CategoryScore {
  category: string
  /** 0-100, or null when no member marker has ever been tested. */
  score: number | null
  band: Band | null
  /** Members that carried the score, plus the ones that could not. */
  terms: ScoreTerm[]
  inRange: number
  tested: number
  total: number
}

/** A category's score on each test date, oldest first, for the sparkline. */
export interface ScoreTrendPoint {
  date: string
  score: number | null
}

// ---- Profile -------------------------------------------------------------

export type Gender = 'male' | 'female'
export type AgeGroup = '18-29' | '30-39' | '40-49' | '50-59' | '60+'

export interface Profile {
  /** Kilograms. Stored because the design collects it; no range depends on it. */
  weightKg: number | null
  /**
   * Centimetres. The one profile field a marker is computed FROM rather than
   * ranged by: weight from a scale plus this is a BMI, and BMI has a published
   * interval where raw weight has none.
   */
  heightCm: number | null
  ageGroup: AgeGroup | null
  gender: Gender | null
}

// ---- AI ------------------------------------------------------------------

export type RecKind = 'FOOD' | 'LIFESTYLE'

export interface Recommendation {
  kind: RecKind
  /** The sentence shown on the card. */
  text: string
  /** The nutrient this came from: always traceable to a fact. */
  nutrient: string
  /** The food named in `text`, or null for a lifestyle item. */
  food: string | null
  origin: FactOrigin
  sourceTitle?: string
}

export interface RecommendationSet {
  /** Marker id, or 'category:<name>'. */
  subject: string
  /** One trend-aware sentence from the model. */
  interpretation: string
  recommendations: Recommendation[]
  /** So the cache can tell whether it is still current. */
  generatedAt: string
  modelLabel: string
  /**
   * Suggestions the validator REFUSED, because they named a food or nutrient
   * we never provided. Shown to the reader, because something they asked for
   * was withheld. Repairs are not listed here, those are logged, not
   * reported, since nothing was lost.
   */
  dropped: string[]
}

export type RecState = 'idle' | 'generating' | 'ready' | 'none' | 'error'

// ---- Food Library --------------------------------------------------------

export type SourceKind = 'url' | 'pdf' | 'builtin'
/**
 * processing  the page is being fetched and read
 * review      read, and waiting for a person to accept or reject its facts
 * linked      at least one fact accepted, and in use
 * failed      could not be read
 */
export type SourceState = 'processing' | 'review' | 'linked' | 'failed'

export interface FoodSource {
  id: string
  kind: SourceKind
  title: string
  /** Host for a URL, file name for a PDF, 'shipped with the app' for builtin. */
  domain: string
  addedAt: string
  state: SourceState
  /** Short bullets the model pulled out. */
  tldr: string[]
  /** Facts extracted from this source, in knowledge-base shape. */
  facts: GroundedFact[]
  error?: string
}

// ---- Import ------------------------------------------------------------

export interface ImportReport {
  file: string
  dates: string[]
  added: number
  updated: number
  /** Marker ids in the file that are not in markers.json. */
  unknownMarkers: string[]
  /** Cells that were present but could not be read as a number. */
  unreadable: number
  /** Extra columns ignored on purpose: status, flags, anything interpretive. */
  ignoredColumns: string[]
  /**
   * Anything the reader should know that is not a count: a unit that had to be
   * inferred, a column that needed a profile field the app does not have yet.
   * Shown, never swallowed.
   */
  notes?: string[]
}

// ---- The snapshot the renderer draws -------------------------------------

export interface ModelChip {
  label: string
  params: string
  quantization: string
  bytes: number
  sizeLabel: string
  /** True once the weights are on disk, so the chip can say "Downloaded". */
  cached: boolean
}

/**
 * Everything the UI needs, in one object.
 *
 * Resent whole after any change rather than patched. At this size that is
 * tens of kilobytes of JSON and it removes a whole class of bug where the
 * table and the gauge disagree because one of them missed an update.
 */
export interface AppState {
  hasData: boolean
  /** Every test date in the store, oldest first. */
  dates: string[]
  markers: MarkerView[]
  categories: Category[]
  scores: CategoryScore[]
  /** Category name -> score on each date. */
  trends: Record<string, ScoreTrendPoint[]>
  profile: Profile
  sources: FoodSource[]
  lastImport: { at: string; file: string } | null
  model: ModelChip
  disclaimer: string
  /** Where the store file lives, shown on the privacy panel. */
  storePath: string
  /** Marker ids the knowledge base can currently say something about. */
  coveredMarkers: string[]
}

// ---- Cross-process shapes -----------------------------------------------

/** Progress while the weights are fetched or loaded. */
export interface ModelProgress {
  phase: 'downloading' | 'loading' | 'ready'
  percent: number
  label: string
}

/**
 * Progress on one piece of work the model is doing, addressed by subject
 * (a marker id, `category:<name>` or `source:<id>`).
 *
 * `percent` is null while there is genuinely nothing to count, which is
 * better than a bar that invents movement. Once generation starts we do have
 * something real to count: characters arriving from the stream.
 */
export interface JobProgress {
  subject: string
  label: string
  percent: number | null
}

/** The answer to "what advice do we have for this subject". */
export interface RecResult {
  state: RecState
  set: RecommendationSet | null
  message?: string
}

/** Source -> nutrient -> marker, for the Food Library's context map. */
export interface ContextGraph {
  sources: { id: string; label: string; state: SourceState; selected?: boolean }[]
  nutrients: { label: string }[]
  markers: { id: string; label: string }[]
  /** Index pairs into `sources` and `nutrients`. */
  sourceToNutrient: [number, number][]
  /** Index pairs into `nutrients` and `markers`. */
  nutrientToMarker: [number, number][]
}
