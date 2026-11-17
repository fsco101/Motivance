import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

type Db = SupabaseClient<Database>

export const BOOKING_KINDS = [
  'confirmed', 'rejected', 'cancelled', 'rescheduled', 'therapist_changed', 'returned_to_pending',
  'session_assigned', 'session_moved', 'session_cancelled', 'session_removed',
  'request_received', 'patient_cancelled', 'needs_therapist', 'reminder', 'session_reminder', 'place_open', 'patient_rescheduled',
  'series_booked', 'series_assigned', 'series_cancelled', 'session_series_cancelled',
] as const
/** Not about one session, so these have no time of their own. */
export const CARE_KINDS = ['plan_updated', 'session_finished', 'practice_reminder', 'patient_inactive', 'care_linked', 'care_unlinked', 'patient_linked', 'patient_unlinked', 'chat_message', 'exercise_missed'] as const
export type NotificationKind = (typeof BOOKING_KINDS)[number] | (typeof CARE_KINDS)[number]
const KNOWN = new Set<string>([...BOOKING_KINDS, ...CARE_KINDS])

/** Facts rather than sentences: the text is written here, so it follows the reader's language. */
export type AppNotification = {
  id: string; kind: NotificationKind; reference: string; startsAt: string | null; endsAt: string | null; previousStartsAt: string | null
  patient: string | null; therapist: string | null; reason: string | null; readAt: string | null; createdAt: string
  /** A weekly course is one notification, so it says how many sessions and when the last one is. */
  sessions: number; lastStartsAt: string | null
  /** The other person it is about, read when the bell is, so a removed photo leaves old notifications too. */
  subjectId: string | null; subjectName: string | null; subjectPhoto: string | null
  /** A finished session's repetitions, and how many days an inactive patient has been quiet. */
  completed: number | null; target: number | null; days: number | null
  /** For a new message: which conversation, and who wrote. Never the words. */
  conversationId: string | null; sender: string | null
  /** A missed exercise day: the calendar day, and how many of the exercises due were done. */
  day: string | null; due: number | null; done: number | null
}
export type Inbox = { unread: number; rows: AppNotification[] }

type RawNotification = {
  id: string; kind: string; read_at: string | null; created_at: string; subject_id?: string | null; subject_name?: string | null; subject_photo?: string | null
  data: {
    reference_no?: string; starts_at?: string; ends_at?: string; previous_starts_at?: string | null; patient_name?: string | null; therapist_name?: string | null; reason?: string | null
    sessions?: number; last_starts_at?: string | null; completed?: number; target?: number; days?: number; conversation_id?: string; sender_name?: string | null
    day?: string; due?: number; done?: number
  }
}

export const decodeNotification = (row: RawNotification & { kind: NotificationKind }): AppNotification => ({
  id: row.id, kind: row.kind, reference: row.data.reference_no ?? '', startsAt: row.data.starts_at ?? null, endsAt: row.data.ends_at ?? null, previousStartsAt: row.data.previous_starts_at ?? null,
  patient: row.data.patient_name ?? null, therapist: row.data.therapist_name ?? null, reason: row.data.reason ?? null, readAt: row.read_at, createdAt: row.created_at,
  sessions: row.data.sessions ?? 0, lastStartsAt: row.data.last_starts_at ?? null,
  subjectId: row.subject_id ?? null, subjectName: row.subject_name ?? null, subjectPhoto: row.subject_photo ?? null,
  completed: row.data.completed ?? null, target: row.data.target ?? null, days: row.data.days ?? null,
  conversationId: row.data.conversation_id ?? null, sender: row.data.sender_name ?? null,
  day: row.data.day ?? null, due: row.data.due ?? null, done: row.data.done ?? null,
})

/** A kind this version does not know is left out, so a newer server never shows a blank row. */
export const decodeInbox = (unread: number, rows: RawNotification[]): Inbox => ({
  unread, rows: rows.filter((row): row is RawNotification & { kind: NotificationKind } => KNOWN.has(row.kind)).map(decodeNotification),
})

export type NotificationWorkspace = 'patient' | 'therapist' | 'scheduler'

/** Where opening a notification goes: wherever the thing it describes can be seen. Mirrors the Android bell. */
export function notificationTarget(note: AppNotification, workspace: NotificationWorkspace): string {
  switch (note.kind) {
    case 'plan_updated': case 'practice_reminder': return '/patient/exercises'
    case 'care_linked': case 'care_unlinked': return '/patient'
    case 'session_finished': case 'patient_inactive': case 'patient_linked': case 'exercise_missed':
      return note.subjectId ? `/therapist/patients/${note.subjectId}` : '/therapist/patients'
    case 'patient_unlinked': return '/therapist/patients'
    case 'chat_message': {
      const base = workspace === 'patient' ? '/patient' : '/therapist'
      return note.conversationId ? `${base}/messages/${note.conversationId}` : `${base}/messages`
    }
    default: return { patient: '/patient/bookings', therapist: '/therapist/schedule', scheduler: '/scheduler/requests' }[workspace]
  }
}

// The bell is on every page, so this file is in the first download. It checks errors itself because the shared helper lives
// in workspace.ts, and importing that pulls the exercise catalogue in with it.
export async function loadInbox(db: Db): Promise<Inbox> {
  const { data, error } = await db.rpc('my_notifications', {})
  if (error) throw error
  const { unread, rows } = data as unknown as { unread: number; rows: RawNotification[] }
  return decodeInbox(unread, rows)
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
