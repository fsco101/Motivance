import type { SupabaseClient } from '@supabase/supabase-js'
import { decodeAvailability, monthRange, type Attendance, type Availability, type BookingStatus } from './booking'
import type { Database } from './database.types'
import { must } from './workspace'

type Db = SupabaseClient<Database>

export const PAGE_SIZE = 25

export type RequestRow = {
  id: string; reference: string; status: BookingStatus; reason: string | null; startsAt: string; endsAt: string; patientId: string; patient: string
  therapistId: string | null; therapist: string | null; attendance: Attendance | null; started: boolean; createdAt: string
}

export type RequestFilters = { search: string; status: BookingStatus | 'all'; from: string; to: string; therapist: string }
export const NO_FILTERS: RequestFilters = { search: '', status: 'all', from: '', to: '', therapist: 'all' }

export type SortKey = 'starts_at' | 'created_at' | 'reference_no' | 'status' | 'patient' | 'therapist' | 'attendance'
export type RequestSort = { key: SortKey; direction: 'asc' | 'desc' }

type RawRow = {
  id: string; reference_no: string; status: BookingStatus; status_reason: string | null; starts_at: string; ends_at: string; patient_id: string; patient_name: string | null
  therapist_id: string | null; therapist_name: string | null; attendance: Attendance | null; started?: boolean; created_at: string
}

export const decodeRow = (row: RawRow): RequestRow => ({
  id: row.id, reference: row.reference_no, status: row.status, reason: row.status_reason, startsAt: row.starts_at, endsAt: row.ends_at, patientId: row.patient_id, patient: row.patient_name ?? '',
  therapistId: row.therapist_id, therapist: row.therapist_name, attendance: row.attendance, started: row.started ?? false, createdAt: row.created_at,
})

export type ScheduleFilters = { search: string; status: 'all' | 'confirmed' | 'rescheduled'; from: string; to: string; therapist: string; patient: string; attendance: 'all' | Attendance | 'unmarked' }
export const NO_SCHEDULE_FILTERS: ScheduleFilters = { search: '', status: 'all', from: '', to: '', therapist: 'all', patient: 'all', attendance: 'all' }
export type PatientChoice = { id: string; name: string }

export const queryOf = (filters: RequestFilters, sort: RequestSort, page: number) => ({
  p_search: filters.search.trim() || undefined, p_statuses: filters.status === 'all' ? undefined : [filters.status], p_from: filters.from || undefined, p_to: filters.to || undefined,
  p_therapist: filters.therapist === 'all' ? undefined : filters.therapist, p_sort: sort.key, p_descending: sort.direction === 'desc', p_limit: PAGE_SIZE, p_offset: page * PAGE_SIZE,
})

export async function loadRequests(db: Db, filters: RequestFilters, sort: RequestSort, page: number) {
  const { rows, total } = must(await db.rpc('scheduler_bookings', queryOf(filters, sort, page))) as unknown as { rows: RawRow[]; total: number }
  return { rows: rows.map(decodeRow), total }
}

export type BookingEvent = { id: number; action: string; actorRole: string; actor: string | null; fromStatus: string | null; toStatus: string | null; toStartsAt: string | null; reason: string | null; toAttendance: Attendance | null; recordedAt: string }
export type RequestDetail = { id: string; events: BookingEvent[] }

type RawDetail = {
  id: string
  events: Array<{ id: number; action: string; actor_role: string; actor_name: string | null; from_status: string | null; to_status: string | null; to_starts_at: string | null; reason: string | null; to_attendance?: Attendance | null; recorded_at: string }>
}

export async function loadDetail(db: Db, booking: string): Promise<RequestDetail> {
  const row = must(await db.rpc('scheduler_booking_detail', { p_booking: booking })) as unknown as RawDetail
  return {
    id: row.id,
    events: row.events.map((event) => ({
      id: event.id, action: event.action, actorRole: event.actor_role, actor: event.actor_name, fromStatus: event.from_status, toStatus: event.to_status, toStartsAt: event.to_starts_at, toAttendance: event.to_attendance ?? null, reason: event.reason, recordedAt: event.recorded_at,
    })),
  }
}

export type TherapistChoice = { id: string; name: string; linked: boolean; busy: boolean; onLeave: boolean }

const scheduleQuery = (filters: ScheduleFilters, sort: RequestSort, limit: number, offset: number) => ({
  p_search: filters.search.trim() || undefined, p_statuses: filters.status === 'all' ? ['confirmed', 'rescheduled'] : [filters.status], p_from: filters.from || undefined, p_to: filters.to || undefined,
  p_therapist: filters.therapist === 'all' ? undefined : filters.therapist, p_patient: filters.patient === 'all' ? undefined : filters.patient,
  p_attendance: filters.attendance === 'all' ? undefined : filters.attendance, p_sort: sort.key, p_descending: sort.direction === 'desc', p_limit: limit, p_offset: offset,
})

async function readSchedule(db: Db, filters: ScheduleFilters, sort: RequestSort, limit: number, offset: number) {
  const { rows, total } = must(await db.rpc('scheduler_bookings', scheduleQuery(filters, sort, limit, offset))) as unknown as { rows: RawRow[]; total: number }
  return { rows: rows.map(decodeRow), total }
}

export const loadConfirmed = (db: Db, filters: ScheduleFilters, sort: RequestSort, page: number) => readSchedule(db, filters, sort, PAGE_SIZE, page * PAGE_SIZE)

/** Everything the filters match, however many pages that takes, because an export covers the whole result and not what is on screen. */
export async function loadAllConfirmed(db: Db, filters: ScheduleFilters, sort: RequestSort, chunk = 500) {
  const rows: RequestRow[] = []
  for (;;) {
    const found = await readSchedule(db, filters, sort, chunk, rows.length)
    rows.push(...found.rows)
    if (found.rows.length === 0 || rows.length >= found.total) return rows
  }
}

export const loadPatientChoices = async (db: Db) => must(await db.rpc('scheduler_schedule_patients')) as unknown as PatientChoice[]
export const loadCenterName = async (db: Db) => {
  const { data, error } = await db.from('center_settings').select('center_name').single()
  if (error) throw error
  return data.center_name
}
export const logExport = async (db: Db, format: 'xlsx' | 'pdf', rows: number) => { must(await db.rpc('scheduler_log_export', { p_format: format, p_rows: rows })) }

/** With no booking, every active therapist, for the filter. With one, those who could take it, linked ones first. */
export async function loadTherapists(db: Db, booking?: string, startsAt?: string): Promise<TherapistChoice[]> {
  const rows = must(await db.rpc('scheduler_therapists', { p_booking: booking, p_starts: startsAt })) as unknown as Array<Omit<TherapistChoice, 'onLeave'> & { on_leave: boolean }>
  return rows.map(({ on_leave, ...row }) => ({ ...row, onLeave: on_leave }))
}

export async function loadStaffAvailability(db: Db, month: string): Promise<Availability> {
  const { from, to } = monthRange(month)
  return decodeAvailability(must(await db.rpc('scheduler_availability', { p_from: from, p_to: to })) as unknown as Parameters<typeof decodeAvailability>[0])
}

export const confirmBooking = async (db: Db, booking: string, therapist: string) => { must(await db.rpc('scheduler_confirm', { p_booking: booking, p_therapist: therapist })) }
export const rejectBooking = async (db: Db, booking: string, reason: string) => { must(await db.rpc('scheduler_reject', { p_booking: booking, p_reason: reason })) }
export const rescheduleBooking = async (db: Db, booking: string, startsAt: string, therapist: string) => { must(await db.rpc('scheduler_reschedule', { p_booking: booking, p_starts: startsAt, p_therapist: therapist })) }
export const assignTherapist = async (db: Db, booking: string, therapist: string) => { must(await db.rpc('scheduler_assign_therapist', { p_booking: booking, p_therapist: therapist })) }
export const cancelBooking = async (db: Db, booking: string, reason: string) => { must(await db.rpc('scheduler_cancel', { p_booking: booking, p_reason: reason })) }
export const bulkReject = async (db: Db, bookings: readonly string[], reason: string) => must(await db.rpc('scheduler_bulk_reject', { p_bookings: [...bookings], p_reason: reason })) as number
