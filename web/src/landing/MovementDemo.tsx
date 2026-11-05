import { m as motion, useAnimationFrame, useInView, useMotionValue, useMotionValueEvent, useReducedMotion, useTransform } from 'motion/react'
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { arcPath } from '@/motion/geometry'
import { DEMO, START, bendAt, nextRep, type RepPhase } from './movement'

const W = 460
const H = 500
const SHOULDER = { x: 258, y: 132 }
const ELBOW = { x: 270, y: 240 }
const FOREARM = 116
const ARC = 66
const PERIOD_S = 3.8
const REST = 10
const REACH = 128

/** Screen angle of a bend: the forearm hangs at 90 degrees and swings toward 0 as it rises. */
const screenAngle = (bend: number) => 90 - bend
const handAt = (bend: number) => {
  const radians = (bend * Math.PI) / 180
  return { x: ELBOW.x + FOREARM * Math.sin(radians), y: ELBOW.y + FOREARM * Math.cos(radians) }
}

const OTHER_SHOULDER = [142, 132] as const
const HIPS = [[166, 296], [234, 296]] as const
const BODY: ReadonlyArray<readonly [number, number, number, number]> = [
  [SHOULDER.x, SHOULDER.y, ...OTHER_SHOULDER], [...OTHER_SHOULDER, ...HIPS[0]], [SHOULDER.x, SHOULDER.y, ...HIPS[1]], [...HIPS[0], ...HIPS[1]],
  [...OTHER_SHOULDER, 128, 236], [128, 236, 120, 332],
  [...HIPS[0], 160, 396], [160, 396, 156, 486], [...HIPS[1], 240, 396], [240, 396, 244, 486],
]
const JOINTS: ReadonlyArray<readonly [number, number]> = [OTHER_SHOULDER, [128, 236], [120, 332], ...HIPS, [160, 396], [156, 486], [240, 396], [244, 486]]

/**
 * What Motivance does, in one picture: a skeleton, a joint angle and a repetition count. It plays by itself until someone
 * takes the hand, then it is theirs. Sample data only.
 */
export function MovementDemo() {
  const { t } = useTranslation()
  const reduced = useReducedMotion()
  const svg = useRef<SVGSVGElement>(null)
  const forearm = useRef<SVGLineElement>(null)
  const hand = useRef<SVGGElement>(null)
  const arc = useRef<SVGPathElement>(null)
  const rep = useRef(START)
  const dragging = useRef(false)
  const inView = useInView(svg)
  const angle = useMotionValue(reduced ? 90 : REST)
  const reading = useTransform(angle, (value) => `${Math.round(value)}°`)
  const [count, setCount] = useState(0)
  const [phase, setPhase] = useState<RepPhase>('seeking')
  const [taken, setTaken] = useState(false)
  const [now, setNow] = useState(90)

  const draw = (bend: number) => {
    const tip = handAt(bend)
    forearm.current?.setAttribute('x2', tip.x.toFixed(1))
    forearm.current?.setAttribute('y2', tip.y.toFixed(1))
    hand.current?.setAttribute('transform', `translate(${tip.x.toFixed(1)} ${tip.y.toFixed(1)})`)
    arc.current?.setAttribute('d', arcPath(ELBOW.x, ELBOW.y, ARC, screenAngle(0), screenAngle(Math.max(bend, 0.01))))
  }
  useMotionValueEvent(angle, 'change', (value) => {
    draw(value)
    const next = nextRep(rep.current, value)
    if (next.count !== rep.current.count) setCount(next.count)
    if (next.phase !== rep.current.phase) setPhase(next.phase)
    rep.current = next
  })
  // eslint-disable-next-line react-hooks/exhaustive-deps -- draw only writes attributes, so one first paint is enough.
  useLayoutEffect(() => draw(angle.get()), [])

  useAnimationFrame((time) => {
    if (taken || reduced || !inView) return
    const wave = (1 - Math.cos(((time / 1000) * 2 * Math.PI) / PERIOD_S)) / 2
    angle.set(REST + wave * (REACH - REST))
  })

  const take = (bend: number) => {
    setTaken(true)
    angle.set(bend)
    setNow(Math.round(bend))
  }
  const pointer = (event: PointerEvent) => {
    const box = svg.current!.getBoundingClientRect()
    const scale = W / box.width
    take(bendAt((event.clientX - box.left) * scale - ELBOW.x, (event.clientY - box.top) * scale - ELBOW.y))
  }
  const keys = (event: KeyboardEvent) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 5 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -5 : 0
    if (!step) return
    event.preventDefault()
    take(Math.min(150, Math.max(0, Math.round(angle.get()) + step)))
  }

  const guidance = phase === 'target' ? t('landing.demoReturn', { degrees: DEMO.low }) : phase === 'seeking' ? t('landing.demoStart', { degrees: DEMO.low }) : t('landing.demoReach', { degrees: DEMO.high })
  return (
    <figure className="min-w-0">
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={t('landing.demoLabel')} className="mx-auto w-full max-w-[28rem] touch-pan-y select-none"
        onPointerDown={(event) => { dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); if (event.pointerType === 'mouse') pointer(event) }}
        onPointerMove={(event) => { if (dragging.current) pointer(event) }} onPointerUp={(event) => { if (dragging.current) pointer(event); dragging.current = false }} onPointerCancel={() => { dragging.current = false }}>
        <circle cx={200} cy={72} r={34} fill="none" strokeWidth={3} className="stroke-night-ink" opacity={0.5} />
        <line x1={200} y1={106} x2={200} y2={132} strokeWidth={3} strokeLinecap="round" className="stroke-night-ink" opacity={0.5} />
        {BODY.map(([x1, y1, x2, y2], index) => <line key={index} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={3} strokeLinecap="round" className="stroke-night-ink" opacity={0.5} />)}
        {JOINTS.map(([cx, cy], index) => <circle key={index} cx={cx} cy={cy} r={4.5} className="fill-night-ink" opacity={0.6} />)}
        <path d={arcPath(ELBOW.x, ELBOW.y, ARC, screenAngle(DEMO.low), screenAngle(DEMO.high))} fill="none" strokeWidth={14} className="stroke-night-ink" opacity={0.28} />
        <path ref={arc} fill="none" strokeWidth={6} strokeLinecap="round" className="stroke-sprout-bright" />
        <line x1={SHOULDER.x} y1={SHOULDER.y} x2={ELBOW.x} y2={ELBOW.y} strokeWidth={5} strokeLinecap="round" className="stroke-sprout-bright" />
        <line ref={forearm} x1={ELBOW.x} y1={ELBOW.y} strokeWidth={5} strokeLinecap="round" className="stroke-sprout-bright" />
        <circle cx={SHOULDER.x} cy={SHOULDER.y} r={7} className="fill-sprout-bright" />
        <circle cx={ELBOW.x} cy={ELBOW.y} r={9} className="fill-paper" />
        <g ref={hand} role="slider" tabIndex={0} aria-label={t('landing.demoSlider')} aria-valuemin={0} aria-valuemax={150} aria-valuenow={now} aria-valuetext={`${now}°`} onKeyDown={keys}
          className="cursor-grab outline-none [&:focus-visible>circle:first-child]:opacity-100">
          <circle r={22} className="fill-paper" opacity={0.14} />
          <circle r={9} className="fill-sprout-bright" />
        </g>
      </svg>
      <figcaption className="mx-auto flex max-w-[28rem] flex-wrap items-end justify-between gap-x-8 gap-y-3 border-t border-night-line pt-4">
        <div>
          <motion.p aria-hidden className="numeric text-5xl font-bold">{reading}</motion.p>
          <p className="text-night-ink" aria-live="polite">{guidance}</p>
        </div>
        <div className="text-right">
          <p className="numeric text-3xl font-bold">{t('landing.demoCount', { count, target: DEMO.repetitions })}</p>
          <p className="text-sm text-night-ink">{t('landing.demoCountLabel')}</p>
        </div>
        <p className="w-full text-sm text-night-ink">{t(taken ? 'landing.demoSample' : 'landing.demoHint')}</p>
      </figcaption>
    </figure>
  )
}
