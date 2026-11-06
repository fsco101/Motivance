import type { SupabaseClient } from '@supabase/supabase-js'
import type { BookingStatus } from './booking'
import type { Database } from './database.types'
import { must } from './workspace'

type Db = SupabaseClient<Database>

export type CenterSettings = {
  centerName: string; location: string; slotMinutes: number; slotCapacity: number; cancelCutoffHours: number; rescheduleCutoffHours: number
  minimumNoticeHours: number; bookingHorizonDays: number; maxActiveBookings: number; maxSelfReschedules: number
}
/** ISO weekdays, so 1 is Monday. Times are the center's own, as HH:MM. */
export type CenterDay = { weekday: number; isOpen: boolean; opensAt: string; closesAt: string }
export type HolidayKind = 'regular' | 'special' | 'seasonal'
export type Holiday = { id: string; name: string; kind: HolidayKind; startsOn: string; endsOn: string }
export type Closure = { id: string; startsAt: string; endsAt: string; allDay: boolean; reason: string }
export type TimeOff = { id: string; therapistId: string; therapist: string; startsAt: string; endsAt: string; reason: string }
export type CenterCalendar = { settings: CenterSettings; hours: CenterDay[]; holidays: Holiday[]; closures: Closure[]; timeOff: TimeOff[] }

/** A session a closure or holiday would strand. It cannot be saved until each has a decision. */
export type AffectedBooking = { id: string; reference: string; status: BookingStatus; startsAt: string; endsAt: string; patient: string; therapistId: string | null; therapist: string | null }
export type Resolution =
  | { booking: string; action: 'cancel'; reason: string }
  | { booking: string; action: 'reschedule'; starts_at: string; therapist: string }
  | { booking: string; action: 'assign'; therapist: string }

export type HolidayDraft = Omit<Holiday, 'id'> & { id: string | null }
export type ClosureDraft = Omit<Closure, 'id'> & { id: string | null }
export type TimeOffDraft = Omit<TimeOff, 'id' | 'therapist'> & { id: string | null }

/** Asia/Manila keeps one offset all year, so a date and time at the center has a single instant. */
export const centerInstant = (date: string, time = '00:00') => `${date}T${time}:00+08:00`
const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
/** The instants a run of whole days covers, from midnight on the first to midnight after the last. */
export const dayRange = (from: string, through: string) => ({ startsAt: centerInstant(from), endsAt: centerInstant(nextDay(through)) })

const time = (value: string) => value.slice(0, 5)

type RawTimeOff = { id: string; therapist_id: string; therapist_name: string; starts_at: string; ends_at: string; reason: string }

export async function loadCalendar(db: Db, today: string): Promise<CenterCalendar> {
  const [settings, hours, holidays, closures, timeOff] = await Promise.all([
    db.from('center_settings').select('*').single(),
    db.from('center_hours').select('*').order('weekday'),
    db.from('center_holidays').select('id,name,kind,starts_on,ends_on').gte('ends_on', today).order('starts_on'),
    db.from('center_closures').select('id,starts_at,ends_at,all_day,reason').gte('ends_at', centerInstant(today)).order('starts_at'),
    db.rpc('scheduler_time_off'),
  ])
  for (const { error } of [settings, hours, holidays, closures, timeOff]) if (error) throw error
  const row = settings.data!
  return {
    settings: {
      centerName: row.center_name, location: row.location, slotMinutes: row.slot_minutes, slotCapacity: row.slot_capacity, cancelCutoffHours: row.cancel_cutoff_hours,
      rescheduleCutoffHours: row.reschedule_cutoff_hours, minimumNoticeHours: row.minimum_notice_hours, bookingHorizonDays: row.booking_horizon_days,
      maxActiveBookings: row.max_active_bookings, maxSelfReschedules: row.max_self_reschedules,
    },
    hours: hours.data!.map((day) => ({ weekday: day.weekday, isOpen: day.is_open, opensAt: time(day.opens_at), closesAt: time(day.closes_at) })),
    holidays: holidays.data!.map((day) => ({ id: day.id, name: day.name, kind: day.kind as HolidayKind, startsOn: day.starts_on, endsOn: day.ends_on })),
    closures: closures.data!.map((day) => ({ id: day.id, startsAt: day.starts_at, endsAt: day.ends_at, allDay: day.all_day, reason: day.reason })),
    timeOff: (timeOff.data as unknown as RawTimeOff[]).map((item) => ({ id: item.id, therapistId: item.therapist_id, therapist: item.therapist_name, startsAt: item.starts_at, endsAt: item.ends_at, reason: item.reason })),
  }
}

type RawAffected = { id: string; reference_no: string; status: BookingStatus; starts_at: string; ends_at: string; patient_name: string | null; therapist_id: string | null; therapist_name: string | null }

/** With a therapist, only their sessions: the center stays open, so nobody else's are affected. */
export async function loadImpact(db: Db, startsAt: string, endsAt: string, therapist?: string): Promise<AffectedBooking[]> {
  const rows = must(await db.rpc('scheduler_calendar_impact', { p_starts: startsAt, p_ends: endsAt, p_therapist: therapist })) as unknown as RawAffected[]
  return rows.map((row) => ({ id: row.id, reference: row.reference_no, status: row.status, startsAt: row.starts_at, endsAt: row.ends_at, patient: row.patient_name ?? '', therapistId: row.therapist_id, therapist: row.therapist_name }))
}

export const saveClosure = async (db: Db, draft: ClosureDraft, resolutions: readonly Resolution[]) => {
  must(await db.rpc('scheduler_save_closure', { p_id: draft.id as string, p_starts: draft.startsAt, p_ends: draft.endsAt, p_all_day: draft.allDay, p_reason: draft.reason, p_resolutions: [...resolutions] }))
}
export const deleteClosure = async (db: Db, id: string) => { must(await db.rpc('scheduler_delete_closure', { p_id: id })) }

export const saveHoliday = async (db: Db, draft: HolidayDraft, resolutions: readonly Resolution[]) => {
  must(await db.rpc('scheduler_save_holiday', { p_id: draft.id as string, p_name: draft.name, p_kind: draft.kind, p_starts_on: draft.startsOn, p_ends_on: draft.endsOn, p_resolutions: [...resolutions] }))
}
export const deleteHoliday = async (db: Db, id: string) => { must(await db.rpc('scheduler_delete_holiday', { p_id: id })) }

export const saveTimeOff = async (db: Db, draft: TimeOffDraft, resolutions: readonly Resolution[]) => {
  must(await db.rpc('scheduler_save_time_off', { p_id: draft.id as string, p_therapist: draft.therapistId, p_starts: draft.startsAt, p_ends: draft.endsAt, p_reason: draft.reason, p_resolutions: [...resolutions] }))
}
export const deleteTimeOff = async (db: Db, id: string) => { must(await db.rpc('scheduler_delete_time_off', { p_id: id })) }

/** Says how many sessions already booked now fall outside the hours, because those keep their time and need a person to look at them. */
export async function saveHours(db: Db, hours: readonly CenterDay[]) {
  const days = hours.map((day) => ({ weekday: day.weekday, is_open: day.isOpen, opens_at: day.opensAt, closes_at: day.closesAt }))
  return (must(await db.rpc('scheduler_save_hours', { p_hours: days })) as unknown as { outside_hours: number }).outside_hours
}

export const saveSettings = async (db: Db, settings: CenterSettings) => {
  must(await db.rpc('scheduler_save_settings', {
    p_center_name: settings.centerName, p_location: settings.location, p_slot_minutes: settings.slotMinutes, p_slot_capacity: settings.slotCapacity, p_cancel_cutoff_hours: settings.cancelCutoffHours,
    p_reschedule_cutoff_hours: settings.rescheduleCutoffHours, p_minimum_notice_hours: settings.minimumNoticeHours, p_booking_horizon_days: settings.bookingHorizonDays,
    p_max_active_bookings: settings.maxActiveBookings, p_max_self_reschedules: settings.maxSelfReschedules,
  }))
}
