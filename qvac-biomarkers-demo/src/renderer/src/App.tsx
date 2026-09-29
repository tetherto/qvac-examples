// ============================================================
// The whole of the renderer's state.
//
// One AppState from the main process, one route, two possible modals, and a
// small map of recommendation state per subject. No health logic lives here
//: statuses, ranges, trends and scores all arrive computed, so this file
// is only ever deciding what to show.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AppState,
  ImportReport,
  JobProgress,
  ModelProgress,
  Profile,
  RecState,
  RecommendationSet
} from '@shared/types.js'
import { Toast, type ToastMessage } from './components/Toast.js'
import { WelcomeScreen } from './screens/WelcomeScreen.js'
import { TableScreen } from './screens/TableScreen.js'
import { OverviewScreen } from './screens/OverviewScreen.js'
import { MarkerScreen } from './screens/MarkerScreen.js'
import { CategoriesScreen } from './screens/CategoriesScreen.js'
import { CategoryScreen } from './screens/CategoryScreen.js'
import { ProfileModal } from './screens/ProfileModal.js'
import { FoodLibraryModal } from './screens/FoodLibraryModal.js'
import { ChatPanel } from './components/ChatPanel.js'
import { ImportSummary } from './components/ImportSummary.js'
import type { Tab } from './components/Chrome.js'

type Route =
  | { name: 'overview' }
  | { name: 'table' }
  | { name: 'categories' }
  | { name: 'marker'; markerId: string }
  | { name: 'category'; category: string }

interface RecEntry {
  state: RecState
  set: RecommendationSet | null
  message?: string
}

export default function App(): React.JSX.Element {
  const [state, setState] = useState<AppState | null>(null)
  const [route, setRoute] = useState<Route>({ name: 'overview' })
  const [modal, setModal] = useState<'profile' | 'foodlib' | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [recs, setRecs] = useState<Record<string, RecEntry>>({})
  const [progress, setProgress] = useState<ModelProgress | null>(null)
  const [jobs, setJobs] = useState<Record<string, JobProgress>>({})
  const [busy, setBusy] = useState(false)
  const [dropping, setDropping] = useState(false)
  /** The last import, held until dismissed. Null means nothing to confirm. */
  const [lastReport, setLastReport] = useState<{ report: ImportReport; first: boolean } | null>(null)
  /**
   * Depth of the drag, not a boolean.
   *
   * Moving across the window fires dragenter/dragleave for every element
   * passed over, and the dragleave that ends the drag usually targets a child
   * rather than the container, so "hide when target is the container" leaves
   * the overlay stuck on screen. Counting enters against leaves is the one
   * form of this that survives a real pointer.
   */
  const dragDepth = useRef(0)
  const [toast, setToast] = useState<ToastMessage | null>(null)

  // ---- Wiring ----

  useEffect(() => {
    window.biomarkers.getState().then(setState)
    const offState = window.biomarkers.onStateChanged(setState)
    const offProgress = window.biomarkers.onModelProgress(setProgress)
    const offRec = window.biomarkers.onRecState(({ subject, state: s, message }) =>
      setRecs((r) => ({ ...r, [subject]: { state: s, set: r[subject]?.set ?? null, message } }))
    )
    const offJob = window.biomarkers.onJobProgress((p) =>
      setJobs((j) => ({ ...j, [p.subject]: p }))
    )
    return () => {
      offState()
      offProgress()
      offRec()
      offJob()
    }
  }, [])

  /** Loads whatever is cached for a subject when its screen opens. */
  const loadCached = useCallback((subject: string) => {
    window.biomarkers.cachedRecommendations(subject).then((r) =>
      setRecs((prev) => ({ ...prev, [subject]: { state: r.state, set: r.set, message: r.message } }))
    )
  }, [])

  useEffect(() => {
    if (route.name === 'marker') loadCached(route.markerId)
    if (route.name === 'category') loadCached(`category:${route.category}`)
  }, [route, loadCached, state?.profile, state?.sources])

  const generate = useCallback(
    async (subject: string, force: boolean) => {
      setRecs((r) => ({ ...r, [subject]: { state: 'generating', set: null } }))
      setJobs((j) => {
        const next = { ...j }
        delete next[subject]
        return next
      })
      const result = await window.biomarkers.generateRecommendations(subject, force)
      setRecs((r) => ({
        ...r,
        [subject]: { state: result.state, set: result.set, message: result.message }
      }))
      if (result.state === 'error') setToast({ text: result.message ?? 'That did not work.', tone: 'bad' })
    },
    []
  )

  /** Wraps an action that can fail, so every error surfaces as a toast. */
  const guard = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      setToast({ text: (err as Error).message, tone: 'bad' })
    } finally {
      setBusy(false)
    }
  }, [])

  // ---- Actions ----

  const importPick = (): Promise<void> =>
    guard(async () => {
      const hadData = state?.hasData ?? false
      const result = await window.biomarkers.importPick()
      if (!result) return
      setState(result.state)
      setRoute({ name: 'overview' })
      setLastReport({ report: result.report, first: !hadData })
    })

  /**
   * Import a file dropped on the window.
   *
   * Same path as the picker, minus the native Open panel, which is the one
   * surface in this app that shows the account name and the rest of the
   * folder. Dropping is also simply how people move a downloaded lab report.
   */
  const importDropped = (file: File): Promise<void> =>
    guard(async () => {
      const filePath = window.biomarkers.pathForFile(file)
      if (!filePath) throw new Error('That did not arrive as a file on disk.')
      const hadData = state?.hasData ?? false
      const result = await window.biomarkers.importPath(filePath)
      setState(result.state)
      setRoute({ name: 'overview' })
      setLastReport({ report: result.report, first: !hadData })
    })

  const importSample = (): Promise<void> =>
    guard(async () => {
      const hadData = state?.hasData ?? false
      const result = await window.biomarkers.importSample()
      setState(result.state)
      setRoute({ name: 'overview' })
      setLastReport({ report: result.report, first: !hadData })
    })

  const setProfile = (profile: Profile): Promise<void> =>
    guard(async () => {
      setState(await window.biomarkers.setProfile(profile))
      // Ranges moved, so every cached answer we were holding is stale.
      setRecs({})
    })

  const setCell = (markerId: string, date: string, value: number | null): Promise<void> =>
    guard(async () => {
      setState(await window.biomarkers.setCell(markerId, date, value))
      setRecs({})
    })

  const addUrl = (url: string): Promise<void> =>
    guard(async () => {
      setState(await window.biomarkers.addUrlSource(url))
      setRecs({})
    })

  const addPdf = (): Promise<void> =>
    guard(async () => {
      const next = await window.biomarkers.addPdfSource()
      if (next) setState(next)
      setRecs({})
    })

  // ---- Render ----

  if (!state) {
    return (
      <div className="stage">
        <div className="frame">
          <div className="welcome">
            <div className="welcome-inner">
              <p className="subtle">Reading your results locally…</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const shared = {
    onImport: importPick,
    onFoodLibrary: () => setModal('foodlib'),
    onProfile: () => setModal('profile'),
    onAsk: () => setChatOpen(true)
  }

  const tab: Tab =
    route.name === 'categories' ? 'categories' : route.name === 'table' ? 'table' : 'overview'
  // Spelled out rather than `{ name: t }`: TypeScript will not narrow a
  // union member's literal tag from a wider union type.
  const onTab = (t: Tab): void =>
    setRoute(t === 'categories' ? { name: 'categories' } : t === 'table' ? { name: 'table' } : { name: 'overview' })

  let screen: React.JSX.Element

  if (!state.hasData) {
    screen = (
      <WelcomeScreen
        state={state}
        progress={progress}
        busy={busy}
        onImport={importPick}
        onLoadSample={importSample}
        onEnsureModel={() => guard(async () => setState(await window.biomarkers.ensureModel()))}
        onProfile={setProfile}
      />
    )
  } else if (route.name === 'marker') {
    const view = state.markers.find((m) => m.marker.id === route.markerId)
    if (!view) {
      screen = <div className="pad">That marker is not in the library.</div>
    } else {
      const entry = recs[route.markerId] ?? { state: 'idle' as RecState, set: null }
      screen = (
        <MarkerScreen
          state={state}
          view={view}
          recState={entry.state}
          recSet={entry.set}
          recMessage={entry.message}
          recProgress={jobs[route.markerId] ?? null}
          onBack={() => setRoute({ name: 'table' })}
          onFoodLibrary={() => setModal('foodlib')}
          onGenerate={() => generate(route.markerId, false)}
          onRegenerate={() => generate(route.markerId, true)}
        />
      )
    }
  } else if (route.name === 'category') {
    const score = state.scores.find((s) => s.category === route.category)
    if (!score) {
      screen = <div className="pad">That category is not in the library.</div>
    } else {
      const subject = `category:${route.category}`
      const entry = recs[subject] ?? { state: 'idle' as RecState, set: null }
      screen = (
        <CategoryScreen
          state={state}
          score={score}
          recState={entry.state}
          recSet={entry.set}
          recMessage={entry.message}
          recProgress={jobs[subject] ?? null}
          onBack={() => setRoute({ name: 'categories' })}
          onOpenMarker={(markerId) => setRoute({ name: 'marker', markerId })}
          onGenerate={() => generate(subject, false)}
          onRegenerate={() => generate(subject, true)}
        />
      )
    }
  } else if (route.name === 'categories') {
    screen = (
      <CategoriesScreen
        state={state}
        tab={tab}
        onTab={onTab}
        onOpenCategory={(category) => setRoute({ name: 'category', category })}
        {...shared}
      />
    )
  } else if (route.name === 'table') {
    screen = (
      <TableScreen
        state={state}
        tab={tab}
        onTab={onTab}
        onOpenMarker={(markerId) => setRoute({ name: 'marker', markerId })}
        onSetCell={setCell}
        {...shared}
      />
    )
  } else {
    screen = (
      <OverviewScreen
        state={state}
        tab={tab}
        onTab={onTab}
        onOpenMarker={(markerId) => setRoute({ name: 'marker', markerId })}
        onOpenCategory={(category) => setRoute({ name: 'category', category })}
        {...shared}
      />
    )
  }

  return (
    <div
      className="stage"
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        dragDepth.current += 1
        setDropping(true)
      }}
      onDragOver={(e) => {
        // preventDefault on dragover is what makes this a drop target at all.
        // Without it Chromium takes the default action and navigates the
        // window to the file, replacing the app with a PDF viewer.
        e.preventDefault()
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDropping(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        dragDepth.current = 0
        setDropping(false)
        const file = e.dataTransfer.files[0]
        if (file) importDropped(file)
      }}
    >
      <div className="frame">
        {screen}
        {state.hasData && (
          <footer className="footer">
            <span>qvac. BIOMARKERS</span>
            <span className="prose">
              {state.model.label} runs on this machine. Nothing is uploaded.
            </span>
          </footer>
        )}
      </div>

      {modal === 'profile' && (
        <ProfileModal
          state={state}
          onClose={() => setModal(null)}
          onSave={(p) => {
            setProfile(p)
            setModal(null)
          }}
          onErase={() =>
            guard(async () => {
              setState(await window.biomarkers.eraseEverything())
              setRecs({})
              setRoute({ name: 'overview' })
            })
          }
        />
      )}

      {modal === 'foodlib' && (
        <FoodLibraryModal
          state={state}
          busy={busy}
          onClose={() => setModal(null)}
          jobs={jobs}
          onAddUrl={addUrl}
          onAddPdf={addPdf}
          onRemove={(id) => guard(async () => setState(await window.biomarkers.removeSource(id)))}
          onSetFact={(sourceId, index, accepted) =>
            guard(async () => {
              setState(await window.biomarkers.setFactAccepted(sourceId, index, accepted))
              setRecs({})
            })
          }
          onOpenMarker={(markerId) => {
            setModal(null)
            setRoute({ name: 'marker', markerId })
          }}
        />
      )}

      {chatOpen && <ChatPanel model={state.model} onClose={() => setChatOpen(false)} />}

      {lastReport && (
        <ImportSummary
          report={lastReport.report}
          firstImport={lastReport.first}
          onClose={() => setLastReport(null)}
        />
      )}

      {dropping && (
        <div className="dropzone">
          <div className="dropzone-card">
            <b>Drop your results here</b>
            <span>A lab PDF, a bloodwork CSV, or an export from your scale or ring.</span>
          </div>
        </div>
      )}

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}
