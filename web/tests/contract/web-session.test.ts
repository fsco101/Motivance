import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { grantConsent, loadSessionRules, saveSession } from '../../src/data/session'
import { createCustomExercise, publishPrescription } from '../../src/data/therapist'
import { loadCatalogue } from '../../src/data/workspace'
import { loadExerciseDay } from '../../src/data/exerciseSchedule'
import { landmark, MovementAssessment, type AssessmentSnapshot, type ExerciseRules, type Landmark } from '../../src/features/exercise/assessment'
import { sessionPayload } from '../../src/features/exercise/session/payload'
import { createUser, link, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

/**
 * A web camera session (#137), saved through the web code to the local backend exactly as a phone session is: the same
 * rules check, the same consent rule, one session per retry, and the exercise done for today on both apps.
 */
const timing = { minimumCycleMs: 600, maximumCycleMs: 30000, peakHoldMs: 100, maxTrunkLean: 20, confidence: 0.7 }

/** An upright patient with the measured elbow (or knee) at `angle` degrees, in normalised frame coordinates. */
function pose(rules: ExerciseRules, angle: number): Landmark[] {
  const points = Array.from({ length: 33 }, () => landmark(0.5, 0.5, 1))
  const s = rules.side === 'RIGHT' ? 1 : 0
  const sin = Math.sin((angle * Math.PI) / 180), cos = Math.cos((angle * Math.PI) / 180)
  if (rules.measuredJoint === 'KNEE') {
    points[11 + s] = landmark(0.5, 0.15, 1); points[23 + s] = landmark(0.5, 0.45, 1); points[25 + s] = landmark(0.5, 0.65, 1); points[27 + s] = landmark(0.5 + sin * 0.2, 0.65 + cos * 0.2, 1)
  } else {
    points[11 + s] = landmark(0.5, 0.3, 1); points[23 + s] = landmark(0.5, 0.8, 1); points[13 + s] = landmark(0.5, 0.5, 1); points[15 + s] = landmark(0.5 + sin * 0.15, 0.5 + cos * 0.15, 1)
  }
  return points
}

/** Runs the shared engine through a ready position and `reps` full repetitions, as the camera would. */
function measure(rules: ExerciseRules, reps: number): AssessmentSnapshot {
  const engine = new MovementAssessment(rules)
  let time = 0
  const frame = (angle: number) => engine.process([pose(rules, angle)], 1000, 1000, (time += 100))
  for (let i = 0; i < 6; i++) frame(10)
  expect(engine.start(time)).toBe(true)
  const peak = rules.highDegrees + 10
  for (let r = 0; r < reps; r++) [10, 10, 40, 60, peak - 20, peak, peak, peak, peak - 30, 40, 10, 10].forEach(frame)
  return engine.pause(time)
}

describe('a session measured on the web', () => {
  const users: TestUser[] = []
  afterAll(() => removeUsers(users))

  it('is saved like a phone session, once, marked as from the web, and finishes the exercise for today', async () => {
    const therapist = await createUser(['therapist'])
    const patient = await createUser(['patient'])
    users.push(therapist, patient)
    await link(therapist, patient)
    const staff = await signedIn(therapist)
    const elbow = (await loadCatalogue(staff, therapist.id)).find((item) => item.algorithm === 'elbow-flexion-v1' && item.selectable)!
    const versionId = randomUUID()
    await publishPrescription(staff, { ...timing, assignmentId: randomUUID(), requestId: versionId, patientId: patient.id, exerciseId: elbow.id, side: 'left', focus: null, low: 20, high: 90, repetitions: 2 })

    const db = await signedIn(patient)
    const loaded = await loadSessionRules(db, patient.id, versionId)
    expect(loaded?.rules).toMatchObject({ kind: 'ELBOW_FLEXION', side: 'LEFT', prescriptionVersionId: versionId, demo: false })
    const rules = loaded!.rules
    const consent = await grantConsent(db, new Date(Date.now() - 20_000))
    const snapshot = measure(rules, 2)
    expect(snapshot.completed).toBe(2)
    const payload = sessionPayload({ sessionId: randomUUID(), ownerId: patient.id, consentId: consent.id, rules, snapshot, startedAt: Date.now() - 15_000, endedAt: Date.now() - 1000 })

    expect(await saveSession(db, payload)).toEqual({ duplicate: false })
    // A retry after a lost answer returns the same session instead of a second one.
    expect(await saveSession(db, payload)).toEqual({ duplicate: true })
    expect(sql(`select count(*)||','||min(client) from public.sessions where patient_id='${patient.id}'`)).toBe('1,web')
    expect(sql(`select completed_repetitions||','||quality from public.session_measurements where session_id='${payload.sessionId}'`)).toBe('2,valid')
    const day = await loadExerciseDay(db, patient.id)
    expect(day.exercises.find((item) => item.assignmentId === loaded!.assignmentId)?.done).toBe(true)
  })

  it('saves each side of a timed both-sides set as its own session, under one consent', async () => {
    const therapist = await createUser(['therapist'])
    const patient = await createUser(['patient'])
    users.push(therapist, patient)
    await link(therapist, patient)
    const staff = await signedIn(therapist)
    const knee = await createCustomExercise(staff, { id: randomUUID(), name: 'Seated knee extension', joint: 'KNEE', english: 'Sit tall and straighten the knee.', filipino: 'Umupo nang tuwid at ituwid ang tuhod.' })
    const versionId = randomUUID()
    await publishPrescription(staff, { ...timing, assignmentId: randomUUID(), requestId: versionId, patientId: patient.id, exerciseId: knee, side: 'bilateral', sideSeconds: 30, focus: null, low: 15, high: 80, repetitions: 1 })

    const db = await signedIn(patient)
    const left = (await loadSessionRules(db, patient.id, versionId))!.rules
    expect(left).toMatchObject({ kind: 'CUSTOM', measuredJoint: 'KNEE', side: 'LEFT', bilateral: true, sideSeconds: 30, exerciseName: 'Seated knee extension' })
    const right: ExerciseRules = { ...left, side: 'RIGHT' }
    const consent = await grantConsent(db, new Date(Date.now() - 60_000))
    for (const [rules, start] of [[left, 50_000], [right, 25_000]] as const) {
      const payload = sessionPayload({ sessionId: randomUUID(), ownerId: patient.id, consentId: consent.id, rules, snapshot: measure(rules, 1), startedAt: Date.now() - start, endedAt: Date.now() - start + 20_000 })
      expect(await saveSession(db, payload)).toEqual({ duplicate: false })
    }
    expect(sql(`select string_agg(m.side||':'||m.completed_repetitions,',' order by m.side) from public.session_measurements m join public.sessions s on s.id=m.session_id where s.patient_id='${patient.id}'`)).toBe('left:1,right:1')
  })

  it('is refused when the rules differ from the prescription or consent was withdrawn, as on the phone', async () => {
    const therapist = await createUser(['therapist'])
    const patient = await createUser(['patient'])
    users.push(therapist, patient)
    await link(therapist, patient)
    const staff = await signedIn(therapist)
    const elbow = (await loadCatalogue(staff, therapist.id)).find((item) => item.algorithm === 'elbow-flexion-v1' && item.selectable)!
    const versionId = randomUUID()
    await publishPrescription(staff, { ...timing, assignmentId: randomUUID(), requestId: versionId, patientId: patient.id, exerciseId: elbow.id, side: 'right', focus: null, low: 20, high: 90, repetitions: 1 })
    const db = await signedIn(patient)
    const rules = (await loadSessionRules(db, patient.id, versionId))!.rules
    const consent = await grantConsent(db, new Date(Date.now() - 20_000))
    const session = (changed: ExerciseRules) => sessionPayload({ sessionId: randomUUID(), ownerId: patient.id, consentId: consent.id, rules: changed, snapshot: measure(rules, 1), startedAt: Date.now() - 15_000, endedAt: Date.now() - 1000 })
    await expect(saveSession(db, session({ ...rules, highDegrees: 100 }))).rejects.toThrow()
    await db.rpc('record_consent', { p_id: randomUUID(), p_event: 'withdrawn', p_version: 'movement-summary-v1', p_occurred_at: new Date(Date.now() - 10_000).toISOString() })
    await expect(saveSession(db, session(rules))).rejects.toThrow()
    expect(sql(`select count(*) from public.sessions where patient_id='${patient.id}'`)).toBe('0')
  })

  it('leaves a phone session, which names no app, recorded as from the phone', async () => {
    const therapist = await createUser(['therapist'])
    const patient = await createUser(['patient'])
    users.push(therapist, patient)
    await link(therapist, patient)
    const staff = await signedIn(therapist)
    const elbow = (await loadCatalogue(staff, therapist.id)).find((item) => item.algorithm === 'elbow-flexion-v1' && item.selectable)!
    const versionId = randomUUID()
    await publishPrescription(staff, { ...timing, assignmentId: randomUUID(), requestId: versionId, patientId: patient.id, exerciseId: elbow.id, side: 'left', focus: null, low: 20, high: 90, repetitions: 1 })
    const db = await signedIn(patient)
    const rules = (await loadSessionRules(db, patient.id, versionId))!.rules
    const consent = await grantConsent(db, new Date(Date.now() - 20_000))
    const phone: Partial<ReturnType<typeof sessionPayload>> = sessionPayload({ sessionId: randomUUID(), ownerId: patient.id, consentId: consent.id, rules, snapshot: measure(rules, 1), startedAt: Date.now() - 15_000, endedAt: Date.now() - 1000 })
    delete phone.client
    expect(await saveSession(db, phone as ReturnType<typeof sessionPayload>)).toEqual({ duplicate: false })
    expect(sql(`select client from public.sessions where patient_id='${patient.id}'`)).toBe('android')
    await expect(saveSession(db, { ...phone, sessionId: randomUUID(), client: 'watch' } as unknown as ReturnType<typeof sessionPayload>)).rejects.toThrow()
  })
})
