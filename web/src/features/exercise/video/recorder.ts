import { recordBitrate, recordSize, sharePlan } from './plan'

/**
 * How this browser can record a session video as MP4, the only kind the server takes. MediaRecorder where it records MP4
 * (H.264); otherwise WebCodecs with Mediabunny's MP4 muxer; otherwise not at all, and the page says so.
 */
export type RecordingSupport = { kind: 'recorder'; mimeType: string } | { kind: 'encoder' } | null

const MP4_TYPES = ['video/mp4;codecs=avc1.42E01F', 'video/mp4;codecs=avc1', 'video/mp4'] as const

export async function recordingSupport(width = 640, height = 480): Promise<RecordingSupport> {
  if (typeof document === 'undefined' || typeof HTMLCanvasElement === 'undefined') return null
  const canCapture = 'captureStream' in HTMLCanvasElement.prototype
  if (canCapture && typeof MediaRecorder !== 'undefined') {
    const type = MP4_TYPES.find((candidate) => { try { return MediaRecorder.isTypeSupported(candidate) } catch { return false } })
    if (type) return { kind: 'recorder', mimeType: type }
  }
  if (typeof VideoEncoder !== 'undefined') {
    try {
      const { canEncodeVideo } = await import('mediabunny')
      if (await canEncodeVideo('avc', { width, height })) return { kind: 'encoder' }
    } catch { /* No encoder after all. */ }
  }
  return null
}

/** A finished recording, kept in this tab. `sessions` are the run's sessions in order; the video belongs to the first. */
export interface RecordedVideo { blob: Blob; url: string; width: number; height: number; durationMs: number; sessions: string[]; preview: Blob | null; at: number }

interface Backend { start(): Promise<void>; add(seconds: number): void; finish(): Promise<Blob>; cancel(): void }

function recorderBackend(canvas: HTMLCanvasElement, mimeType: string, bits: number): Backend {
  const stream = canvas.captureStream(30)
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bits })
  const chunks: Blob[] = []
  recorder.addEventListener('dataavailable', (event) => { if (event.data.size > 0) chunks.push(event.data) })
  const stopTracks = () => stream.getTracks().forEach((track) => track.stop())
  return {
    async start() { recorder.start(1000) },
    // The canvas stream picks up each drawing by itself.
    add() {},
    finish: () => new Promise<Blob>((resolve, reject) => {
      recorder.addEventListener('stop', () => { stopTracks(); resolve(new Blob(chunks, { type: 'video/mp4' })) }, { once: true })
      recorder.addEventListener('error', () => { stopTracks(); reject(new Error('recording_failed')) }, { once: true })
      if (recorder.state === 'inactive') { stopTracks(); resolve(new Blob(chunks, { type: 'video/mp4' })) } else recorder.stop()
    }),
    cancel() { try { if (recorder.state !== 'inactive') recorder.stop() } catch { /* Already stopped. */ } stopTracks() },
  }
}

async function encoderBackend(canvas: HTMLCanvasElement, bits: number): Promise<Backend> {
  const mb = await import('mediabunny')
  const target = new mb.BufferTarget()
  const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target })
  const source = new mb.CanvasSource(canvas, { codec: 'avc', bitrate: bits, keyFrameInterval: 2 })
  output.addVideoTrack(source, { frameRate: 30 })
  // A frame arriving while the encoder is still busy is skipped, never queued, so recording cannot hold up tracking.
  let busy: Promise<void> | null = null
  let failed = false
  return {
    start: () => output.start(),
    add(seconds) {
      if (busy || failed) return
      busy = source.add(seconds).catch(() => { failed = true }).finally(() => { busy = null })
    },
    async finish() {
      await busy
      if (failed) throw new Error('recording_failed')
      await output.finalize()
      return new Blob([target.buffer!], { type: 'video/mp4' })
    },
    cancel() { void output.cancel().catch(() => undefined) },
  }
}

/**
 * Records one run, every side in the same video, as Android's SessionRecorder does: the camera picture with the skeleton and
 * angle drawn as the patient sees them, and a caption with the exercise, the angle and the count. It draws on its own canvas,
 * at the camera picture's shape, so the page's layout never changes the video. Drawing never waits for the encoder.
 */
export class SessionRecorder {
  readonly canvas: HTMLCanvasElement
  readonly width: number
  readonly height: number
  private readonly ctx: CanvasRenderingContext2D
  private backend: Backend | null = null
  private startedAt: number | null = null
  private lastAt = 0
  private preview: Promise<Blob | null> | null = null
  private readonly at: number
  sessions: string[] = []

  constructor(private readonly support: NonNullable<RecordingSupport>, cameraWidth: number, cameraHeight: number, private readonly now = () => performance.now(), wall = Date.now()) {
    const size = recordSize(cameraWidth, cameraHeight)
    this.width = size.width
    this.height = size.height
    this.canvas = document.createElement('canvas')
    this.canvas.width = size.width
    this.canvas.height = size.height
    this.ctx = this.canvas.getContext('2d')!
    this.at = wall
  }

  async start() {
    const bits = recordBitrate(this.width, this.height)
    // Something must be on the canvas before the encoder sees it.
    this.ctx.fillStyle = '#062229'
    this.ctx.fillRect(0, 0, this.width, this.height)
    this.backend = this.support.kind === 'recorder' ? recorderBackend(this.canvas, this.support.mimeType, bits) : await encoderBackend(this.canvas, bits)
    await this.backend.start()
    this.startedAt = this.now()
  }

  /** Adds one session of the run, the first time it is seen. */
  join(sessionId: string) { if (!this.sessions.includes(sessionId)) this.sessions.push(sessionId) }

  /** Draws one tracked frame with `paint`, adds the caption, and hands it to the encoder. Called from the frame loop. */
  frame(paint: (ctx: CanvasRenderingContext2D, width: number, height: number) => void, caption: string) {
    if (!this.backend || this.startedAt === null) return
    const { ctx, width, height } = this
    paint(ctx, width, height)
    drawCaption(ctx, caption, width, height)
    this.lastAt = this.now()
    this.backend.add((this.lastAt - this.startedAt) / 1000)
    this.preview ??= previewOf(this.canvas)
  }

  /** Ends the recording. Null when nothing was drawn. */
  async finish(): Promise<RecordedVideo | null> {
    const backend = this.backend
    this.backend = null
    if (!backend || this.startedAt === null) return null
    if (this.preview === null) { backend.cancel(); return null }
    const blob = await backend.finish()
    const durationMs = Math.max(1, Math.round(this.lastAt - this.startedAt))
    return { blob, url: URL.createObjectURL(blob), width: this.width, height: this.height, durationMs, sessions: [...this.sessions], preview: await this.preview, at: this.at }
  }

  cancel() { this.backend?.cancel(); this.backend = null }
}

/** The caption band along the bottom, at Android's sizes: 28 and 14 units of a 360-unit-wide picture. */
export function drawCaption(ctx: CanvasRenderingContext2D, caption: string, width: number, height: number) {
  const unit = width / 360
  const band = 28 * unit
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = 'rgba(6, 34, 41, 0.78)'
  ctx.fillRect(0, height - band, width, band)
  ctx.fillStyle = '#ffffff'
  ctx.font = `700 ${14 * unit}px system-ui, sans-serif`
  ctx.textBaseline = 'middle'
  ctx.fillText(caption, 12 * unit, height - band / 2, width - 24 * unit)
  ctx.restore()
}

/** The still the therapist sees before pressing play: the first frame, at the shared size, under the server's 200 KB limit. */
async function previewOf(source: HTMLCanvasElement): Promise<Blob | null> {
  const plan = sharePlan(source.width, source.height, 1)
  const small = document.createElement('canvas')
  small.width = plan.width
  small.height = plan.height
  small.getContext('2d')!.drawImage(source, 0, 0, plan.width, plan.height)
  for (const quality of [0.8, 0.6, 0.4]) {
    const blob = await new Promise<Blob | null>((resolve) => small.toBlob(resolve, 'image/jpeg', quality))
    if (blob && blob.size <= 204_800) return blob
  }
  return null
}

