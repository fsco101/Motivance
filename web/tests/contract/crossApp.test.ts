import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { createCustomExercise, publishPrescription } from '../../src/data/therapist'
import { loadCatalogue } from '../../src/data/workspace'
import { createUser, link, removeUsers, signedIn, type TestUser } from '../support/stack'

/**
 * Publishes through the web code, then reads the result exactly as Android downloads it. The response becomes the fixture
 * that WebPublishedPrescriptionTest feeds to Android's real decoder, so the two apps cannot drift apart unnoticed.
 * After an intended change, regenerate it with UPDATE_ANDROID_FIXTURE=1.
 */
const FIXTURE = '../android/app/src/test/resources/web-published-prescriptions.json'
// The select in SupabaseAuthRepository.loadWorkspace.
const ANDROID_SELECT = 'id,patient_id,prescription_versions(id,version,parameters,side,minimum_degrees,maximum_degrees,target_repetitions,exercise_versions(id,algorithm_key,definition))'

describe('what the web publishes, Android can run', () => {
  const users: TestUser[] = []
  afterAll(() => removeUsers(users))

  it('produces the rows the Android decoder is tested against', async () => {
    const therapist = await createUser(['therapist'])
    const patient = await createUser(['patient'])
    users.push(therapist, patient)
    await link(therapist, patient)
    const db = await signedIn(therapist)
    const catalogue = await loadCatalogue(db, therapist.id)
    const elbow = catalogue.find((item) => item.algorithm === 'elbow-flexion-v1' && item.selectable)!
    const custom = await createCustomExercise(db, { id: randomUUID(), name: 'Seated knee extension', joint: 'KNEE', english: 'Sit tall and straighten the knee.', filipino: 'Umupo nang tuwid at ituwid ang tuhod.' })
    const standardVersion = randomUUID()
    const customVersion = randomUUID()
    const standardAssignment = randomUUID()
    const customAssignment = randomUUID()
    await publishPrescription(db, {
      assignmentId: standardAssignment, requestId: standardVersion, patientId: patient.id, exerciseId: elbow.id, side: 'right', focus: 'KNEE', low: 25, high: 110, repetitions: 6,
      minimumCycleMs: 750, maximumCycleMs: 20000, peakHoldMs: 250, maxTrunkLean: 15, confidence: 0.7,
    })
    await publishPrescription(db, {
      assignmentId: customAssignment, requestId: customVersion, patientId: patient.id, exerciseId: custom, side: 'bilateral', sideSeconds: 90, focus: null, low: 15, high: 80, repetitions: 8,
      minimumCycleMs: 600, maximumCycleMs: 30000, peakHoldMs: 100, maxTrunkLean: 20, confidence: 0.7,
    })

    const person = await signedIn(patient)
    const { data, error } = await person.from('exercise_assignments').select(ANDROID_SELECT).eq('active', true).eq('patient_id', patient.id).order('id')
    if (error) throw error
    const stable = new Map([[patient.id, 'patient'], [standardAssignment, 'standard-assignment'], [customAssignment, 'custom-assignment'], [standardVersion, 'standard-version'], [customVersion, 'custom-version'], [elbow.id, 'elbow-exercise'], [custom, 'custom-exercise']])
    const text = [...stable].reduce((json, [from, to]) => json.replaceAll(from, to), JSON.stringify(data))
    const sorted = (JSON.parse(text) as Array<{ id: string }>).sort((a, b) => a.id.localeCompare(b.id))
    const fixture = `${JSON.stringify(sorted, null, 2)}\n`

    if (process.env.UPDATE_ANDROID_FIXTURE) writeFileSync(FIXTURE, fixture)
    expect(fixture).toBe(readFileSync(FIXTURE, 'utf8').replaceAll('\r\n', '\n'))
  })
})
