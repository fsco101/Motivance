import { PoseLandmarker } from '@mediapipe/tasks-vision'
import { toPeople } from './landmarks'
import type { Landmark } from '../assessment'

/** Where MediaPipe's runtime and the pose model are served from: this app's own address, never a CDN. */
export interface PoseAssets { wasmLoaderPath: string; wasmBinaryPath: string; modelAssetPath: string }

/**
 * The settings that change results match Android (CameraPrototype.kt): video mode, up to two people so the engine can
 * refuse a second person, and MediaPipe's default 0.5 thresholds, which Android also leaves unchanged.
 */
const SETTINGS = { runningMode: 'VIDEO', numPoses: 2, minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5 } as const

export interface Landmarker {
  delegate: 'GPU' | 'CPU'
  detect(image: TexImageSource | ImageBitmap, timestampMs: number): Landmark[][]
  close(): void
}

/** Loads the pose model on the graphics chip when `canvas` gives one, otherwise on the CPU, then warms it up. */
export async function createLandmarker(assets: PoseAssets, canvas: (() => HTMLCanvasElement | OffscreenCanvas) | null, blank: () => ImageBitmap | HTMLCanvasElement | OffscreenCanvas): Promise<Landmarker> {
  const fileset = { wasmLoaderPath: assets.wasmLoaderPath, wasmBinaryPath: assets.wasmBinaryPath }
  const create = (gpu: boolean) => PoseLandmarker.createFromOptions(fileset, {
    ...SETTINGS,
    baseOptions: { modelAssetPath: assets.modelAssetPath, delegate: gpu ? 'GPU' : 'CPU' },
    ...(gpu && canvas ? { canvas: canvas() } : {}),
  })
  let delegate: 'GPU' | 'CPU' = canvas ? 'GPU' : 'CPU'
  let task: PoseLandmarker
  try {
    task = await create(delegate === 'GPU')
  } catch (error) {
    if (delegate === 'CPU') throw error
    delegate = 'CPU'
    task = await create(false)
  }
  // The first frame compiles the graphics shaders; doing it now keeps the patient's first frame fast.
  task.detectForVideo(blank() as TexImageSource, 0)
  return {
    delegate,
    detect: (image, timestampMs) => toPeople(task.detectForVideo(image as TexImageSource, timestampMs).landmarks),
    close: () => task.close(),
  }
}
