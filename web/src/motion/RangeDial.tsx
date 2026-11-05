import { animate, m as motion, useMotionValue, useMotionValueEvent, useReducedMotion } from 'motion/react'
import { useEffect, useRef } from 'react'
import { useCardActive } from './InteractiveCard'
import { arcPath, clampDegrees, polar, protractorAngle } from './geometry'
import { duration, ease, spring } from './tokens'

type Props = {
  /** The prescribed range. */
  low: number
  high: number
  /** The measured range, when the patient has one. */
  reached?: readonly [number, number] | null
  width?: number
  dark?: boolean
  label: string
}

/**
 * A small protractor: the prescribed band, the measured range and a needle at the furthest reach. Inside an
 * InteractiveCard it replays the movement from the lowest to the highest measured angle when the card is active.
 */
export function RangeDial({ low, high, reached, width = 104, dark, label }: Props) {
  const stroke = Math.max(5, width * 0.07)
  const cx = width / 2
  const r = cx - stroke / 2 - 1
  const cy = r + stroke / 2 + 1
  const height = cy + stroke / 2 + 1
  const active = useCardActive()
  const reduced = useReducedMotion()
  const start = reached ? clampDegrees(reached[0]) : 0
  const end = reached ? clampDegrees(reached[1]) : 0
  const needle = useRef<SVGGElement>(null)
  const value = useMotionValue(end)
  const place = (degrees: number) => needle.current?.setAttribute('transform', `rotate(${degrees} ${cx} ${cy})`)
  useMotionValueEvent(value, 'change', place)

  useEffect(() => {
    place(value.get())
    if (!reached || !active || reduced) {
      value.set(end)
      return
    }
    value.set(start)
    const controls = animate(value, end, spring.needle)
    return () => controls.stop()
    // place only writes an attribute; re-running for it would restart the replay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduced, reached, start, end, value])

  const measured = reached ? arcPath(cx, cy, r, protractorAngle(start), protractorAngle(end)) : null
  const tip = polar(cx, cy, r + stroke * 0.5, 180)
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="shrink-0 overflow-visible">
      <path d={arcPath(cx, cy, r, 180, 360)} fill="none" strokeWidth={stroke} strokeLinecap="round" className={dark ? 'stroke-night-line' : 'stroke-tide'} />
      <path d={arcPath(cx, cy, r, protractorAngle(low), protractorAngle(high))} fill="none" strokeWidth={stroke} className={dark ? 'stroke-sprout-bright' : 'stroke-sprout'} opacity={0.34} />
      {measured && (
        <motion.path key={active ? 'replay' : 'rest'} d={measured} fill="none" strokeWidth={stroke * 0.46} strokeLinecap="round"
          className={dark ? 'stroke-sprout-bright' : 'stroke-lagoon'}
          initial={active && !reduced ? { pathLength: 0 } : false} animate={{ pathLength: 1 }} transition={{ duration: duration.slow * 2, ease: ease.out }} />
      )}
      {reached && (
        <g ref={needle}>
          <line x1={cx} y1={cy} x2={tip.x} y2={tip.y} strokeWidth={2} strokeLinecap="round" className={dark ? 'stroke-paper' : 'stroke-ink'} />
        </g>
      )}
      <circle cx={cx} cy={cy} r={stroke * 0.42} className={dark ? 'fill-paper' : 'fill-ink'} />
    </svg>
  )
}
