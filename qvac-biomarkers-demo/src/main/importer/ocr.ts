// ============================================================
// On-device OCR, for lab reports that arrive as a scan or a photo.
//
// The QVAC SDK's dedicated OCR engine (EasyOCR pipeline: a CRAFT detector
// and a Latin recognizer, both GGUF, about 100 MB in total) runs here, in
// the main process, next to MedPsy. Nothing leaves the machine.
//
// It returns text BLOCKS with a bounding box each, not lines. A lab report is
// a table, so the blocks are regrouped into rows by their vertical centre and
// read left to right, which gives labrows.ts the same "name value unit range"
// lines a digital PDF gives it.
//
// The model is loaded for one import and unloaded after it: it is small and
// loads in under a second, and a resident OCR model would sit in memory next
// to a 2.7 GB MedPsy for no reason. The job goes through the same queue as
// completions, so a chat reply and an OCR pass never compete for the GPU.
// ============================================================

import { loadModel, unloadModel, ocr, OCR_LATIN, MODEL_TYPES } from '@qvac/sdk'
import { serialise } from '../qvac.js'
import { ImportError } from './kinds.js'

interface Block {
  text: string
  /** [x1, y1, x2, y2] in image pixels, origin top left. */
  bbox: number[]
  confidence: number
}

/** Regroups OCR blocks into rows of text, top to bottom, left to right. */
export function blocksToRows(blocks: Block[]): string[] {
  const items = blocks
    .filter((b) => b.text.trim() && Array.isArray(b.bbox) && b.bbox.length >= 4)
    .map((b) => ({
      text: b.text.trim(),
      x: b.bbox[0],
      y: (b.bbox[1] + b.bbox[3]) / 2,
      h: Math.max(1, b.bbox[3] - b.bbox[1])
    }))
    .sort((a, b) => a.y - b.y)
  const rows: { y: number; h: number; items: typeof items }[] = []
  for (const it of items) {
    // Same row when the centres are closer than 60% of the shorter box: a
    // table row's cells share a line, and the next row sits a full line down.
    const row = rows.find((r) => Math.abs(r.y - it.y) < Math.max(6, Math.min(r.h, it.h) * 0.6))
    if (row) row.items.push(it)
    else rows.push({ y: it.y, h: it.h, items: [it] })
  }
  return rows.map((r) =>
    r.items
      .sort((a, b) => a.x - b.x)
      .map((i) => i.text)
      .join(' ')
  )
}

/**
 * Reads each image and returns its rows, in order. `images` are file paths or
 * encoded image bytes (PNG or JPEG).
 */
export function ocrImages(images: (string | Buffer)[]): Promise<{ pages: string[][]; seconds: number }> {
  return serialise(async () => {
    const started = Date.now()
    let modelId: string
    try {
      modelId = await loadModel({
        modelSrc: OCR_LATIN.src,
        modelType: MODEL_TYPES.ggmlOcr,
        // Metal on a Mac: about 3 s a page against 15 s on the CPU, measured
        // on a four-page report. Other platforms keep the engine's default.
        modelConfig: process.platform === 'darwin' ? { backendDevice: 'metal' } : {}
      })
    } catch (err) {
      throw new ImportError(
        'The on-device OCR model could not be loaded. It downloads once (about 100 MB) the first ' +
          `time a scan or a photo is imported, so this needs a connection once: ${(err as Error).message}`
      )
    }
    try {
      const pages: string[][] = []
      for (const image of images) {
        const blocks = (await ocr({ modelId, image }).blocks) as Block[]
        pages.push(blocksToRows(blocks))
      }
      return { pages, seconds: Math.round((Date.now() - started) / 100) / 10 }
    } finally {
      await unloadModel({ modelId, clearStorage: false }).catch(() => undefined)
    }
  })
}
