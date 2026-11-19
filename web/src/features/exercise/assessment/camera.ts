import { f32, type Landmark } from './domain'

/** Rolling frame rate and p95 latency over the newest frames (CameraDiagnostics.kt). Keeps no landmarks or pictures. */
export interface DiagnosticsSnapshot { samples: number; fps: number; p95LatencyMs: number }
export class CameraDiagnostics {
  private samples: [number, number][] = []
  constructor(private readonly capacity = 300) {
    if (capacity < 2) throw new Error('Diagnostics need at least two samples')
  }
  record(timestampMs: number, latencyMs: number): DiagnosticsSnapshot {
    const last = this.samples[this.samples.length - 1]
    if (timestampMs < 0 || latencyMs < 0 || (last && timestampMs <= last[0])) throw new Error('Samples must move forward in time')
    this.samples.push([timestampMs, latencyMs])
    if (this.samples.length > this.capacity) this.samples.shift()
    const elapsed = this.samples[this.samples.length - 1]![0] - this.samples[0]![0]
    const fps = elapsed > 0 ? ((this.samples.length - 1) * 1000) / elapsed : 0
    const latencies = this.samples.map((s) => s[1]).sort((a, b) => a - b)
    return { samples: this.samples.length, fps, p95LatencyMs: latencies[Math.ceil(latencies.length * 0.95) - 1]! }
  }
}

/** What the camera screen does with one analysed frame (PerformancePolicy.kt). Engineering fallback, not a device claim. */
export type FrameAction = 'PROCESS' | 'DROP' | 'PAUSE'
/** A frame older than this is out of date by the time it reaches the screen. */
export const STALE_FRAME_MS = 1000
/** Android pauses on severe heat. Browsers report no temperature, so the web passes true while the tab is hidden. */
export const shouldPause = (thermalStatus: number) => thermalStatus >= 3
export const slowCamera = (s: DiagnosticsSnapshot) => s.samples >= 60 && s.p95LatencyMs > 250
/** A late frame is only skipped; the engine's own rule for a gap over a second discards a repetition in progress. */
export const frameAction = (pause: boolean, ageMs: number): FrameAction => (pause ? 'PAUSE' : ageMs > STALE_FRAME_MS ? 'DROP' : 'PROCESS')

/** Fits the frame inside the view, centred, shared by the drawn picture and its landmarks (PreviewMapping.kt). */
export interface PreviewMapping { width: number; height: number; left: number; top: number; map(point: Landmark): [number, number] }
export function previewMapping(frameWidth: number, frameHeight: number, viewWidth: number, viewHeight: number, mirror: boolean): PreviewMapping {
  if (!(frameWidth > 0 && frameHeight > 0 && viewWidth > 0 && viewHeight > 0)) throw new Error('Frame and view need a size')
  const vw = f32(viewWidth), vh = f32(viewHeight)
  const scale = Math.min(f32(vw / frameWidth), f32(vh / frameHeight))
  const width = f32(frameWidth * scale), height = f32(frameHeight * scale)
  const left = f32(f32(vw - width) / 2), top = f32(f32(vh - height) / 2)
  return {
    width, height, left, top,
    map: (p) => [f32(left + f32((mirror ? f32(1 - p.x) : p.x) * width)), f32(top + f32(p.y * height))],
  }
}
