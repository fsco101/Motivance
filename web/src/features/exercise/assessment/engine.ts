import {
  EMPTY_SNAPSHOT, f32, type AssessmentSnapshot, type ExerciseRules, type Landmark, type RepFeedback, type TrackingQuality,
} from './domain'
import { measurementChain } from './overlay'

/** Java's Math.toDegrees and toRadians constants, so conversions round exactly as on Android. */
export const toDegrees = (radians: number) => radians * 57.29577951308232
export const toRadians = (degrees: number) => degrees * 0.017453292519943295
export const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

const EDGE_LOW = f32(0.02), EDGE_HIGH = f32(0.98)
export const inFrame = (p: Landmark) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= EDGE_LOW && p.x <= EDGE_HIGH && p.y >= EDGE_LOW && p.y <= EDGE_HIGH

/** The angle at b between a and c, in pixel units so a wide or tall frame does not distort it. */
export function jointAngle(a: Landmark, b: Landmark, c: Landmark, width: number, height: number): number | null {
  if (width <= 0 || height <= 0) return null
  const ux = f32(a.x - b.x) * width, uy = f32(a.y - b.y) * height
  const vx = f32(c.x - b.x) * width, vy = f32(c.y - b.y) * height
  const first = Math.hypot(ux, uy), second = Math.hypot(vx, vy)
  if (!Number.isFinite(first) || !Number.isFinite(second) || first < 5 || second < 5) return null
  return toDegrees(Math.acos(clamp((ux * vx + uy * vy) / (first * second), -1, 1)))
}

/**
 * Counts repetitions from one person's landmarks, frame by frame. Port of MovementAssessment.kt: the phases, filters
 * and limits are the same so a movement gives the same count, range and feedback on the web and on a phone.
 * A new or recovered stream must find the start position again before anything counts.
 */
export class MovementAssessment {
  private state: AssessmentSnapshot
  private samples: number[] = []
  private stable = 0
  private lastFrame = -1
  private lastAngle: number | null = null
  private lastAngleTime = 0
  private cycleStarted = 0
  private peakStarted: number | null = null
  private lastClock: number | null = null

  constructor(readonly rules: ExerciseRules, restored?: AssessmentSnapshot | null) {
    this.state = { ...(restored ?? EMPTY_SNAPSHOT), timestampMs: 0, running: false, angleDegrees: null, phase: 'SEEKING_START', quality: 'PAUSED', feedback: 'NONE' }
  }

  get snapshot(): AssessmentSnapshot { return this.state }

  start(timestampMs: number): boolean {
    const s = this.state
    if (s.running || s.quality !== 'READY' || timestampMs < s.timestampMs || timestampMs - s.timestampMs > 1000) return false
    this.state = { ...s, running: true, phase: 'SEEKING_START', feedback: 'NONE' }
    this.lastClock = timestampMs
    return true
  }

  pause(timestampMs: number): AssessmentSnapshot {
    this.advance(timestampMs)
    this.resetCycle(); this.resetFilter()
    this.state = { ...this.state, timestampMs: Math.max(timestampMs, this.state.timestampMs), running: false, quality: 'PAUSED', angleDegrees: null, feedback: 'NONE' }
    this.lastClock = null
    return this.state
  }

  process(people: readonly (readonly Landmark[])[], width: number, height: number, time: number): AssessmentSnapshot {
    const rules = this.rules
    if (time <= this.lastFrame || time < this.state.timestampMs) return this.state
    if (this.lastFrame >= 0 && time - this.lastFrame > 1000) { this.resetCycle(); this.resetFilter() }
    this.lastFrame = time; this.advance(time)
    if (people.length === 0) return this.invalid('NO_PERSON', time)
    if (people.length !== 1) return this.invalid('MULTIPLE_PEOPLE', time)
    const points = people[0]!
    const chain = measurementChain(rules)
    const shoulder = rules.side === 'LEFT' ? 11 : 12
    const hip = shoulder + 12
    // The trunk (shoulder and hip) is always needed for the lean check; the chain defines the measured angle.
    const required = [...new Set([...chain.landmarks, shoulder, hip])]
    if (required.some((i) => { const p = points[i]; return !p || !Number.isFinite(p.visibility) || p.visibility < rules.confidence })) return this.invalid('LOW_CONFIDENCE', time)
    if (required.some((i) => !inFrame(points[i]!))) return this.invalid('OUT_OF_FRAME', time)
    const top = points[shoulder]!, bottom = points[hip]!
    if (f32(f32(bottom.y - top.y) * height) < 5) return this.invalid('DEGENERATE', time)
    const included = jointAngle(points[chain.proximal]!, points[chain.vertex]!, points[chain.distal]!, width, height)
    if (included === null) return this.invalid('DEGENERATE', time)
    const raw = chain.extendsProximal ? 180 - included : included
    const across = f32(Math.abs(f32(f32(top.x - bottom.x) * width))), down = f32(Math.abs(f32(f32(top.y - bottom.y) * height)))
    const lean = toDegrees(f32(Math.atan2(across, down)))
    if (lean > rules.maxTrunkLeanDegrees) return this.invalid('TRUNK_LEAN', time)
    const previous = this.lastAngle
    if (previous !== null && time > this.lastAngleTime && (Math.abs(raw - previous) * 1000) / (time - this.lastAngleTime) > rules.maxSpeedDegreesPerSecond) return this.invalid('OUTLIER', time)
    this.lastAngle = raw; this.lastAngleTime = time
    this.samples.push(raw); if (this.samples.length > 3) this.samples.shift()
    this.stable++
    if (this.stable < rules.stableFrames) {
      this.state = { ...this.state, timestampMs: time, quality: 'POSITIONING', angleDegrees: null, invalidFrames: this.state.invalidFrames + (this.state.running ? 1 : 0) }
      return this.state
    }
    const angle = [...this.samples].sort((a, b) => a - b)[Math.floor(this.samples.length / 2)]!
    this.state = { ...this.state, timestampMs: time, quality: 'READY', angleDegrees: angle, feedback: 'NONE' }
    if (!this.state.running) return this.state
    const s = this.state
    this.state = {
      ...s, validFrames: s.validFrames + 1,
      minimumDegrees: s.minimumDegrees === null ? angle : Math.min(s.minimumDegrees, angle),
      maximumDegrees: s.maximumDegrees === null ? angle : Math.max(s.maximumDegrees, angle),
    }
    if ((this.state.phase === 'MOVING' || this.state.phase === 'AT_TARGET') && time - this.cycleStarted > rules.maximumCycleMs) {
      this.incomplete('TIMED_OUT'); this.resetCycle(); return this.state
    }
    switch (this.state.phase) {
      case 'SEEKING_START':
        if (angle <= rules.lowDegrees) this.state = { ...this.state, phase: 'REST' }
        break
      case 'REST':
        if (angle > rules.lowDegrees + 5) { this.cycleStarted = time; this.state = { ...this.state, phase: 'MOVING' } }
        break
      case 'MOVING':
        if (angle >= rules.highDegrees) {
          if (this.peakStarted === null) this.peakStarted = time
          const held = time - this.peakStarted
          this.state = { ...this.state, holdElapsedMs: held }
          if (held >= rules.peakHoldMs) this.state = { ...this.state, phase: 'AT_TARGET', feedback: 'TARGET_REACHED' }
        } else { this.peakStarted = null; this.state = { ...this.state, holdElapsedMs: 0 } }
        if (angle <= rules.lowDegrees) {
          this.incomplete('INCOMPLETE_RANGE'); this.state = { ...this.state, phase: 'REST', holdElapsedMs: 0 }; this.peakStarted = null
        }
        break
      case 'AT_TARGET':
        if (angle <= rules.lowDegrees) {
          const valid = time - this.cycleStarted >= rules.minimumCycleMs
          if (!valid) this.incomplete('TOO_FAST')
          this.state = { ...this.state, completed: this.state.completed + (valid ? 1 : 0), phase: 'REST', holdElapsedMs: 0, feedback: valid ? 'COMPLETE' : 'TOO_FAST' }
          this.peakStarted = null
        }
        break
    }
    return this.state
  }

  private advance(time: number) {
    const last = this.lastClock
    if (this.state.running && last !== null && time >= last) this.state = { ...this.state, durationMs: this.state.durationMs + time - last }
    if (last === null || time >= last) this.lastClock = time
  }
  private resetCycle() { this.state = { ...this.state, phase: 'SEEKING_START', holdElapsedMs: 0 }; this.peakStarted = null; this.cycleStarted = 0 }
  private resetFilter() { this.stable = 0; this.samples = []; this.lastAngle = null }
  private incomplete(reason: RepFeedback) {
    const s = this.state
    this.state = { ...s, incomplete: s.incomplete + 1, feedback: reason, failureReasons: { ...s.failureReasons, [reason]: (s.failureReasons[reason] ?? 0) + 1 } }
  }
  private invalid(quality: TrackingQuality, time: number): AssessmentSnapshot {
    this.resetCycle(); this.resetFilter()
    this.state = { ...this.state, timestampMs: time, quality, angleDegrees: null, feedback: 'NONE', invalidFrames: this.state.invalidFrames + (this.state.running ? 1 : 0) }
    return this.state
  }
}

/** The result of one attempt, read from two consecutive snapshots (RepetitionOutcome.kt). Only active measurement counts. */
export type RepOutcome = { type: 'counted'; count: number } | { type: 'missed'; reason: RepFeedback }
export function repOutcome(before: AssessmentSnapshot, after: AssessmentSnapshot): RepOutcome | null {
  if (!after.running) return null
  if (after.completed > before.completed) return { type: 'counted', count: after.completed }
  if (after.incomplete > before.incomplete) return { type: 'missed', reason: after.feedback }
  return null
}
