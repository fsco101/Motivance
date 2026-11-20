import type { AssessmentSnapshot, BodySide, ExerciseRules } from '../assessment'

/**
 * The sides of one prescription, in order, and when each one ends (android/core/domain SideSet.kt). A both-sides
 * prescription runs left then right. A side with a time ends when the active measuring clock reaches it, even after the
 * target. Untimed, the left side of a both-sides set ends at the target, and every other side ends when the patient
 * presses Finish. The caller stops asking once a side has ended.
 */
export const SIDE_SET = { countdownSeconds: 5, announcementLimitMs: 6000 } as const

export type SideEvent = { type: 'targetReached' } | { type: 'sideEnded'; next: BodySide } | { type: 'setComplete' }

export const sidesOf = (rules: ExerciseRules): BodySide[] => (rules.bilateral ? ['LEFT', 'RIGHT'] : [rules.side])

export function nextSide(rules: ExerciseRules): BodySide | null {
  const sides = sidesOf(rules)
  return sides[sides.indexOf(rules.side) + 1] ?? null
}

/** Time left on this side, or null without a time. */
export const sideRemainingMs = (rules: ExerciseRules, s: AssessmentSnapshot) => (rules.sideSeconds === null ? null : Math.max(rules.sideSeconds * 1000 - s.durationMs, 0))

export function sideEvent(rules: ExerciseRules, before: AssessmentSnapshot, after: AssessmentSnapshot): SideEvent | null {
  if (!after.running) return null
  const next = nextSide(rules)
  const limit = rules.sideSeconds
  // Level-triggered, so a side past its time still ends on its first frame.
  if (limit !== null && after.durationMs >= limit * 1000) return next ? { type: 'sideEnded', next } : { type: 'setComplete' }
  if (before.completed < rules.targetRepetitions && after.completed >= rules.targetRepetitions) {
    if (limit !== null) return { type: 'targetReached' }
    if (next) return { type: 'sideEnded', next }
  }
  return null
}
