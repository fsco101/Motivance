import { describe, expect, it } from 'vitest'
import { BODY_JOINTS, createRules } from '../assessment'
import { FLOOR, guideMotion, guideMotionFor, guideProgress, motionAngleAt, motionFrame, posed, type GuidePoint } from './rig'

/** The same cases and numbers as android/core/domain ExerciseGuideTest.kt. */
const interior = (a: GuidePoint, b: GuidePoint, c: GuidePoint) => {
  const ux = a.x - b.x, uy = a.y - b.y, vx = c.x - b.x, vy = c.y - b.y
  return (Math.acos(Math.min(1, Math.max(-1, (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy))))) * 180) / Math.PI
}
const length = (a: GuidePoint, b: GuidePoint) => Math.hypot(a.x - b.x, a.y - b.y)
const angle = (expected: number, actual: number) => expect(actual).toBeCloseTo(expected, 2)

describe('the guide rig', () => {
  it('bends the elbow as the camera measures it at every angle', () => {
    const motion = guideMotion('ELBOW')
    for (const a of [0, 20, 90, 120, 150]) { const arm = posed(motion, a).nearArm; angle(180 - a, interior(arm.root, arm.middle, arm.end)) }
  })
  it('measures the shoulder from the trunk', () => {
    const motion = guideMotion('SHOULDER')
    for (const a of [45, 90, 120, 170]) { const pose = posed(motion, a); angle(a, interior({ x: pose.nearArm.root.x, y: pose.hips.y }, pose.nearArm.root, pose.nearArm.middle)) }
  })
  it('matches the camera at the wrist, hip and knee', () => {
    const wrist = posed(guideMotion('WRIST'), 40).nearArm
    angle(140, interior(wrist.middle, wrist.end, wrist.tip))
    const hip = posed(guideMotion('HIP'), 70)
    angle(110, interior(hip.shoulders, hip.hips, hip.nearLeg.middle))
    for (const name of [null, 'Standing knee curl']) { const leg = posed(guideMotion('KNEE', 'LEFT', name), 60).nearLeg; angle(120, interior(leg.root, leg.middle, leg.end)) }
  })
  it('lifts a seated hip from the chair and never passes through it', () => {
    const motion = guideMotion('HIP', 'LEFT', 'Seated hip flexion')
    expect(motion.low).toBe(90)
    expect(motion.high).toBeGreaterThan(motion.low)
    const rest = posed(motion, motion.low)
    expect(rest.nearLeg.middle.y).toBeCloseTo(rest.hips.y, 3)
    for (const a of [motion.low, 100, motion.high]) {
      const pose = posed(motion, a)
      angle(180 - a, interior(pose.shoulders, pose.hips, pose.nearLeg.middle))
      expect(Math.max(pose.nearLeg.end.y, pose.nearLeg.tip.y)).toBeLessThanOrEqual(FLOOR)
    }
    expect(guideMotion('HIP', 'LEFT', 'Seated hip flexion', 60, 110)).toMatchObject({ low: 90, high: 110 })
    const below = guideMotion('HIP', 'LEFT', 'Pag-upo at pag-angat ng hita', 10, 80)
    expect(below.low).toBe(90)
    expect(below.high).toBeGreaterThan(below.low)
    expect(guideMotion('HIP', 'LEFT', null, 10, 80).low).toBe(10)
  })
  it('follows the flat-foot convention at the ankle', () => {
    const motion = guideMotion('ANKLE')
    const flat = posed(motion, 90).nearLeg
    expect(Math.abs(flat.end.y - flat.tip.y)).toBeLessThan(0.5)
    const lifted = posed(motion, 115).nearLeg
    angle(65, interior(lifted.middle, lifted.end, lifted.tip))
    expect(lifted.tip.y).toBeLessThan(flat.tip.y)
  })
  it('never stretches a limb and keeps the person on the floor', () => {
    for (const joint of BODY_JOINTS) {
      const motion = guideMotion(joint)
      const first = posed(motion, motion.low), last = posed(motion, motion.high)
      expect(length(first.nearArm.root, first.nearArm.middle)).toBeCloseTo(length(last.nearArm.root, last.nearArm.middle), 3)
      expect(length(first.nearLeg.middle, first.nearLeg.end)).toBeCloseTo(length(last.nearLeg.middle, last.nearLeg.end), 3)
      for (const side of ['LEFT', 'RIGHT'] as const) {
        const pose = posed(guideMotion(joint, side), guideMotion(joint, side).low)
        const lowest = Math.max(pose.farLeg.end.y, pose.farLeg.tip.y)
        expect(lowest).toBeLessThanOrEqual(FLOOR)
        expect(lowest).toBeGreaterThan(FLOOR - 8)
      }
    }
  })
  it('turns the working side toward the camera, and shows each joint the way the camera sees it', () => {
    expect(posed(guideMotion('ELBOW', 'LEFT'), 90).nearArm.end.x).toBeLessThan(0)
    expect(posed(guideMotion('ELBOW', 'RIGHT'), 90).nearArm.end.x).toBeGreaterThan(0)
    expect(posed(guideMotion('SHOULDER', 'LEFT'), 90).nearArm.end.x).toBeGreaterThan(0)
    expect(posed(guideMotion('SHOULDER', 'RIGHT'), 90).nearArm.end.x).toBeLessThan(0)
    expect(guideMotion('SHOULDER').view).toBe('FRONT')
    for (const joint of BODY_JOINTS.filter((j) => j !== 'SHOULDER')) expect(guideMotion(joint).view).toBe('SIDE')
  })
  it('lets a therapist\'s name choose the posture', () => {
    expect(guideMotion('KNEE').posture).toBe('SEATED')
    expect(guideMotion('KNEE', 'LEFT', 'Seated knee extension').posture).toBe('SEATED')
    expect(guideMotion('KNEE', 'LEFT', 'Standing knee curl').posture).toBe('STANDING')
    expect(guideMotion('HIP').posture).toBe('STANDING')
    expect(guideMotion('HIP', 'LEFT', 'Pag-upo at pag-angat ng hita').posture).toBe('SEATED')
  })
  it('shows the prescribed range within what a body can do, and reads it from the rules', () => {
    expect(guideMotion('ELBOW', 'LEFT', null, 25, 110)).toMatchObject({ low: 25, high: 110 })
    expect(guideMotion('ELBOW', 'LEFT', null, 20, 180).high).toBe(150)
    const motion = guideMotionFor(createRules({ kind: 'CUSTOM', side: 'RIGHT', lowDegrees: 15, highDegrees: 80, measuredJoint: 'KNEE', exerciseName: 'Standing knee curl', demo: false, prescriptionVersionId: 'p' }))
    expect(motion).toMatchObject({ joint: 'KNEE', side: 'RIGHT', posture: 'STANDING', high: 80 })
  })
  it('goes out, holds and comes back in one smooth repetition', () => {
    const motion = guideMotion('ELBOW', 'LEFT', null, 20, 120)
    expect(motionAngleAt(motion, 0)).toBeCloseTo(20, 3)
    expect(motionAngleAt(motion, 0.5)).toBeCloseTo(120, 3)
    expect(motionAngleAt(motion, 0.99)).toBeCloseTo(20, 3)
    for (let i = 0; i < 1000; i++) expect(Math.abs(guideProgress((i + 1) / 1000) - guideProgress(i / 1000))).toBeLessThan(0.02)
  })
  it('frames small movements closer', () => {
    expect(motionFrame(guideMotion('WRIST', 'RIGHT'))).toEqual({ centerX: 13, centerY: 34, span: 66 })
    expect(motionFrame(guideMotion('SHOULDER', 'LEFT', null, 15, 170))).toEqual({ centerX: 0, centerY: 41, span: 124 })
  })
})
