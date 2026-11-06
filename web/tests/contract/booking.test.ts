import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bookingFailureKey, cancelMyBooking, loadAvailability, loadMyBookings, requestBooking, type Slot } from '../../src/data/booking'
import { createUser, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

describe('booking on the local backend', () => {
  let patient: TestUser
  let slot: Slot

  beforeAll(async () => {
    patient = await createUser(['patient'], 'Paolo Reyes')
    const month = sql(`select to_char(current_date+20,'YYYY-MM')`)
    const availability = await loadAvailability(await signedIn(patient), month)
    const open = availability.days.find((day) => day.status === 'open')
    if (!open) throw new Error('No open day to test with')
    slot = open.slots[0]!
  })
  afterAll(() => removeUsers([patient]))

  it('reads the center\'s days in its own zone', async () => {
    const month = sql(`select to_char(current_date+20,'YYYY-MM')`)
    const { timeZone, days } = await loadAvailability(await signedIn(patient), month)
    expect(timeZone).toBe('Asia/Manila')
    expect(days.length).toBeGreaterThanOrEqual(28)
    expect(new Set(days.map((day) => day.status)).has('closed')).toBe(true)
  })

  it('requests a slot, and a retry with the same ID returns the same booking', async () => {
    const db = await signedIn(patient)
    const request = randomUUID()
    const booking = await requestBooking(db, request, slot.startsAt)
    expect(booking).toMatchObject({ status: 'pending', therapist: null })
    expect(booking.reference).toMatch(/^BK-\d{4}-\d{6}$/)
    expect((await requestBooking(db, request, slot.startsAt)).id).toBe(booking.id)
    expect(await loadMyBookings(db)).toHaveLength(1)
  })

  it('turns a refusal into its own wording', async () => {
    const failure = await requestBooking(await signedIn(patient), randomUUID(), slot.startsAt).catch((error: unknown) => error)
    expect(bookingFailureKey(failure)).toBe('booking.errors.overlap')
  })

  it('cancels a booking and frees the time', async () => {
    const db = await signedIn(patient)
    const [booking] = await loadMyBookings(db)
    expect(booking).toMatchObject({ canCancel: true })
    await cancelMyBooking(db, booking!.id)
    expect((await loadMyBookings(db))[0]).toMatchObject({ status: 'cancelled', canCancel: false })
    await expect(requestBooking(db, randomUUID(), slot.startsAt)).resolves.toMatchObject({ status: 'pending' })
  })
})
