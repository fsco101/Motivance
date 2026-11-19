import { f32, jointChain, straightIsZero, type AssessmentSnapshot, type ExerciseRules, type Landmark } from './domain'
import { clamp, inFrame, toDegrees, toRadians } from './engine'

/**
 * The three landmarks an exercise is measured on, shared by the engine and the drawn protractor so the protractor is
 * the same calculation that counts repetitions (MeasurementGeometry.kt). The angle is between a 0° reference leaving
 * the vertex and the moving segment: elbow, wrist, hip, knee and ankle read 0° straight, the shoulder 0° arm at side.
 */
export interface MeasurementChain { proximal: number; vertex: number; distal: number; extendsProximal: boolean; landmarks: number[] }
export function measurementChain(rules: ExerciseRules): MeasurementChain {
  const [proximal, vertex, distal] = jointChain(rules.measuredJoint, rules.side)
  return { proximal, vertex, distal, extendsProximal: straightIsZero(rules.measuredJoint), landmarks: [proximal, vertex, distal] }
}

/** A point in normalised frame coordinates (0..1). */
export interface FramePoint { readonly x: number; readonly y: number }
const framePoint = (x: number, y: number): FramePoint => ({ x: f32(x), y: f32(y) })

export interface Protractor {
  vertex: FramePoint
  referenceEnd: FramePoint
  movingEnd: FramePoint
  /** Arc from 0° to this frame's unfiltered angle. */
  measuredArc: FramePoint[]
  /** Start zone: 0° to the therapist's low threshold. */
  startZone: FramePoint[]
  /** Target zone: the therapist's high threshold to 180°. */
  targetZone: FramePoint[]
  lowTick: [FramePoint, FramePoint]
  highTick: [FramePoint, FramePoint]
  lowLabel: FramePoint
  highLabel: FramePoint
  angleLabel: FramePoint
  rawAngleDegrees: number
}

const ARC_STEP_DEGREES = 3

/**
 * The protractor for one frame, or null if a measured landmark fails the confidence and frame checks the engine uses.
 * Points come from the frame's pixel geometry, so they stay right when the picture is scaled or mirrored.
 * minRadiusPx keeps it legible when the limb is small on screen.
 */
export function protractor(points: readonly Landmark[], rules: ExerciseRules, width: number, height: number, minRadiusPx = 0): Protractor | null {
  if (width <= 0 || height <= 0) return null
  const chain = measurementChain(rules)
  if (chain.landmarks.some((i) => { const p = points[i]; return !p || !Number.isFinite(p.visibility) || p.visibility < rules.confidence || !inFrame(p) })) return null
  const px = (i: number) => [points[i]!.x * width, points[i]!.y * height] as const
  const p = px(chain.proximal), v = px(chain.vertex), d = px(chain.distal)
  const proximalLength = Math.hypot(v[0] - p[0], v[1] - p[1]), distalLength = Math.hypot(d[0] - v[0], d[1] - v[1])
  if (proximalLength < 5 || distalLength < 5) return null
  const rx = (chain.extendsProximal ? v[0] - p[0] : p[0] - v[0]) / proximalLength
  const ry = (chain.extendsProximal ? v[1] - p[1] : p[1] - v[1]) / proximalLength
  const mx = (d[0] - v[0]) / distalLength, my = (d[1] - v[1]) / distalLength
  const raw = toDegrees(Math.acos(clamp(rx * mx + ry * my, -1, 1)))
  // Arcs sweep toward the moving segment; a perfectly straight pose sweeps positively.
  const sign = rx * my - ry * mx < 0 ? -1 : 1
  const radius = Math.max(0.42 * Math.min(proximalLength, distalLength), minRadiusPx)
  // Negative angles fall on the far side of the 0° reference, where no zone or tick is drawn.
  const at = (degrees: number, scale: number) => {
    const a = toRadians(clamp(degrees, -180, 180)) * sign
    const x = v[0] + (rx * Math.cos(a) - ry * Math.sin(a)) * radius * scale
    const y = v[1] + (rx * Math.sin(a) + ry * Math.cos(a)) * radius * scale
    return framePoint(x / width, y / height)
  }
  const arc = (rawFrom: number, rawTo: number, scale = 1) => {
    const from = clamp(rawFrom, 0, 180), to = clamp(rawTo, 0, 180)
    if (to <= from) return [at(from, scale)]
    const steps = Math.max(1, Math.ceil((to - from) / ARC_STEP_DEGREES))
    return Array.from({ length: steps + 1 }, (_, i) => at(from + ((to - from) * i) / steps, scale))
  }
  const low = clamp(rules.lowDegrees, 0, 180), high = clamp(rules.highDegrees, 0, 180)
  return {
    vertex: at(0, 0),
    referenceEnd: at(0, 1.6),
    movingEnd: framePoint(points[chain.distal]!.x, points[chain.distal]!.y),
    measuredArc: arc(0, raw),
    startZone: arc(0, rules.lowDegrees),
    targetZone: arc(rules.highDegrees, 180),
    lowTick: [at(low, 0.72), at(low, 1.28)],
    highTick: [at(high, 0.72), at(high, 1.28)],
    lowLabel: at(rules.lowDegrees, 1.62),
    highLabel: at(rules.highDegrees, 1.62),
    // Small sweeps leave no room inside the arc, so the value sits just across the reference.
    angleLabel: raw >= 30 ? at(raw / 2, 0.62) : at(-30, 1.15),
    rawAngleDegrees: raw,
  }
}

/** Steps of the repetition rule, in the order the engine requires them. */
export type RepStep = 'START' | 'REACH' | 'HOLD' | 'RETURN'
export interface RepetitionGuide { step: RepStep | null; targetProgress: number | null; holdProgress: number }

/** What the patient must do next and how far along the step is, from engine state only. */
export function repetitionGuide(rules: ExerciseRules, s: AssessmentSnapshot): RepetitionGuide {
  const angle = s.quality === 'READY' && s.angleDegrees !== null && Number.isFinite(s.angleDegrees) ? s.angleDegrees : null
  if (angle === null) return { step: null, targetProgress: null, holdProgress: 0 }
  const step: RepStep =
    s.phase === 'SEEKING_START' ? 'START'
      : s.phase === 'REST' ? 'REACH'
        // Holding starts on the first frame at the target, before any hold time has passed.
        : s.phase === 'MOVING' ? (angle >= rules.highDegrees ? 'HOLD' : 'REACH')
          : 'RETURN'
  const holdProgress = s.phase === 'AT_TARGET' ? 1 : rules.peakHoldMs <= 0 ? 0 : clamp(s.holdElapsedMs / rules.peakHoldMs, 0, 1)
  return { step, targetProgress: clamp((angle - rules.lowDegrees) / (rules.highDegrees - rules.lowDegrees), 0, 1), holdProgress }
}
