import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { cn } from '@/lib/cn'
import { RANGE_MIN_GAP, RANGE_SNAP, arcPath, clampDegrees, degreesAt, moveRange, polar, protractorAngle } from './geometry'

type End = 'low' | 'high'
type Props = {
  low: number
  high: number
  description: string
  lowLabel: string
  highLabel: string
  /** Leave out for a read-only protractor. */
  onChange?: (low: number, high: number) => void
  className?: string
}

const SIZE = 420
const STROKE = 26
const CX = SIZE / 2
const R = CX - STROKE - 26
const CY = R + STROKE + 26
const HEIGHT = CY + STROKE

/**
 * The prescription range on a 0-180 degree protractor. Both ends drag, snapping to 5 degrees and staying 15 degrees
 * apart, as on Android. Each end is also a slider for keyboards and screen readers.
 */
export function RangeArc({ low, high, description, lowLabel, highLabel, onChange, className }: Props) {
  const svg = useRef<SVGSVGElement>(null)
  const [dragging, setDragging] = useState<End | null>(null)
  const editable = Boolean(onChange)

  const pointerDegrees = (event: PointerEvent) => {
    const box = svg.current!.getBoundingClientRect()
    const scale = SIZE / box.width
    return degreesAt((event.clientX - box.left) * scale, (event.clientY - box.top) * scale, CX, CY)
  }
  const apply = (end: End, degrees: number) => {
    const next = moveRange(low, high, end, degrees)
    if (next.low !== low || next.high !== high) onChange?.(next.low, next.high)
  }
  const start = (event: PointerEvent<SVGSVGElement>) => {
    if (!editable) return
    const at = pointerDegrees(event)
    const end: End = Math.abs(at - high) <= Math.abs(at - low) ? 'high' : 'low'
    setDragging(end)
    event.currentTarget.setPointerCapture(event.pointerId)
    apply(end, at)
  }
  const keys = (end: End) => (event: KeyboardEvent) => {
    const current = end === 'low' ? low : high
    const steps: Record<string, number> = {
      ArrowRight: RANGE_SNAP, ArrowUp: RANGE_SNAP, ArrowLeft: -RANGE_SNAP, ArrowDown: -RANGE_SNAP,
      PageUp: RANGE_MIN_GAP, PageDown: -RANGE_MIN_GAP,
    }
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 180 : steps[event.key] !== undefined ? current + steps[event.key]! : null
    if (next === null) return
    event.preventDefault()
    apply(end, clampDegrees(next))
  }

  const ticks = Array.from({ length: 37 }, (_, index) => index * 5)
  return (
    <svg ref={svg} viewBox={`0 0 ${SIZE} ${HEIGHT}`} aria-label={description} role="group"
      className={cn('w-full select-none overflow-visible', editable && 'touch-none', dragging && 'cursor-grabbing', className)}
      onPointerDown={start} onPointerMove={(event) => dragging && apply(dragging, pointerDegrees(event))} onPointerUp={() => setDragging(null)} onPointerCancel={() => setDragging(null)}>
      {ticks.map((degrees) => {
        const major = degrees % 45 === 0
        const a = polar(CX, CY, R - STROKE / 2 - 6, protractorAngle(degrees))
        const b = polar(CX, CY, R - STROKE / 2 - (major ? 16 : 11), protractorAngle(degrees))
        return <line key={degrees} x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={major ? 2 : 1} className={major ? 'stroke-slate' : 'stroke-line-strong'} />
      })}
      {[0, 45, 90, 135, 180].map((degrees) => {
        const p = polar(CX, CY, R - STROKE / 2 - 32, protractorAngle(degrees))
        return <text key={degrees} x={p.x} y={p.y + 4} textAnchor="middle" className="fill-slate font-body text-[12px]">{degrees}</text>
      })}
      <path d={arcPath(CX, CY, R, 180, 360)} fill="none" strokeWidth={STROKE} strokeLinecap="round" className="stroke-tide" />
      <path d={arcPath(CX, CY, R, protractorAngle(low), protractorAngle(high))} fill="none" strokeWidth={STROKE} className="stroke-sprout" />
      {(['low', 'high'] as const).map((end) => {
        const degrees = end === 'low' ? low : high
        const p = polar(CX, CY, R, protractorAngle(degrees))
        const label = polar(CX, CY, R + STROKE + 16, protractorAngle(degrees))
        return (
          <g key={end} role={editable ? 'slider' : undefined} tabIndex={editable ? 0 : undefined} aria-label={end === 'low' ? lowLabel : highLabel}
            aria-valuemin={end === 'low' ? 0 : low + RANGE_MIN_GAP} aria-valuemax={end === 'low' ? high - RANGE_MIN_GAP : 180} aria-valuenow={degrees} aria-valuetext={`${degrees}°`}
            onKeyDown={editable ? keys(end) : undefined} className={cn('outline-none [&:focus-visible>circle]:stroke-lagoon', editable && 'cursor-grab')}>
            <circle cx={p.x} cy={p.y} r={STROKE / 2 + 5} strokeWidth={4} className="fill-paper stroke-ink" />
            <text x={label.x} y={label.y + 5} textAnchor="middle" className="numeric fill-ink text-[15px] font-semibold">{degrees}°</text>
          </g>
        )
      })}
    </svg>
  )
}
