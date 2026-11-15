import { MEDIA_LIMITS, type MediaDraft } from '@/data/chat'

/** Photos are sent at most this long on their long side, and previews at this. */
export const PHOTO_LONG_SIDE = 1600
export const PREVIEW_LONG_SIDE = 320
/** Video is made 480p: at most this on its short side and this on its long side, for at most 30 seconds. */
export const VIDEO_SHORT_SIDE = 480
export const VIDEO_LONG_SIDE = 854
export const VIDEO_SECONDS = 30
export const VIDEO_BITS = 1_000_000

export class MediaError extends Error {}

/** The largest even size inside the limits that keeps the shape. Even, because video encoders need it. Never enlarges. */
export function fitWithin(width: number, height: number, longSide: number, shortSide = longSide) {
  const long = Math.max(width, height)
  const short = Math.min(width, height)
  const scale = Math.min(1, longSide / long, shortSide / short)
  const even = (value: number) => Math.max(2, Math.floor((value * scale) / 2) * 2)
  return { width: even(width), height: even(height) }
}

/** What a video becomes: its size, and how much of it is kept. Longer clips keep their first 30 seconds. */
export function videoPlan(width: number, height: number, seconds: number) {
  if (!(width > 0 && height > 0 && seconds > 0)) throw new MediaError('chat_media_invalid')
  return { ...fitWithin(width, height, VIDEO_LONG_SIDE, VIDEO_SHORT_SIDE), seconds: Math.min(seconds, VIDEO_SECONDS), trimmed: seconds > VIDEO_SECONDS + 0.25 }
}

const canvasOf = (width: number, height: number) => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

const jpeg = (canvas: HTMLCanvasElement, quality: number) => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new MediaError('chat_media_invalid'))), 'image/jpeg', quality)
})

/** Draws a picture at a size, as JPEG, lowering quality and then size until it fits under `limit`. */
async function encode(source: CanvasImageSource, width: number, height: number, limit: number) {
  let size = { width, height }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const canvas = canvasOf(size.width, size.height)
    const context = canvas.getContext('2d')!
    // A photo with transparency would turn black; paper behind it keeps it as it looked.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, size.width, size.height)
    context.drawImage(source, 0, 0, size.width, size.height)
    for (const quality of [0.82, 0.7, 0.58]) {
      const blob = await jpeg(canvas, quality)
      if (blob.size <= limit) return { blob, ...size }
    }
    size = fitWithin(size.width, size.height, Math.floor(Math.max(size.width, size.height) * 0.8))
  }
  throw new MediaError('chat_media_too_large')
}

/** A photo, shrunk to 1600 px and re-encoded, which also drops its location and camera details. */
export async function preparePhoto(file: Blob): Promise<MediaDraft> {
  if (!file.type.startsWith('image/')) throw new MediaError('chat_media_invalid')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    // Some formats, such as HEIC outside Safari, cannot be read by the browser.
    throw new MediaError('chat_media_unreadable')
  }
  try {
    const target = fitWithin(bitmap.width, bitmap.height, PHOTO_LONG_SIDE)
    const photo = await encode(bitmap, target.width, target.height, Math.floor(MEDIA_LIMITS.image * 0.95))
    const small = fitWithin(photo.width, photo.height, PREVIEW_LONG_SIDE)
    const preview = await encode(bitmap, small.width, small.height, MEDIA_LIMITS.preview)
    return { kind: 'image', file: photo.blob, mime: 'image/jpeg', preview: preview.blob, width: photo.width, height: photo.height, durationMs: null }
  } finally {
    bitmap.close()
  }
}

/** The recorder formats the server accepts, in order of preference. Chrome and Firefox record WebM; Safari records MP4. */
function recorderType() {
  const choices = [['video/webm;codecs=vp8,opus', 'video/webm'], ['video/webm', 'video/webm'], ['video/mp4;codecs=avc1,mp4a', 'video/mp4'], ['video/mp4', 'video/mp4']] as const
  if (typeof MediaRecorder === 'undefined') return null
  return choices.find(([type]) => MediaRecorder.isTypeSupported(type)) ?? null
}

const once = (target: EventTarget, event: string) => new Promise<void>((resolve, reject) => {
  target.addEventListener(event, () => resolve(), { once: true })
  target.addEventListener('error', () => reject(new MediaError('chat_media_unreadable')), { once: true })
})

/**
 * A video recorded by a browser, as many shared clips are, often does not say how long it is until it has been read to the end.
 * Seeking past the end makes the browser find out; then it goes back to the start.
 */
async function learnDuration(video: HTMLVideoElement) {
  if (Number.isFinite(video.duration)) return
  const known = new Promise<void>((resolve) => {
    const check = () => { if (Number.isFinite(video.duration)) { video.removeEventListener('durationchange', check); resolve() } }
    video.addEventListener('durationchange', check)
  })
  video.currentTime = Number.MAX_SAFE_INTEGER
  await Promise.race([known, new Promise((resolve) => setTimeout(resolve, 5_000))])
  video.currentTime = 0
  await once(video, 'seeked')
}

/**
 * A video, made 480p at about 1 Mbps and cut to its first 30 seconds, then a still from its first frame. The browser has no
 * way to re-encode faster than playing, so this takes as long as the part of the clip that is kept; `onProgress` reports it.
 */
export async function prepareVideo(file: Blob, onProgress: (share: number) => void = () => undefined): Promise<MediaDraft> {
  if (!file.type.startsWith('video/')) throw new MediaError('chat_media_invalid')
  const format = recorderType()
  if (!format) throw new MediaError('chat_media_unsupported')
  const address = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.preload = 'auto'
  video.playsInline = true
  video.src = address
  const audio = new AudioContext()
  try {
    await once(video, 'loadedmetadata')
    await learnDuration(video)
    if (!Number.isFinite(video.duration)) throw new MediaError('chat_media_unreadable')
    const plan = videoPlan(video.videoWidth, video.videoHeight, video.duration)
    const canvas = canvasOf(plan.width, plan.height)
    const context = canvas.getContext('2d')!
    // The sound goes to the recording only, never to the speakers.
    const sound = audio.createMediaStreamDestination()
    audio.createMediaElementSource(video).connect(sound)
    const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...sound.stream.getAudioTracks()])
    const recorder = new MediaRecorder(stream, { mimeType: format[0], videoBitsPerSecond: VIDEO_BITS, audioBitsPerSecond: 64_000 })
    const parts: Blob[] = []
    recorder.ondataavailable = (event) => { if (event.data.size > 0) parts.push(event.data) }
    const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve() })

    let poster: Blob | null = null
    let running = true
    const draw = async () => {
      if (!running) return
      context.drawImage(video, 0, 0, plan.width, plan.height)
      if (!poster && video.currentTime > 0) {
        const small = fitWithin(plan.width, plan.height, PREVIEW_LONG_SIDE)
        poster = (await encode(canvas, small.width, small.height, MEDIA_LIMITS.preview)).blob
      }
      onProgress(Math.min(1, video.currentTime / plan.seconds))
      if (video.currentTime >= plan.seconds || video.ended) {
        running = false
        video.pause()
        recorder.stop()
        return
      }
      requestAnimationFrame(() => void draw())
    }
    await audio.resume().catch(() => undefined)
    recorder.start(1000)
    // A browser that will not play sound without a fresh tap still plays the picture, so the video is sent without sound.
    await video.play().catch(async () => { video.muted = true; await video.play() })
    void draw()
    video.addEventListener('ended', () => { if (running) { running = false; recorder.stop() } }, { once: true })
    await stopped
    const result = new Blob(parts, { type: format[1] })
    if (!poster) throw new MediaError('chat_media_unreadable')
    if (result.size > MEDIA_LIMITS.video) throw new MediaError('chat_media_too_large')
    onProgress(1)
    return { kind: 'video', file: result, mime: format[1], preview: poster, width: plan.width, height: plan.height, durationMs: Math.round(Math.min(video.currentTime, plan.seconds) * 1000) }
  } finally {
    video.pause()
    video.removeAttribute('src')
    URL.revokeObjectURL(address)
    void audio.close()
  }
}
