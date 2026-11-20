import { shareSessionVideo, startSessionVideo, uploadVideoFile, type SessionVideo } from '@/data/sessionVideos'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/data/database.types'
import { PrepareError, SESSION_VIDEO, sharePlan } from './plan'
import type { RecordedVideo } from './recorder'

/** A recording made ready to share: a standard MP4 at 480p of at most its first five minutes, and its preview. */
export interface ShareDraft { file: Blob; preview: Blob; width: number; height: number; durationMs: number }

/**
 * Makes the recording smaller for sharing with Mediabunny, which decodes and encodes with the browser's WebCodecs: 480p,
 * the first five minutes, about 500 kbps, written as an ordinary MP4 that every player opens. `onProgress` goes from 0 to 1.
 */
export async function prepareForSharing(video: RecordedVideo, onProgress: (share: number) => void = () => undefined): Promise<ShareDraft> {
  if (!video.preview) throw new PrepareError('no_preview')
  let mb: typeof import('mediabunny')
  try { mb = await import('mediabunny') } catch (error) { throw new PrepareError(String(error)) }
  try {
    const input = new mb.Input({ source: new mb.BlobSource(video.blob), formats: mb.ALL_FORMATS })
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new PrepareError('no_video')
    const seconds = await input.computeDuration()
    const plan = sharePlan(track.displayWidth, track.displayHeight, Math.max(1, Math.round(seconds * 1000)))
    const target = new mb.BufferTarget()
    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target })
    const conversion = await mb.Conversion.init({
      input, output,
      video: { width: plan.width, height: plan.height, fit: 'contain', codec: 'avc', bitrate: SESSION_VIDEO.bits, forceTranscode: true },
      audio: { discard: true },
      trim: { start: 0, end: plan.durationMs / 1000 },
      showWarnings: false,
    })
    if (!conversion.isValid) throw new PrepareError('conversion_invalid')
    conversion.onProgress = (progress) => onProgress(Math.min(Math.max(progress, 0), 1))
    await conversion.execute()
    const file = new Blob([target.buffer!], { type: 'video/mp4' })
    if (file.size > SESSION_VIDEO.bytes) throw new Error('video_too_large')
    onProgress(1)
    return { file, preview: video.preview, width: plan.width, height: plan.height, durationMs: plan.durationMs }
  } catch (error) {
    if (error instanceof PrepareError || (error as Error).message === 'video_too_large') throw error
    throw new PrepareError(String(error))
  }
}

/**
 * Shares one prepared video with the therapist, in Android's steps: the server agrees to the files and names where they go,
 * both are stored, then it is shared for 15 days. `onProgress` covers the upload, from 0.8 to 1.
 */
export async function shareDraft(db: SupabaseClient<Database>, id: string, sessionId: string, draft: ShareDraft, onProgress: (share: number) => void = () => undefined): Promise<SessionVideo> {
  const places = await startSessionVideo(db, id, sessionId, draft.width, draft.height, Math.max(1, draft.durationMs))
  await uploadVideoFile(db, places.mediaPath, draft.file, 'video/mp4')
  onProgress(0.95)
  await uploadVideoFile(db, places.previewPath, draft.preview, 'image/jpeg')
  const shared = await shareSessionVideo(db, id)
  onProgress(1)
  return shared
}
