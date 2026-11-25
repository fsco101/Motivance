import { fitWithin, VIDEO_LONG_SIDE, VIDEO_SHORT_SIDE } from '@/features/chat/media'

/**
 * Session videos shared with the therapist (#129, #139), the same limits as Android's SessionVideoLimits and the server's
 * session_video_* functions: 480p, the first five minutes, about 500 kbps, at most 20 MB, a preview of at most 200 KB.
 */
export const SESSION_VIDEO = {
  bytes: 20_971_520,
  previewBytes: 204_800,
  ms: 300_000,
  bits: 500_000,
  days: 15,
} as const

/** The recording's own size: the camera picture's shape, at most 1280 pixels on its long side, even (videoSize on Android). */
export function recordSize(width: number, height: number) {
  const scale = Math.min(1, 1280 / Math.max(width, height))
  const even = (value: number) => Math.max(2, Math.floor(value / 2) * 2)
  return { width: even(width * scale), height: even(height * scale) }
}

/** The recording's bitrate, as on Android: about three bits a pixel, between 1 and 4 Mbps. */
export const recordBitrate = (width: number, height: number) => Math.min(Math.max(width * height * 3, 1_000_000), 4_000_000)

/** What a recording becomes for sharing: 480p and its first five minutes (sessionVideoPlan on Android). */
export function sharePlan(width: number, height: number, durationMs: number) {
  if (!(width > 0 && height > 0 && durationMs > 0)) throw new Error('video_invalid')
  const size = fitWithin(width, height, VIDEO_LONG_SIDE, VIDEO_SHORT_SIDE)
  return { ...size, durationMs: Math.min(durationMs, SESSION_VIDEO.ms), trimmed: durationMs > SESSION_VIDEO.ms + 250 }
}

/** The file name a download gets, as the phone names its gallery copy. */
export function videoFileName(at: number) {
  const d = new Date(at)
  const two = (n: number) => String(n).padStart(2, '0')
  return `Motivance-session-${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}.mp4`
}

/** The refusals the server names, in the patient's words (videoRefusal on Android). Anything else is a plain failure. */
export function shareRefusalKey(error: unknown) {
  const message = (error as { message?: string } | null)?.message ?? ''
  if (message.includes('video_session_missing')) return 'recording.errorUploading'
  if (message.includes('video_unavailable')) return 'recording.errorNoTherapist'
  if (message.includes('video_already_shared')) return 'recording.errorAlready'
  if (message.includes('video_too_large')) return 'recording.errorTooLarge'
  if (message.includes('video_rate_limited')) return 'recording.errorRate'
  if (error instanceof PrepareError) return 'recording.errorPrepare'
  return 'recording.errorFailed'
}

/** The video could not be made ready to send in this browser. */
export class PrepareError extends Error {}
