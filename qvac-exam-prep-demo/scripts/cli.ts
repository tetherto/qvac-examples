// ============================================================
// The pipeline from a terminal, no window.
//
//   npm run chunks -- <file|url> [...] [--full]
//       ingest + chunk + junk filter, print what was kept and dropped
//
//   npm run gen -- <file|url> [...] [--n 10] [--difficulty applied]
//       [--types single,multi,truefalse] [--model best] [--focus text] [--seed 1]
//       the full generation pipeline through the real model, printing every
//       acceptance and every rejection, then writing the exam to out/
// ============================================================

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { close } from '@qvac/sdk'
import { generateExam } from '../src/core/pipeline'
import type { Chunk, Difficulty, GenEvent, ModelKey, QuestionType } from '../src/core/types'
import { ingest } from '../src/main/ingest'
import { DEFAULT_MODEL, PARALLEL } from '../src/main/models'
import { engineFor, onModelStatus, shutdown } from '../src/main/qvac'

const [cmd, ...rest] = process.argv.slice(2)
const refs: string[] = []
const flags: Record<string, string> = {}
for (let i = 0; i < rest.length; i++) {
  const a = rest[i]
  if (a.startsWith('--')) {
    const next = rest[i + 1]
    if (next && !next.startsWith('--')) {
      flags[a.slice(2)] = next
      i++
    } else flags[a.slice(2)] = 'true'
  } else refs.push(a)
}

const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`
}

async function load(): Promise<{ chunks: Chunk[]; titles: Record<string, string> }> {
  const chunks: Chunk[] = []
  const titles: Record<string, string> = {}
  for (const ref of refs) {
    const r = await ingest(ref)
    titles[r.source.id] = r.source.title
    console.log(`\n${c.cyan(r.source.title)} ${c.dim(`(${r.source.type}, ${r.source.status})`)}`)
    if (r.source.message) console.log(`  ${r.source.message}`)
    console.log(`  ${r.chunks.length} chunks kept, ${r.dropped.length} dropped`)
    if (cmd === 'chunks') {
      for (const k of r.chunks) {
        const where = [k.headingTrail.join(' › '), k.pageNumber != null ? `p.${k.pageNumber}` : '', k.anchor ? `#${k.anchor}` : '']
          .filter(Boolean)
          .join(' · ')
        console.log(`  ${c.green('KEEP')} ${k.id} ~${k.tokenEstimate}t ${where}`)
        console.log(flags.full ? k.text.replace(/^/gm, '       ') : c.dim(`       ${k.text.slice(0, 110).replace(/\s+/g, ' ')}…`))
      }
      for (const d of r.dropped) {
        console.log(`  ${c.red('DROP')} ${d.id} ~${d.tokenEstimate}t [${d.dropReason}] ${d.headingTrail.join(' › ')}`)
        console.log(c.dim(`       ${d.text.slice(0, 110).replace(/\s+/g, ' ')}…`))
      }
    }
    chunks.push(...r.chunks)
  }
  return { chunks, titles }
}

async function gen(): Promise<void> {
  const { chunks, titles } = await load()
  const modelKey = (flags.model ?? DEFAULT_MODEL) as ModelKey
  let lastPct = -1
  onModelStatus((s) => {
    if (s.phase === 'downloading' && s.progress) {
      const pct = Math.floor(s.progress.percent)
      if (pct !== lastPct) process.stderr.write(`\r  downloading ${modelKey}: ${pct}% (${(s.progress.speed / 1e6).toFixed(1)} MB/s)   `)
      lastPct = pct
    } else console.log(c.dim(`  model ${s.key}: ${s.phase}${s.error ? ` ${s.error}` : ''}`))
  })

  const emit = (e: GenEvent): void => {
    switch (e.type) {
      case 'started':
        console.log(`\n${e.prompts} prompts for ${e.target} questions, pool of ${e.poolSize} chunks`)
        break
      case 'accepted': {
        const q = e.question
        console.log(`\n${c.green(`ACCEPT ${e.accepted}/${e.target}`)} ${c.dim(`${q.type} from ${q.sourceChunkId}`)}`)
        console.log(`  ${q.stem}`)
        for (const o of q.options) console.log(`   ${q.correct.includes(o.id) ? c.green('✓') : ' '} ${o.id}) ${o.text}`)
        console.log(c.dim(`  ${q.explanation}`))
        break
      }
      case 'rejected': {
        const r = e.rejection
        console.log(`\n${c.red(`REJECT #${r.promptIndex}`)} ${r.type} [${r.reasons.join(', ')}] ${c.dim(r.headingTrail.join(' › '))}`)
        console.log(`  ${r.detail}`)
        if (flags.raw) console.log(c.dim(`  ${r.raw}`))
        break
      }
      case 'topup':
        console.log(`\ntop-up batch: ${e.prompts} prompts`)
        break
      case 'done':
        console.log(`\nDONE ${e.accepted}/${e.target} in ${e.seconds}s, ${e.rejected} rejected${e.shortBy ? `. Short by ${e.shortBy.missing}: ${e.shortBy.reason}` : ''}`)
        break
      case 'cancelled':
      case 'error':
        console.log(`\n${e.type.toUpperCase()}`, 'message' in e ? e.message : '')
        break
    }
  }

  const controller = new AbortController()
  process.once('SIGINT', () => {
    console.log('\ncancelling…')
    controller.abort()
  })

  const exam = await generateExam({
    config: {
      questionCount: Number(flags.n ?? 10),
      difficulty: (flags.difficulty ?? 'applied') as Difficulty,
      types: (flags.types ?? 'single,multi,truefalse').split(',') as QuestionType[],
      topicFocus: flags.focus,
      mode: 'exam',
      modelKey
    },
    chunks,
    sourceTitles: titles,
    engine: engineFor(modelKey),
    emit,
    signal: controller.signal,
    slots: PARALLEL,
    seed: flags.seed ? Number(flags.seed) : undefined
  })
  if (exam) {
    await mkdir('out', { recursive: true })
    const path = join('out', `${exam.id}.json`)
    await writeFile(path, JSON.stringify(exam, null, 2))
    console.log(`exam written to ${path}`)
  }
}

if (!refs.length || (cmd !== 'chunks' && cmd !== 'gen')) {
  console.log('usage: npm run chunks -- <file|url> [--full]\n       npm run gen -- <file|url> [--n 10] [--difficulty recall|applied|scenario] [--types single,multi,truefalse] [--model fast|balanced|best] [--focus text] [--raw]')
  process.exit(1)
}

try {
  if (cmd === 'chunks') await load()
  else await gen()
} finally {
  if (cmd === 'gen') {
    await shutdown()
    await close()
  }
}
