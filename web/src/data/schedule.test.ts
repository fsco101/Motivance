import { describe, expect, it } from 'vitest'
import { decodeSchedule, openingDate, sessionsOn, type Schedule, type ScheduleDay } from './schedule'

const session = { id: 's1', reference_no: 'BK-2026-000001', status: 'confirmed' as const, starts_at: '2026-12-14T02:00:00+00:00', ends_at: '2026-12-14T03:00:00+00:00', location: 'Center' }
const free = { starts_at: '2026-12-14T01:00:00+00:00', ends_at: '2026-12-14T02:00:00+00:00', session: null }

const day = (date: string, sessions: number): ScheduleDay => ({
  date, status: 'open', holiday: null,
  rows: Array.from({ length: sessions }, (_, index) => ({
    startsAt: `${date}T01:00:00Z`, endsAt: `${date}T02:00:00Z`,
    session: { id: `${date}${index}`, reference: 'BK', status: 'confirmed', startsAt: `${date}T01:00:00Z`, endsAt: `${date}T02:00:00Z`, location: '', therapist: null, patientId: null, patient: null, linked: false },
  })),
})
const month = (...days: ScheduleDay[]): Schedule => ({ days })

describe('reading a schedule', () => {
  it('keeps an empty hour empty, and names the therapist on a patient\'s session', () => {
    const { days } = decodeSchedule({ days: [{ date: '2026-12-14', status: 'open', holiday: null, rows: [free, { starts_at: session.starts_at, ends_at: session.ends_at, session: { ...session, therapist_name: 'Dana Reyes' } }] }] })
    expect(days[0]!.rows[0]!.session).toBeNull()
    expect(days[0]!.rows[1]!.session).toMatchObject({ reference: 'BK-2026-000001', therapist: 'Dana Reyes', location: 'Center', patient: null, linked: false })
  })

  it('names the patient on a therapist\'s session, and keeps the link', () => {
    const { days } = decodeSchedule({ days: [{ date: '2026-12-14', status: 'open', holiday: null, rows: [{ starts_at: session.starts_at, ends_at: session.ends_at, session: { ...session, patient_id: 'p1', patient_name: 'Ana', linked: true } }] }] })
    expect(days[0]!.rows[0]!.session).toMatchObject({ patientId: 'p1', patient: 'Ana', linked: true, therapist: null })
  })

  it('treats a missing location as none, so nothing shows an empty label', () => {
    const { days } = decodeSchedule({ days: [{ date: '2026-12-14', status: 'open', holiday: null, rows: [{ starts_at: session.starts_at, ends_at: session.ends_at, session: { ...session, location: null } }] }] })
    expect(days[0]!.rows[0]!.session?.location).toBe('')
  })

  it('counts the sessions on a day, and none on an unknown one', () => {
    expect(sessionsOn(day('2026-12-14', 2))).toHaveLength(2)
    expect(sessionsOn(undefined)).toEqual([])
  })
})

describe('the date a month opens on', () => {
  it('is the next date with a session, not an earlier one', () => {
    expect(openingDate(month(day('2026-12-01', 1), day('2026-12-14', 0), day('2026-12-20', 1)), '2026-12-14')).toBe('2026-12-20')
  })

  it('counts a session today', () => {
    expect(openingDate(month(day('2026-12-14', 1), day('2026-12-20', 1)), '2026-12-14')).toBe('2026-12-14')
  })

  it('falls back to today when nothing is ahead', () => {
    expect(openingDate(month(day('2026-12-01', 1), day('2026-12-14', 0)), '2026-12-14')).toBe('2026-12-14')
  })

  it('opens a later month on its first session', () => {
    expect(openingDate(month(day('2027-01-05', 0), day('2027-01-08', 1)), '2026-12-14')).toBe('2027-01-08')
  })

  it('waits for a choice in a past month, or a later one with nothing in it', () => {
    expect(openingDate(month(day('2026-11-05', 1)), '2026-12-14')).toBeNull()
    expect(openingDate(month(day('2027-01-05', 0)), '2026-12-14')).toBeNull()
  })
})
