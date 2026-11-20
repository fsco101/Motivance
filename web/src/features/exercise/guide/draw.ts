import { FLOOR, HEAD_RADIUS, SEAT_HEIGHT, motionFrame, posed, type GuideLimb, type GuideMotion, type GuidePoint, type GuidePose } from './rig'
import { HEEL, LENGTH, OUTLINE, PROFILE_FINGERS, SHOULDER_Y, TOE, type Offset } from './outline'

/** One SVG element of the guide: a filled shape, a stroked line, or a circle or ellipse. */
export type GuideShape =
  | { kind: 'path'; d: string; fill?: string; stroke?: string; width?: number; dash?: string; cap?: 'round' | 'butt' }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; fill: string }

interface Outfit { skin: string; skinFar: string; hair: string; top: string; topFar: string; shorts: string; shortsFar: string; shoe: string; shoeFar: string; sole: string; prop: string; shadow: string; floor: string; range: string; rangeBack: string }

/** Android's two outfits (ExerciseGuide.kt), for a light stage and the dark camera stage. */
export const ON_LIGHT: Outfit = { skin: '#c98e66', skinFar: '#ae7650', hair: '#2b211c', top: '#0e7c86', topFar: '#0a5f68', shorts: '#0d2b36', shortsFar: '#28495a', shoe: '#ffffff', shoeFar: '#d7e4e2', sole: '#e8a33d', prop: '#8fb0ae', shadow: 'rgba(13,43,54,0.13)', floor: 'rgba(13,43,54,0.2)', range: '#1b7f45', rangeBack: 'rgba(27,127,69,0.33)' }
export const ON_DARK: Outfit = { skin: '#d8a07a', skinFar: '#b98660', hair: '#3a2a22', top: '#17a3af', topFar: '#0e7c86', shorts: '#e9f3f1', shortsFar: '#b6ccca', shoe: '#ffffff', shoeFar: '#c3d3d1', sole: '#e8a33d', prop: '#285661', shadow: 'rgba(0,0,0,0.33)', floor: 'rgba(191,227,221,0.33)', range: '#6fe08f', rangeBack: 'rgba(111,224,143,0.4)' }

/** One rig unit is this many outline units, which makes the head the size the rig gives it. */
const OUTLINE_UNIT = HEAD_RADIUS / 40
/** The rig's trunk is longer than the sign-in figure's, so the front torso is drawn a little taller than it is wide. */
const TORSO_UNIT = 0.19

const n = (v: number) => Math.round(v * 100) / 100
type Place = (o: Offset) => Offset

/** A closed curve through the points, so the body has soft lines and no mechanical joints (Catmull-Rom, as on Android). */
function shape(list: Offset[], place: Place, fill: string): GuideShape {
  const c = list.map(place)
  const at = (i: number) => c[(i + c.length) % c.length]!
  let d = `M${n(at(0).x)} ${n(at(0).y)}`
  c.forEach((_, i) => {
    const a = at(i - 1), b = at(i), p = at(i + 1), q = at(i + 2)
    d += `C${n(b.x + (p.x - a.x) / 6)} ${n(b.y + (p.y - a.y) / 6)} ${n(p.x - (q.x - b.x) / 6)} ${n(p.y - (q.y - b.y) / 6)} ${n(p.x)} ${n(p.y)}`
  })
  return { kind: 'path', d: `${d}Z`, fill }
}
/** A brow or a mouth: a line that bends once. */
function bend(from: Offset, via: Offset, to: Offset, place: Place, stroke: string, width: number): GuideShape {
  const a = place(from), b = place(via), c = place(to)
  return { kind: 'path', d: `M${n(a.x)} ${n(a.y)}Q${n(b.x)} ${n(b.y)} ${n(c.x)} ${n(c.y)}`, stroke, width, cap: 'round' }
}
const line = (a: Offset, b: Offset, stroke: string, width: number, cap: 'round' | 'butt' = 'round'): GuideShape => ({ kind: 'path', d: `M${n(a.x)} ${n(a.y)}L${n(b.x)} ${n(b.y)}`, stroke, width, cap })

/**
 * The guide at one angle, as SVG shapes in a `width` × `height` box (drawGuide on Android): floor, shadow, the person,
 * and, with `range`, the prescribed sweep around the working joint with the current position filled in.
 */
export function guideShapes(motion: GuideMotion, angle: number, outfit: Outfit, width: number, height: number, range: boolean): GuideShape[] {
  const frame = motionFrame(motion)
  const scale = Math.min(width, height) / frame.span
  const at = (p: GuidePoint): Offset => ({ x: width / 2 + (p.x - frame.centerX) * scale, y: height / 2 + (p.y - frame.centerY) * scale })
  const u = (v: number) => v * scale
  const pose = posed(motion, angle)
  const floor = at({ x: 0, y: FLOOR }).y
  const out: GuideShape[] = []
  out.push(line({ x: 0, y: floor }, { x: width, y: floor }, outfit.floor, u(0.6)))
  const under = at({ x: pose.view === 'SIDE' ? pose.hips.x + 6 * pose.facing : 0, y: FLOOR })
  out.push({ kind: 'ellipse', cx: under.x, cy: under.y, rx: u(24), ry: u(1.6), fill: outfit.shadow })

  /** Lays an outline along a bone, so it turns and stretches with the rig. A side of -1 mirrors it. */
  const bone = (from: GuidePoint, to: GuidePoint, length: number, side: number): Place => {
    const s = at(from), e = at(to)
    const span = Math.max(Math.hypot(e.x - s.x, e.y - s.y), 0.01)
    const ux = (e.x - s.x) / span, uy = (e.y - s.y) / span
    const along = span / length, across = u(OUTLINE_UNIT) * side
    return (o) => ({ x: s.x + ux * o.y * along + uy * o.x * across, y: s.y + uy * o.y * along - ux * o.x * across })
  }
  /** Stands an outline upright on a point of the body. */
  const upright = (point: GuidePoint, side = 1): Place => { const c = at(point), k = u(OUTLINE_UNIT); return (o) => ({ x: c.x + o.x * k * side, y: c.y + o.y * k }) }

  const arm = (limb: GuideLimb, side: number, skin: string, shade: string, sleeve: string, profile: boolean, sleeveShade?: string) => {
    const upper = bone(limb.root, limb.middle, LENGTH.upperArm, side)
    const fore = bone(limb.middle, limb.end, LENGTH.forearm, side)
    const hand = bone(limb.end, limb.tip, LENGTH.hand, side)
    out.push(shape(OUTLINE.Forearm, fore, skin), shape(OUTLINE.Thumb, hand, shade), shape(profile ? OUTLINE.ProfileHand : OUTLINE.Hand, hand, skin))
    if (profile) for (const [a, b] of PROFILE_FINGERS) out.push(line(hand(a), hand(b), shade, u(0.14)))
    out.push(shape(OUTLINE.UpperArm, upper, skin))
    // A crescent of shade under the sleeve keeps the arm apart from a shirt of the same colour.
    if (sleeveShade) out.push(shape(OUTLINE.Sleeve, (o) => upper({ x: o.x - 3, y: o.y + 4 }), sleeveShade))
    out.push(shape(OUTLINE.Sleeve, upper, sleeve))
  }
  const frontLeg = (limb: GuideLimb, side: number) => {
    out.push(shape(OUTLINE.Shank, bone(limb.middle, limb.end, LENGTH.shank, side), outfit.skin), shape(OUTLINE.Thigh, bone(limb.root, limb.middle, LENGTH.thigh, side), outfit.skin))
    const foot = upright({ x: limb.end.x, y: FLOOR }, side)
    out.push(shape(OUTLINE.Sole, foot, outfit.sole), shape(OUTLINE.Shoe, foot, outfit.shoe))
  }
  const sideLeg = (limb: GuideLimb, side: number, skin: string, shorts: string, shoe: string) => {
    out.push(shape(OUTLINE.ProfileShank, bone(limb.middle, limb.end, LENGTH.shank, side), skin))
    const thigh = bone(limb.root, limb.middle, LENGTH.thigh, side)
    out.push(shape(OUTLINE.ProfileThigh, thigh, skin), shape(OUTLINE.ProfileShorts, thigh, shorts))
    const foot = bone(limb.end, limb.tip, LENGTH.foot, side)
    // A foot rocks on its heel, but the rig turns it around the ankle, so the shoe is lifted back out of the floor.
    const sunk = Math.max(Math.max(foot(HEEL).y, foot(TOE).y) - floor, 0)
    const standing: Place = (o) => { const p = foot(o); return { x: p.x, y: p.y - sunk } }
    out.push(shape(OUTLINE.ProfileSole, standing, outfit.sole), shape(OUTLINE.ProfileShoe, standing, shoe))
  }
  const frontHead = (p: GuidePose) => {
    const head = upright(p.head)
    out.push(shape(OUTLINE.Face, head, outfit.skin), shape(OUTLINE.LeftEar, head, outfit.skinFar), shape(OUTLINE.RightEar, head, outfit.skinFar), shape(OUTLINE.Hair, head, outfit.hair), shape(OUTLINE.LeftEye, head, outfit.hair), shape(OUTLINE.RightEye, head, outfit.hair))
    out.push(bend({ x: -19, y: -9 }, { x: -12, y: -13 }, { x: -6, y: -9 }, head, outfit.hair, u(0.36)), bend({ x: 6, y: -9 }, { x: 12, y: -13 }, { x: 19, y: -9 }, head, outfit.hair, u(0.36)))
    out.push({ ...bend({ x: -1, y: 5 }, { x: -3, y: 13 }, { x: 1, y: 14 }, head, outfit.hair, u(0.26)), stroke: `color-mix(in srgb, ${outfit.hair} 45%, transparent)` } as GuideShape)
    out.push(bend({ x: -8, y: 23 }, { x: 0, y: 29 }, { x: 8, y: 23 }, head, outfit.hair, u(0.33)))
  }
  const sideHead = (p: GuidePose) => {
    const head = upright(p.head, p.facing)
    out.push(shape(OUTLINE.ProfileHead, head, outfit.skin), shape(OUTLINE.ProfileEar, head, outfit.skinFar), shape(OUTLINE.ProfileHair, head, outfit.hair), shape(OUTLINE.ProfileEye, head, outfit.hair))
    out.push(bend({ x: 11, y: -10 }, { x: 18, y: -14 }, { x: 26, y: -10 }, head, outfit.hair, u(0.36)), bend({ x: 18, y: 26 }, { x: 24, y: 28 }, { x: 30, y: 25 }, head, outfit.hair, u(0.3)))
  }

  const f = pose.facing
  if (pose.view === 'SIDE') {
    if (pose.posture === 'SEATED') {
      const seat = at({ x: pose.hips.x - 3 * f, y: SEAT_HEIGHT })
      for (const dx of [-9, 9]) out.push(line({ x: seat.x + u(dx), y: seat.y }, { x: seat.x + u(dx * 1.25), y: floor }, outfit.prop, u(1.6)))
      out.push({ kind: 'path', d: roundRect(seat.x - u(13), seat.y - u(0.2), u(26), u(2.8), u(1.4)), fill: outfit.prop })
    }
    arm(pose.farArm, f, outfit.skinFar, outfit.skinFar, outfit.topFar, true)
    sideLeg(pose.farLeg, f, outfit.skinFar, outfit.shortsFar, outfit.shoeFar)
    out.push(shape(OUTLINE.ProfilePelvis, upright(pose.hips, f), outfit.shorts))
    sideLeg(pose.nearLeg, f, outfit.skin, outfit.shorts, outfit.shoe)
    // The shirt comes after the leg, so it hangs over the shorts and falls across a raised thigh.
    const trunk = upright(pose.shoulders, f)
    out.push(shape(OUTLINE.ProfileNeck, trunk, outfit.skinFar), shape(OUTLINE.ProfileTorso, trunk, outfit.top))
    sideHead(pose)
    arm(pose.nearArm, f, outfit.skin, outfit.skinFar, outfit.top, true, outfit.topFar)
  } else {
    frontLeg(pose.nearLeg, f)
    frontLeg(pose.farLeg, -f)
    const shoulder = at({ x: pose.shoulders.x, y: pose.shoulders.y + 1.5 })
    const across = u(OUTLINE_UNIT), down = u(TORSO_UNIT)
    const trunk: Place = (o) => ({ x: shoulder.x + o.x * across, y: shoulder.y + (o.y - SHOULDER_Y) * down })
    out.push(shape(OUTLINE.Shorts, trunk, outfit.shorts), shape(OUTLINE.Neck, trunk, outfit.skinFar), shape(OUTLINE.Shirt, trunk, outfit.top))
    frontHead(pose)
    arm(pose.farArm, -f, outfit.skin, outfit.skinFar, outfit.top, false)
    arm(pose.nearArm, f, outfit.skin, outfit.skinFar, outfit.top, false)
  }
  if (range) out.push(...rangeShapes(motion, angle, outfit, at, u))
  return out
}

function roundRect(x: number, y: number, w: number, h: number, r: number) {
  return `M${n(x + r)} ${n(y)}H${n(x + w - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + w)} ${n(y + r)}V${n(y + h - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + w - r)} ${n(y + h)}H${n(x + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x)} ${n(y + h - r)}V${n(y + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + r)} ${n(y)}Z`
}

/** The prescribed sweep around the working joint, with the current position filled in (drawRange on Android). */
function rangeShapes(motion: GuideMotion, angle: number, outfit: Outfit, at: (p: GuidePoint) => Offset, u: (v: number) => number): GuideShape[] {
  const bearing = (p: GuidePose) => { const a = at(p.pivot), b = at(p.reach); return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI }
  const turn = (from: number, to: number) => { const raw = ((to - from + 540) % 360) - 180; return raw < -180 ? raw + 360 : raw }
  const start = bearing(posed(motion, motion.low))
  const short = turn(start, bearing(posed(motion, motion.high)))
  // A joint can turn past the half circle; a range wider than 170° goes the long way round.
  const full = Math.abs(motion.high - motion.low) <= 170 ? short : short > 0 ? short - 360 : short + 360
  const travelled = motion.high > motion.low ? (full * (angle - motion.low)) / (motion.high - motion.low) : 0
  const pivot = at(posed(motion, angle).pivot)
  const radius = u(motion.joint === 'WRIST' || motion.joint === 'ANKLE' ? 9 : 13)
  const arc = (sweep: number) => {
    const steps = Math.max(2, Math.ceil(Math.abs(sweep) / 4))
    return Array.from({ length: steps + 1 }, (_, i) => {
      const a = ((start + (sweep * i) / steps) * Math.PI) / 180
      return `${i === 0 ? 'M' : 'L'}${n(pivot.x + radius * Math.cos(a))} ${n(pivot.y + radius * Math.sin(a))}`
    }).join('')
  }
  const width = u(0.7)
  return [
    { kind: 'path', d: arc(full), stroke: outfit.rangeBack, width, dash: `${n(u(1.6))} ${n(u(1.6))}`, cap: 'round' },
    { kind: 'path', d: arc(travelled), stroke: outfit.range, width: width * 1.6, cap: 'round' },
    { kind: 'ellipse', cx: pivot.x, cy: pivot.y, rx: u(1.3), ry: u(1.3), fill: outfit.range },
  ]
}
