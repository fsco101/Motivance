import type { Icon } from '@phosphor-icons/react'
import { cn } from '@/lib/cn'
import { InteractiveCard } from '@/motion/InteractiveCard'
import { RollingNumber } from '@/motion/RollingNumber'

type Props = { label: string; value: number; detail?: string; icon: Icon; to?: string; tone?: 'caution' }

/** One headline number. It opens the page that explains it, and it is always a count from the server, never a score. */
export function StatCard({ label, value, detail, icon: Glyph, to, tone }: Props) {
  const body = (
    <div className="p-3.5">
      <div className="flex items-center justify-between gap-1.5">
        <span className="truncate text-sm font-semibold text-slate">{label}</span>
        <span className={cn('grid size-7 shrink-0 place-items-center rounded-control text-base', tone === 'caution' ? 'bg-amber-soft text-amber-ink' : 'bg-tide text-lagoon-deep')}><Glyph aria-hidden /></span>
      </div>
      <span className="numeric mt-1 block text-stat font-bold"><RollingNumber value={value} /></span>
      {detail && <span className="block text-sm text-slate">{detail}</span>}
    </div>
  )
  return to
    ? <InteractiveCard to={to} linkLabel={`${label}: ${value}`} className="h-full">{body}</InteractiveCard>
    : <div className="h-full rounded-card border border-line bg-paper shadow-rest">{body}</div>
}
