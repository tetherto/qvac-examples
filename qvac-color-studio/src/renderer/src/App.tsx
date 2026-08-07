// ============================================================
// The flow, and all of the state.
//
//   setup → intro → capture → analyzing → workspace
//                       ↑         ↓
//                    retake ──────┘
//
// Exactly one model call happens in this app: `analyze`, right
// after a capture. Everything else — the face mesh, the drape, the
// twelve commentaries — is renderer work over that one cached
// result. Clicking a swatch never goes near a model.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { TitleBar } from './components/TitleBar'
import { AnalyzingScreen } from './screens/AnalyzingScreen'
import { CaptureScreen } from './screens/CaptureScreen'
import { IntroScreen } from './screens/IntroScreen'
import { NoFaceScreen, type RetakeReason } from './screens/NoFaceScreen'
import { SetupScreen } from './screens/SetupScreen'
import { WorkspaceScreen } from './screens/WorkspaceScreen'
import type { Still } from './lib/drape'
import { detectDrapeGeometry, type DrapeGeometry } from './lib/faceMesh'
import { bestColorName as pickBestColor } from '@shared/palette'
import type { Analysis, ModelsProgress } from '@shared/types'

type Screen = 'setup' | 'intro' | 'capture' | 'analyzing' | 'noFace' | 'workspace'

const INITIAL_PROGRESS: ModelsProgress = {
  phase: 'idle',
  percent: 0,
  label: 'Starting up…',
  mbDone: 0,
  mbTotal: 0
}

export function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>('setup')
  const [modelsProgress, setModelsProgress] = useState<ModelsProgress>(INITIAL_PROGRESS)

  // The capture and everything derived from it.
  const [still, setStill] = useState<Still | null>(null)
  const [geometry, setGeometry] = useState<DrapeGeometry | null>(null)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [selectedName, setSelectedName] = useState<string>('')

  // Why we landed on the retake screen, and the detail to show under it.
  const [retakeReason, setRetakeReason] = useState<RetakeReason>('noFace')
  const [retakeDetail, setRetakeDetail] = useState<string | null>(null)

  // Object URLs we minted and must revoke; leaking them leaks the photo.
  const urlsRef = useRef<string[]>([])
  const trackUrl = useCallback((url: string): string => {
    urlsRef.current.push(url)
    return url
  }, [])

  // ---- First run: make sure the models are on disk --------------------

  const fetchModels = useCallback(() => {
    setModelsProgress({ ...INITIAL_PROGRESS, phase: 'downloading', label: 'Checking models…' })
    window.colorStudio.ensureModels().catch(() => {
      // The main process has already pushed an `error` progress event with
      // the detail; the setup screen is showing it.
    })
  }, [])

  useEffect(() => {
    const off = window.colorStudio.onModelsProgress(setModelsProgress)
    fetchModels()
    return off
  }, [fetchModels])

  // Revoke every object URL on unmount.
  useEffect(
    () => () => {
      urlsRef.current.forEach(URL.revokeObjectURL)
      urlsRef.current = []
    },
    []
  )

  // ---- Capture → face mesh → the single vision pass -------------------

  const handleStill = useCallback(
    async (next: Still) => {
      trackUrl(next.url)
      setStill(next)
      setRetakeDetail(null)

      // Find the chin first. No face means no drape, so we stop before
      // spending a model call.
      let found: DrapeGeometry | null = null
      try {
        found = await detectDrapeGeometry(next.canvas)
      } catch (err) {
        // The mesh itself would not start — our problem, not a framing one.
        setRetakeReason('failed')
        setRetakeDetail(err instanceof Error ? err.message : 'The face mesh could not start.')
        setScreen('noFace')
        return
      }

      if (!found) {
        setRetakeReason('noFace')
        setScreen('noFace')
        return
      }

      setGeometry(found)
      setScreen('analyzing')

      try {
        // ONE call. It returns the verdict and all twelve commentaries.
        const result = await window.colorStudio.analyze(next.png)
        setAnalysis(result)
        setSelectedName(pickBestColor(result))
        setScreen('workspace')
      } catch (err) {
        setRetakeReason('failed')
        setRetakeDetail(err instanceof Error ? err.message : 'The vision model could not finish.')
        setScreen('noFace')
      }
    },
    [trackUrl]
  )

  // ---- Start over -----------------------------------------------------

  const startOver = useCallback(() => {
    setStill(null)
    setGeometry(null)
    setAnalysis(null)
    setSelectedName('')
    setRetakeDetail(null)
    setScreen('capture')
  }, [])

  // ---- Render ---------------------------------------------------------

  return (
    <div className="shell">
      <TitleBar />

      {screen === 'setup' && (
        <SetupScreen
          progress={modelsProgress}
          onEnter={() => setScreen('intro')}
          onRetry={fetchModels}
        />
      )}

      {screen === 'intro' && <IntroScreen onStart={() => setScreen('capture')} />}

      {screen === 'capture' && <CaptureScreen onStill={(s) => void handleStill(s)} />}

      {screen === 'noFace' && (
        <NoFaceScreen
          reason={retakeReason}
          detail={retakeDetail}
          onRetake={() => setScreen('capture')}
        />
      )}

      {screen === 'analyzing' && still && <AnalyzingScreen stillUrl={still.url} />}

      {screen === 'workspace' && analysis && still && geometry && (
        <WorkspaceScreen
          analysis={analysis}
          still={still}
          geometry={geometry}
          selectedName={selectedName}
          onSelect={setSelectedName}
          onStartOver={startOver}
        />
      )}
    </div>
  )
}
