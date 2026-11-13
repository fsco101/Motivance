import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { failureKey } from './errors'
import { must } from './workspace'

type Db = SupabaseClient<Database>

export const CENTER_ZONE = 'Asia/Manila'

export type DayStatus = 'open' | 'closed' | 'holiday' | 'closure' | 'past' | 'too_soon' | 'too_far'
export type Slot = { startsAt: string; endsAt: string; remaining: number; mine: boolean; waiting: boolean }
export type AvailabilityDay = { date: string; status: DayStatus; holiday: string | null; slots: Slot[] }
export type Availability = { timeZone: string; days: AvailabilityDay[] }

type RawAvailability = {
  time_zone: string
  days: Array<{ date: string; status: DayStatus; holiday: string | null; slots: Array<{ starts_at: string; ends_at: string; remaining: number; mine: boolean; waiting?: boolean }> }>
}

export function decodeAvailability(raw: RawAvailability): Availability {
  return {
    timeZone: raw.time_zone,
    days: raw.days.map((day) => ({ ...day, slots: day.slots.map((slot) => ({ startsAt: slot.starts_at, endsAt: slot.ends_at, remaining: slot.remaining, mine: slot.mine, waiting: slot.waiting ?? false })) })),
  }
}

/** The first and last date of a `YYYY-MM` month. Plain calendar arithmetic, so no time zone can move a day. */
export function monthRange(month: string) {
  const [year = 0, number = 1] = month.split('-').map(Number)
  const last = new Date(Date.UTC(year, number, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
}

export function shiftMonth(month: string, by: number) {
  const [year = 0, number = 1] = month.split('-').map(Number)
  const moved = new Date(Date.UTC(year, number - 1 + by, 1))
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, '0')}`
}

export const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

/** Today at the center, which is not always today on the device. */
export const todayAt = (zone: string, now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)

export async function loadAvailability(db: Db, month: string) {
  const { from, to } = monthRange(month)
  return decodeAvailability(must(await db.rpc('booking_availability', { p_from: from, p_to: to })) as unknown as RawAvailability)
}

/** How far ahead a patient may book, which decides how far the calendar can turn. */
export async function loadHorizonDays(db: Db) {
  const { data, error } = await db.from('center_settings').select('booking_horizon_days').single()
  if (error) throw error
  return data.booking_horizon_days
}

export type BookingStatus = 'pending' | 'confirmed' | 'rejected' | 'cancelled' | 'rescheduled'
export const ACTIVE: readonly BookingStatus[] = ['pending', 'confirmed', 'rescheduled']

export type Booking = {
  id: string; reference: string; status: BookingStatus; reason: string | null; startsAt: string; endsAt: string; previousStartsAt: string | null
  therapist: string | null; therapistPhoto: string | null; location: string; cancelUntil: string | null; canCancel: boolean; rescheduleUntil: string | null; canReschedule: boolean; reschedulesLeft: number
}

export type RawBooking = {
  id: string; reference_no: string; status: BookingStatus; status_reason: string | null; starts_at: string; ends_at: string; previous_starts_at: string | null
  therapist_name: string | null; therapist_photo?: string | null; location?: string; cancel_until?: string | null; can_cancel?: boolean; reschedule_until?: string | null; can_reschedule?: boolean; reschedules_left?: number
}

export const decodeBooking = (row: RawBooking): Booking => ({
  id: row.id, reference: row.reference_no, status: row.status, reason: row.status_reason, startsAt: row.starts_at, endsAt: row.ends_at, previousStartsAt: row.previous_starts_at,
  therapist: row.therapist_name, therapistPhoto: row.therapist_photo ?? null, location: row.location ?? '', cancelUntil: row.cancel_until ?? null, canCancel: row.can_cancel ?? false,
  rescheduleUntil: row.reschedule_until ?? null, canReschedule: row.can_reschedule ?? false, reschedulesLeft: row.reschedules_left ?? 0,
})

export async function loadMyBookings(db: Db) {
  return (must(await db.rpc('my_bookings')) as unknown as RawBooking[]).map(decodeBooking)
}

/** `request` is chosen once per attempt, so retrying after a lost response returns the same booking. */
export async function requestBooking(db: Db, request: string, startsAt: string) {
  return decodeBooking(must(await db.rpc('request_booking', { p_request: request, p_starts: startsAt })) as unknown as RawBooking)
}

export async function rescheduleMyBooking(db: Db, booking: string, startsAt: string) {
  must(await db.rpc('reschedule_my_booking', { p_booking: booking, p_starts: startsAt }))
}

export async function cancelMyBooking(db: Db, booking: string) {
  must(await db.rpc('cancel_my_booking', { p_booking: booking }))
}

export const isUpcoming = (booking: Booking, now = Date.now()) => ACTIVE.includes(booking.status) && new Date(booking.endsAt).getTime() > now

const startTime = (booking: Booking) => new Date(booking.startsAt).getTime()

/** Sessions still to come, the soonest first, whatever order they arrive in. */
export const upcomingBookings = (bookings: readonly Booking[], now = Date.now()) => bookings.filter((booking) => isUpcoming(booking, now)).sort((a, b) => startTime(a) - startTime(b))

export const nextBooking = (bookings: readonly Booking[], now = Date.now()) => upcomingBookings(bookings, now)[0] ?? null

export type Attendance = 'attended' | 'no_show'

export async function markAttendance(db: Db, booking: string, attendance: Attendance) {
  must(await db.rpc('mark_attendance', { p_booking: booking, p_attendance: attendance }))
}

/** A place in the line for a full time. Open means a place is free now, and the first to book gets it. */
export type WaitlistEntry = { id: string; startsAt: string; endsAt: string; open: boolean }

export async function loadMyWaitlist(db: Db): Promise<WaitlistEntry[]> {
  const rows = must(await db.rpc('my_waitlist')) as unknown as Array<{ id: string; starts_at: string; ends_at: string; open: boolean }>
  return rows.map((row) => ({ id: row.id, startsAt: row.starts_at, endsAt: row.ends_at, open: row.open }))
}

export async function joinWaitlist(db: Db, startsAt: string) {
  must(await db.rpc('join_waitlist', { p_starts: startsAt }))
}

export async function leaveWaitlist(db: Db, startsAt: string) {
  must(await db.rpc('leave_waitlist', { p_starts: startsAt }))
}

/** Someone else has already changed this booking, so whatever is on screen no longer applies. */
export const isStale = (error: unknown) => ['booking_state', 'booking_unavailable'].includes((error as { message?: string } | null)?.message ?? '')

/** The server refuses with a stable booking_* message, which has its own wording. Anything else is an ordinary failure. */
export function bookingFailureKey(error: unknown) {
  const message = (error as { message?: string } | null)?.message ?? ''
  return message.startsWith('booking_') ? `booking.errors.${message.slice('booking_'.length)}` : failureKey(error)
}
