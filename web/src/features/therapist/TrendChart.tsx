import { m as motion, useReducedMotion } from 'motion/react'
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import { duration, ease } from '@/motion/tokens'

export type TrendPoint = { id: string; label: string; value: number | null }

const W = 720
const H = 240
const PAD = { top: 16, right: 16, bottom: 26, left: 40 }

/**
 * A plain line of measured values. Gaps stay gaps; nothing is smoothed or filled in. There is deliberately no target band:
 * range of motion is a difference between two angles, so drawing the prescribed angles behind it would imply a comparison
 * the numbers do not support. Android charts it the same way.
 */
export function TrendChart({ title, points, unit, max = 180, className, plain }: { title: string; points: readonly TrendPoint[]; unit: string; max?: number; className?: string; plain?: boolean }) {
  const { t } = useTranslation()
  const reduced = useReducedMotion()
  const svg = useRef<SVGSVGElement>(null)
  const [active, setActive] = useState<number | null>(null)
  const x = (index: number) => PAD.left + (points.length < 2 ? 0 : (index / (points.length - 1)) * (W - PAD.left - PAD.right))
  const y = (value: number) => H - PAD.bottom - (value / max) * (H - PAD.top - PAD.bottom)
  const line = points.reduce((path, point, index) => {
    if (point.value === null) return path
    const previous = points[index - 1]
    return `${path}${previous && previous.value !== null ? 'L' : 'M'}${x(index).toFixed(1)} ${y(point.value).toFixed(1)} `
  }, '')
  const nearest = (event: PointerEvent) => {
    const box = svg.current?.getBoundingClientRect()
    if (!box || points.length === 0) return
    const position = ((event.clientX - box.left) / box.width) * W
    setActive(Math.round(((position - PAD.left) / (W - PAD.left - PAD.right)) * (points.length - 1)))
  }
  const keys = (event: KeyboardEvent) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    event.preventDefault()
    setActive((current) => Math.min(points.length - 1, Math.max(0, (current ?? (step > 0 ? -1 : points.length)) + step)))
  }
  const shown = active !== null ? points[Math.min(Math.max(active, 0), points.length - 1)] : undefined
  const shownIndex = shown ? points.indexOf(shown) : -1
  return (
    <figure className={cn('min-w-0', className)}>
      <figcaption className="mb-2 flex items-baseline justify-between gap-4">
        <span className="font-semibold">{title}</span>
        <span className="numeric text-sm text-slate" aria-live="polite">{shown ? `${shown.label}: ${shown.value === null ? t('progress.notMeasured') : `${shown.value}${unit}`}` : ''}</span>
      </figcaption>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} role="img" tabIndex={0} aria-label={t('progress.chartLabel', { title, count: points.length })} className="w-full overflow-visible rounded-control"
        onPointerMove={nearest} onPointerLeave={() => setActive(null)} onKeyDown={keys} onBlur={() => setActive(null)}>
        {[0, 0.5, 1].map((share) => {
          const value = Math.round(max * share)
          return (
            <g key={share}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(value)} y2={y(value)} className="stroke-line" />
              <text x={PAD.left - 8} y={y(value) + 4} textAnchor="end" className="fill-slate text-[12px]">{value}</text>
            </g>
          )
        })}
        {points[0] && <text x={PAD.left} y={H - 6} className="fill-slate text-[12px]">{points[0].label}</text>}
        {points.length > 1 && <text x={W - PAD.right} y={H - 6} textAnchor="end" className="fill-slate text-[12px]">{points.at(-1)?.label}</text>}
        <motion.path d={line} fill="none" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" className="stroke-lagoon"
          initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: duration.sweep, ease: ease.out }} />
        {points.map((point, index) => point.value !== null && (
          <circle key={point.id} cx={x(index)} cy={y(point.value)} r={index === shownIndex ? 6 : 3.5} className={index === shownIndex ? 'fill-ink' : 'fill-lagoon'} />
        ))}
        {shown && <line x1={x(shownIndex)} x2={x(shownIndex)} y1={PAD.top} y2={H - PAD.bottom} strokeDasharray="3 4" className="stroke-slate" />}
      </svg>
      {!plain && <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-lagoon-deep">{t('progress.showTable')}</summary>
        <table className="mt-2 w-full max-w-md text-left">
          <caption className="sr-only">{title}</caption>
          <thead><tr className="text-slate"><th scope="col" className="py-1 font-semibold">{t('progress.date')}</th><th scope="col" className="py-1 text-right font-semibold">{title}</th></tr></thead>
          <tbody>{points.map((point) => <tr key={point.id} className="border-t border-line"><td className="py-1">{point.label}</td><td className="numeric py-1 text-right">{point.value === null ? t('progress.notMeasured') : `${point.value}${unit}`}</td></tr>)}</tbody>
        </table>
      </details>}
    </figure>
  )
}
