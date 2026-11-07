import type { Icon } from '@phosphor-icons/react'
import { cn } from '@/lib/cn'
import { InteractiveCard } from '@/motion/InteractiveCard'
import { RollingNumber } from '@/motion/RollingNumber'

type Props = { label: string; value: number | null; unit?: string; detail?: string; icon: Icon; to?: string; tone?: 'caution' }

/** One headline number. It opens the page that explains it, and it is always from the server, never a score. With nothing to measure it shows a dash, not a zero. */
export function StatCard({ label, value, unit = '', detail, icon: Glyph, to, tone }: Props) {
  const body = (
    <div className="p-3.5">
      <div className="flex items-center justify-between gap-1.5">
        <span className="truncate text-sm font-semibold text-slate">{label}</span>
        <span className={cn('grid size-7 shrink-0 place-items-center rounded-control text-base', tone === 'caution' ? 'bg-amber-soft text-amber-ink' : 'bg-tide text-lagoon-deep')}><Glyph aria-hidden /></span>
      </div>
      <span className="numeric mt-1 block text-stat font-bold">{value === null ? '–' : <><RollingNumber value={value} />{unit}</>}</span>
      {detail && <span className="block text-sm text-slate">{detail}</span>}
    </div>
  )
  return to
    ? <InteractiveCard to={to} linkLabel={value === null ? `${label}: ${detail ?? ''}` : `${label}: ${value}${unit}`} className="h-full">{body}</InteractiveCard>
    : <div className="h-full rounded-card border border-line bg-paper shadow-rest">{body}</div>
}
