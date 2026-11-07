import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bookingFailureKey } from '../../src/data/booking'
import { loadInbox } from '../../src/data/notifications'
import { cancelSeries, createSeries, loadDetail, loadRequests, NO_FILTERS, previewSeries, searchPatients, type SeriesDraft } from '../../src/data/scheduler'
import { createUser, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

describe('weekly sessions on the local backend', () => {
  const tag = randomUUID().slice(0, 8)
  let scheduler: TestUser
  let therapist: TestUser
  let patient: TestUser
  let draft: SeriesDraft
  let series: string

  beforeAll(async () => {
    ;[scheduler, therapist, patient] = await Promise.all([createUser(['scheduler'], `Sol ${tag}`), createUser(['therapist'], `Zed ${tag}`), createUser(['patient'], `Ana ${tag}`)])
    const first = sql(`select d::date from generate_series(current_date+90,current_date+150,interval '1 day') d where extract(isodow from d)<6
 and not exists(select 1 from public.center_holidays h,generate_series(0,3) n where (d+make_interval(weeks=>n))::date between h.starts_on and h.ends_on) order by d limit 1`)
    draft = { patient: patient.id, therapist: therapist.id, startsAt: `${first}T09:00:00+08:00`, weeks: 4 }
    const second = sql(`select ('${first}'::date+7)`)
    sql(`insert into public.bookings(id,reference_no,patient_id,therapist_id,starts_at,ends_at,status) values(gen_random_uuid(),'BK-SER-${tag}','${patient.id}',null,'${second}T09:00:00+08:00','${second}T10:00:00+08:00','pending')`)
  })
  afterAll(() => removeUsers([scheduler, therapist, patient]))

  it('finds patients by name', async () => {
    const found = await searchPatients(await signedIn(scheduler), `Ana ${tag}`)
    expect(found.map((item) => item.id)).toEqual([patient.id])
  })

  it('reads each date with what would stop it', async () => {
    const dates = await previewSeries(await signedIn(scheduler), draft)
    expect(dates.map((date) => date.problem)).toEqual([null, 'overlap', null, null])
  })

  it('books the dates that pass, and retrying books nothing more', async () => {
    const db = await signedIn(scheduler)
    const request = randomUUID()
    const made = await createSeries(db, request, draft)
    expect(made).toMatchObject({ weeks: 4, booked: 3 })
    series = made.id
    expect(await createSeries(db, request, draft)).toMatchObject({ id: series, booked: 3 })
  })

  it('reads one notification for the course, with its count and last date', async () => {
    const { rows } = await loadInbox(await signedIn(patient))
    const notes = rows.filter((note) => note.kind === 'series_booked')
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ sessions: 3, therapist: `Zed ${tag}` })
    expect(notes[0]!.lastStartsAt).toBeTruthy()
  })

  it('shows which sessions belong to a course', async () => {
    const db = await signedIn(scheduler)
    const { rows } = await loadRequests(db, { ...NO_FILTERS, search: `Ana ${tag}`, status: 'confirmed' }, { key: 'starts_at', direction: 'asc' }, 0)
    expect(rows.map((row) => row.seriesId)).toEqual([series, series, series])
    expect(await loadDetail(db, rows[0]!.id)).toMatchObject({ seriesId: series, seriesRemaining: 3 })
  })

  it('cancels what is left, and says why it cannot do so twice', async () => {
    const db = await signedIn(scheduler)
    expect(await cancelSeries(db, series, 'Course finished early')).toBe(3)
    const failure = await cancelSeries(db, series, 'Course finished early').catch((error: unknown) => error)
    expect(bookingFailureKey(failure)).toBe('booking.errors.state')
  })

  it('refuses everyone but a Scheduler', async () => {
    const failure = await previewSeries(await signedIn(patient), draft).catch((error: unknown) => error)
    expect(bookingFailureKey(failure)).toBe('errors.forbidden')
  })
})
