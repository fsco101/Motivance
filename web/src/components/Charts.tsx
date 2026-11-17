import { m as motion, useReducedMotion } from 'motion/react'
import { useState, type KeyboardEvent } from 'react'
import { duration, ease } from '@/motion/tokens'

/** Compares a few counts. Each row carries its own label and value, so nothing depends on reading a colour. */
export function BarList({ items, format = String }: { items: ReadonlyArray<{ label: string; value: number }>; /** How a value is written, such as a size in MB. */ format?: (value: number) => string }) {
  const reduced = useReducedMotion()
  const largest = Math.max(...items.map((item) => item.value), 1)
  return (
    <ul className="flex flex-col gap-3.5">
      {items.map((item) => (
        <li key={item.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span>{item.label}</span>
            <span className="numeric font-semibold">{format(item.value)}</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-mist">
            <motion.div className="h-full origin-left rounded-full bg-lagoon" style={{ width: `${(item.value / largest) * 100}%` }}
              initial={reduced ? false : { scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: duration.slow, ease: ease.out }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

const percent = (degrees: number) => `${(degrees / 180) * 100}%`

/** A range on the 0 to 180 degree scale: the pale band was prescribed, and the solid bar is what was measured. */
export function RangeBar({ low, high, reached }: { low: number; high: number; reached?: readonly [number, number] | null }) {
  return (
    <div aria-hidden className="relative h-1.5 w-full overflow-hidden rounded-full bg-mist">
      <span className="absolute inset-y-0 bg-line-strong/50" style={{ left: percent(low), width: percent(high - low) }} />
      {reached && <span className="absolute inset-y-0 rounded-full bg-lagoon" style={{ left: percent(reached[0]), width: percent(Math.max(reached[1] - reached[0], 1)) }} />}
    </div>
  )
}

export type MeterLevel = 'ok' | 'high' | 'full'
/** At three quarters a limit deserves a look; at nine tenths, action. */
export const meterLevel = (share: number): MeterLevel => (share >= 0.9 ? 'full' : share >= 0.75 ? 'high' : 'ok')

const METER_FILL: Record<MeterLevel, string> = { ok: 'bg-lagoon', high: 'bg-amber', full: 'bg-alarm' }

/**
 * One amount against its limit. The track is a pale step of the fill's own hue, so the whole bar reads as one quantity, and
 * the fill turns amber and then red as the limit nears. The words beside it say the same, so colour is never the only sign.
 */
export function Meter({ label, used, limit, usedText, detail, status }: { label: string; used: number; limit: number; usedText: string; detail: string; status?: string }) {
  const reduced = useReducedMotion()
  const share = limit > 0 ? Math.min(used / limit, 1) : 0
  const level = meterLevel(share)
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="font-semibold">{label}</span>
        <span className="numeric text-sm text-slate">{usedText}</span>
      </div>
      <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={Math.min(used, limit)} aria-valuetext={`${usedText}. ${detail}`}
        className="mt-1.5 h-3 overflow-hidden rounded-full bg-tide">
        <motion.div className={`h-full origin-left rounded-full ${METER_FILL[level]}`} style={{ width: `${Math.max(share * 100, used > 0 ? 1 : 0)}%` }}
          initial={reduced ? false : { scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: duration.slow, ease: ease.out }} />
      </div>
      <p className="mt-1.5 text-sm text-slate">{status ? <span className={level === 'full' ? 'font-semibold text-alarm' : 'font-semibold text-amber-ink'}>{status} </span> : null}{detail}</p>
    </div>
  )
}

const COLUMN = { width: 280, height: 96, top: 8, bottom: 4, gap: 2 }

/**
 * Daily counts as columns, one series per chart, so charts of different sizes never share an axis. The tallest day sets the
 * scale. Pointing at a day, or moving along with the arrow keys once the chart has focus, names that day and its count.
 */
export function DailyColumns({ title, days, total, describe }: { title: string; days: ReadonlyArray<{ label: string; value: number }>; total: string; describe: (label: string, value: number) => string }) {
  const [active, setActive] = useState<number | null>(null)
  const largest = Math.max(...days.map((day) => day.value), 0)
  const slot = COLUMN.width / Math.max(days.length, 1)
  const bar = Math.min(slot - COLUMN.gap, 24)
  const plot = COLUMN.height - COLUMN.top - COLUMN.bottom
  const shown = active === null ? null : days[active]
  return (
    <figure className="min-w-0">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold">{title}</span>
        <span className="numeric text-sm text-slate" aria-live="polite">{shown ? describe(shown.label, shown.value) : total}</span>
      </figcaption>
      <svg viewBox={`0 0 ${COLUMN.width} ${COLUMN.height}`} className="mt-1.5 w-full overflow-visible rounded-control" role="img" tabIndex={0}
        aria-label={`${title}, ${total}`} onPointerLeave={() => setActive(null)} onBlur={() => setActive(null)}
        onKeyDown={(event: KeyboardEvent) => {
          const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
          if (!step || days.length === 0) return
          event.preventDefault()
          setActive((current) => Math.min(days.length - 1, Math.max(0, (current ?? (step > 0 ? -1 : days.length)) + step)))
        }}>
        <line x1={0} x2={COLUMN.width} y1={COLUMN.height - COLUMN.bottom} y2={COLUMN.height - COLUMN.bottom} className="stroke-line" />
        {days.map((day, index) => {
          const height = largest === 0 ? 0 : Math.max((day.value / largest) * plot, day.value > 0 ? 3 : 0)
          const x = index * slot + (slot - bar) / 2
          const y = COLUMN.height - COLUMN.bottom - height
          const radius = Math.min(4, height / 2, bar / 2)
          return (
            <g key={day.label} onPointerEnter={() => setActive(index)}>
              {/* The hit area is the whole day's slot, taller than the column. */}
              <rect x={index * slot} y={0} width={slot} height={COLUMN.height} className="fill-transparent" />
              {height > 0 && <path d={`M${x} ${y + height}V${y + radius}a${radius} ${radius} 0 0 1 ${radius} ${-radius}h${bar - 2 * radius}a${radius} ${radius} 0 0 1 ${radius} ${radius}V${y + height}Z`}
                className={active === index ? 'fill-lagoon-deep' : 'fill-lagoon'} />}
            </g>
          )
        })}
      </svg>
      <div aria-hidden className="mt-1 flex justify-between text-xs text-slate"><span>{days[0]?.label}</span><span>{days.at(-1)?.label}</span></div>
    </figure>
  )
}
