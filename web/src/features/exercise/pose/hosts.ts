import workerLoader from '@mediapipe/tasks-vision/vision_wasm_module_internal.js?url'
import workerBinary from '@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url'
import pageLoader from '@mediapipe/tasks-vision/vision_wasm_internal.js?url'
import pageBinary from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'
import modelUrl from './models/pose_landmarker_lite.task?url'
import type { LandmarkerHost } from './choose'
import { chooseHost } from './choose'
import type { Detection, FrameSource } from './frameLoop'
import { createLandmarker, type Landmarker, type PoseAssets } from './mediapipe'
import type { FromWorker, ToWorker } from './messages'
import { guardFetch, notStatistics } from './offOrigin'

const absolute = (path: string) => new URL(path, location.href).href
// A module worker imports MediaPipe's ES module loader; the page loads the classic one as a script.
const WORKER_ASSETS: PoseAssets = { wasmLoaderPath: absolute(workerLoader), wasmBinaryPath: absolute(workerBinary), modelAssetPath: absolute(modelUrl) }
const PAGE_ASSETS: PoseAssets = { wasmLoaderPath: absolute(pageLoader), wasmBinaryPath: absolute(pageBinary), modelAssetPath: absolute(modelUrl) }

const frameImage = (source: FrameSource) => createImageBitmap(source as unknown as HTMLVideoElement)

/** MediaPipe in pose.worker.ts. Frames go over as transferred bitmaps and come back with their landmarks. */
class WorkerHost implements LandmarkerHost {
  readonly thread = 'worker'
  delegate: 'GPU' | 'CPU' = 'CPU'
  private readonly worker = new Worker(new URL('./pose.worker.ts', import.meta.url), { type: 'module', name: 'pose' })
  private waiting: ((message: FromWorker) => void) | null = null
  private closedWith: Promise<string[]> | null = null

  constructor() {
    this.worker.onmessage = ({ data }: MessageEvent<FromWorker>) => { const resolve = this.waiting; this.waiting = null; resolve?.(data) }
    this.worker.onerror = () => { const resolve = this.waiting; this.waiting = null; resolve?.({ type: 'failed', message: 'The tracking worker stopped' }) }
  }

  private send(message: ToWorker, transfer: Transferable[] = []) {
    return new Promise<FromWorker>((resolve) => { this.waiting = resolve; this.worker.postMessage(message, transfer) })
  }

  async init() {
    const reply = await this.send({ type: 'init', assets: WORKER_ASSETS, gpu: true })
    if (reply.type !== 'ready') throw new Error(reply.type === 'failed' ? reply.message : 'Tracking did not start')
    this.delegate = reply.delegate
    return reply.delegate
  }

  async detect(source: FrameSource, timestampMs: number): Promise<Detection> {
    const image = await frameImage(source)
    const width = image.width, height = image.height
    const reply = await this.send({ type: 'frame', image, timestampMs }, [image])
    if (reply.type !== 'result') throw new Error(reply.type === 'frame-failed' ? reply.message : 'Tracking failed')
    return { people: reply.people, image: reply.image, width, height, timestampMs }
  }

  /** Closes MediaPipe, then the worker. Resolves with the addresses the worker refused. */
  closeAndReport(): Promise<string[]> {
    this.closedWith ??= this.send({ type: 'close' }).then((reply) => {
      this.worker.terminate()
      return reply.type === 'closed' ? reply.refused : []
    })
    return this.closedWith
  }

  close() { void this.closeAndReport() }
}

let pageGuard: (() => string[]) | null = null

/** MediaPipe on the page's own thread, for browsers that can only use the graphics chip there. */
class PageHost implements LandmarkerHost {
  readonly thread = 'page'
  delegate: 'GPU' | 'CPU' = 'CPU'
  private landmarker: Landmarker | null = null

  async init() {
    pageGuard ??= guardFetch(window, notStatistics)
    const canvas = () => document.createElement('canvas')
    const blank = () => Object.assign(document.createElement('canvas'), { width: 64, height: 64 })
    this.landmarker = await createLandmarker(PAGE_ASSETS, canvas, blank)
    this.delegate = this.landmarker.delegate
    return this.delegate
  }

  async detect(source: FrameSource, timestampMs: number): Promise<Detection> {
    if (!this.landmarker) throw new Error('Tracking has not started')
    const image = await frameImage(source)
    return { people: this.landmarker.detect(image, timestampMs), image, width: image.width, height: image.height, timestampMs }
  }

  close() { this.landmarker?.close(); this.landmarker = null }
}

let shared: Promise<LandmarkerHost> | null = null

/**
 * Starts loading MediaPipe and the model once, and keeps it for the visit so a second exercise starts at once.
 * Call it as soon as the patient opens an exercise or the camera check.
 */
export function preparePoseTracking(): Promise<LandmarkerHost> {
  shared ??= chooseHost(() => new WorkerHost(), () => new PageHost()).catch((error: unknown) => { shared = null; throw error })
  return shared
}

/** Frees MediaPipe, for example when the patient signs out. */
export async function releasePoseTracking(): Promise<string[]> {
  const current = shared
  shared = null
  if (!current) return []
  const host = await current.catch(() => null)
  if (host instanceof WorkerHost) return host.closeAndReport()
  host?.close()
  return pageGuard?.() ?? []
}
