// 03 Exam setup: good defaults, so ⌘↵ alone makes a sensible paper.
// Everything starts selected. Sources and topics are the same kind of
// control: one line that says what is in, opening to a checklist. The
// topic list is built from the material's own headings.

import { useEffect, useRef, useState } from 'react'
import type { TopicNode } from '../../../core/topics'
import type { Difficulty, ExamConfig, QuestionType } from '../../../core/types'
import { isReady, readyRows, useApp } from '../state'
import { Btn, DIFFICULTY_LABEL, Eyebrow, Icon, Label, duration, fileName, shortUrl } from '../ui'

const api = window.api

const COUNTS = [10, 20, 40]
const TYPES: { key: QuestionType; label: string; short: string }[] = [
  { key: 'single', label: 'Single answer', short: 'Single' },
  { key: 'multi', label: 'Multiple answers', short: 'Multiple' },
  { key: 'truefalse', label: 'True or false', short: 'True/false' }
]
const DEPTHS: { key: Difficulty; blurb: string }[] = [
  { key: 'recall', blurb: 'Remember the facts' },
  { key: 'applied', blurb: 'Use them on a case' },
  { key: 'scenario', blurb: 'Weigh trade-offs' }
]

function Row({ label, children, top }: { label: string; children: React.ReactNode; top?: boolean }) {
  return (
    <div className="setup-row" style={{ alignItems: top ? 'start' : 'center' }}>
      <div style={{ paddingTop: top ? 14 : 0 }}>
        <Label>{label}</Label>
      </div>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  )
}

function Check({ state }: { state: 'on' | 'off' | 'some' }) {
  if (state === 'off') return <span className="box" />
  return <span className="box box-on">{state === 'on' ? <Icon name="check" size={10} width={3.5} color="var(--fg-on-acqua)" /> : <span style={{ width: 7, height: 2, background: 'var(--fg-on-acqua)' }} />}</span>
}

// ---- One checklist control for sources and topics ----------------------------
//
// Selection is stored as what is LEFT OUT, so "everything" is the default
// and a source that finishes parsing while you set up is included too.

export interface PickItem {
  key: string
  label: string
  hint?: string
  count: number
  children?: PickItem[]
}

type PickState = 'on' | 'off' | 'some'

function stateOf(item: PickItem, out: Set<string>): PickState {
  if (out.has(item.key)) return 'off'
  const kids = item.children ?? []
  if (!kids.length) return 'on'
  const left = kids.filter((c) => out.has(c.key)).length
  return left === 0 ? 'on' : left === kids.length ? 'off' : 'some'
}

/** Sections still in, given what is left out. */
export function pickedCount(items: PickItem[], out: Set<string>): number {
  return items.reduce((n, it) => {
    const st = stateOf(it, out)
    if (st === 'off') return n
    if (st === 'on') return n + it.count
    return n + (it.children ?? []).filter((c) => !out.has(c.key)).reduce((s, c) => s + c.count, 0)
  }, 0)
}

function Picker({ items, out, setOut, noun, open, setOpen }: { items: PickItem[]; out: string[]; setOut: (o: string[]) => void; noun: string; open: boolean; setOpen: (b: boolean) => void }) {
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const set = new Set(out)
  const f = filter.trim().toLowerCase()
  const match = (it: PickItem): boolean => !f || it.label.toLowerCase().includes(f) || (it.children ?? []).some(match)
  const shown = items.filter(match)
  const inCount = items.filter((it) => stateOf(it, set) !== 'off').length
  const sections = pickedCount(items, set)
  const all = items.reduce((n, it) => n + it.count, 0)

  const toggle = (it: PickItem): void => {
    const kids = (it.children ?? []).map((c) => c.key)
    const rest = out.filter((k) => k !== it.key && !kids.includes(k))
    setOut(stateOf(it, set) === 'off' ? rest : [...rest, it.key])
  }
  const toggleChild = (parent: PickItem, c: PickItem): void => {
    const kids = (parent.children ?? []).map((x) => x.key)
    let left = set.has(parent.key) ? kids : kids.filter((k) => set.has(k))
    left = left.includes(c.key) ? left.filter((k) => k !== c.key) : [...left, c.key]
    const rest = out.filter((k) => k !== parent.key && !kids.includes(k))
    setOut(left.length === kids.length ? [...rest, parent.key] : [...rest, ...left])
  }

  const summary =
    inCount === items.length
      ? `All ${items.length} ${noun}${items.length === 1 ? '' : 's'}`
      : inCount === 0
        ? `No ${noun}s`
        : items
            .filter((it) => stateOf(it, set) !== 'off')
            .map((it) => it.label)
            .slice(0, 3)
            .join(', ') + (inCount > 3 ? ` +${inCount - 3}` : '')

  return (
    <div className={`picker${open ? ' picker-open' : ''}`}>
      <button type="button" className="picker-head" onClick={() => setOpen(!open)}>
        <span className="ellipsis" style={{ fontSize: 14, color: inCount ? 'var(--fg-1)' : 'var(--status-danger)', flex: 1, textAlign: 'left' }}>
          {summary}
        </span>
        <span className="mono" style={{ fontSize: 12, color: 'var(--fg-3)', flex: 'none' }}>
          {inCount < items.length ? `${inCount} of ${items.length} · ` : ''}
          {sections === all ? `${all} sections` : `${sections} of ${all} sections`}
        </span>
        <Icon name="chevronDown" size={14} width={2} color="var(--fg-3)" style={{ transform: open ? 'rotate(180deg)' : undefined }} />
      </button>
      {open && (
        <div className="picker-body">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 12px' }}>
            {items.length > 6 && (
              <div className="field" style={{ height: 34, flex: 1 }}>
                <Icon name="search" size={14} width={2} color="var(--fg-3)" />
                <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Filter ${noun}s`} />
              </div>
            )}
            <span style={{ flex: items.length > 6 ? 'none' : 1 }} />
            <button type="button" className="link-btn accent" onClick={() => setOut([])} disabled={!out.length}>
              Select all
            </button>
            <button type="button" className="link-btn" onClick={() => setOut(items.map((it) => it.key))} disabled={inCount === 0}>
              Clear
            </button>
          </div>
          <div className="tree">
            {shown.map((it) => {
              const st = stateOf(it, set)
              const kids = it.children ?? []
              const isOpen = expanded[it.key] ?? (!!f || st === 'some')
              return (
                <div key={it.key}>
                  <div className="tree-row">
                    <button type="button" className="tree-chev" onClick={() => setExpanded({ ...expanded, [it.key]: !isOpen })} disabled={!kids.length} aria-label="Expand">
                      {kids.length ? <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={12} width={2} color="var(--fg-3)" /> : null}
                    </button>
                    <button type="button" className="tree-pick" onClick={() => toggle(it)}>
                      <Check state={st} />
                      <span className="ellipsis" style={{ flex: 1, color: st === 'off' ? 'var(--fg-3)' : 'var(--fg-1)' }} title={it.hint}>
                        {it.label}
                      </span>
                      {it.hint && (
                        <span className="ellipsis" style={{ color: 'var(--fg-3)', maxWidth: 260 }}>
                          {it.hint}
                        </span>
                      )}
                      <span style={{ color: 'var(--fg-3)', minWidth: 28, textAlign: 'right' }}>{st === 'some' ? `${kids.filter((c) => !set.has(c.key)).length}/${kids.length}` : it.count}</span>
                    </button>
                  </div>
                  {isOpen &&
                    kids
                      .filter((c) => !f || match(c) || it.label.toLowerCase().includes(f))
                      .map((c) => {
                        const on = !set.has(it.key) && !set.has(c.key)
                        return (
                          <button type="button" key={c.key} className="tree-pick tree-child" onClick={() => toggleChild(it, c)}>
                            <Check state={on ? 'on' : 'off'} />
                            <span className="ellipsis" style={{ flex: 1, color: on ? 'var(--fg-1)' : 'var(--fg-3)' }}>
                              {c.label}
                            </span>
                            <span style={{ color: 'var(--fg-3)' }}>{c.count}</span>
                          </button>
                        )
                      })}
                </div>
              )
            })}
            {!shown.length && <div style={{ padding: '10px 16px', color: 'var(--fg-3)' }}>Nothing matches “{filter}”.</div>}
          </div>
        </div>
      )}
    </div>
  )
}

const topicItems = (tree: TopicNode[]): PickItem[] =>
  tree.map((n) => ({ key: n.path, label: n.name, count: n.sections, children: n.children.map((c) => ({ key: c.path, label: c.name, count: c.sections })) }))

/** What the pipeline wants: the topic paths that are in, or undefined for all. */
function includedTopics(items: PickItem[], out: string[]): string[] | undefined {
  if (!out.length) return undefined
  const set = new Set(out)
  return items.flatMap((it) => {
    const st = stateOf(it, set)
    if (st === 'on') return [it.key]
    if (st === 'some') return (it.children ?? []).filter((c) => !set.has(c.key)).map((c) => c.key)
    return []
  })
}

/** A preset like "State only" becomes "everything else left out". */
function excludeAllBut(items: PickItem[], keep: string[]): string[] {
  const k = new Set(keep)
  return items.flatMap((it) => {
    if (k.has(it.key)) return []
    const kids = it.children ?? []
    const kept = kids.filter((c) => k.has(c.key))
    return kept.length ? kids.filter((c) => !k.has(c.key)).map((c) => c.key) : [it.key]
  })
}

// ---- The screen ----------------------------------------------------------------

export function Setup({ preset }: { preset?: Partial<ExamConfig> }) {
  const { sources, settings, statuses, choices, exams, startGen, go, resident } = useApp()
  const ready = readyRows(sources)
  const parsing = sources.filter((r) => r.source.status === 'parsing').length
  const nextNo = Math.max(0, ...exams.map((e) => e.number ?? 0)) + 1
  const [title, setTitle] = useState(preset?.title ?? '')
  const [count, setCount] = useState(preset?.questionCount ?? 20)
  const [custom, setCustom] = useState(!COUNTS.includes(preset?.questionCount ?? 20))
  const [types, setTypes] = useState<QuestionType[]>(preset?.types ?? ['single', 'multi'])
  const [difficulty, setDifficulty] = useState<Difficulty>(preset?.difficulty ?? 'applied')
  const [sourcesOut, setSourcesOut] = useState<string[]>(preset?.sourceIds ? ready.map((r) => r.source.id).filter((id) => !preset.sourceIds!.includes(id)) : [])
  const [topicsOut, setTopicsOut] = useState<string[]>([])
  const [mode, setMode] = useState<'exam' | 'practice'>(preset?.mode ?? 'exam')
  const [tree, setTree] = useState<TopicNode[]>([])
  const [open, setOpen] = useState<'sources' | 'topics' | null>(preset?.topics?.length ? 'topics' : null)
  const presetApplied = useRef(!preset?.topics?.length)

  const sourceIds = ready.map((r) => r.source.id).filter((id) => !sourcesOut.includes(id))
  const key = sourceIds.join(',')
  useEffect(() => {
    void api.library.topics(sourceIds).then((t) => {
      setTree(t)
      if (!presetApplied.current && t.length) {
        presetApplied.current = true
        setTopicsOut(excludeAllBut(topicItems(t), preset!.topics!))
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const sourceItems: PickItem[] = ready.map(({ source: s, kept }) => ({
    key: s.id,
    label: s.type === 'url' ? shortUrl(s.ref).replace(/^[^/]+\//, '…/') : fileName(s.ref),
    hint: s.title,
    count: kept
  }))
  const tItems = topicItems(tree)
  const topics = includedTopics(tItems, topicsOut)
  const sections = topics ? pickedCount(tItems, new Set(topicsOut)) : pickedCount(sourceItems, new Set(sourcesOut))

  const st = statuses[settings.modelKey]
  const choice = choices.find((c) => c.key === settings.modelKey)
  const modelReady = isReady(st)

  // Load the model while the paper is being set, so pressing Generate
  // starts writing at once instead of spending the first seconds loading.
  useEffect(() => {
    if (st?.phase === 'downloaded' && resident !== settings.modelKey) void api.models.load(settings.modelKey).catch(() => undefined)
  }, [st?.phase, resident, settings.modelKey])
  const single = sourceIds.length === 1 ? ready.find((r) => r.source.id === sourceIds[0])?.source.title : undefined
  const defaultTitle = single ?? `Practice paper ${nextNo}`
  const perQ = settings.secondsPerQuestion[settings.modelKey]
  const problem = !types.length ? 'Pick a question type' : !sourceIds.length ? 'Pick a source' : topics && !topics.length ? 'Pick a topic' : null
  const canGo = modelReady && !problem && count > 0

  const generate = (): void => {
    if (!canGo) return
    void startGen({
      title: title.trim() || defaultTitle,
      questionCount: count,
      difficulty,
      types,
      sourceIds: sourcesOut.length ? sourceIds : undefined,
      topics,
      mode,
      modelKey: settings.modelKey
    })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        generate()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!ready.length) {
    return (
      <div className="screen center">
        <div className="card" style={{ padding: '28px 24px', width: 400, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="mono" style={{ fontSize: 18, fontWeight: 700 }}>
            Nothing to build from yet.
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--fg-2)', margin: 0 }}>{parsing ? 'Your material is still being read.' : 'Add a guide or notes to start.'}</p>
          <Btn variant="primary" onClick={() => go({ name: 'library' })} style={{ width: 'max-content' }}>
            Go to Library →
          </Btn>
        </div>
      </div>
    )
  }

  const chip = (on: boolean) => `chip${on ? ' chip-on' : ''}`
  const tldr = [
    `${count} questions`,
    types.map((t) => TYPES.find((x) => x.key === t)!.short).join(', ') || 'no types',
    DIFFICULTY_LABEL[difficulty],
    `${sourceIds.length} source${sourceIds.length === 1 ? '' : 's'}`,
    `${sections} §`,
    topics ? `${topics.length} topic${topics.length === 1 ? '' : 's'}` : 'all topics',
    mode === 'exam' ? 'graded at the end' : 'feedback as you go',
    perQ ? `~${duration(perQ * count)}` : null
  ].filter(Boolean)

  return (
    <div className="screen" style={{ minWidth: 0 }}>
      <div className="scroll" style={{ flex: 1, padding: '40px 48px 24px' }}>
        <Eyebrow style={{ marginBottom: 10 }}>New exam · Practice paper No. {nextNo}</Eyebrow>
        <input className="title-input" value={title} placeholder={defaultTitle} onChange={(e) => setTitle(e.target.value)} aria-label="Paper title" />
        <p style={{ fontSize: 15, color: 'var(--fg-2)', margin: '8px 0 20px' }}>Name it, or keep the default. Change anything below, or just generate.</p>

        <Row label="Questions">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {COUNTS.map((n) => (
              <button
                type="button"
                key={n}
                className={`count${!custom && count === n ? ' count-on' : ''}`}
                onClick={() => {
                  setCustom(false)
                  setCount(n)
                }}
              >
                {n}
              </button>
            ))}
            {custom ? (
              <input className="count count-on count-input" type="number" min={1} max={100} value={count} autoFocus onChange={(e) => setCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} />
            ) : (
              <button type="button" className="count-custom" onClick={() => setCustom(true)}>
                Custom
              </button>
            )}
          </div>
        </Row>

        <Row label="Question types">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {TYPES.map((t) => {
              const on = types.includes(t.key)
              return (
                <button type="button" key={t.key} className={chip(on)} onClick={() => setTypes(on ? types.filter((x) => x !== t.key) : [...types, t.key])}>
                  {t.key === 'single' ? (
                    <span className={`radio${on ? ' radio-on' : ''}`} />
                  ) : t.key === 'multi' ? (
                    <Check state={on ? 'on' : 'off'} />
                  ) : (
                    <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: on ? 'var(--qvac-acqua)' : 'var(--fg-3)' }}>
                      T/F
                    </span>
                  )}
                  {t.label}
                </button>
              )
            })}
          </div>
        </Row>

        <Row label="Depth">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
            {DEPTHS.map((d) => (
              <button type="button" key={d.key} className={`depth${difficulty === d.key ? ' depth-on' : ''}`} onClick={() => setDifficulty(d.key)}>
                <span className="mono" style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg-1)' }}>
                  {DIFFICULTY_LABEL[d.key]}
                </span>
                <span style={{ fontSize: 13, lineHeight: 1.45, color: difficulty === d.key ? 'var(--fg-2)' : 'var(--fg-3)' }}>{d.blurb}</span>
              </button>
            ))}
          </div>
        </Row>

        <Row label="Sources" top>
          <Picker items={sourceItems} out={sourcesOut} setOut={setSourcesOut} noun="source" open={open === 'sources'} setOpen={(b) => setOpen(b ? 'sources' : null)} />
          {parsing > 0 && <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 8 }}>+{parsing} still being read; included when ready.</div>}
        </Row>

        <Row label="Topics" top>
          <Picker items={tItems} out={topicsOut} setOut={setTopicsOut} noun="topic" open={open === 'topics'} setOpen={(b) => setOpen(b ? 'topics' : null)} />
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 8 }}>From your headings.{topics ? ' A narrow focus may give fewer questions, never filler.' : ''}</div>
        </Row>

        <Row label="Mode">
          <div className="seg">
            <button type="button" className={mode === 'exam' ? 'seg-on' : ''} onClick={() => setMode('exam')}>
              <b className="mono">Exam</b> <span>· graded at the end</span>
            </button>
            <button type="button" className={mode === 'practice' ? 'seg-on' : ''} onClick={() => setMode('practice')}>
              <b className="mono">Practice</b> <span>· feedback as you go</span>
            </button>
          </div>
        </Row>
      </div>

      <div className="setup-foot">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="mono ellipsis" style={{ fontSize: 13, color: 'var(--fg-1)' }}>
            {tldr.join(' · ')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 4 }}>
            {!modelReady ? (
              st?.phase === 'downloading' ? (
                `Model ${Math.floor(st.progress?.percent ?? 0)}%${st.progress?.speed ? `, ~${duration((st.progress.total - st.progress.downloaded) / st.progress.speed)} left` : ''}. Set up now; generate when it lands.`
              ) : (
                <>
                  {choice?.label ?? 'The model'} isn't downloaded.{' '}
                  <button type="button" className="link-btn accent" onClick={() => go({ name: 'settings' })}>
                    Download in Settings
                  </button>
                </>
              )
            ) : (
              "Runs offline. Stop anytime, keep what's done."
            )}
          </div>
        </div>
        <Btn variant="primary" size="lg" disabled={!canGo} onClick={generate} kbd={canGo ? '⌘↵' : undefined} style={{ minWidth: 240 }}>
          {problem ?? (modelReady ? 'Generate exam' : 'Waiting for model')}
        </Btn>
      </div>
    </div>
  )
}
