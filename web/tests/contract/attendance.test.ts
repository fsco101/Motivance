import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bookingFailureKey, markAttendance } from '../../src/data/booking'
import { loadSchedule } from '../../src/data/schedule'
import { loadConfirmed, loadDetail, NO_SCHEDULE_FILTERS, type RequestSort } from '../../src/data/scheduler'
import { createUser, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

const EARLIEST: RequestSort = { key: 'starts_at', direction: 'asc' }

describe('attendance on the local backend', () => {
  const tag = randomUUID().slice(0, 8)
  const search = { ...NO_SCHEDULE_FILTERS, search: `BK-ATT-${tag}` }
  let scheduler: TestUser
  let therapist: TestUser
  let other: TestUser
  let patient: TestUser
  const past = randomUUID()
  const missed = randomUUID()
  const future = randomUUID()

  beforeAll(async () => {
    ;[scheduler, therapist, other, patient] = await Promise.all([createUser(['scheduler'], `Sol ${tag}`), createUser(['therapist'], `Zed ${tag}`), createUser(['therapist'], `Amy ${tag}`), createUser(['patient'], `Ana ${tag}`)])
    sql(([[past, -50, 'P'], [missed, -26, 'M'], [future, 200, 'F']] as const).map(([id, hours, suffix]) => `insert into public.bookings(id,reference_no,patient_id,therapist_id,starts_at,ends_at,status)
 values('${id}','BK-ATT-${tag}-${suffix}','${patient.id}','${therapist.id}',now()+interval '${hours} hours',now()+interval '${hours} hours'+interval '1 hour','confirmed');`).join('\n'))
  })
  afterAll(() => removeUsers([scheduler, therapist, other, patient]))

  it('lets the assigned therapist mark a session and correct it', async () => {
    const db = await signedIn(therapist)
    await markAttendance(db, past, 'attended')
    await markAttendance(db, past, 'no_show')
    const { rows } = await loadConfirmed(await signedIn(scheduler), { ...search, attendance: 'no_show' }, EARLIEST, 0)
    expect(rows.map((row) => row.id)).toEqual([past])
    expect(rows[0]).toMatchObject({ attendance: 'no_show', started: true })
  })

  it('shows each change in the history, with what it was', async () => {
    const { events } = await loadDetail(await signedIn(scheduler), past)
    expect(events.filter((event) => event.action === 'attendance_marked').map((event) => event.toAttendance)).toEqual(['no_show', 'attended'])
  })

  it('tells a session that started from one still to come, on My Schedule', async () => {
    const month = sql(`select to_char((now()+interval '200 hours') at time zone 'Asia/Manila','YYYY-MM')`)
    const { days } = await loadSchedule(await signedIn(therapist), 'therapist', month)
    const session = days.flatMap((day) => day.rows).find((row) => row.session?.id === future)?.session
    expect(session).toMatchObject({ started: false, attendance: null })
  })

  it('filters who has not been marked, leaving out what is still to come', async () => {
    const { rows } = await loadConfirmed(await signedIn(scheduler), { ...search, attendance: 'unmarked' }, EARLIEST, 0)
    expect(rows.map((row) => row.id)).toEqual([missed])
  })

  it('says why a mark is refused', async () => {
    const early = await markAttendance(await signedIn(therapist), future, 'attended').catch((error: unknown) => error)
    expect(bookingFailureKey(early)).toBe('booking.errors.not_started')
    for (const person of [other, patient]) {
      const denied = await markAttendance(await signedIn(person), missed, 'attended').catch((error: unknown) => error)
      expect(bookingFailureKey(denied)).toBe('errors.forbidden')
    }
  })
})
