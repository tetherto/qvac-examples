// App-wide state: settings, models, the library, papers, the generation in
// flight, and which screen is showing. Everything comes from the main
// process over window.api; this file only mirrors it and listens for pushes.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Attempt, Exam, ExamConfig, GenEvent, ModelChoice, ModelKey, ModelStatus, Question, Rejection, Settings } from '../../core/types'
import type { AppState, SourceRow } from '../../preload/index'

const api = window.api

export type Route =
  | { name: 'onboarding' }
  | { name: 'library' }
  | { name: 'setup'; preset?: Partial<ExamConfig> }
  | { name: 'taking'; attemptId: string }
  | { name: 'results'; attemptId: string }
  | { name: 'review'; attemptId: string; filter: 'reread' | 'all'; index: number }
  | { name: 'exams' }
  | { name: 'settings' }
  | { name: 'debug' }

export interface FeedItem {
  kind: 'accepted' | 'rejected'
  n?: number // question number, accepted only
  question?: Question
  rejection?: Rejection
  at: number
}

export interface GenView {
  config: ExamConfig
  startedAt: number
  phase: 'starting' | 'running' | 'done' | 'error' | 'cancelled'
  prompts: number
  produced: number
  poolSize: number
  accepted: Question[]
  rejected: number
  feed: FeedItem[]
  done?: Extract<GenEvent, { type: 'done' }>
  error?: string
}

function reduceGen(g: GenView, e: GenEvent): GenView {
  switch (e.type) {
    case 'started':
      return { ...g, phase: 'running', prompts: e.prompts, poolSize: e.poolSize }
    case 'produced':
      return { ...g, produced: g.produced + 1 }
    case 'topup':
      return { ...g, prompts: g.prompts + e.prompts }
    case 'accepted':
      return { ...g, accepted: [...g.accepted, e.question], feed: [{ kind: 'accepted', n: e.accepted, question: e.question, at: Date.now() }, ...g.feed] }
    case 'rejected':
      return { ...g, rejected: g.rejected + 1, feed: [{ kind: 'rejected', rejection: e.rejection, at: Date.now() }, ...g.feed] }
    case 'done':
      return { ...g, phase: 'done', done: e }
    case 'cancelled':
      return { ...g, phase: 'cancelled' }
    case 'error':
      return { ...g, phase: 'error', error: e.message }
  }
}

interface Ctx {
  route: Route
  go: (r: Route) => void
  state: AppState | null
  settings: Settings
  setSettings: (patch: Partial<Settings>) => Promise<void>
  choices: ModelChoice[]
  statuses: Partial<Record<ModelKey, ModelStatus>>
  resident: ModelKey | null
  sources: SourceRow[]
  exams: Exam[]
  attempts: Attempt[]
  gen: GenView | null
  startGen: (config: ExamConfig) => Promise<void>
  cancelGen: () => Promise<void>
  keepGen: () => Promise<Exam | null>
  clearGen: () => void
  /** Starts (or resumes) a sitting of a paper and opens it. */
  sit: (exam: Exam, mode?: 'exam' | 'practice') => Promise<void>
  addRefs: (refs: string[]) => Promise<void>
  notice: string | null
  setNotice: (n: string | null) => void
  showKeys: boolean
  setShowKeys: (b: boolean) => void
}

const AppContext = createContext<Ctx | null>(null)

export function useApp(): Ctx {
  const c = useContext(AppContext)
  if (!c) throw new Error('useApp outside AppProvider')
  return c
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null)
  const [route, setRoute] = useState<Route>({ name: 'library' })
  const [choices, setChoices] = useState<ModelChoice[]>([])
  const [statuses, setStatuses] = useState<Partial<Record<ModelKey, ModelStatus>>>({})
  const [resident, setResident] = useState<ModelKey | null>(null)
  const [sources, setSources] = useState<SourceRow[]>([])
  const [exams, setExams] = useState<Exam[]>([])
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [gen, setGen] = useState<GenView | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [showKeys, setShowKeys] = useState(false)
  const attemptsRef = useRef(attempts)
  attemptsRef.current = attempts

  const refreshExams = useCallback(async () => {
    const r = await api.exams.list()
    setExams(r.exams)
    setAttempts(r.attempts)
  }, [])

  const refreshModels = useCallback(async () => {
    const r = await api.models.list()
    setChoices(r.choices)
    setResident(r.resident)
    setStatuses(Object.fromEntries(r.statuses.map((s) => [s.key, s])))
  }, [])

  useEffect(() => {
    void (async () => {
      const s = await api.app.state()
      setState(s)
      setSources(await api.library.list())
      await Promise.all([refreshModels(), refreshExams()])
      setRoute(s.settings.onboarded ? { name: 'library' } : { name: 'onboarding' })
    })()
    const offs = [
      api.models.onStatus((s) => {
        setStatuses((prev) => ({ ...prev, [s.key]: s }))
        if (s.phase === 'loaded') setResident(s.key)
        else if (s.phase === 'downloaded') setResident((r) => (r === s.key ? null : r))
      }),
      api.library.onChanged(setSources),
      api.exams.onChanged(() => void refreshExams()),
      api.gen.onEvent((e) => setGen((g) => (g ? reduceGen(g, e) : g)))
    ]
    return () => offs.forEach((off) => off())
  }, [refreshExams, refreshModels])

  // Theme: the design's dark and light registers, or follow the system.
  const theme = state?.settings.theme ?? 'dark'
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      document.documentElement.dataset.theme = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])

  const setSettings = useCallback(async (patch: Partial<Settings>) => {
    const next = await api.app.setSettings(patch)
    setState((s) => (s ? { ...s, settings: next } : s))
  }, [])

  const startGen = useCallback(async (config: ExamConfig) => {
    setGen({ config, startedAt: Date.now(), phase: 'starting', prompts: 0, produced: 0, poolSize: 0, accepted: [], rejected: 0, feed: [] })
    try {
      await api.gen.start(config)
    } catch (err) {
      setGen((g) => (g ? { ...g, phase: 'error', error: (err as Error).message } : g))
    }
  }, [])

  const sit = useCallback(async (exam: Exam, mode?: 'exam' | 'practice') => {
    const open = attemptsRef.current.find((a) => a.examId === exam.id && !a.finishedAt)
    if (open) return setRoute({ name: 'taking', attemptId: open.id })
    const now = new Date().toISOString()
    const a: Attempt = {
      id: `att-${Date.now().toString(36)}`,
      examId: exam.id,
      mode: mode ?? exam.config.mode,
      startedAt: now,
      updatedAt: now,
      elapsedMs: 0,
      current: 0,
      answers: {},
      flagged: [],
      checked: [],
      duds: {}
    }
    await api.exams.saveAttempt(a)
    setAttempts((xs) => [...xs, a])
    setRoute({ name: 'taking', attemptId: a.id })
  }, [])

  const addRefs = useCallback(async (refs: string[]) => {
    const errors = await api.library.add(refs)
    if (errors.length) setNotice(errors.join(' '))
  }, [])

  const value = useMemo<Ctx>(
    () => ({
      route,
      go: setRoute,
      state,
      settings: state?.settings ?? { theme: 'dark', modelKey: 'best', onboarded: true, secondsPerQuestion: {} },
      setSettings,
      choices,
      statuses,
      resident,
      sources,
      exams,
      attempts,
      gen,
      startGen,
      cancelGen: async () => {
        await api.gen.cancel()
        setGen(null)
      },
      keepGen: async () => {
        const exam = await api.gen.keep()
        setGen(null)
        await refreshExams()
        return exam
      },
      clearGen: () => setGen(null),
      sit,
      addRefs,
      notice,
      setNotice,
      showKeys,
      setShowKeys
    }),
    [route, state, setSettings, choices, statuses, resident, sources, exams, attempts, gen, startGen, sit, addRefs, notice, showKeys, refreshExams]
  )

  // `npm run shots` drives the screens through this handle (dev builds only).
  if (import.meta.env.DEV) (window as unknown as { __ef: Ctx }).__ef = value

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

// ---- Derived helpers ----------------------------------------------------------

/** Ready means the weights are on disk: loading into memory happens on first use. */
export function isReady(s: ModelStatus | undefined): boolean {
  return !!s && (s.phase === 'downloaded' || s.phase === 'loaded' || s.phase === 'loading')
}

export function readyRows(rows: SourceRow[]): SourceRow[] {
  return rows.filter((r) => r.source.status === 'ready' && r.kept > 0)
}

export function sectionCount(rows: SourceRow[]): number {
  return readyRows(rows).reduce((n, r) => n + r.kept, 0)
}

/** A short model blurb: "8B · 5.0 GB". */
export function modelLine(c: ModelChoice | undefined): string {
  if (!c) return ''
  const params = c.name.match(/([\d.]+B)\b/)?.[1] ?? c.name
  return `${params} · ${(c.bytes / 1e9).toFixed(1)} GB`
}
