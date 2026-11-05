import { animate, m as motion, useMotionValue, useMotionValueEvent, useReducedMotion, useTransform } from 'motion/react'
import { useEffect, useRef, type Ref } from 'react'
import { spring } from '@/motion/tokens'

type Point = readonly [number, number]

/** A closed curve through the points, so the body has soft anatomical lines and no mechanical joints. */
function smooth(points: readonly Point[]) {
  const at = (index: number) => points[(index + points.length) % points.length]!
  let path = `M${at(0)[0]} ${at(0)[1]}`
  points.forEach((_, index) => {
    const [a, b, c, d] = [at(index - 1), at(index), at(index + 1), at(index + 2)]
    path += `C${b[0] + (c[0] - a[0]) / 6} ${b[1] + (c[1] - a[1]) / 6} ${c[0] - (d[0] - b[0]) / 6} ${c[1] - (d[1] - b[1]) / 6} ${c[0]} ${c[1]}`
  })
  return `${path}Z`
}

/** Mirrors the right half of a shape across the body's centre line. Points on the centre line are not repeated. */
const both = (half: readonly Point[]): Point[] => [...half, ...[...half].reverse().filter(([x]) => x !== 0).map(([x, y]): Point => [-x, y])]
const flip = (shape: readonly Point[]) => shape.map(([x, y]): Point => [-x, y])

const FACE = smooth(both([[0, 49], [19, 52], [30, 68], [32, 90], [27, 108], [15, 123], [0, 129]]))
const HAIR = smooth([[-33, 92], [-36, 66], [-27, 46], [-8, 37], [14, 37], [31, 48], [37, 68], [34, 92], [29, 78], [24, 66], [8, 63], [-10, 66], [-24, 68], [-29, 80]])
const NECK = smooth(both([[14, 108], [15, 138], [30, 152], [12, 170], [0, 174]]))
const SHIRT = smooth(both([[0, 170], [15, 162], [25, 147], [48, 153], [67, 168], [66, 205], [60, 236], [53, 264], [55, 288], [0, 294]]))
const SHORTS = smooth(both([[0, 282], [53, 278], [66, 305], [73, 345], [75, 392], [44, 398], [12, 392], [3, 358], [0, 352]]))
const LEG: readonly Point[] = [[66, 330], [68, 372], [62, 418], [56, 456], [60, 492], [60, 532], [51, 582], [46, 608], [28, 608], [25, 584], [21, 540], [22, 500], [27, 466], [23, 424], [13, 372], [14, 330]]
const SHOE: readonly Point[] = [[27, 602], [47, 602], [55, 618], [60, 630], [52, 640], [28, 640], [18, 632], [22, 616]]
const SOLE: readonly Point[] = [[19, 633], [28, 638], [52, 638], [60, 632], [60, 640], [52, 645], [28, 645], [18, 640]]

// An arm hangs from its shoulder at (0, 0), and each part hangs from the joint above it.
const UPPER_ARM = smooth([[-14, -13], [0, -19], [14, -13], [18, 12], [17, 48], [14, 82], [13, 108], [-12, 108], [-14, 82], [-15, 44], [-15, 10]])
const SLEEVE = smooth([[-15, -14], [0, -20], [15, -14], [19, 12], [18, 42], [-15, 46], [-16, 10]])
const FOREARM = smooth([[-13, -6], [-16, 22], [-12, 56], [-8, 90], [8, 90], [11, 56], [17, 24], [13, -6]])
const HAND = smooth([[-8, -3], [-10, 14], [-9, 28], [-5, 40], [1, 44], [7, 39], [10, 26], [9, 10], [8, -3]])
const THUMB = smooth([[-8, 6], [-15, 15], [-15, 26], [-10, 24], [-7, 17]])

const SHOULDER_X = 59
const SHOULDER_Y = 176
const ELBOW = 106
const WRIST = 88
const REACH = ELBOW + WRIST + 44
const CENTER = 232

/** Where a raised arm's fingertip travels, measured from the arm hanging at the side. */
function sweep(from: number, to: number, radius: number) {
  const point = (degrees: number) => {
    const radians = (degrees * Math.PI) / 180
    return `${(SHOULDER_X + Math.sin(radians) * radius).toFixed(1)} ${(SHOULDER_Y + Math.cos(radians) * radius).toFixed(1)}`
  }
  return `M${point(from)}A${radius} ${radius} 0 0 0 ${point(to)}`
}

function Arm({ upper, fore, shoulder, elbow, side = 1 }: { upper?: Ref<SVGGElement>; fore?: Ref<SVGGElement>; shoulder: number; elbow: number; side?: 1 | -1 }) {
  return (
    <g transform={`translate(${SHOULDER_X * side} ${SHOULDER_Y}) scale(${side} 1)`}>
      <g ref={upper} transform={`rotate(${-shoulder})`}>
        <g transform={`translate(0 ${ELBOW})`}>
          <g ref={fore} transform={`rotate(${-elbow})`}>
            <path d={FOREARM} className="fill-figure-skin" />
            <g transform={`translate(0 ${WRIST})`}><path d={THUMB} className="fill-figure-shade" /><path d={HAND} className="fill-figure-skin" /></g>
          </g>
        </g>
        <path d={UPPER_ARM} className="fill-figure-skin" />
        <path d={SLEEVE} className="fill-figure-shirt" />
      </g>
    </g>
  )
}

const elbowFor = (shoulder: number) => 5 + shoulder * 0.08

/** The model person answers the form: the arm rests low, rises as the form is completed, and eases down again on an error. */
export function FormFigure({ reach, band, compact }: { reach: number; band: readonly [number, number]; compact?: boolean }) {
  const reduced = useReducedMotion()
  const value = useMotionValue(reduced ? reach : band[0])
  const upper = useRef<SVGGElement>(null)
  const fore = useRef<SVGGElement>(null)
  // The rotation goes straight on the SVG, because a CSS pivot cannot follow a joint inside nested groups.
  const pose = (angle: number) => {
    upper.current?.setAttribute('transform', `rotate(${-angle})`)
    fore.current?.setAttribute('transform', `rotate(${-elbowFor(angle)})`)
  }
  useMotionValueEvent(value, 'change', pose)
  const progress = useTransform(value, [band[0], band[1]], [0, 1])
  useEffect(() => {
    if (reduced) {
      value.jump(reach)
      pose(reach)
      return
    }
    const controls = animate(value, reach, spring.layout)
    return () => controls.stop()
  }, [reach, reduced, value])
  const path = sweep(band[0], band[1], REACH + 16)
  return (
    <svg aria-hidden viewBox={compact ? '30 20 530 310' : '0 20 570 650'} className={compact ? 'h-44 w-auto' : 'size-full max-h-[34rem]'}>
      <defs>
        <radialGradient id="figure-glow">
          <stop offset="0" stopColor="var(--color-lagoon)" stopOpacity="0.42" />
          <stop offset="1" stopColor="var(--color-lagoon)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={CENTER + 40} cy={300} r={300} fill="url(#figure-glow)" />
      <g transform={`translate(${CENTER} 0)`}>
        <ellipse cx={0} cy={648} rx={110} ry={10} className="fill-night" opacity={0.6} />
        <path d={path} fill="none" strokeWidth={3} strokeDasharray="2 12" strokeLinecap="round" className="stroke-night-ink" opacity={0.6} />
        <motion.path d={path} fill="none" strokeWidth={5} strokeLinecap="round" className="stroke-sprout-bright" style={{ pathLength: progress }} />
        {[1, -1].map((side) => (
          <g key={side}>
            <path d={smooth(side === 1 ? LEG : flip(LEG))} className="fill-figure-skin" />
            <path d={smooth(side === 1 ? SOLE : flip(SOLE))} className="fill-amber" />
            <path d={smooth(side === 1 ? SHOE : flip(SHOE))} className="fill-paper" />
          </g>
        ))}
        <path d={SHORTS} className="fill-figure-shorts" />
        <path d={NECK} className="fill-figure-shade" />
        <path d={SHIRT} className="fill-figure-shirt" />
        <path d={FACE} className="fill-figure-skin" />
        <ellipse cx={-32} cy={92} rx={4.5} ry={8} className="fill-figure-shade" />
        <ellipse cx={32} cy={92} rx={4.5} ry={8} className="fill-figure-shade" />
        <path d={HAIR} className="fill-figure-hair" />
        <g className="fill-figure-hair">
          <ellipse cx={-12.5} cy={89} rx={2.6} ry={3.2} />
          <ellipse cx={12.5} cy={89} rx={2.6} ry={3.2} />
        </g>
        <g fill="none" strokeLinecap="round" className="stroke-figure-hair">
          <path d="M-19 80Q-12 76-6 80M6 80Q12 76 19 80" strokeWidth={2.2} />
          <path d="M-1 94Q-3 102 1 103" strokeWidth={1.6} opacity={0.45} />
          <path d="M-8 112Q0 118 8 112" strokeWidth={2} />
        </g>
        <Arm side={-1} shoulder={7} elbow={6} />
        <Arm upper={upper} fore={fore} shoulder={band[0]} elbow={elbowFor(band[0])} />
      </g>
    </svg>
  )
}
