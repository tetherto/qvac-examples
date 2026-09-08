// Reading a photographed document.
//
// TranslatePsy-AfriSLM does no OCR at all: it is a text-in, text-out translation
// model. The scan tab is therefore two models in a row, and this file is the first
// one.
//
// QVAC ships two OCR paths and only one of them works here. The dedicated engine
// (OCR_LATIN on `ggml-ocr`) loads in 0.7s, returns nothing for a clean 1150x560
// page, and then takes the worker down with it on unload (WORKER_SHUTDOWN 50206,
// measured on SDK 0.16 today, and the same fault was recorded on 0.15). So this uses
// the OCR vision-language model through the ordinary completion path, which
// transcribed the same page in 1.8s with every line correct.

const CLEAN = [
  [/^\s*```[a-z]*\s*/i, ''],   // a fenced block around the answer
  [/```\s*$/, ''],
  [/^\*\*(.+?)\*\*$/gm, '$1'], // the model bolds headings it thinks are headings
  [/^#+\s*/gm, ''],
  // A rule between sections is layout, not text. The OCR reader emits them and they
  // arrived in the translation as their own block, twice, reading "---".
  [/^\s*[-_*]{3,}\s*$/gm, ''],
  // The 3B reader prefixes every line with its block type and bounding box.
  [/^(header|footer|title|text|table|list)\s*\[[\d,\s]+\]\s*/gmi, '']
]

export function tidy (text) {
  let out = String(text || '').trim()
  for (const [re, to] of CLEAN) out = out.replace(re, to)
  return out.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim()
}

export async function readDocument ({ mod, modelId, imagePath, onDelta }) {
  const run = mod.completion({
    modelId,
    history: [
      { role: 'system', content: 'You transcribe documents exactly as written. You never translate, summarise or explain.' },
      {
        role: 'user',
        content: 'Transcribe every line of text in this document, in reading order. ' +
          'Keep the original wording, numbers and dates exactly. Separate paragraphs with a blank line. ' +
          'Output only the transcription.',
        attachments: [{ path: imagePath }]
      }
    ],
    stream: true,
    // Each page is an independent read. Sharing a cache across photos made an earlier
    // recipe describe the previous image, which is worse than failing.
    kvCache: false,
    generationParams: { predict: 900, temp: 0, reasoning_budget: 0 }
  })
  let text = ''
  for await (const ev of run.events) {
    if (ev.type === 'contentDelta') { text += ev.text; if (onDelta) onDelta(ev.text) }
  }
  const final = await run.final
  return tidy(final.contentText || text)
}
