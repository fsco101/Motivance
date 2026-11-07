import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

type Db = SupabaseClient<Database>

export type NotificationKind =
  | 'confirmed' | 'rejected' | 'cancelled' | 'rescheduled' | 'therapist_changed' | 'returned_to_pending'
  | 'session_assigned' | 'session_moved' | 'session_cancelled' | 'session_removed'
  | 'request_received' | 'patient_cancelled' | 'needs_therapist' | 'reminder' | 'session_reminder' | 'place_open' | 'patient_rescheduled'

/** Facts rather than sentences: the text is written here, so it follows the reader's language. */
export type AppNotification = {
  id: string; kind: NotificationKind; reference: string; startsAt: string; endsAt: string; previousStartsAt: string | null
  patient: string | null; therapist: string | null; reason: string | null; readAt: string | null; createdAt: string
}
export type Inbox = { unread: number; rows: AppNotification[] }

type RawNotification = {
  id: string; kind: NotificationKind; read_at: string | null; created_at: string
  data: { reference_no?: string; starts_at: string; ends_at: string; previous_starts_at?: string | null; patient_name?: string | null; therapist_name?: string | null; reason?: string | null }
}

export const decodeNotification = (row: RawNotification): AppNotification => ({
  id: row.id, kind: row.kind, reference: row.data.reference_no ?? '', startsAt: row.data.starts_at, endsAt: row.data.ends_at, previousStartsAt: row.data.previous_starts_at ?? null,
  patient: row.data.patient_name ?? null, therapist: row.data.therapist_name ?? null, reason: row.data.reason ?? null, readAt: row.read_at, createdAt: row.created_at,
})

// The bell is on every page, so this file is in the first download. It checks errors itself because the shared helper lives
// in workspace.ts, and importing that pulls the exercise catalogue in with it.
export async function loadInbox(db: Db): Promise<Inbox> {
  const { data, error } = await db.rpc('my_notifications', {})
  if (error) throw error
  const { unread, rows } = data as unknown as { unread: number; rows: RawNotification[] }
  return { unread, rows: rows.map(decodeNotification) }
}

/** Email has no app to choose its language, so the server is told the reader's. */
export async function saveLanguage(db: Db, language: string) {
  const { error } = await db.rpc('set_my_language', { p_language: language === 'fil' ? 'fil' : 'en' })
  if (error) throw error
}

/** With no list, everything. The server only ever touches the caller's own. */
export async function markRead(db: Db, ids?: readonly string[]) {
  const { data, error } = await db.rpc('mark_notifications_read', { p_ids: ids ? [...ids] : undefined })
  if (error) throw error
  return data as number
}
