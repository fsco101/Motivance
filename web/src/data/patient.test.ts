import { describe, expect, it } from 'vitest'
import { decodeExercises, thisWeek, validInvitation, type RawPlan } from './patient'

const version = (number: number, definition: Record<string, unknown>, parameters: unknown = {}) => ({
  id: `v${number}`, version: number, parameters, side: 'left', minimum_degrees: 20, maximum_degrees: 90, target_repetitions: 8,
  exercise_versions: { id: `e${number}`, algorithm_key: 'elbow-flexion-v1', definition },
})
const plan = (...versions: RawPlan['prescription_versions']): RawPlan => ({ id: 'a1', prescription_versions: versions })

describe('a patient\'s exercises', () => {
  it('uses the newest version of each assignment', () => {
    const [exercise] = decodeExercises([plan(version(1, { name: 'Old' }), version(3, { name: 'Elbow bend' }), version(2, { name: 'Middle' }))], 'en')
    expect(exercise).toMatchObject({ assignmentId: 'a1', versionId: 'v3', name: 'Elbow bend', version: 3, low: 20, high: 90, repetitions: 8 })
  })

  it('shows instructions in the reader\'s language, and falls back to English', () => {
    const both = plan(version(1, { name: 'x', instructions_en: 'Bend', instructions_fil: 'Baluktot' }))
    expect(decodeExercises([both], 'fil')[0]?.instructions).toBe('Baluktot')
    expect(decodeExercises([both], 'en')[0]?.instructions).toBe('Bend')
    expect(decodeExercises([plan(version(1, { name: 'x', instructions_en: 'Bend' }))], 'fil')[0]?.instructions).toBe('Bend')
  })

  it('reads the prescribed focus when there is one', () => {
    expect(decodeExercises([plan(version(1, { name: 'x' }, { focus_joint: 'KNEE' }))], 'en')[0]?.focus).toBe('KNEE')
    expect(decodeExercises([plan(version(1, { name: 'x' }))], 'en')[0]?.focus).toBeNull()
  })

  it('reads the time per side when there is one', () => {
    expect(decodeExercises([plan(version(1, { name: 'x' }, { side_seconds: 90 }))], 'en')[0]?.sideSeconds).toBe(90)
    expect(decodeExercises([plan(version(1, { name: 'x' }))], 'en')[0]?.sideSeconds).toBeNull()
    expect(decodeExercises([plan(version(1, { name: 'x' }, { side_seconds: '90' }))], 'en')[0]?.sideSeconds).toBeNull()
  })

  it('leaves out an assignment with nothing to show', () => {
    expect(decodeExercises([plan()], 'en')).toEqual([])
    expect(decodeExercises([plan({ ...version(1, {}), exercise_versions: null })], 'en')).toEqual([])
  })
})

describe('this week', () => {
  const wednesday = new Date(2026, 10, 4, 15)
  const session = (date: Date, status = 'completed') => ({ id: date.toISOString(), startedAt: date.toISOString(), status })

  it('runs Monday to Sunday around today, even on a Sunday', () => {
    expect(thisWeek([], wednesday).map(({ day }) => day.getDate())).toEqual([2, 3, 4, 5, 6, 7, 8])
    expect(thisWeek([], new Date(2026, 10, 8))[0]?.day.getDate()).toBe(2)
  })

  it('marks only days with a completed session', () => {
    const week = thisWeek([session(new Date(2026, 10, 3, 9)), session(new Date(2026, 10, 5, 9), 'interrupted'), session(new Date(2026, 9, 27, 9))], wednesday)
    expect(week.map(({ done }) => done)).toEqual([false, true, false, false, false, false, false])
  })
})

describe('an invitation code', () => {
  it('is 48 hexadecimal characters, ignoring spaces around it', () => {
    expect(validInvitation(` ${'a1'.repeat(24)} `)).toBe(true)
    expect(validInvitation('a1'.repeat(23))).toBe(false)
    expect(validInvitation('zz'.repeat(24))).toBe(false)
  })
})
