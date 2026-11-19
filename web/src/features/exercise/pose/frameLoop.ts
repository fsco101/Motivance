import { frameAction, type CameraDiagnostics, type DiagnosticsSnapshot, type Landmark } from '../assessment'
import { LatestFrameGate } from './frameGate'

/** A decoded camera frame the caller draws, then closes. ImageBitmap in the browser. */
export interface FrameImage { readonly width: number; readonly height: number; close(): void }

export interface Detection { people: Landmark[][]; image: FrameImage; width: number; height: number; timestampMs: number }

export interface PoseDetector {
  readonly delegate: 'GPU' | 'CPU'
  /** Detects people in the current video frame. The returned image is that exact frame. */
  detect(source: FrameSource, timestampMs: number): Promise<Detection>
}

/** The part of HTMLVideoElement the loop uses. */
export interface FrameSource {
  readonly videoWidth: number
  readonly videoHeight: number
  requestVideoFrameCallback(callback: (now: number) => void): number
  cancelVideoFrameCallback(handle: number): void
}

export interface TrackedFrame extends Detection { diagnostics: DiagnosticsSnapshot; latencyMs: number }

interface Options {
  video: FrameSource
  detector: PoseDetector
  diagnostics: CameraDiagnostics
  onFrame: (frame: TrackedFrame) => void
  /** Called once each time measurement must stop because the page is hidden. */
  onPause: () => void
  now?: () => number
  hidden?: () => boolean
}

/**
 * Runs detection on each new video frame, one at a time (requestVideoFrameCallback). It applies Android's frame policy
 * (PerformancePolicy): a result over a second old is skipped, and measurement pauses while the tab is hidden, which
 * stands in for Android's heat pause because a browser reports no temperature.
 */
export class FrameLoop {
  private readonly gate = new LatestFrameGate()
  private handle: number | null = null
  private running = false
  private paused = false
  private lastStamp = -Infinity
  private readonly now: () => number
  private readonly hidden: () => boolean

  constructor(private readonly options: Options) {
    this.now = options.now ?? (() => performance.now())
    this.hidden = options.hidden ?? (() => document.visibilityState === 'hidden')
  }

  get dropped() { return this.gate.dropped }

  start() {
    if (this.running) return
    this.running = true
    this.paused = false
    this.request()
  }

  stop() {
    this.running = false
    if (this.handle !== null) this.options.video.cancelVideoFrameCallback(this.handle)
    this.handle = null
  }

  private request() {
    this.handle = this.options.video.requestVideoFrameCallback(() => this.onVideoFrame())
  }

  private onVideoFrame() {
    this.handle = null
    if (!this.running) return
    this.request()
    if (this.hidden()) {
      if (!this.paused) { this.paused = true; this.options.onPause() }
      return
    }
    this.paused = false
    if (!this.gate.tryEnter()) return
    // Whole milliseconds, as Android stamps frames: the saved durations are whole milliseconds on the server.
    const stamp = Math.max(Math.round(this.now()), this.lastStamp + 1)
    this.lastStamp = stamp
    this.options.detector.detect(this.options.video, stamp).then(
      (detection) => this.onDetection(detection, stamp),
      () => this.gate.leave(),
    )
  }

  private onDetection(detection: Detection, stamp: number) {
    this.gate.leave()
    const latencyMs = this.now() - stamp
    if (!this.running) { detection.image.close(); return }
    const diagnostics = this.options.diagnostics.record(stamp, Math.max(0, Math.round(latencyMs)))
    const action = frameAction(this.hidden(), latencyMs)
    if (action !== 'PROCESS') {
      detection.image.close()
      if (action === 'PAUSE' && !this.paused) { this.paused = true; this.options.onPause() }
      return
    }
    this.options.onFrame({ ...detection, diagnostics, latencyMs })
  }
}
