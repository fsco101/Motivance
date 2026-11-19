import { REP_FEEDBACK, type AssessmentSnapshot, type ExerciseRules } from '../assessment'

interface Session {
  sessionId: string
  ownerId: string
  consentId: string
  rules: ExerciseRules
  snapshot: AssessmentSnapshot
  /** Milliseconds since 1970, as Android sends them. */
  startedAt: number
  endedAt: number
}

/**
 * The session as ingest_session takes it: the same fields as Android's upload (ExerciseJson.kt and SessionStore.kt),
 * plus `client`, so validation can tell a web session from a phone one. The patient never sees it.
 */
export function sessionPayload({ sessionId, ownerId, consentId, rules: r, snapshot: s, startedAt, endedAt }: Session) {
  const rules: Record<string, unknown> = {
    kind: r.kind, side: r.side, low: r.lowDegrees, high: r.highDegrees, target: r.targetRepetitions, confidence: r.confidence,
    stableFrames: r.stableFrames, minimumCycleMs: r.minimumCycleMs, maximumCycleMs: r.maximumCycleMs, peakHoldMs: r.peakHoldMs,
    maxTrunkLean: r.maxTrunkLeanDegrees, maxSpeed: r.maxSpeedDegreesPerSecond, version: r.version, prescription: r.prescriptionVersionId,
    demo: r.demo, measuredJoint: r.measuredJoint, focusJoint: r.focusJoint,
  }
  if (r.exerciseName !== null) rules.exerciseName = r.exerciseName
  if (r.bilateral) rules.bilateral = true
  if (r.sideSeconds !== null) rules.sideSeconds = r.sideSeconds
  const reasons = Object.fromEntries(REP_FEEDBACK.flatMap((reason) => (s.failureReasons[reason] === undefined ? [] : [[reason, s.failureReasons[reason]]])))
  return {
    schemaVersion: 2, consentId, sessionId, ownerId, startedAt, endedAt, client: 'web' as const, rules,
    metrics: {
      time: s.timestampMs, angle: s.angleDegrees, min: s.minimumDegrees, max: s.maximumDegrees, completed: s.completed, incomplete: s.incomplete,
      duration: s.durationMs, valid: s.validFrames, invalid: s.invalidFrames, reasons,
    },
  }
}
