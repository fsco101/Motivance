import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bookingFailureKey, joinWaitlist, leaveWaitlist, loadAvailability, loadMyWaitlist, requestBooking } from '../../src/data/booking'
import { loadInbox } from '../../src/data/notifications'
import { createUser, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

describe('the waitlist on the local backend', () => {
  const tag = randomUUID().slice(0, 8)
  let holders: TestUser[]
  let patient: TestUser
  let staff: TestUser
  let day: string
  let at: string

  beforeAll(async () => {
    const people = await Promise.all([1, 2, 3, 4].map((index) => createUser(['patient'], `Holder ${index} ${tag}`)))
    patient = people.pop()!
    holders = people
    staff = await createUser(['therapist'], `Staff ${tag}`)
    // Past the other files' dates, because every file shares one calendar and one capacity.
    day = sql(`select d::date from generate_series(current_date+38,current_date+55,interval '1 day') d
 where extract(isodow from d)<6 and not exists(select 1 from public.center_holidays h where d::date between h.starts_on and h.ends_on) order by d limit 1`)
    at = `${day}T16:00:00+08:00`
    for (const holder of holders) await requestBooking(await signedIn(holder), randomUUID(), at)
  })
  afterAll(() => removeUsers([...holders, patient, staff]))

  const slot = async (db: Awaited<ReturnType<typeof signedIn>>) => {
    const { days } = await loadAvailability(db, day.slice(0, 7))
    return days.find((item) => item.date === day)!.slots.find((item) => new Date(item.startsAt).getTime() === new Date(at).getTime())!
  }

  it('joins a full time, once, and the calendar says so', async () => {
    const db = await signedIn(patient)
    await joinWaitlist(db, at)
    await joinWaitlist(db, at)
    const entries = await loadMyWaitlist(db)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ open: false })
    expect(await slot(db)).toMatchObject({ remaining: 0, waiting: true })
  })

  it('hears when a place opens, with no booking behind the news', async () => {
    const db = await signedIn(patient)
    const holder = await signedIn(holders[0]!)
    const { data } = await holder.rpc('my_bookings')
    const mine = (data as unknown as Array<{ id: string }>)[0]!
    await holder.rpc('cancel_my_booking', { p_booking: mine.id })
    expect((await loadMyWaitlist(db))[0]).toMatchObject({ open: true })
    const { rows } = await loadInbox(db)
    expect(rows[0]).toMatchObject({ kind: 'place_open', reference: '' })
    expect(new Date(rows[0]!.startsAt!).getTime()).toBe(new Date(at).getTime())
  })

  it('leaves the list on booking the place', async () => {
    const db = await signedIn(patient)
    await requestBooking(db, randomUUID(), at)
    expect(await loadMyWaitlist(db)).toEqual([])
    expect(await slot(db)).toMatchObject({ mine: true, waiting: false })
  })

  it('leaves on request, and says why a time with places cannot be joined', async () => {
    const db = await signedIn(holders[0]!)
    await joinWaitlist(db, at)
    await leaveWaitlist(db, at)
    expect(await loadMyWaitlist(db)).toEqual([])
    const spare = `${day}T15:00:00+08:00`
    expect(bookingFailureKey(await joinWaitlist(db, spare).catch((error: unknown) => error))).toBe('booking.errors.not_full')
  })

  it('refuses staff', async () => {
    const failure = await joinWaitlist(await signedIn(staff), at).catch((error: unknown) => error)
    expect(bookingFailureKey(failure)).toBe('errors.forbidden')
  })
})
