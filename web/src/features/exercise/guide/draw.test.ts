import { describe, expect, it } from 'vitest'
import { BODY_JOINTS, createRules } from '../assessment'
import { guideShapes, ON_DARK, ON_LIGHT } from './draw'
import { guideMotion, guideMotionFor, motionAngleAt } from './rig'

const numbers = (shapes: ReturnType<typeof guideShapes>) => shapes.flatMap((shape) =>
  shape.kind === 'ellipse' ? [shape.cx, shape.cy, shape.rx, shape.ry] : (shape.d.match(/-?\d+(\.\d+)?|NaN|Infinity/g) ?? []).map(Number))

describe('the guide drawing', () => {
  // The library's own exercises, and a therapist's own exercise on any joint, side and posture.
  const library = [
    guideMotionFor(createRules({ kind: 'ELBOW_FLEXION' })),
    guideMotionFor(createRules({ kind: 'SHOULDER_ABDUCTION', side: 'RIGHT' })),
    ...BODY_JOINTS.flatMap((joint) => (['LEFT', 'RIGHT'] as const).flatMap((side) =>
      [null, 'Seated lift', 'Standing lift'].map((name) => guideMotion(joint, side, name)))),
  ]

  it('draws every exercise in the library through its whole range, in the picture', () => {
    for (const motion of library) {
      for (const time of [0, 0.25, 0.5, 0.75]) {
        for (const outfit of [ON_LIGHT, ON_DARK]) {
          const shapes = guideShapes(motion, motionAngleAt(motion, time), outfit, 320, 220, true)
          const values = numbers(shapes)
          expect(values.every(Number.isFinite), `${motion.joint} ${motion.side} ${motion.posture} at ${time}`).toBe(true)
          // The person and the range stay inside the stage, with a little room for a stroke.
          const ellipses = shapes.filter((shape) => shape.kind === 'ellipse')
          ellipses.forEach((shape) => { expect(shape.cx).toBeGreaterThan(-20); expect(shape.cx).toBeLessThan(340) })
        }
      }
    }
  })

  it('shows the prescribed range as a sweep, filled to where the person is', () => {
    const motion = guideMotion('ELBOW', 'LEFT', null, 20, 120)
    const at = (time: number) => guideShapes(motion, motionAngleAt(motion, time), ON_LIGHT, 300, 300, true)
    const [, back, filled, pivot] = at(0).slice(-4)
    expect(back).toMatchObject({ kind: 'path', dash: expect.any(String) })
    expect(pivot).toMatchObject({ kind: 'ellipse', fill: ON_LIGHT.range })
    // At the start the filled arc has no length; at the target it is the whole sweep.
    const length = (shape: typeof filled) => (shape?.kind === 'path' ? shape.d.split('L').length : 0)
    const target = at(0.5).slice(-2)[0]
    expect(length(target)).toBeGreaterThan(length(filled))
    expect(guideShapes(motion, 60, ON_LIGHT, 300, 300, false).some((shape) => shape.kind === 'path' && shape.dash)).toBe(false)
  })
})
