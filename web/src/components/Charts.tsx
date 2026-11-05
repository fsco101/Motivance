import { m as motion, useReducedMotion } from 'motion/react'
import { duration, ease } from '@/motion/tokens'

/** Compares a few counts. Each row carries its own label and value, so nothing depends on reading a colour. */
export function BarList({ items }: { items: ReadonlyArray<{ label: string; value: number }> }) {
  const reduced = useReducedMotion()
  const largest = Math.max(...items.map((item) => item.value), 1)
  return (
    <ul className="flex flex-col gap-3.5">
      {items.map((item) => (
        <li key={item.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span>{item.label}</span>
            <span className="numeric font-semibold">{item.value}</span>
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
