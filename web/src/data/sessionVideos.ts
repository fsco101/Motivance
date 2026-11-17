import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

type Db = SupabaseClient<Database>

/** Session videos live apart from chat media, in their own private bucket (#129). */
export const VIDEO_BUCKET = 'session-videos'
/** A link to watch is good for five minutes, as chat links are. */
export const VIDEO_LINK_SECONDS = 300

/** A session video the patient chose to share. The phone keeps its own copy; this one is gone after 15 days or when they stop. */
export type SessionVideo = {
  id: string; sessionId: string; patientId: string; therapistId: string; width: number; height: number; durationMs: number
  mediaPath: string; previewPath: string; sharedAt: string; expiresAt: string
}

type RawVideo = {
  id: string; session_id: string; patient_id: string; therapist_id: string; width: number; height: number; duration_ms: number
  media_path: string; preview_path: string; shared_at: string | null; expires_at: string | null
}

export const decodeVideo = (row: RawVideo): SessionVideo => ({
  id: row.id, sessionId: row.session_id, patientId: row.patient_id, therapistId: row.therapist_id, width: row.width, height: row.height,
  durationMs: row.duration_ms, mediaPath: row.media_path, previewPath: row.preview_path, sharedAt: row.shared_at ?? '', expiresAt: row.expires_at ?? '',
})

/** The videos shared for one patient. Row-level security shows only live ones, and only to the patient and the exercise's therapist. */
export async function loadSessionVideos(db: Db, patientId: string) {
  const { data, error } = await db.from('session_videos')
    .select('id,session_id,patient_id,therapist_id,width,height,duration_ms,media_path,preview_path,shared_at,expires_at').eq('patient_id', patientId)
  if (error) throw error
  return (data as RawVideo[]).map(decodeVideo)
}

/** A short-lived link to watch, issued only while the video is shared. */
export async function videoLink(db: Db, path: string, seconds = VIDEO_LINK_SECONDS) {
  const { data, error } = await db.storage.from(VIDEO_BUCKET).createSignedUrl(path, seconds)
  if (error) throw error
  return data.signedUrl
}

/** The patient changes their mind: the server copy goes, and nobody can open it again. */
export async function stopSharingVideo(db: Db, id: string) {
  const { error } = await db.rpc('stop_sharing_session_video', { p_id: id })
  if (error) throw error
}

/** The phone's steps, kept here for the tests: agree on the places, store both files, then share. */
export async function startSessionVideo(db: Db, id: string, sessionId: string, width: number, height: number, durationMs: number) {
  const { data, error } = await db.rpc('start_session_video', { p_id: id, p_session: sessionId, p_width: width, p_height: height, p_duration_ms: durationMs })
  if (error) throw error
  const places = data as unknown as { media_path: string; preview_path: string }
  return { mediaPath: places.media_path, previewPath: places.preview_path }
}

export async function uploadVideoFile(db: Db, path: string, file: Blob, contentType: string) {
  const typed = file.type === contentType ? file : new Blob([file], { type: contentType })
  const { error } = await db.storage.from(VIDEO_BUCKET).upload(path, typed, { contentType, upsert: false })
  if (error && !/exists|duplicate/i.test(error.message)) throw error
}

export async function shareSessionVideo(db: Db, id: string) {
  const { data, error } = await db.rpc('share_session_video', { p_id: id })
  if (error) throw error
  // A file over its limit is refused and removed, and the server says so in the answer.
  const result = data as unknown as RawVideo & { refused?: string }
  if (result.refused) throw Object.assign(new Error(result.refused), { message: result.refused })
  return decodeVideo(result)
}
