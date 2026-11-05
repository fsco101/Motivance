/** Screen angle in degrees: 0 points right, and it grows clockwise because screen y points down. */
export function polar(cx: number, cy: number, radius: number, degrees: number) {
  const radians = (degrees * Math.PI) / 180
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) }
}

export function arcPath(cx: number, cy: number, radius: number, from: number, to: number) {
  const start = polar(cx, cy, radius, from)
  const end = polar(cx, cy, radius, to)
  const large = Math.abs(to - from) > 180 ? 1 : 0
  const sweep = to >= from ? 1 : 0
  return `M ${start.x.toFixed(3)} ${start.y.toFixed(3)} A ${radius} ${radius} 0 ${large} ${sweep} ${end.x.toFixed(3)} ${end.y.toFixed(3)}`
}

export const clampDegrees = (value: number) => Math.min(180, Math.max(0, value))

/** A joint angle on the protractor: 0 degrees on the left, 180 on the right, through the top. */
export const protractorAngle = (jointDegrees: number) => 180 + clampDegrees(jointDegrees)

/** The open 240-degree goniometer face used by MotionArc on Android. */
export const FACE_START = 150
export const FACE_SWEEP = 240
export const faceAngle = (jointDegrees: number) => FACE_START + (clampDegrees(jointDegrees) / 180) * FACE_SWEEP

/** Where a pointer sits on the protractor, in joint degrees. Mirrors RangeArc on Android. */
export function degreesAt(x: number, y: number, cx: number, cy: number) {
  let degrees = (Math.atan2(y - cy, x - cx) * 180) / Math.PI - 180
  degrees = ((degrees % 360) + 360) % 360
  if (degrees > 180) degrees = degrees > 270 ? 0 : 180
  return degrees
}

export const RANGE_SNAP = 5
export const RANGE_MIN_GAP = 15

/** Apply a drag to one end of a range, with the same snap and minimum gap as the Android editor. */
export function moveRange(low: number, high: number, end: 'low' | 'high', pointerDegrees: number) {
  const snapped = Math.round(pointerDegrees / RANGE_SNAP) * RANGE_SNAP
  return end === 'high'
    ? { low, high: Math.min(180, Math.max(snapped, Math.min(low + RANGE_MIN_GAP, 180))) }
    : { low: Math.max(0, Math.min(snapped, Math.max(high - RANGE_MIN_GAP, 0))), high }
}
