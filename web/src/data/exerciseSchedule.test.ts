import { describe, expect, it } from 'vitest'
import { countDays, daysBetween, draftProblem, isExerciseDay, weekdayOf, type ScheduleDraft } from './exerciseSchedule'

const plan = (patch: Partial<ScheduleDraft> = {}): ScheduleDraft => ({ id: 'a', patientId: 'p', startsOn: '2026-11-18', endsOn: '2026-12-01', restWeekdays: [], restDates: [], ...patch })

describe('exercise schedule days', () => {
  it('names ISO weekdays from the calendar date alone', () => {
    expect(weekdayOf('2026-11-16')).toBe(1)
    expect(weekdayOf('2026-11-22')).toBe(7)
    expect(weekdayOf('2024-02-29')).toBe(4)
  })

  it('counts both ends of a range', () => {
    expect(daysBetween('2026-11-18', '2026-11-18')).toBe(1)
    expect(daysBetween('2026-11-18', '2026-12-01')).toBe(14)
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(2)
  })

  it('rests on rest weekdays and rest dates, and only inside the range', () => {
    const schedule = plan({ restWeekdays: [7], restDates: ['2026-11-20'] })
    expect(isExerciseDay(schedule, '2026-11-17')).toBe(false)
    expect(isExerciseDay(schedule, '2026-11-18')).toBe(true)
    expect(isExerciseDay(schedule, '2026-11-20')).toBe(false)
    expect(isExerciseDay(schedule, '2026-11-22')).toBe(false)
    expect(isExerciseDay(schedule, '2026-12-01')).toBe(true)
    expect(isExerciseDay(schedule, '2026-12-02')).toBe(false)
  })

  it('sums exercise and rest days for the summary, as the server does', () => {
    expect(countDays(plan({ restWeekdays: [7], restDates: ['2026-11-20', '2027-01-05'] }))).toEqual({ total: 14, exercise: 11, rest: 3 })
    expect(countDays(plan({ endsOn: '2026-11-17' }))).toEqual({ total: 0, exercise: 0, rest: 0 })
  })

  it('says what the server would refuse before anything is saved', () => {
    const today = '2026-11-18'
    expect(draftProblem(plan(), today)).toBeNull()
    expect(draftProblem(plan({ endsOn: '2026-11-17' }), today)).toBe('dates')
    expect(draftProblem(plan({ endsOn: '' }), today)).toBe('dates')
    expect(draftProblem(plan({ endsOn: '2027-11-18' }), today)).toBeNull()
    expect(draftProblem(plan({ endsOn: '2027-11-19' }), today)).toBe('tooLong')
    expect(draftProblem(plan({ startsOn: '2026-11-17' }), today)).toBe('pastStart')
    expect(draftProblem(plan({ restWeekdays: [1, 2, 3, 4, 5, 6, 7] }), today)).toBe('allRest')
    expect(draftProblem(plan({ endsOn: '2026-11-18', restDates: ['2026-11-18'] }), today)).toBe('noDay')
  })

  it('lets a schedule that has started keep its start date, but not end in the past', () => {
    const started = plan({ startsOn: '2026-11-10' })
    expect(draftProblem(started, '2026-11-18', { startsOn: '2026-11-10' })).toBeNull()
    expect(draftProblem({ ...started, endsOn: '2026-11-17' }, '2026-11-18', { startsOn: '2026-11-10' })).toBe('pastEnd')
    // Only the days from today on count towards "at least one exercise day".
    expect(draftProblem({ ...started, endsOn: '2026-11-18', restDates: ['2026-11-18'] }, '2026-11-18', { startsOn: '2026-11-10' })).toBe('noDay')
  })
})
