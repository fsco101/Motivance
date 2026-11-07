import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bookingFailureKey } from '../../src/data/booking'
import { loadSummary } from '../../src/data/scheduler'
import { createUser, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

describe('the Scheduler dashboard on the local backend', () => {
  const tag = randomUUID().slice(0, 8)
  let scheduler: TestUser
  let patient: TestUser

  beforeAll(async () => {
    ;[scheduler, patient] = await Promise.all([createUser(['scheduler'], `Sol ${tag}`), createUser(['patient'], `Ana ${tag}`)])
  })
  afterAll(() => removeUsers([scheduler, patient]))

  it('reads the figures and the week they cover', async () => {
    const summary = await loadSummary(await signedIn(scheduler))
    expect(summary.pending).toBeGreaterThanOrEqual(0)
    expect(summary.weekFrom <= summary.date && summary.date <= summary.weekTo).toBe(true)
    expect(summary.utilization).toBe(summary.places > 0 ? Math.round(100 * summary.booked / summary.places) : null)
  })

  it('counts a new pending request', async () => {
    const db = await signedIn(scheduler)
    const before = (await loadSummary(db)).pending
    sql(`insert into public.bookings(id,reference_no,patient_id,starts_at,ends_at,status) values(gen_random_uuid(),'BK-DSH-${tag}','${patient.id}',now()+interval '400 days',now()+interval '401 days','pending')`)
    expect((await loadSummary(db)).pending).toBe(before + 1)
  })

  it('refuses everyone but a Scheduler', async () => {
    const failure = await loadSummary(await signedIn(patient)).catch((error: unknown) => error)
    expect(bookingFailureKey(failure)).toBe('errors.forbidden')
  })
})
