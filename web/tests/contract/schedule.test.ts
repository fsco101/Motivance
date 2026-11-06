import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bookingFailureKey, requestBooking } from '../../src/data/booking'
import { loadSchedule, sessionsOn } from '../../src/data/schedule'
import { confirmBooking } from '../../src/data/scheduler'
import { createUser, link, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

const manila = (date: string, hour: number) => `${date}T${String(hour).padStart(2, '0')}:00:00+08:00`
const workingDay = (after: number) => sql(`select d::date from generate_series(current_date+${after},current_date+55,interval '1 day') d
 where extract(isodow from d)<6 and not exists(select 1 from public.center_holidays h where d::date between h.starts_on and h.ends_on) order by d limit 1`)

describe('schedules on the local backend', () => {
  const tag = randomUUID().slice(0, 8)
  const date = workingDay(26)
  const month = date.slice(0, 7)
  let scheduler: TestUser
  let linked: TestUser
  let other: TestUser
  let ana: TestUser
  let ben: TestUser
  const on = (days: Awaited<ReturnType<typeof loadSchedule>>) => days.days.find((day) => day.date === date)

  beforeAll(async () => {
    ;[scheduler, linked, other, ana, ben] = await Promise.all([
      createUser(['scheduler'], `Sol ${tag}`), createUser(['therapist'], `Zed ${tag}`), createUser(['therapist'], `Amy ${tag}`), createUser(['patient'], `Ana ${tag}`), createUser(['patient'], `Ben ${tag}`),
    ])
    await link(linked, ana)
    const db = await signedIn(scheduler)
    const first = await requestBooking(await signedIn(ana), randomUUID(), manila(date, 9))
    const second = await requestBooking(await signedIn(ben), randomUUID(), manila(date, 11))
    await Promise.all([confirmBooking(db, first.id, linked.id), confirmBooking(db, second.id, linked.id)])
    await requestBooking(await signedIn(ana), randomUUID(), manila(date, 14))
  })
  afterAll(() => removeUsers([scheduler, linked, other, ana, ben]))

  it('gives a patient only their own confirmed session, at its time', async () => {
    const day = on(await loadSchedule(await signedIn(ana), 'patient', month))
    const [session] = sessionsOn(day)
    expect(sessionsOn(day)).toHaveLength(1)
    expect(session).toMatchObject({ therapist: `Zed ${tag}`, status: 'confirmed', patient: null })
    expect(new Date(session!.startsAt).getTime()).toBe(new Date(manila(date, 9)).getTime())
    expect(new Date(session!.endsAt).getTime()).toBe(new Date(manila(date, 10)).getTime())
    expect(day!.rows.length).toBeGreaterThan(1)
  })

  it('gives a therapist each patient at their time, and says which are linked', async () => {
    const sessions = sessionsOn(on(await loadSchedule(await signedIn(linked), 'therapist', month)))
    expect(sessions.map((session) => [session.patient, session.linked])).toEqual([[`Ana ${tag}`, true], [`Ben ${tag}`, false]])
    expect(sessions[0]!.reference).toMatch(/^BK-/)
  })

  it('gives another therapist nothing', async () => {
    expect(sessionsOn(on(await loadSchedule(await signedIn(other), 'therapist', month)))).toEqual([])
  })

  it('refuses a patient a therapist schedule', async () => {
    const failure = await loadSchedule(await signedIn(ana), 'therapist', month).catch((error: unknown) => error)
    expect(bookingFailureKey(failure)).toBe('errors.forbidden')
  })
})
