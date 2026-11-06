import { describe, expect, it } from 'vitest'
import { addDays, bookingFailureKey, decodeAvailability, decodeBooking, isStale, isUpcoming, monthRange, nextBooking, shiftMonth, todayAt, upcomingBookings, type Booking, type RawBooking } from './booking'

const row = (extra: Partial<RawBooking> = {}): RawBooking => ({
  id: 'b1', reference_no: 'BK-2026-000001', status: 'pending', status_reason: null, starts_at: '2026-12-07T01:00:00+00:00', ends_at: '2026-12-07T02:00:00+00:00',
  previous_starts_at: null, therapist_name: null, ...extra,
})

describe('months', () => {
  it('finds the last day, including in a leap year', () => {
    expect(monthRange('2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-30' })
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
  })

  it('moves across a year', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2027-01', -1)).toBe('2026-12')
  })
})

describe('adding days', () => {
  it('crosses a month and a year', () => {
    expect(addDays('2026-11-06', 60)).toBe('2027-01-05')
    expect(addDays('2026-11-06', 0)).toBe('2026-11-06')
  })
})

describe('today at the center', () => {
  it('follows Manila rather than the device', () => {
    expect(todayAt('Asia/Manila', new Date('2026-11-06T20:00:00Z'))).toBe('2026-11-07')
    expect(todayAt('America/New_York', new Date('2026-11-07T02:00:00Z'))).toBe('2026-11-06')
  })
})

describe('availability', () => {
  it('reads each date and its slots', () => {
    const { timeZone, days } = decodeAvailability({ time_zone: 'Asia/Manila', days: [{ date: '2026-12-07', status: 'open', holiday: null, slots: [{ starts_at: 'a', ends_at: 'b', remaining: 2, mine: true }] }] })
    expect(timeZone).toBe('Asia/Manila')
    expect(days[0]?.slots[0]).toEqual({ startsAt: 'a', endsAt: 'b', remaining: 2, mine: true })
  })
})

describe('bookings', () => {
  const at = (start: string, status: Booking['status'] = 'confirmed') => decodeBooking(row({ id: start, status, starts_at: start, ends_at: start.replace('01:00', '02:00') }))
  const now = new Date('2026-12-01T00:00:00Z').getTime()

  it('fills in what only the patient\'s list carries', () => {
    expect(decodeBooking(row())).toMatchObject({ location: '', cancelUntil: null, canCancel: false, therapist: null })
    expect(decodeBooking(row({ location: 'Quezon City', can_cancel: true, cancel_until: 'x', therapist_name: 'Dana' }))).toMatchObject({ location: 'Quezon City', canCancel: true, cancelUntil: 'x', therapist: 'Dana' })
  })

  it('counts only active bookings still to come as upcoming', () => {
    expect(isUpcoming(at('2026-12-07T01:00:00Z'), now)).toBe(true)
    expect(isUpcoming(at('2026-12-07T01:00:00Z', 'cancelled'), now)).toBe(false)
    expect(isUpcoming(at('2026-11-07T01:00:00Z'), now)).toBe(false)
  })

  it('picks the soonest session, whatever order they arrive in', () => {
    const list = [at('2026-12-09T01:00:00Z'), at('2026-12-07T01:00:00Z'), at('2026-11-07T01:00:00Z'), at('2026-12-02T01:00:00Z', 'rejected')]
    expect(nextBooking(list, now)?.id).toBe('2026-12-07T01:00:00Z')
    expect(nextBooking([], now)).toBeNull()
  })

  it('lists upcoming sessions soonest first, even across time offsets', () => {
    const list = [at('2026-12-14T01:00:00Z'), at('2026-12-07T01:00:00Z'), at('2026-12-07T09:00:00+08:00'.replace('09:00', '08:00')), at('2026-11-07T01:00:00Z')]
    expect(upcomingBookings(list, now).map((booking) => booking.id)).toEqual(['2026-12-07T08:00:00+08:00', '2026-12-07T01:00:00Z', '2026-12-14T01:00:00Z'])
  })
})

describe('a refused booking', () => {
  it('counts as stale only when the booking itself has changed', () => {
    expect(isStale({ message: 'booking_state' })).toBe(true)
    expect(isStale({ message: 'booking_unavailable' })).toBe(true)
    expect(isStale({ message: 'booking_therapist_busy' })).toBe(false)
    expect(isStale(null)).toBe(false)
  })

  it('uses its own wording', () => {
    expect(bookingFailureKey({ message: 'booking_full' })).toBe('booking.errors.full')
    expect(bookingFailureKey({ message: 'booking_too_soon' })).toBe('booking.errors.too_soon')
  })

  it('falls back to the ordinary failures', () => {
    expect(bookingFailureKey({ code: '42501' })).toBe('errors.forbidden')
    expect(bookingFailureKey(new Error('Something else'))).toBe('errors.request')
  })
})
