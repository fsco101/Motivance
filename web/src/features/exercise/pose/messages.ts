import type { Landmark } from '../assessment'
import type { PoseAssets } from './mediapipe'

/** Messages between the page and pose.worker.ts. Frames travel as transferred ImageBitmaps, so nothing is copied. */
export type ToWorker =
  | { type: 'init'; assets: PoseAssets; gpu: boolean }
  | { type: 'frame'; image: ImageBitmap; timestampMs: number }
  | { type: 'close' }

export type FromWorker =
  | { type: 'ready'; delegate: 'GPU' | 'CPU' }
  | { type: 'failed'; message: string }
  | { type: 'result'; people: Landmark[][]; image: ImageBitmap; timestampMs: number }
  | { type: 'frame-failed'; message: string }
  /** Sent after close: the addresses the guard refused, such as MediaPipe's usage statistics. */
  | { type: 'closed'; refused: string[] }
