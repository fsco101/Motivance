import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bookingFailureKey } from '../../src/data/booking'
import { dayRange, deleteClosure, deleteHoliday, deleteTimeOff, loadCalendar, loadImpact, saveClosure, saveHoliday, saveTimeOff } from '../../src/data/calendar'
import { loadTherapists } from '../../src/data/scheduler'
import { createUser, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

/** Well past the booking window, so nothing here touches a date another suite is using. */
const farDay = (after: number) => sql(`select d::date from generate_series(current_date+${after},current_date+${after + 14},interval '1 day') d
 where extract(isodow from d)<6 and not exists(select 1 from public.center_holidays h where d::date between h.starts_on and h.ends_on) order by d limit 1`)

describe('the center calendar on the local backend', () => {
  const tag = randomUUID().slice(0, 8)
  const date = farDay(120)
  const today = sql(`select (now() at time zone 'Asia/Manila')::date`)
  const booking = randomUUID()
  let scheduler: TestUser
  let patient: TestUser
  let therapist: TestUser

  beforeAll(async () => {
    ;[scheduler, patient, therapist] = await Promise.all([createUser(['scheduler'], `Sol ${tag}`), createUser(['patient'], `Ana ${tag}`), createUser(['therapist'], `Zed ${tag}`)])
    sql(`insert into public.bookings(id,reference_no,patient_id,starts_at,ends_at,status) values('${booking}','BK-CAL-${tag}','${patient.id}','${date}T09:00:00+08:00','${date}T10:00:00+08:00','pending')`)
  })
  afterAll(() => removeUsers([scheduler, patient, therapist]))

  it('reads the settings, hours and what is ahead', async () => {
    const calendar = await loadCalendar(await signedIn(scheduler), today)
    expect(calendar.settings.slotMinutes).toBeGreaterThan(0)
    expect(calendar.hours).toHaveLength(7)
    expect(calendar.hours[0]).toMatchObject({ weekday: 1, isOpen: true, opensAt: '09:00', closesAt: '17:00' })
    expect(calendar.holidays.every((holiday) => holiday.endsOn >= today)).toBe(true)
  })

  it('lists the bookings a day would strand', async () => {
    const affected = await loadImpact(await signedIn(scheduler), dayRange(date, date).startsAt, dayRange(date, date).endsAt)
    expect(affected).toHaveLength(1)
    expect(affected[0]).toMatchObject({ id: booking, reference: `BK-CAL-${tag}`, status: 'pending', patient: `Ana ${tag}`, therapist: null })
  })

  it('refuses a closure over a booking with no decision, in words the page can show', async () => {
    const failure = await saveClosure(await signedIn(scheduler), { id: null, ...dayRange(date, date), allDay: true, reason: `Test ${tag}` }, []).catch((error: unknown) => error)
    expect(bookingFailureKey(failure)).toBe('booking.errors.unresolved')
  })

  it('saves a closure and cancels the booking together', async () => {
    const db = await signedIn(scheduler)
    await saveClosure(db, { id: null, ...dayRange(date, date), allDay: true, reason: `Test ${tag}` }, [{ booking, action: 'cancel', reason: `Test ${tag}` }])
    expect(sql(`select status from public.bookings where id='${booking}'`)).toBe('cancelled')
    const { closures } = await loadCalendar(db, today)
    const saved = closures.find((closure) => closure.reason === `Test ${tag}`)!
    expect(saved).toMatchObject({ allDay: true })
    await deleteClosure(db, saved.id)
    expect((await loadCalendar(db, today)).closures.some((closure) => closure.id === saved.id)).toBe(false)
  })

  it('saves, edits and deletes a holiday', async () => {
    const db = await signedIn(scheduler)
    const name = `Holiday ${tag}`
    await saveHoliday(db, { id: null, name, kind: 'seasonal', startsOn: date, endsOn: date }, [])
    const saved = (await loadCalendar(db, today)).holidays.find((holiday) => holiday.name === name)!
    expect(saved).toMatchObject({ kind: 'seasonal', startsOn: date })
    await saveHoliday(db, { ...saved, name: `${name} renamed` }, [])
    expect((await loadCalendar(db, today)).holidays.find((holiday) => holiday.id === saved.id)?.name).toBe(`${name} renamed`)
    await deleteHoliday(db, saved.id)
    expect((await loadCalendar(db, today)).holidays.some((holiday) => holiday.id === saved.id)).toBe(false)
  })

  it('saves time off, marks the therapist on leave and lists only their sessions', async () => {
    const db = await signedIn(scheduler)
    const day = farDay(150)
    const range = { startsAt: `${day}T09:00:00+08:00`, endsAt: `${day}T12:00:00+08:00` }
    const held = randomUUID()
    sql(`insert into public.bookings(id,reference_no,patient_id,therapist_id,starts_at,ends_at,status) values('${held}','BK-OFF-${tag}','${patient.id}','${therapist.id}','${day}T10:00:00+08:00','${day}T11:00:00+08:00','confirmed')`)
    expect((await loadImpact(db, range.startsAt, range.endsAt, therapist.id)).map((row) => row.id)).toEqual([held])
    expect(await loadImpact(db, range.startsAt, range.endsAt, scheduler.id)).toEqual([])
    const draft = { id: null, therapistId: therapist.id, ...range, reason: `Leave ${tag}` }
    expect(bookingFailureKey(await saveTimeOff(db, draft, []).catch((error: unknown) => error))).toBe('booking.errors.unresolved')
    await saveTimeOff(db, draft, [{ booking: held, action: 'cancel', reason: `Away ${tag}` }])
    const saved = (await loadCalendar(db, today)).timeOff.find((entry) => entry.reason === `Leave ${tag}`)!
    expect(saved).toMatchObject({ therapistId: therapist.id, therapist: `Zed ${tag}` })
    const open = randomUUID()
    sql(`insert into public.bookings(id,reference_no,patient_id,starts_at,ends_at,status) values('${open}','BK-PICK-${tag}','${patient.id}','${day}T10:00:00+08:00','${day}T11:00:00+08:00','pending')`)
    expect((await loadTherapists(db, open)).find((choice) => choice.id === therapist.id)).toMatchObject({ onLeave: true })
    expect(bookingFailureKey(await db.rpc('scheduler_confirm', { p_booking: open, p_therapist: therapist.id }).then(({ error }) => error))).toBe('booking.errors.therapist_on_leave')
    await deleteTimeOff(db, saved.id)
    expect((await loadTherapists(db, open)).find((choice) => choice.id === therapist.id)).toMatchObject({ onLeave: false })
  })

  it('refuses everyone else', async () => {
    const failure = await loadImpact(await signedIn(patient), dayRange(date, date).startsAt, dayRange(date, date).endsAt).catch((error: unknown) => error)
    expect(bookingFailureKey(failure)).toBe('errors.forbidden')
  })
})
