import { describe, expect, it } from 'vitest'
import { decodeCatalogue } from './catalogue'

const knee = { name: 'Seated knee extension', measurement_convention: '2d_joint_degrees', measured_joint: 'KNEE', instructions_en: 'Sit tall.' }

describe('therapist catalogue, matching Android', () => {
  it('offers built-ins and the therapist’s own exercises', () => {
    const list = decodeCatalogue([
      { id: 'elbow', version: 1, algorithm_key: 'elbow-flexion-v1', definition: { name: 'Elbow flexion' }, exercises: { id: 'e1', owner_id: null } },
      { id: 'mine', version: 1, algorithm_key: 'joint-angle-v1', definition: knee, exercises: { id: 'e2', owner_id: 'therapist' } },
    ], 'therapist')
    expect(list.map((item) => item.selectable)).toEqual([true, true])
    expect(list[1]).toMatchObject({ custom: true, joint: 'KNEE', exerciseId: 'e2' })
    expect(list[0]?.joint).toBeNull()
  })

  it('keeps retired and other therapists’ exercises named but not selectable', () => {
    const list = decodeCatalogue([
      { id: 'retired', version: 1, algorithm_key: 'joint-angle-v1', definition: knee, exercises: null },
      { id: 'theirs', version: 1, algorithm_key: 'joint-angle-v1', definition: knee, exercises: { id: 'e3', owner_id: 'someone-else' } },
    ], 'therapist')
    expect(list.map((item) => item.id)).toEqual(['retired', 'theirs'])
    expect(list.every((item) => !item.selectable && item.name === 'Seated knee extension')).toBe(true)
  })

  it('offers only the newest version, and keeps older ones for naming existing plans', () => {
    const list = decodeCatalogue([
      { id: 'v1', version: 1, algorithm_key: 'elbow-flexion-v1', definition: { name: 'Elbow flexion' }, exercises: { id: 'e1', owner_id: null } },
      { id: 'v2', version: 2, algorithm_key: 'elbow-flexion-v1', definition: { name: 'Elbow flexion' }, exercises: { id: 'e1', owner_id: null } },
    ], 'therapist')
    expect(list.map((item) => [item.id, item.selectable])).toEqual([['v1', false], ['v2', true]])
  })

  it('drops rows the app cannot measure', () => {
    expect(decodeCatalogue([
      { id: 'future', version: 1, algorithm_key: 'gait-v9', definition: { name: 'Gait' }, exercises: { id: 'e4', owner_id: null } },
      { id: 'broken', version: 1, algorithm_key: 'joint-angle-v1', definition: { ...knee, measured_joint: 'NECK' }, exercises: { id: 'e5', owner_id: 'therapist' } },
    ], 'therapist')).toEqual([])
  })
})
