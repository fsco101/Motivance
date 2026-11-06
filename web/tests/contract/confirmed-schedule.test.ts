import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bookingFailureKey } from '../../src/data/booking'
import { loadAllConfirmed, loadCenterName, loadConfirmed, loadPatientChoices, logExport, NO_SCHEDULE_FILTERS, type RequestSort } from '../../src/data/scheduler'
import { createUser, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

const EARLIEST: RequestSort = { key: 'starts_at', direction: 'asc' }

describe('the confirmed schedule on the local backend', () => {
  const tag = randomUUID().slice(0, 8)
  const search = { ...NO_SCHEDULE_FILTERS, search: `BK-CON-${tag}` }
  let scheduler: TestUser
  let therapist: TestUser
  let patient: TestUser

  beforeAll(async () => {
    ;[scheduler, therapist, patient] = await Promise.all([createUser(['scheduler'], `Sol ${tag}`), createUser(['therapist'], `Zed ${tag}`), createUser(['patient'], `Ana ${tag}`)])
    // One call: each is a separate process, and every test file is starting at once.
    sql(['confirmed', 'rescheduled', 'confirmed', 'confirmed', 'confirmed', 'pending', 'cancelled'].map((status, index) => {
      const person = status === 'pending' || status === 'cancelled' ? 'null' : `'${therapist.id}'`
      return `insert into public.bookings(id,reference_no,patient_id,therapist_id,starts_at,ends_at,status) values(gen_random_uuid(),'BK-CON-${tag}-${index}','${patient.id}',${person},now()+interval '${200 + index * 2} days',now()+interval '${200 + index * 2} days 1 hour','${status}');`
    }).join('\n'))
  })
  afterAll(() => removeUsers([scheduler, therapist, patient]))

  it('lists confirmed and rescheduled sessions only', async () => {
    const { rows, total } = await loadConfirmed(await signedIn(scheduler), search, EARLIEST, 0)
    expect(total).toBe(5)
    expect(new Set(rows.map((row) => row.status))).toEqual(new Set(['confirmed', 'rescheduled']))
  })

  it('narrows to one status, and to one patient', async () => {
    const db = await signedIn(scheduler)
    expect((await loadConfirmed(db, { ...search, status: 'rescheduled' }, EARLIEST, 0)).total).toBe(1)
    expect((await loadConfirmed(db, { ...search, patient: patient.id }, EARLIEST, 0)).total).toBe(5)
    expect((await loadConfirmed(db, { ...search, patient: scheduler.id }, EARLIEST, 0)).total).toBe(0)
  })

  it('reads the whole result however many pages it takes, in order and without repeats', async () => {
    const rows = await loadAllConfirmed(await signedIn(scheduler), search, EARLIEST, 2)
    expect(rows.map((row) => row.reference)).toEqual([0, 1, 2, 3, 4].map((index) => `BK-CON-${tag}-${index}`))
  })

  it('offers the patients on the schedule, with their account off too, and nobody else', async () => {
    const idle = await createUser(['patient'], `Idle ${tag}`)
    const db = await signedIn(scheduler)
    sql(`update public.profiles set active=false where id='${patient.id}'`)
    const choices = (await loadPatientChoices(db)).map((choice) => choice.id)
    sql(`update public.profiles set active=true where id='${patient.id}'`)
    removeUsers([idle])
    expect(choices).toContain(patient.id)
    expect(choices).not.toContain(idle.id)
  })

  it('knows the center\'s name', async () => {
    expect(await loadCenterName(await signedIn(scheduler))).toBeTruthy()
  })

  it('records an export with its format and row count', async () => {
    await logExport(await signedIn(scheduler), 'pdf', 5)
    expect(sql(`select action,target_type,target_id from public.audit_events where actor_id='${scheduler.id}' and action='export' order by id desc limit 1`)).toBe('export|bookings|pdf:5')
  })

  it('refuses an unknown format, and everyone else', async () => {
    expect(bookingFailureKey(await logExport(await signedIn(scheduler), 'csv' as 'pdf', 5).catch((error: unknown) => error))).toBe('booking.errors.invalid')
    expect(bookingFailureKey(await logExport(await signedIn(patient), 'pdf', 5).catch((error: unknown) => error))).toBe('errors.forbidden')
  })
})
