import { describe, expect, it } from 'vitest'
import { centerInstant, dayRange } from './calendar'

describe('times at the center', () => {
  it('reads a date and time in Manila, whatever zone this runs in', () => {
    expect(new Date(centerInstant('2026-12-14', '09:00')).toISOString()).toBe('2026-12-14T01:00:00.000Z')
  })

  it('starts a date at midnight in Manila, which is the evening before in UTC', () => {
    expect(new Date(centerInstant('2026-12-14')).toISOString()).toBe('2026-12-13T16:00:00.000Z')
  })
})

describe('a run of whole days', () => {
  it('covers one day from midnight to midnight', () => {
    const { startsAt, endsAt } = dayRange('2026-12-14', '2026-12-14')
    expect(new Date(startsAt).toISOString()).toBe('2026-12-13T16:00:00.000Z')
    expect(new Date(endsAt).toISOString()).toBe('2026-12-14T16:00:00.000Z')
  })

  it('runs through the last day, across a month and a year', () => {
    const { startsAt, endsAt } = dayRange('2026-12-28', '2027-01-01')
    expect(new Date(startsAt).toISOString()).toBe('2026-12-27T16:00:00.000Z')
    expect(new Date(endsAt).toISOString()).toBe('2027-01-01T16:00:00.000Z')
  })
})
