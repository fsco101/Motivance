import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bookingFailureKey, loadMyBookings, requestBooking, rescheduleMyBooking } from '../../src/data/booking'
import { loadInbox } from '../../src/data/notifications'
import { createUser, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

describe('moving a session on the local backend', () => {
  const tag = randomUUID().slice(0, 8)
  let patient: TestUser
  let therapist: TestUser
  let scheduler: TestUser
  let day: string
  let booking: string

  const at = (hour: number) => `${day}T${String(hour).padStart(2, '0')}:00:00+08:00`

  beforeAll(async () => {
    ;[patient, therapist, scheduler] = await Promise.all([createUser(['patient'], `Ana ${tag}`), createUser(['therapist'], `Zed ${tag}`), createUser(['scheduler'], `Sol ${tag}`)])
    day = sql(`select d::date from generate_series(current_date+42,current_date+58,interval '1 day') d
 where extract(isodow from d)<6 and not exists(select 1 from public.center_holidays h where d::date between h.starts_on and h.ends_on) order by d limit 1`)
    booking = (await requestBooking(await signedIn(patient), randomUUID(), at(9))).id
    const { error } = await (await signedIn(scheduler)).rpc('scheduler_confirm', { p_booking: booking, p_therapist: therapist.id })
    if (error) throw error
  })
  afterAll(() => removeUsers([patient, therapist, scheduler]))

  const mine = async () => (await loadMyBookings(await signedIn(patient))).find((item) => item.id === booking)!

  it('reads whether a session can be moved', async () => {
    expect(await mine()).toMatchObject({ canReschedule: true, reschedulesLeft: 2 })
    expect((await mine()).rescheduleUntil).toBeTruthy()
  })

  it('moves it, back to Pending, and tells the people concerned', async () => {
    await rescheduleMyBooking(await signedIn(patient), booking, at(10))
    expect(await mine()).toMatchObject({ status: 'pending', therapist: `Zed ${tag}`, reschedulesLeft: 1 })
    expect((await mine()).previousStartsAt).toBeTruthy()
    for (const person of [scheduler, therapist]) {
      const { rows } = await loadInbox(await signedIn(person))
      expect(rows.find((note) => note.kind === 'patient_rescheduled')).toMatchObject({ patient: `Ana ${tag}` })
    }
  })

  it('says why a move is refused', async () => {
    await rescheduleMyBooking(await signedIn(patient), booking, at(11))
    expect(await mine()).toMatchObject({ canReschedule: false, reschedulesLeft: 0 })
    const failure = await rescheduleMyBooking(await signedIn(patient), booking, at(12)).catch((error: unknown) => error)
    expect(bookingFailureKey(failure)).toBe('booking.errors.reschedule_limit')
  })

  it('refuses staff', async () => {
    const failure = await rescheduleMyBooking(await signedIn(therapist), booking, at(12)).catch((error: unknown) => error)
    expect(bookingFailureKey(failure)).toBe('errors.forbidden')
  })
})
