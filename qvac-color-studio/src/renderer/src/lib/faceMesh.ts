// ============================================================
// Finding the chin, once per capture.
//
// The QVAC SDK does language, vision, diffusion and speech — but
// not face landmarks, so the drape geometry comes from MediaPipe
// FaceMesh running in the renderer. Both the runtime and the
// weights are served from the app bundle (see
// `scripts/fetch-face-landmarker.mjs`), so this makes no network
// call and the offline promise holds.
//
// We detect ONCE on the frozen still, cache the geometry, and
// reuse it for all twelve swatches. Re-detecting per click would
// be slow and would make the band twitch between colours.
// ============================================================

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

/** Where the band goes, in the still's own pixel coordinates. */
export interface DrapeGeometry {
  x: number
  y: number
  width: number
  height: number
  /**
   * How far down the band the top fade finishes, 0–1. The band should
   * bleed in under the chin rather than start with a hard edge.
   */
  fade: number
}

// Landmark indices in MediaPipe's 478-point face mesh.
const CHIN = 152 // lowest point of the chin
const JAW_LEFT = 234 // left edge of the face, by the ear
const JAW_RIGHT = 454 // right edge

/**
 * Runs the face mesh over one still and returns the drape geometry, or
 * null when there is no face to drape against.
 *
 * The landmarker is created and closed inside this call. It is only
 * needed for a few milliseconds per capture, and closing it hands the
 * memory straight back — the same courtesy the QVAC models get.
 */
export async function detectDrapeGeometry(
  image: HTMLCanvasElement | HTMLImageElement
): Promise<DrapeGeometry | null> {
  const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm')

  const landmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: '/mediapipe/face_landmarker.task',
      // CPU on purpose. This runs ONCE on a single 512x640 still, which is
      // trivial work — and the GPU is about to be handed to a 1.5 GB vision
      // model. Competing for it caused the model's KV cache to come back
      // smaller than requested, which surfaced as a bogus CONTEXT_OVERFLOW
      // on a 615-token prompt. Leave the GPU to the model that needs it.
      delegate: 'CPU'
    },
    runningMode: 'IMAGE',
    numFaces: 1
  })

  try {
    const result = landmarker.detect(image)
    const points = result.faceLandmarks?.[0]
    if (!points?.length) return null

    const width = image.width
    const height = image.height

    const chin = points[CHIN]
    const left = points[JAW_LEFT]
    const right = points[JAW_RIGHT]
    if (!chin || !left || !right) return null

    // Landmarks are normalised 0–1 against the image box. The face width sets
    // the scale of everything below; the chin sets where the drape starts.
    const faceWidth = Math.abs(right.x - left.x) * width
    const chinY = chin.y * height

    // Full width, edge to edge. A narrower band would leave the person's own
    // top showing at the sides, and whatever colour they happen to be wearing
    // biases the comparison — which is the one thing this screen must not do.
    const bandX = 0
    const bandWidth = width

    // Start right at the chin, a whisker above it, so no sliver of their own
    // clothing survives between jaw and drape. Any gap here defeats the point.
    const bandY = Math.max(0, Math.min(height - 1, chinY - faceWidth * 0.02))

    return {
      x: bandX,
      y: bandY,
      width: bandWidth,
      height: height - bandY,
      // Just enough blend to avoid a pasted-on hard line, but short — a long
      // fade is another way to let the old colour through.
      fade: 0.07
    }
  } finally {
    landmarker.close()
  }
}
