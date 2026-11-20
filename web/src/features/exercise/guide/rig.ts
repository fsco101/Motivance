import type { BodyJoint, BodySide, ExerciseRules } from '../assessment'

/**
 * The poses of the guide character, a model person who demonstrates each exercise (android/core/domain ExerciseGuide.kt).
 * It turns a joint angle into body positions with the camera's angle conventions, so the character shows what is
 * measured. Units are 1% of standing height, with y growing downward and the floor at FLOOR.
 */
export type GuideView = 'FRONT' | 'SIDE'
export type GuidePosture = 'STANDING' | 'SEATED'
export interface GuidePoint { x: number; y: number }
/** A limb from its root to its tip: shoulder, elbow, wrist, fingertip or hip, knee, ankle, toe. */
export interface GuideLimb { root: GuidePoint; middle: GuidePoint; end: GuidePoint; tip: GuidePoint }
export interface GuideFrame { centerX: number; centerY: number; span: number }
export interface GuidePose {
  view: GuideView; facing: number; posture: GuidePosture; head: GuidePoint; neck: GuidePoint; shoulders: GuidePoint; hips: GuidePoint
  nearArm: GuideLimb; farArm: GuideLimb; nearLeg: GuideLimb; farLeg: GuideLimb
  /** The joint being demonstrated, and the point on the moving part that sweeps around it. */
  pivot: GuidePoint; reach: GuidePoint
}
export interface GuideMotion { joint: BodyJoint; side: BodySide; view: GuideView; posture: GuidePosture; low: number; high: number }

export const FLOOR = 100
export const HEAD_RADIUS = 6.6
export const SEAT_HEIGHT = 76
const ANKLE_HEIGHT = 96, UPPER_ARM = 16.5, FOREARM = 14.5, HAND = 6.5, THIGH = 23.5, SHANK = 23, FOOT = 11, TRUNK = 30

/** The character faces the way a patient would, with the working side toward the camera. */
export const motionFacing = (m: GuideMotion) => (m.side === 'LEFT' ? -1 : 1)

export function motionFrame(m: GuideMotion): GuideFrame {
  const f = motionFacing(m)
  if (m.joint === 'WRIST') return { centerX: 13 * f, centerY: 34, span: 66 }
  if (m.joint === 'ANKLE') return { centerX: 18 * f, centerY: 80, span: 56 }
  if (m.joint === 'SHOULDER') return m.high > 125 ? { centerX: 0, centerY: 41, span: 124 } : { centerX: 0, centerY: 50, span: 108 }
  return m.posture === 'SEATED' ? { centerX: 14 * f, centerY: 52, span: 108 } : { centerX: 6 * f, centerY: 50, span: 108 }
}

/** Out and back with a rest at each end, so a patient can see both the start and the target. */
export function guideProgress(time: number) {
  const t = time - Math.floor(time)
  const ease = (x: number) => (1 - Math.cos(Math.PI * x)) / 2
  if (t < 0.1) return 0
  if (t < 0.45) return ease((t - 0.1) / 0.35)
  if (t < 0.6) return 1
  if (t < 0.95) return 1 - ease((t - 0.6) / 0.35)
  return 0
}

/** Where the character is at `time`, from 0 to 1 through one repetition. */
export const motionAngleAt = (m: GuideMotion, time: number) => m.low + (m.high - m.low) * guideProgress(time)

const ANATOMICAL: Record<BodyJoint, [number, number]> = { SHOULDER: [0, 175], ELBOW: [0, 150], WRIST: [0, 80], HIP: [0, 120], KNEE: [0, 130], ANKLE: [60, 125] }
const TYPICAL: Record<BodyJoint, [number, number]> = { SHOULDER: [15, 110], ELBOW: [20, 120], WRIST: [5, 60], HIP: [10, 80], KNEE: [15, 90], ANKLE: [90, 115] }
/** Sitting upright already bends the hip to 90°, so a seated thigh can only lift from the chair. */
const SEATED_HIP: [number, number] = [90, 120]
const SEATED_HIP_LIFT = 115
const within = (value: number, [low, high]: [number, number]) => Math.min(Math.max(value, low), high)

/**
 * The guide for one exercise. A prescribed range is shown as prescribed, within what a body can do. Knee and ankle work
 * is shown seated, and a therapist's own exercise can ask for either posture in its name.
 */
export function guideMotion(joint: BodyJoint, side: BodySide = 'LEFT', name: string | null = null, low: number | null = null, high: number | null = null): GuideMotion {
  const words = (name ?? '').toLowerCase()
  const seatedByDefault = joint === 'KNEE' || joint === 'ANKLE'
  const seated = joint === 'SHOULDER' || joint === 'ELBOW' || joint === 'WRIST' ? false
    : ['stand', 'tayo'].some((w) => words.includes(w)) ? joint === 'ANKLE'
      : ['seat', 'sit', 'upo'].some((w) => words.includes(w)) ? true
        : seatedByDefault
  const seatedHip = seated && joint === 'HIP'
  const limits = seatedHip ? SEATED_HIP : ANATOMICAL[joint]
  const [usualLow, usualHigh] = seatedHip ? [SEATED_HIP[0], SEATED_HIP_LIFT] : TYPICAL[joint]
  const shownLow = within(low ?? usualLow, limits)
  const shownHigh = within(high ?? usualHigh, limits)
  // A range wholly below the chair cannot be shown seated, so the usual lift stands in for it.
  const belowTheChair = seatedHip && shownHigh <= shownLow
  return {
    joint, side, view: joint === 'SHOULDER' ? 'FRONT' : 'SIDE', posture: seated ? 'SEATED' : 'STANDING',
    low: belowTheChair ? usualLow : shownLow, high: belowTheChair ? usualHigh : shownHigh,
  }
}

export const guideMotionFor = (rules: ExerciseRules) => guideMotion(rules.measuredJoint, rules.side, rules.exerciseName, rules.lowDegrees, rules.highDegrees)

const add = (a: GuidePoint, b: GuidePoint): GuidePoint => ({ x: a.x + b.x, y: a.y + b.y })
/** A direction by angle: 0 straight down, 90 forward, 180 straight up. */
const way = (degrees: number, facing: number, length: number): GuidePoint => ({ x: facing * Math.sin((degrees * Math.PI) / 180) * length, y: Math.cos((degrees * Math.PI) / 180) * length })
function arm(root: GuidePoint, upper: number, fore: number, hand: number, facing: number): GuideLimb {
  const middle = add(root, way(upper, facing, UPPER_ARM)), end = add(middle, way(fore, facing, FOREARM))
  return { root, middle, end, tip: add(end, way(hand, facing, HAND)) }
}
function leg(root: GuidePoint, thigh: number, shank: number, foot: number, facing: number): GuideLimb {
  const middle = add(root, way(thigh, facing, THIGH)), end = add(middle, way(shank, facing, SHANK))
  return { root, middle, end, tip: add(end, way(foot, facing, FOOT)) }
}

export const posed = (m: GuideMotion, angle: number): GuidePose => (m.view === 'FRONT' ? front(m, angle) : side(m, angle))

/** Facing the camera. The patient's left arm is on the right of the picture. */
function front(m: GuideMotion, angle: number): GuidePose {
  const working = m.side === 'LEFT' ? 1 : -1
  const hips = { x: 0, y: ANKLE_HEIGHT - THIGH - SHANK }
  const shoulders = { x: 0, y: hips.y - TRUNK }
  const near = arm({ x: 9.5 * working, y: shoulders.y + 1.5 }, angle, angle + 4, angle + 4, working)
  const far = arm({ x: -9.5 * working, y: shoulders.y + 1.5 }, 7, 11, 11, -working)
  const standing = (sign: number) => { const l = leg({ x: 5.5 * sign, y: hips.y + 1 }, 3, 1, 3, sign); return { ...l, tip: add(l.end, { x: 3 * sign, y: FLOOR - 1 - l.end.y }) } }
  return {
    view: 'FRONT', facing: working, posture: 'STANDING', head: { x: 0, y: shoulders.y - 11 }, neck: { x: 0, y: shoulders.y - 3.5 }, shoulders, hips,
    nearArm: near, farArm: far, nearLeg: standing(working), farLeg: standing(-working), pivot: near.root, reach: near.middle,
  }
}

/** Side on, with the working side toward the camera, as the camera needs for these joints. */
function side(m: GuideMotion, angle: number): GuidePose {
  const f = motionFacing(m)
  const seated = m.posture === 'SEATED'
  const hips = seated ? { x: -6 * f, y: ANKLE_HEIGHT - SHANK - 1 } : { x: 0, y: ANKLE_HEIGHT - THIGH - SHANK }
  const shoulders = add(hips, { x: 0, y: -TRUNK })
  const shoulder = add(shoulders, { x: 0, y: 1.5 })
  const restThigh = seated ? 90 : 2, restShank = seated ? 0 : -2
  const rest = leg(hips, restThigh, restShank, 90 + restShank, f)
  const relaxed = seated ? arm(shoulder, 14, 62, 66, f) : arm(shoulder, -4, 6, 10, f)
  const farLeg = seated ? rest : leg(hips, -3, -7, 83, f)
  const farArm = seated ? arm(shoulder, 10, 58, 62, f) : arm(shoulder, 5, 14, 18, f)
  let nearArm = relaxed, nearLeg = rest, pivot = rest.middle, reach = rest.end
  switch (m.joint) {
    case 'ELBOW': nearArm = arm(shoulder, 0, angle, angle, f); pivot = nearArm.middle; reach = nearArm.end; break
    case 'WRIST': nearArm = arm(shoulder, 10, 90, 90 + angle, f); pivot = nearArm.end; reach = nearArm.tip; break
    case 'HIP': {
      // Standing, the knee relaxes as the thigh rises. Seated, the shin stays upright. The hip angle is measured to the knee.
      const shank = seated ? 0 : angle * 0.45
      nearLeg = leg(hips, angle, shank, shank + 90, f); pivot = hips; reach = nearLeg.middle; break
    }
    case 'KNEE': {
      const thigh = seated ? 90 : 0
      const shank = thigh - angle
      nearLeg = leg(hips, thigh, shank, shank + 90, f); pivot = nearLeg.middle; reach = nearLeg.end; break
    }
    case 'ANKLE': nearLeg = leg(hips, restThigh, restShank, restShank + angle, f); pivot = nearLeg.end; reach = nearLeg.tip; break
    case 'SHOULDER': throw new Error('The shoulder is shown from the front')
  }
  return {
    view: 'SIDE', facing: f, posture: m.posture, head: add(shoulders, { x: 1.2 * f, y: -11 }), neck: add(shoulders, { x: 0.6 * f, y: -3.5 }),
    shoulders, hips, nearArm, farArm, nearLeg, farLeg, pivot, reach,
  }
}
