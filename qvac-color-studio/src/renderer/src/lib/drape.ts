// ============================================================
// The drape itself — canvas work, no model involved.
//
// Recolouring the band is instant, so clicking through twelve
// swatches feels like holding fabric up to a mirror. The vision
// model has already said its piece; this is just paint.
// ============================================================

import type { DrapeGeometry } from './faceMesh'

/** A still frozen from the webcam or loaded from disk, ready to composite. */
export interface Still {
  /** The unmodified capture. Everything else is derived from it. */
  canvas: HTMLCanvasElement
  /** PNG bytes — what goes to `analyze()` and `generateFullLook()`. */
  png: Uint8Array
  /** An object URL for the plain still, for the capture-review view. */
  url: string
}

/**
 * Portrait aspect the whole UI is built around, matching the design's 4:5-ish
 * frame. Both models get this exact image, so the size is a compromise, and
 * both of them want it small:
 *
 * - The vision model turns the picture into tokens. A larger still means more
 *   image tokens, and a 720x880 capture overflowed SmolVLM2's context outright.
 * - SD 2.1 was trained around 512px and drifts badly above it. 512x640 is a
 *   multiple of 64, which is what the sampler needs.
 *
 * The UI only ever shows the still at ~300px wide, so nothing is lost on screen.
 */
export const STILL_WIDTH = 512
export const STILL_HEIGHT = 640

function drawCover(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number
): void {
  // Fill the portrait box without distorting the person: scale to cover,
  // then centre-crop the overflow.
  const scale = Math.max(width / sourceWidth, height / sourceHeight)
  const drawWidth = sourceWidth * scale
  const drawHeight = sourceHeight * scale
  ctx.drawImage(source, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight)
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the still.'))),
      'image/png'
    )
  })
}

async function finishStill(canvas: HTMLCanvasElement): Promise<Still> {
  const blob = await canvasToPng(canvas)
  return {
    canvas,
    png: new Uint8Array(await blob.arrayBuffer()),
    url: URL.createObjectURL(blob)
  }
}

/**
 * Freezes the current video frame into a still.
 *
 * The preview is mirrored so framing feels like a mirror, but the still is
 * NOT — the model and the saved image should show the person the right way
 * round.
 */
export async function stillFromVideo(video: HTMLVideoElement): Promise<Still> {
  const canvas = document.createElement('canvas')
  canvas.width = STILL_WIDTH
  canvas.height = STILL_HEIGHT

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get a 2D canvas.')

  drawCover(ctx, video, video.videoWidth, video.videoHeight, STILL_WIDTH, STILL_HEIGHT)
  return finishStill(canvas)
}

/** Same, from a file the user picked instead of using the camera. */
export async function stillFromFile(file: File): Promise<Still> {
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = STILL_WIDTH
    canvas.height = STILL_HEIGHT

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not get a 2D canvas.')

    drawCover(ctx, bitmap, bitmap.width, bitmap.height, STILL_WIDTH, STILL_HEIGHT)
    return finishStill(canvas)
  } finally {
    bitmap.close()
  }
}

/**
 * Paints the still with a colour band under the chin and returns an object
 * URL for the result.
 *
 * The geometry is computed once per capture and passed in, so this is pure
 * drawing — cheap enough to run on every swatch click.
 */
export function compositeDrape(
  still: Still,
  geometry: DrapeGeometry,
  hex: string
): string | null {
  const canvas = document.createElement('canvas')
  canvas.width = still.canvas.width
  canvas.height = still.canvas.height

  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.drawImage(still.canvas, 0, 0)

  const { x, y, width, height, fade } = geometry

  // A hard-edged rectangle reads as a bug. Fading the top few percent in
  // makes the colour look like cloth sitting below the jaw.
  const gradient = ctx.createLinearGradient(0, y, 0, y + height)
  gradient.addColorStop(0, `${hex}00`)
  gradient.addColorStop(Math.min(0.999, fade), hex)
  gradient.addColorStop(1, hex)

  ctx.fillStyle = gradient
  ctx.fillRect(x, y, width, height)

  return canvas.toDataURL('image/png')
}

/** Turns the PNG bytes the diffusion model returned into something an <img> can show. */
export function pngToUrl(bytes: Uint8Array): string {
  // Copy into a fresh buffer: the bytes arrive over IPC and we do not want
  // to hand a possibly-shared ArrayBuffer to the Blob constructor.
  return URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
}
