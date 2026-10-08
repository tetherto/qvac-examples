// The Exam Prep shell: the sidebar, the screen for the current route, and
// the things that work everywhere: drop files on the window, ⌘N, ⌘O, "?".

import { useEffect, useRef, useState } from 'react'
import type { Attempt, Exam } from '../../core/types'
import { Sidebar } from './Sidebar'
import { Debug } from './screens/Debug'
import { Exams, ResumeCard } from './screens/Exams'
import { Generating } from './screens/Generating'
import { Library } from './screens/Library'
import { Onboarding } from './screens/Onboarding'
import { Results } from './screens/Results'
import { Review } from './screens/Review'
import { Settings } from './screens/Settings'
import { Setup } from './screens/Setup'
import { Taking } from './screens/Taking'
import { AppProvider, useApp } from './state'

const api = window.api

function KeyMap({ onClose }: { onClose: () => void }) {
  const keys: [string, string][] = [
    ['1–9', 'Choose or toggle an option'],
    ['← →', 'Previous / next question'],
    ['F', 'Flag for later'],
    ['G', 'Focus question grid'],
    ['S', 'Show or hide source'],
    ['⌘↵', 'Generate / finish'],
    ['Esc', 'Cancel generation'],
    ['⌘N', 'New exam'],
    ['⌘O', 'Add files']
  ]
  return (
    <div className="overlay" onClick={onClose}>
      <div className="keymap" onClick={(e) => e.stopPropagation()}>
        {keys.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <span style={{ color: 'var(--fg-1)', fontWeight: 700 }}>{k}</span>
            <span style={{ color: 'var(--fg-3)' }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Screen() {
  const { route, go, gen } = useApp()
  switch (route.name) {
    case 'library':
      return <Library />
    case 'setup':
      return gen ? <Generating /> : <Setup key={JSON.stringify(route.preset ?? {})} preset={route.preset} />
    case 'exams':
      return <Exams />
    case 'results':
      return <Results attemptId={route.attemptId} />
    case 'review':
      return <Review attemptId={route.attemptId} filter={route.filter} index={route.index} />
    case 'settings':
      return <Settings />
    default:
      return (
        <button type="button" className="link-btn" onClick={() => go({ name: 'library' })}>
          Back
        </button>
      )
  }
}

function Shell() {
  const { state, route, go, addRefs, notice, setNotice, showKeys, setShowKeys, exams, attempts } = useApp()
  const [dragging, setDragging] = useState(false)
  const [resume, setResume] = useState<{ e: Exam; a: Attempt } | null>(null)
  const asked = useRef(false)

  // 09f: an unfinished paper at launch.
  useEffect(() => {
    if (asked.current || !state || !exams.length) return
    asked.current = true
    const a = attempts.filter((x) => !x.finishedAt).sort((x, y) => y.updatedAt.localeCompare(x.updatedAt))[0]
    const e = a && exams.find((x) => x.id === a.examId)
    if (a && e && state.settings.onboarded) setResume({ e, a })
  }, [state, exams, attempts])
  useEffect(() => {
    if (route.name !== 'library' || (resume && !attempts.some((x) => x.id === resume.a.id && !x.finishedAt))) setResume(null)
  }, [route.name, attempts, resume])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'n' && route.name !== 'taking') {
        e.preventDefault()
        go({ name: 'setup' })
      } else if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        void api.library.pick()
      } else if (e.key === '?' && route.name !== 'taking') setShowKeys(!showKeys)
      else if (e.key === 'Escape' && showKeys) setShowKeys(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [route.name, go, showKeys, setShowKeys])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 8000)
    return () => clearTimeout(t)
  }, [notice, setNotice])

  if (!state) return <div className="boot" />

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDragging(false)
    const paths = [...e.dataTransfer.files].map((f) => api.app.pathFor(f)).filter(Boolean)
    const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
    const refs = paths.length ? paths : text && /^https?:\/\//.test(text.trim()) ? [text.trim()] : []
    if (refs.length) void addRefs(refs)
  }
  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault()
      if (!dragging) setDragging(true)
    },
    onDragLeave: (e: React.DragEvent) => {
      if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
    },
    onDrop
  }

  let body: React.ReactNode
  if (route.name === 'onboarding') body = <Onboarding />
  else if (route.name === 'taking') body = <Taking attemptId={route.attemptId} />
  else if (route.name === 'debug') body = <Debug onBack={() => go({ name: 'settings' })} />
  else
    body = (
      <div className="shell">
        <Sidebar />
        <main className="main">
          <Screen />
        </main>
      </div>
    )

  return (
    <div className="root" {...(route.name === 'taking' ? {} : dropProps)}>
      {body}
      {dragging && (
        <div className="drop-veil">
          <span>Drop to add to your library</span>
        </div>
      )}
      {notice && (
        <div className="notice" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}
      {resume && (
        <div className="overlay" onClick={() => setResume(null)}>
          <div style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <ResumeCard exam={resume.e} attempt={resume.a} />
          </div>
        </div>
      )}
      {showKeys && <KeyMap onClose={() => setShowKeys(false)} />}
    </div>
  )
}

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
