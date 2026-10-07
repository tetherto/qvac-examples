// Run logs. Three views of the same run, because they answer different
// questions: events.jsonl for machine replay, transcript.md for reading what
// the agent actually said, summary.json for "did it get through and how far".
import fs from 'node:fs'
import path from 'node:path'

function stamp () {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

export class RunLogger {
  constructor (baseDir) {
    this.dir = path.join(baseDir, stamp())
    fs.mkdirSync(this.dir, { recursive: true })
    this.eventsPath = path.join(this.dir, 'events.jsonl')
    this.transcriptPath = path.join(this.dir, 'transcript.md')
    this.summaryPath = path.join(this.dir, 'summary.json')
    this.startedAt = Date.now()
    fs.writeFileSync(this.transcriptPath, '# Vault Guardian blind-test run\n\n')
  }

  event (type, payload = {}) {
    const line = JSON.stringify({ at: new Date().toISOString(), type, ...payload })
    fs.appendFileSync(this.eventsPath, line + '\n')
  }

  transcript (text) {
    fs.appendFileSync(this.transcriptPath, text + '\n')
  }

  summary (obj) {
    const body = { durationMs: Date.now() - this.startedAt, ...obj }
    fs.writeFileSync(this.summaryPath, JSON.stringify(body, null, 2) + '\n')
    return body
  }
}
