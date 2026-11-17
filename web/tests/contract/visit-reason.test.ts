import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bookingFailureKey, loadMyBookings, requestBooking, rescheduleMyBooking } from '../../src/data/booking'
import { loadSchedule, sessionsOn } from '../../src/data/schedule'
import { confirmBooking, createSeries, loadRequests, NO_FILTERS, rescheduleBooking } from '../../src/data/scheduler'
import { createUser, link, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

const manila = (date: string, hour: number) => `${date}T${String(hour).padStart(2, '0')}:00:00+08:00`
const workingDays = (after: number, count: number) => sql(`select d::date from generate_series(current_date+${after},current_date+58,interval '1 day') d
 where extract(isodow from d)<6 and not exists(select 1 from public.center_holidays h where d::date between h.starts_on and h.ends_on) order by d limit ${count}`).split(/\r?\n/)

describe('the reason for a visit on the local backend', () => {
  const tag = randomUUID().slice(0, 8)
  const [first, second, third] = workingDays(30, 3) as [string, string, string]
  let scheduler: TestUser
  let therapist: TestUser
  let other: TestUser
  let patient: TestUser
  let bookingId = ''

  beforeAll(async () => {
    ;[scheduler, therapist, other, patient] = await Promise.all([
      createUser(['scheduler'], `Sol ${tag}`), createUser(['therapist'], `Zed ${tag}`), createUser(['therapist'], `Amy ${tag}`), createUser(['patient'], `Ana ${tag}`),
    ])
    await link(therapist, patient)
  })
  afterAll(() => removeUsers([scheduler, therapist, other, patient]))

  it('refuses a reason too short or too long, and keeps none for a blank one', async () => {
    const db = await signedIn(patient)
    for (const reason of ['ab', 'x'.repeat(501)]) {
      const failure = await requestBooking(db, randomUUID(), manila(first, 9), reason).catch((error: unknown) => error)
      expect(bookingFailureKey(failure)).toBe('booking.errors.visit_reason')
    }
    const blank = await requestBooking(db, randomUUID(), manila(first, 15), '   ')
    expect(blank.visitReason).toBeNull()
    expect(sql(`select count(*) from public.bookings where patient_id='${patient.id}'`)).toBe('1')
  })

  it('keeps the reason as the patient wrote it, and names both people', async () => {
    const booking = await requestBooking(await signedIn(patient), randomUUID(), manila(first, 9), '  Knee pain after walking\nworse on stairs  ')
    bookingId = booking.id
    expect(booking).toMatchObject({ visitReason: 'Knee pain after walking\nworse on stairs', patient: `Ana ${tag}`, therapist: null })
    expect((await loadMyBookings(await signedIn(patient))).find((item) => item.id === bookingId)?.visitReason).toBe('Knee pain after walking\nworse on stairs')
  })

  it('shows the reason to Schedulers in the requests table', async () => {
    const { rows } = await loadRequests(await signedIn(scheduler), { ...NO_FILTERS, search: `Ana ${tag}` }, { key: 'starts_at', direction: 'asc' }, 0)
    expect(rows.find((row) => row.id === bookingId)?.visitReason).toBe('Knee pain after walking\nworse on stairs')
  })

  it('shows it to the assigned therapist and the patient on their schedules, with both faces', async () => {
    await confirmBooking(await signedIn(scheduler), bookingId, therapist.id)
    const month = first.slice(0, 7)
    const mine = sessionsOn((await loadSchedule(await signedIn(therapist), 'therapist', month)).days.find((day) => day.date === first))
    expect(mine.find((session) => session.id === bookingId)).toMatchObject({ visitReason: 'Knee pain after walking\nworse on stairs', patient: `Ana ${tag}`, therapist: `Zed ${tag}` })
    const theirs = sessionsOn((await loadSchedule(await signedIn(patient), 'patient', month)).days.find((day) => day.date === first))
    expect(theirs.find((session) => session.id === bookingId)).toMatchObject({ visitReason: 'Knee pain after walking\nworse on stairs', patient: `Ana ${tag}`, therapist: `Zed ${tag}` })
    // Another therapist sees nothing of a session that is not theirs.
    expect(sessionsOn((await loadSchedule(await signedIn(other), 'therapist', month)).days.find((day) => day.date === first))).toEqual([])
  })

  it('keeps the reason when the patient or a Scheduler moves the session', async () => {
    await rescheduleMyBooking(await signedIn(patient), bookingId, manila(second, 10))
    await rescheduleBooking(await signedIn(scheduler), bookingId, manila(third, 11), therapist.id)
    expect(sql(`select visit_reason from public.bookings where id='${bookingId}'`)).toBe('Knee pain after walking\nworse on stairs')
  })

  it('stays out of notifications, which can be read on a lock screen', () => {
    expect(sql(`select count(*) from public.notifications where booking_id='${bookingId}' and data::text ilike '%Knee pain%'`)).toBe('0')
    expect(sql(`select count(*) from public.booking_events where booking_id='${bookingId}' and coalesce(reason,'') ilike '%Knee pain%'`)).toBe('0')
  })

  it('gives a weekly course one reason for every session', async () => {
    const made = await createSeries(await signedIn(scheduler), randomUUID(), { patient: patient.id, therapist: therapist.id, startsAt: manila(first, 13), weeks: 2, reason: 'Elbow strengthening course' })
    expect(made.booked).toBeGreaterThan(0)
    expect(sql(`select count(*) from public.bookings where series_id='${made.id}' and visit_reason='Elbow strengthening course'`)).toBe(String(made.booked))
  })
})
