// Regenerate fixtures/test-sentences.json for the "Try an example" button.
//
// Why this script exists: the first version of that fixture took its sentences for 8 of the
// 19 languages straight out of qvac/TranslatePsy-AfriSLM-Synthetic-Mix, which is CC-BY-NC 4.0.
// The model's own licence is Apache 2.0 and the examples repo is Apache 2.0, so those 16
// strings could not ship. Everything is now produced by the model itself from a fixed English
// sentence, then translated back to English so the round trip is visible.
//
// The round trip is not a quality score. It is there so anyone reading the fixture can see
// where the model drifted, and so nobody mistakes these for reference translations.
//
//   node bin/make-examples.mjs               # all 19
//   node bin/make-examples.mjs af am ha      # just these
//
// Takes about 3 s per language on the 2B Q4 with the model already cached.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sdk } from '../lib/sdk.js'
import { variantById, variantUrl } from '../lib/models.js'
import { FINE_TUNED, buildPrompt } from '../lib/translate.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, '..', 'fixtures', 'test-sentences.json')
const VARIANT = '2B-Q4'

// Two everyday sentences per language, the kind of thing this app is for. Fixed, so a
// re-run produces a comparable fixture rather than a different one.
const SEEDS = [
  'The school will be closed on Monday because the teachers are in a meeting.',
  'I have had a fever and a bad headache for three days and I want to see a doctor today.'
]

const only = process.argv.slice(2)
const targets = FINE_TUNED.filter(l => l.code !== 'en' && (!only.length || only.includes(l.code)))

const { mod } = await sdk()   // sdk() returns { mod, cliVersion, sdkVersion }
const v = variantById(VARIANT)
console.log(`loading AfriSLM ${v.params} ${v.quant}`)
const modelId = await mod.loadModel({
  modelSrc: variantUrl(v),
  modelType: 'llamacpp-completion',
  modelConfig: { device: 'gpu', ctx_size: 2048, reasoning_budget: 0 }
})

async function translate (from, to, text) {
  const run = mod.completion({
    modelId,
    history: buildPrompt(from, to, text),
    stream: false,
    kvCache: false,
    generationParams: { predict: 512, temp: 0, reasoning_budget: 0 }
  })
  return ((await run.final).contentText || '').trim()
}

const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { languages: {} }
const languages = only.length ? existing.languages : {}

for (const lang of targets) {
  const samples = []
  for (const english of SEEDS) {
    const text = await translate('English', lang.name, english)
    const back = await translate(lang.name, 'English', text)
    samples.push({ text, english, roundTrip: back, pair: `eng-${lang.code}`, origin: 'model' })
    console.log(`  ${lang.code}  ${text.slice(0, 60)}`)
  }
  languages[lang.code] = { name: lang.name, samples }
}

const doc = {
  _note: 'Example sentences for the 19 fine-tuned languages, loaded by the "Try an example" button.',
  _origin: 'Every sentence was produced by TranslatePsy-AfriSLM-2B Q4_K_M itself, from one of two ' +
    'fixed English sentences, then translated back to English (roundTrip) so the drift is visible. ' +
    'They exercise the app. They are not reference translations and must not be used to judge it.',
  _why: 'An earlier version of this file took sentences for 8 languages from ' +
    'qvac/TranslatePsy-AfriSLM-Synthetic-Mix, which is CC-BY-NC 4.0 and therefore cannot ship in ' +
    'an Apache 2.0 repository. Regenerate with: node bin/make-examples.mjs',
  _model: `TranslatePsy-AfriSLM-${v.params} ${v.quant}, greedy decoding, generated ${new Date().toISOString().slice(0, 10)}`,
  languages: Object.fromEntries(FINE_TUNED.filter(l => l.code !== 'en' && languages[l.code])
    .map(l => [l.code, languages[l.code]]))
}
fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n')
await mod.unloadModel({ modelId })
const n = Object.values(doc.languages).reduce((a, l) => a + l.samples.length, 0)
console.log(`\nwrote ${OUT}: ${Object.keys(doc.languages).length} languages, ${n} sentences`)
