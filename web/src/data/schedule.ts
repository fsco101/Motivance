import type { SupabaseClient } from '@supabase/supabase-js'
import { monthRange, type Attendance, type BookingStatus } from './booking'
import type { Database } from './database.types'
import { must } from './workspace'

type Db = SupabaseClient<Database>

export type ScheduleAudience = 'patient' | 'therapist'
export type ScheduleDayStatus = 'open' | 'closed' | 'holiday' | 'closure'

/** A patient's own session names the therapist. A therapist's names the patient, and says whether their record can be opened. */
export type ScheduleSession = {
  id: string; reference: string; status: BookingStatus; startsAt: string; endsAt: string; location: string
  therapist: string | null; patientId: string | null; patient: string | null; linked: boolean; attendance: Attendance | null; started: boolean
}
export type ScheduleRow = { startsAt: string; endsAt: string; session: ScheduleSession | null; onLeave: boolean }
export type ScheduleDay = { date: string; status: ScheduleDayStatus; holiday: string | null; rows: ScheduleRow[]; onLeave: boolean }
export type Schedule = { days: ScheduleDay[] }

type RawSession = {
  id: string; reference_no: string; status: BookingStatus; starts_at: string; ends_at: string; location: string | null
  therapist_name?: string | null; patient_id?: string | null; patient_name?: string | null; linked?: boolean; attendance?: Attendance | null; started?: boolean
}
type RawDay = { date: string; status: ScheduleDayStatus; holiday: string | null; on_leave?: boolean; rows: Array<{ starts_at: string; ends_at: string; session: RawSession | null; on_leave?: boolean }> }

const decodeSession = (raw: RawSession): ScheduleSession => ({
  id: raw.id, reference: raw.reference_no, status: raw.status, startsAt: raw.starts_at, endsAt: raw.ends_at, location: raw.location ?? '',
  therapist: raw.therapist_name ?? null, patientId: raw.patient_id ?? null, patient: raw.patient_name ?? null, linked: raw.linked ?? false,
  attendance: raw.attendance ?? null, started: raw.started ?? false,
})

export const decodeSchedule = (raw: { days: RawDay[] }): Schedule => ({
  days: raw.days.map((day) => ({
    date: day.date, status: day.status, holiday: day.holiday, onLeave: day.on_leave ?? false,
    rows: day.rows.map((row) => ({ startsAt: row.starts_at, endsAt: row.ends_at, session: row.session ? decodeSession(row.session) : null, onLeave: row.on_leave ?? false })),
  })),
})

export async function loadSchedule(db: Db, audience: ScheduleAudience, month: string) {
  const { from, to } = monthRange(month)
  const range = { p_from: from, p_to: to }
  const result = audience === 'patient' ? await db.rpc('my_schedule', range) : await db.rpc('therapist_schedule', range)
  return decodeSchedule(must(result) as unknown as { days: RawDay[] })
}

export const sessionsOn = (day: ScheduleDay | undefined) => day?.rows.flatMap((row) => row.session ?? []) ?? []

/** Where a month opens: the next date with a session, or today when nothing is ahead. A month with neither waits for a choice. */
export function openingDate(schedule: Schedule, today: string) {
  const next = schedule.days.find((day) => day.date >= today && sessionsOn(day).length > 0)
  return next?.date ?? (schedule.days.some((day) => day.date === today) ? today : null)
}
