import { BODY_JOINTS, createRules, kindJoint, type BodyJoint, type ExerciseKind, type ExerciseRules } from '../assessment'

/** A prescription version as the web reads it, with its exercise version. */
export interface RawPrescription {
  id: string
  side: string
  minimum_degrees: number
  maximum_degrees: number
  target_repetitions: number
  parameters: unknown
  exercise_versions: { id: string; algorithm_key: string; definition: unknown } | null
}

const KINDS: Record<string, ExerciseKind> = { 'elbow-flexion-v1': 'ELBOW_FLEXION', 'shoulder-abduction-v1': 'SHOULDER_ABDUCTION', 'joint-angle-v1': 'CUSTOM' }
const CONVENTIONS: Record<ExerciseKind, string> = { ELBOW_FLEXION: '2d_flexion_degrees', SHOULDER_ABDUCTION: '2d_abduction_degrees', CUSTOM: '2d_joint_degrees' }
const text = (value: unknown) => (typeof value === 'string' ? value : '')
const joint = (value: unknown) => (BODY_JOINTS.includes(value as BodyJoint) ? (value as BodyJoint) : null)
const num = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)

/**
 * The rules a session measures with, read from the prescription exactly as Android reads them (PrescriptionCache.kt):
 * the same defaults, and the same refusals. ingest_session checks every one of these against the prescription.
 */
export function prescribedRules(p: RawPrescription): ExerciseRules | null {
  const exercise = p.exercise_versions
  if (!exercise) return null
  const kind = KINDS[exercise.algorithm_key]
  if (!kind) return null
  const definition = (exercise.definition ?? {}) as Record<string, unknown>
  if (definition.measurement_convention !== CONVENTIONS[kind]) return null
  const measured = kind === 'CUSTOM' ? joint(definition.measured_joint) : kindJoint(kind)
  if (!measured) return null
  // A both-sides plan starts on the left; each side is saved as its own session.
  const side = p.side === 'left' || p.side === 'bilateral' ? 'LEFT' : p.side === 'right' ? 'RIGHT' : null
  if (!side) return null
  const legacy = (definition.instructions ?? {}) as Record<string, unknown>
  if (!(text(definition.instructions_en).trim() || text(legacy.en).trim())) return null
  const parameters = (p.parameters ?? {}) as Record<string, unknown>
  const focus = parameters.focus_joint === undefined ? measured : joint(parameters.focus_joint)
  if (!focus) return null
  try {
    return createRules({
      kind, side, lowDegrees: p.minimum_degrees, highDegrees: p.maximum_degrees, targetRepetitions: p.target_repetitions,
      confidence: num(parameters.confidence, 0.7), minimumCycleMs: num(parameters.minimum_cycle_ms, 600), maximumCycleMs: num(parameters.maximum_cycle_ms, 30_000),
      peakHoldMs: num(parameters.peak_hold_ms, 100), maxTrunkLeanDegrees: num(parameters.max_trunk_lean_degrees, 20),
      version: exercise.id, prescriptionVersionId: p.id, demo: false, focusJoint: focus, measuredJoint: measured,
      exerciseName: kind === 'CUSTOM' ? text(definition.name).trim() : null,
      bilateral: p.side === 'bilateral', sideSeconds: typeof parameters.side_seconds === 'number' ? parameters.side_seconds : null,
    })
  } catch {
    return null
  }
}
