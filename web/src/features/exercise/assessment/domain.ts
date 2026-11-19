/**
 * Measurement types, mirroring android/core/domain Exercise.kt and Models.kt. The rules, names and limits must stay the
 * same as Android's, because both apps save sessions the therapist reads side by side. shared/assessment holds the
 * cases both engines must answer identically.
 */

/** Kotlin keeps landmarks and some arithmetic in 32-bit floats; rounding the same way keeps both engines' decisions equal. */
export const f32 = Math.fround

export type ExerciseKind = 'ELBOW_FLEXION' | 'SHOULDER_ABDUCTION' | 'CUSTOM'
export type BodySide = 'LEFT' | 'RIGHT'
export type BodyJoint = 'SHOULDER' | 'ELBOW' | 'WRIST' | 'HIP' | 'KNEE' | 'ANKLE'
export const BODY_JOINTS: readonly BodyJoint[] = ['SHOULDER', 'ELBOW', 'WRIST', 'HIP', 'KNEE', 'ANKLE']

/** MediaPipe pose landmark indices on the left side; the right side is one higher. */
const JOINTS: Record<BodyJoint, { point: number; chain: [number, number, number]; straightIsZero: boolean }> = {
  SHOULDER: { point: 11, chain: [23, 11, 13], straightIsZero: false },
  ELBOW: { point: 13, chain: [11, 13, 15], straightIsZero: true },
  WRIST: { point: 15, chain: [13, 15, 19], straightIsZero: true },
  HIP: { point: 23, chain: [11, 23, 25], straightIsZero: true },
  KNEE: { point: 25, chain: [23, 25, 27], straightIsZero: true },
  ANKLE: { point: 27, chain: [25, 27, 31], straightIsZero: true },
}
const shift = (side: BodySide) => (side === 'RIGHT' ? 1 : 0)
export const jointLandmark = (joint: BodyJoint, side: BodySide) => JOINTS[joint].point + shift(side)
export const jointChain = (joint: BodyJoint, side: BodySide) => JOINTS[joint].chain.map((i) => i + shift(side)) as [number, number, number]
/** 0° is the limb continuing straight through the joint; the shoulder instead reads 0° with the arm against the trunk. */
export const straightIsZero = (joint: BodyJoint) => JOINTS[joint].straightIsZero

export function kindJoint(kind: ExerciseKind): BodyJoint {
  if (kind === 'ELBOW_FLEXION') return 'ELBOW'
  if (kind === 'SHOULDER_ABDUCTION') return 'SHOULDER'
  throw new Error('A custom exercise names its own measured joint')
}

export interface Landmark { readonly x: number; readonly y: number; readonly visibility: number }
export const landmark = (x: number, y: number, visibility: number): Landmark => ({ x: f32(x), y: f32(y), visibility: f32(visibility) })

/** Seconds a therapist can give each side of a both-sides set (SideSet.kt). */
export const SIDE_SECONDS = { min: 15, max: 1800 } as const

/** Immutable parameters pinned for one session. Demo rules are never a prescription. */
export interface ExerciseRules {
  readonly kind: ExerciseKind
  readonly side: BodySide
  readonly lowDegrees: number
  readonly highDegrees: number
  readonly targetRepetitions: number
  readonly confidence: number
  readonly stableFrames: number
  readonly minimumCycleMs: number
  readonly maximumCycleMs: number
  readonly peakHoldMs: number
  readonly maxTrunkLeanDegrees: number
  readonly maxSpeedDegreesPerSecond: number
  readonly version: string
  readonly prescriptionVersionId: string | null
  readonly demo: boolean
  readonly measuredJoint: BodyJoint
  readonly focusJoint: BodyJoint
  /** The therapist's name for a custom exercise. Built-in exercises use their translated names. */
  readonly exerciseName: string | null
  /** This side belongs to a both-sides prescription, which runs left then right. */
  readonly bilateral: boolean
  /** The therapist's time for each side. Null means no limit. */
  readonly sideSeconds: number | null
}

type Overrides = { [K in keyof ExerciseRules]?: ExerciseRules[K] | undefined }

/** Builds rules with Android's defaults and refuses the same invalid combinations ExerciseRules' init block refuses. */
export function createRules(overrides: Overrides = {}): ExerciseRules {
  const given = Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined)) as Partial<ExerciseRules>
  const kind = given.kind ?? 'ELBOW_FLEXION'
  const measuredJoint = given.measuredJoint ?? kindJoint(kind)
  const rules: ExerciseRules = {
    kind, side: 'LEFT', lowDegrees: 20, highDegrees: 90, targetRepetitions: 5, confidence: f32(0.7), stableFrames: 5,
    minimumCycleMs: 600, maximumCycleMs: 30_000, peakHoldMs: 100, maxTrunkLeanDegrees: 20, maxSpeedDegreesPerSecond: 600,
    version: 'demo-v1', prescriptionVersionId: null, demo: true, exerciseName: null, bilateral: false, sideSeconds: null,
    ...given, measuredJoint, focusJoint: given.focusJoint ?? measuredJoint,
  }
  const confidence = f32(rules.confidence)
  const fail = (why: string) => { throw new Error(`Invalid exercise rules: ${why}`) }
  if (rules.sideSeconds !== null && (rules.sideSeconds < SIDE_SECONDS.min || rules.sideSeconds > SIDE_SECONDS.max)) fail('side time')
  if (kind === 'CUSTOM' ? !rules.exerciseName?.trim() : measuredJoint !== kindJoint(kind) || rules.exerciseName !== null) fail('exercise')
  const { lowDegrees: low, highDegrees: high } = rules
  if (!Number.isFinite(low) || !Number.isFinite(high) || low < 0 || high > 180 || !(high > low + 10)) fail('thresholds')
  if (!Number.isInteger(rules.targetRepetitions) || rules.targetRepetitions < 1 || rules.targetRepetitions > 1000) fail('repetitions')
  if (confidence < f32(0.1) || confidence > 1 || !(rules.stableFrames > 0)) fail('confidence')
  if (!(rules.minimumCycleMs > 0) || !(rules.maximumCycleMs > rules.minimumCycleMs) || !(rules.peakHoldMs >= 0)) fail('timing')
  if (!Number.isFinite(rules.maxSpeedDegreesPerSecond) || !(rules.maxSpeedDegreesPerSecond > 0)) fail('speed')
  if (!Number.isFinite(rules.maxTrunkLeanDegrees) || rules.maxTrunkLeanDegrees < 0 || rules.maxTrunkLeanDegrees > 90) fail('trunk lean')
  if (!rules.version.trim() || (!rules.demo && !rules.prescriptionVersionId?.trim())) fail('version')
  return Object.freeze({ ...rules, confidence })
}

export type TrackingQuality = 'NO_PERSON' | 'MULTIPLE_PEOPLE' | 'LOW_CONFIDENCE' | 'OUT_OF_FRAME' | 'DEGENERATE' | 'OUTLIER' | 'POSITIONING' | 'TRUNK_LEAN' | 'READY' | 'PAUSED'
export type MovementPhase = 'SEEKING_START' | 'REST' | 'MOVING' | 'AT_TARGET'
export type RepFeedback = 'NONE' | 'TARGET_REACHED' | 'COMPLETE' | 'INCOMPLETE_RANGE' | 'TOO_FAST' | 'TIMED_OUT'
/** In Kotlin's declaration order, which saved summaries and the shared cases list failure reasons in. */
export const REP_FEEDBACK: readonly RepFeedback[] = ['NONE', 'TARGET_REACHED', 'COMPLETE', 'INCOMPLETE_RANGE', 'TOO_FAST', 'TIMED_OUT']

export interface AssessmentSnapshot {
  readonly timestampMs: number
  readonly quality: TrackingQuality
  readonly angleDegrees: number | null
  readonly minimumDegrees: number | null
  readonly maximumDegrees: number | null
  readonly completed: number
  readonly incomplete: number
  readonly durationMs: number
  readonly validFrames: number
  readonly invalidFrames: number
  readonly phase: MovementPhase
  readonly feedback: RepFeedback
  readonly running: boolean
  readonly failureReasons: Readonly<Partial<Record<RepFeedback, number>>>
  /** Time spent at or above the high threshold in the current attempt. Live-only; not saved. */
  readonly holdElapsedMs: number
}

export const EMPTY_SNAPSHOT: AssessmentSnapshot = Object.freeze({
  timestampMs: 0, quality: 'NO_PERSON', angleDegrees: null, minimumDegrees: null, maximumDegrees: null, completed: 0,
  incomplete: 0, durationMs: 0, validFrames: 0, invalidFrames: 0, phase: 'SEEKING_START', feedback: 'NONE', running: false,
  failureReasons: {}, holdElapsedMs: 0,
})

export const romDegrees = (s: AssessmentSnapshot) =>
  s.minimumDegrees !== null && s.maximumDegrees !== null ? s.maximumDegrees - s.minimumDegrees : null
