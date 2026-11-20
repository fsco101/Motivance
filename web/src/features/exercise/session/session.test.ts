import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createRules, EMPTY_SNAPSHOT, type AssessmentSnapshot } from '../assessment'
import { sessionPayload } from './payload'
import { prescribedRules, type RawPrescription } from './rules'
import { SIDE_SET, sideEvent, sideRemainingMs, sidesOf, nextSide } from './sideSet'

/** The same cases and numbers as android/core/domain SideSetTest.kt. */
describe('side sets', () => {
  const both = createRules({ bilateral: true, sideSeconds: 60, targetRepetitions: 5 })
  const snap = (completed: number, durationMs: number, running = true): AssessmentSnapshot => ({ ...EMPTY_SNAPSHOT, completed, durationMs, running })

  it('run left then right', () => {
    expect(sidesOf(both)).toEqual(['LEFT', 'RIGHT'])
    expect(nextSide(both)).toBe('RIGHT')
    expect(nextSide(createRules({ ...both, side: 'RIGHT' }))).toBeNull()
    expect(sidesOf(createRules({ side: 'RIGHT' }))).toEqual(['RIGHT'])
    expect(nextSide(createRules())).toBeNull()
  })
  it('move to the right when time is up on the left', () => {
    expect(sideEvent(both, snap(3, 59_990), snap(3, 60_000))).toEqual({ type: 'sideEnded', next: 'RIGHT' })
  })
  it('complete the set when time is up on the last side', () => {
    expect(sideEvent(createRules({ ...both, side: 'RIGHT' }), snap(3, 59_990), snap(3, 60_000))).toEqual({ type: 'setComplete' })
    expect(sideEvent(createRules({ sideSeconds: 60 }), snap(3, 59_990), snap(3, 60_000))).toEqual({ type: 'setComplete' })
  })
  it('keep going when the target is reached with time left', () => {
    expect(sideEvent(both, snap(4, 10_000), snap(5, 10_050))).toEqual({ type: 'targetReached' })
    expect(sideEvent(both, snap(5, 11_000), snap(6, 11_050))).toBeNull()
  })
  it('still move on when time is up before the target', () => {
    expect(sideEvent(both, snap(2, 59_999), snap(2, 60_001))).toEqual({ type: 'sideEnded', next: 'RIGHT' })
  })
  it('switch at the target without a time', () => {
    const untimed = createRules({ ...both, sideSeconds: null })
    expect(sideEvent(untimed, snap(4, 10_000), snap(5, 10_050))).toEqual({ type: 'sideEnded', next: 'RIGHT' })
    expect(sideEvent(createRules({ ...untimed, side: 'RIGHT' }), snap(4, 10_000), snap(5, 10_050))).toBeNull()
  })
  it('leave an untimed single side to Finish', () => {
    expect(sideEvent(createRules(), snap(4, 10_000), snap(5, 10_050))).toBeNull()
    expect(sideEvent(createRules(), snap(5, 10_000_000), snap(5, 10_000_050))).toBeNull()
  })
  it('do nothing while paused', () => {
    expect(sideEvent(both, snap(3, 59_000), snap(3, 61_000, false))).toBeNull()
    expect(sideEvent(both, snap(4, 10_000), snap(5, 10_050, false))).toBeNull()
  })
  it('end a side past its time on the next frame', () => {
    expect(sideEvent(both, snap(3, 61_000), snap(3, 61_050))).toEqual({ type: 'sideEnded', next: 'RIGHT' })
  })
  it('count the remaining time down', () => {
    expect(sideRemainingMs(both, snap(0, 15_500))).toBe(44_500)
    expect(sideRemainingMs(both, snap(0, 70_000))).toBe(0)
    expect(sideRemainingMs(createRules(), snap(0, 1))).toBeNull()
  })
  it('use the same countdown and limits as Android', () => {
    expect(SIDE_SET).toEqual({ countdownSeconds: 5, announcementLimitMs: 6000 })
    expect(() => createRules({ sideSeconds: 14 })).toThrow()
    expect(() => createRules({ sideSeconds: 1801 })).toThrow()
  })
})

function prescription(overrides: Partial<RawPrescription> = {}, definition: Record<string, unknown> = {}, parameters: Record<string, unknown> = {}): RawPrescription {
  return {
    id: 'version-1', side: 'left', minimum_degrees: 20, maximum_degrees: 90, target_repetitions: 10, parameters,
    exercise_versions: { id: 'exercise-1', algorithm_key: 'elbow-flexion-v1', definition: { measurement_convention: '2d_flexion_degrees', instructions_en: 'Bend.', ...definition } },
    ...overrides,
  }
}

/** The same mapping as android PrescriptionCache.kt. */
describe('prescribedRules', () => {
  it('reads a built-in exercise with Android defaults for timing it does not set', () => {
    expect(prescribedRules(prescription())).toMatchObject({
      kind: 'ELBOW_FLEXION', side: 'LEFT', lowDegrees: 20, highDegrees: 90, targetRepetitions: 10, confidence: Math.fround(0.7),
      minimumCycleMs: 600, maximumCycleMs: 30_000, peakHoldMs: 100, maxTrunkLeanDegrees: 20, version: 'exercise-1',
      prescriptionVersionId: 'version-1', demo: false, measuredJoint: 'ELBOW', focusJoint: 'ELBOW', exerciseName: null, bilateral: false, sideSeconds: null,
    })
  })
  it('takes timing, confidence, focus and time per side from the prescription', () => {
    const rules = prescribedRules(prescription({ side: 'bilateral' }, {}, { confidence: 0.8, minimum_cycle_ms: 900, maximum_cycle_ms: 20_000, peak_hold_ms: 500, max_trunk_lean_degrees: 15, focus_joint: 'SHOULDER', side_seconds: 45 }))
    expect(rules).toMatchObject({ side: 'LEFT', bilateral: true, confidence: Math.fround(0.8), minimumCycleMs: 900, maximumCycleMs: 20_000, peakHoldMs: 500, maxTrunkLeanDegrees: 15, focusJoint: 'SHOULDER', measuredJoint: 'ELBOW', sideSeconds: 45 })
  })
  it('reads a therapist exercise by its measured joint and name', () => {
    const rules = prescribedRules(prescription({ side: 'right', exercise_versions: { id: 'custom-1', algorithm_key: 'joint-angle-v1', definition: { measurement_convention: '2d_joint_degrees', measured_joint: 'KNEE', name: ' Knee bend ', instructions_en: 'Bend.' } } }))
    expect(rules).toMatchObject({ kind: 'CUSTOM', side: 'RIGHT', measuredJoint: 'KNEE', focusJoint: 'KNEE', exerciseName: 'Knee bend' })
  })
  it('refuses what Android refuses', () => {
    expect(prescribedRules(prescription({ exercise_versions: null }))).toBeNull()
    expect(prescribedRules(prescription({}, { measurement_convention: '2d_joint_degrees' }))).toBeNull()
    expect(prescribedRules(prescription({}, { instructions_en: '' }))).toBeNull()
    expect(prescribedRules(prescription({ side: 'up' }))).toBeNull()
    expect(prescribedRules(prescription({ maximum_degrees: 25 }))).toBeNull()
    expect(prescribedRules(prescription({ exercise_versions: { id: 'x', algorithm_key: 'squat-v9', definition: {} } }))).toBeNull()
    expect(prescribedRules(prescription({ exercise_versions: { id: 'x', algorithm_key: 'joint-angle-v1', definition: { measurement_convention: '2d_joint_degrees', measured_joint: 'NECK', name: 'n', instructions_en: 'x' } } }))).toBeNull()
  })
  it('keeps instructions only in English when there is no Filipino', () => {
    expect(prescribedRules(prescription({}, { instructions: { en: 'Old style.' }, instructions_en: '' }))).not.toBeNull()
  })
})

/**
 * The real server rows for prescriptions the web published, which Android's decoder is tested against
 * (WebPublishedPrescriptionTest.kt). The web reads them to the same rules.
 */
describe('prescribedRules on the shared Android fixture', () => {
  const rows = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../android/app/src/test/resources/web-published-prescriptions.json'), 'utf8')) as Array<{ prescription_versions: RawPrescription[] }>
  const rules = (id: string) => prescribedRules(rows.flatMap((row) => row.prescription_versions).find((version) => version.id === id)!)

  it('reads a standard exercise with its targets and timing', () => {
    expect(rules('standard-version')).toMatchObject({ kind: 'ELBOW_FLEXION', side: 'RIGHT', lowDegrees: 25, highDegrees: 110, targetRepetitions: 6, minimumCycleMs: 750, maximumCycleMs: 20_000, peakHoldMs: 250, maxTrunkLeanDegrees: 15, confidence: Math.fround(0.7), focusJoint: 'KNEE', demo: false })
  })
  it('reads a custom exercise with its name, joint and both sides', () => {
    expect(rules('custom-version')).toMatchObject({ kind: 'CUSTOM', exerciseName: 'Seated knee extension', measuredJoint: 'KNEE', focusJoint: 'KNEE', side: 'LEFT', bilateral: true, sideSeconds: 90 })
  })
})

/** The same fields as android ExerciseJson.kt and SessionStore.kt, which ingest_session checks. */
describe('sessionPayload', () => {
  it('matches what the phone uploads', () => {
    const rules = createRules({ demo: false, prescriptionVersionId: 'version-1', version: 'exercise-1', targetRepetitions: 10 })
    const snapshot: AssessmentSnapshot = { ...EMPTY_SNAPSHOT, timestampMs: 9000, angleDegrees: 12.5, minimumDegrees: 10, maximumDegrees: 95, completed: 3, incomplete: 1, durationMs: 8000, validFrames: 80, invalidFrames: 4, failureReasons: { TOO_FAST: 1 } }
    expect(sessionPayload({ sessionId: 's-1', ownerId: 'p-1', consentId: 'c-1', rules, snapshot, startedAt: 1000, endedAt: 9500 })).toEqual({
      schemaVersion: 2, consentId: 'c-1', sessionId: 's-1', ownerId: 'p-1', startedAt: 1000, endedAt: 9500, client: 'web',
      rules: {
        kind: 'ELBOW_FLEXION', side: 'LEFT', low: 20, high: 90, target: 10, confidence: Math.fround(0.7), stableFrames: 5, minimumCycleMs: 600, maximumCycleMs: 30_000,
        peakHoldMs: 100, maxTrunkLean: 20, maxSpeed: 600, version: 'exercise-1', prescription: 'version-1', demo: false, measuredJoint: 'ELBOW', focusJoint: 'ELBOW',
      },
      metrics: { time: 9000, angle: 12.5, min: 10, max: 95, completed: 3, incomplete: 1, duration: 8000, valid: 80, invalid: 4, reasons: { TOO_FAST: 1 } },
    })
  })
  it('adds the name, the both-sides flag and the time per side only when they apply', () => {
    const rules = createRules({ kind: 'CUSTOM', measuredJoint: 'KNEE', exerciseName: 'Knee bend', bilateral: true, sideSeconds: 45, demo: false, prescriptionVersionId: 'v', version: 'e' })
    const payload = sessionPayload({ sessionId: 's', ownerId: 'p', consentId: 'c', rules, snapshot: EMPTY_SNAPSHOT, startedAt: 0, endedAt: 0 })
    expect(payload.rules).toMatchObject({ exerciseName: 'Knee bend', bilateral: true, sideSeconds: 45 })
    expect(payload.metrics).toMatchObject({ angle: null, min: null, max: null, reasons: {} })
  })
})
