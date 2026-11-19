/// <reference lib="webworker" />
import { createLandmarker, type Landmarker } from './mediapipe'
import type { FromWorker, ToWorker } from './messages'
import { guardFetch } from './offOrigin'

/** Runs MediaPipe off the page's thread. Nothing here can reach another address; see offOrigin.ts. */
const scope = self as unknown as DedicatedWorkerGlobalScope
const refused = guardFetch(scope)
let landmarker: Landmarker | null = null

const post = (message: FromWorker, transfer: Transferable[] = []) => scope.postMessage(message, transfer)
const blank = () => {
  const canvas = new OffscreenCanvas(64, 64)
  canvas.getContext('2d')?.fillRect(0, 0, 64, 64) // A canvas needs a context before it can hand over a bitmap.
  return canvas.transferToImageBitmap()
}

scope.onmessage = async ({ data }: MessageEvent<ToWorker>) => {
  if (data.type === 'init') {
    try {
      const canvas = data.gpu && typeof OffscreenCanvas !== 'undefined' ? () => new OffscreenCanvas(1, 1) : null
      landmarker = await createLandmarker(data.assets, canvas, blank)
      post({ type: 'ready', delegate: landmarker.delegate })
    } catch (error) {
      post({ type: 'failed', message: String(error) })
    }
  } else if (data.type === 'frame') {
    try {
      if (!landmarker) throw new Error('Tracking has not started')
      const people = landmarker.detect(data.image, data.timestampMs)
      post({ type: 'result', people, image: data.image, timestampMs: data.timestampMs }, [data.image])
    } catch (error) {
      data.image.close()
      post({ type: 'frame-failed', message: String(error) })
    }
  } else {
    landmarker?.close()
    landmarker = null
    // Closing flushes MediaPipe's statistics; give the refused request a moment to be recorded.
    setTimeout(() => post({ type: 'closed', refused: refused() }), 500)
  }
}
