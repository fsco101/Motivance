import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bookingFailureKey, requestBooking } from '../../src/data/booking'
import {
  assignTherapist, bulkReject, cancelBooking, confirmBooking, loadDetail, loadRequests, loadStaffAvailability, loadTherapists, NO_FILTERS, rejectBooking, rescheduleBooking, type RequestSort,
} from '../../src/data/scheduler'
import { createUser, link, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

const NEWEST: RequestSort = { key: 'created_at', direction: 'desc' }
const manila = (date: string, hour: number) => `${date}T${String(hour).padStart(2, '0')}:00:00+08:00`
const workingDay = (after: number) => sql(`select d::date from generate_series(current_date+${after},current_date+55,interval '1 day') d
 where extract(isodow from d)<6 and not exists(select 1 from public.center_holidays h where d::date between h.starts_on and h.ends_on) order by d limit 1`)

describe('scheduling on the local backend', () => {
  const tag = randomUUID().slice(0, 8)
  let scheduler: TestUser
  let linked: TestUser
  let other: TestUser
  let ana: TestUser
  let ben: TestUser
  const search = { ...NO_FILTERS, search: tag }

  beforeAll(async () => {
    ;[scheduler, linked, other, ana, ben] = await Promise.all([
      createUser(['scheduler'], `Sol ${tag}`), createUser(['therapist'], `Zed ${tag}`), createUser(['therapist'], `Amy ${tag}`), createUser(['patient'], `Ana ${tag}`), createUser(['patient'], `Ben ${tag}`),
    ])
    await link(linked, ana)
  })
  afterAll(() => removeUsers([scheduler, linked, other, ana, ben]))

  const request = async (person: TestUser, start: string) => requestBooking(await signedIn(person), randomUUID(), start)

  it('refuses everyone else', async () => {
    for (const person of [ana, linked]) {
      const failure = await loadRequests(await signedIn(person), NO_FILTERS, NEWEST, 0).catch((error: unknown) => error)
      expect(bookingFailureKey(failure)).toBe('errors.forbidden')
    }
  })

  it('searches, filters, sorts and pages on the server', async () => {
    const db = await signedIn(scheduler)
    const first = await request(ana, manila(workingDay(30), 9))
    const second = await request(ben, manila(workingDay(31), 10))
    const found = await loadRequests(db, search, { key: 'patient', direction: 'desc' }, 0)
    expect(found.total).toBe(2)
    expect(found.rows.map((row) => row.id)).toEqual([second.id, first.id])
    expect(found.rows[1]).toMatchObject({ patient: `Ana ${tag}`, status: 'pending', therapist: null })
    expect((await loadRequests(db, { ...NO_FILTERS, search: first.reference }, NEWEST, 0)).rows.map((row) => row.id)).toEqual([first.id])
    expect((await loadRequests(db, { ...search, status: 'confirmed' }, NEWEST, 0)).total).toBe(0)
    expect((await loadRequests(db, search, NEWEST, 5)).rows).toEqual([])
    expect((await loadRequests(db, search, NEWEST, 5)).total).toBe(2)
  })

  it('lists a linked therapist first, and marks who is busy', async () => {
    const db = await signedIn(scheduler)
    const [row] = (await loadRequests(db, { ...search, search: `Ana ${tag}` }, NEWEST, 0)).rows
    const choices = await loadTherapists(db, row!.id)
    const ids = choices.map((choice) => choice.id)
    expect(ids.indexOf(linked.id)).toBeLessThan(ids.indexOf(other.id))
    expect(choices.find((choice) => choice.id === linked.id)).toMatchObject({ linked: true, busy: false })
    await confirmBooking(db, row!.id, linked.id)
    const [ben_] = (await loadRequests(db, { ...search, search: `Ben ${tag}` }, NEWEST, 0)).rows
    expect((await loadTherapists(db, ben_!.id, row!.startsAt)).find((choice) => choice.id === linked.id)?.busy).toBe(true)
  })

  it('confirms, changes the therapist, reschedules and cancels, and keeps the history', async () => {
    const db = await signedIn(scheduler)
    const [row] = (await loadRequests(db, { ...search, search: `Ana ${tag}` }, NEWEST, 0)).rows
    await assignTherapist(db, row!.id, other.id)
    const month = workingDay(33).slice(0, 7)
    const { days } = await loadStaffAvailability(db, month)
    const free = days.flatMap((day) => day.slots).find((slot) => slot.remaining > 0 && slot.startsAt > row!.endsAt)
    await rescheduleBooking(db, row!.id, free!.startsAt, other.id)
    await cancelBooking(db, row!.id, 'Patient travelling')
    const detail = await loadDetail(db, row!.id)
    expect(detail.events.map((event) => event.action)).toEqual(['cancelled', 'rescheduled', 'therapist_changed', 'confirmed', 'requested'])
    expect(detail.events[0]).toMatchObject({ actorRole: 'scheduler', actor: `Sol ${tag}`, reason: 'Patient travelling' })
  })

  it('rejects one request, or several at once', async () => {
    const db = await signedIn(scheduler)
    const [ben_] = (await loadRequests(db, { ...search, search: `Ben ${tag}` }, NEWEST, 0)).rows
    await rejectBooking(db, ben_!.id, 'Too far away')
    const failure = await rejectBooking(db, ben_!.id, 'Again').catch((error: unknown) => error)
    expect(bookingFailureKey(failure)).toBe('booking.errors.state')
    const a = await request(ana, manila(workingDay(34), 9))
    const b = await request(ben, manila(workingDay(34), 10))
    await confirmBooking(db, a.id, other.id)
    expect(await bulkReject(db, [a.id, b.id], 'Outdated request')).toBe(1)
    const rows = (await loadRequests(db, search, NEWEST, 0)).rows
    expect(rows.find((row) => row.id === a.id)?.status).toBe('confirmed')
    expect(rows.find((row) => row.id === b.id)?.status).toBe('rejected')
  })
})
