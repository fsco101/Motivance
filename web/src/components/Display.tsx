import { ArrowClockwiseIcon, InfoIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { m as motion } from 'motion/react'
import { Avatar as RadixAvatar, Tooltip as RadixTooltip } from 'radix-ui'
import { useId, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { cn } from '@/lib/cn'
import { MotionArc } from '@/motion/MotionArc'
import { RollingNumber } from '@/motion/RollingNumber'
import { spring } from '@/motion/tokens'
import { Button } from './Button'

export function Avatar({ name, photo, size = 40, className }: { name: string; photo?: string | null; size?: number; className?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?'
  return (
    <RadixAvatar.Root style={{ width: size, height: size, fontSize: size * 0.38 }} className={cn('inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-tide font-display font-bold text-lagoon-deep', className)}>
      {photo && <RadixAvatar.Image src={photo} alt="" className="size-full object-cover" />}
      <RadixAvatar.Fallback aria-hidden delayMs={photo ? 300 : 0} data-initials={initials} className="before:content-[attr(data-initials)]" />
    </RadixAvatar.Root>
  )
}

const tones = {
  neutral: 'bg-tide text-ink',
  positive: 'bg-sprout-soft text-sprout-deep',
  primary: 'bg-tide text-lagoon-deep',
  caution: 'bg-amber-soft text-amber-ink',
  danger: 'bg-alarm-soft text-alarm',
}

export function StatusPill({ tone = 'neutral', icon, children, className }: { tone?: keyof typeof tones; icon?: ReactNode; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex min-h-6 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-sm font-semibold', tones[tone], className)}>{icon}{children}</span>
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn('relative block overflow-hidden rounded-md bg-tide', className)}>
      <span className="absolute inset-0 -translate-x-full animate-[shimmer_1.6s_infinite] bg-linear-to-r from-transparent via-paper/60 to-transparent motion-reduce:hidden" />
    </span>
  )
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 py-10">
      <MotionArc progress={0} size={72} stroke={7} />
      <h3 className="text-xl font-bold">{title}</h3>
      <p className="max-w-[52ch] text-slate">{detail}</p>
      {action}
    </div>
  )
}

/** Failures say what happened and what to do; they offer Retry when retrying can help. */
export function Notice({ tone = 'error', title, children, onRetry, className }: { tone?: 'error' | 'info' | 'caution'; title?: string; children: ReactNode; onRetry?: () => void; className?: string }) {
  const { t } = useTranslation()
  const Icon = tone === 'info' ? InfoIcon : WarningCircleIcon
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('flex items-start gap-3 rounded-control p-4',
      tone === 'error' && 'bg-alarm-soft text-alarm', tone === 'info' && 'bg-tide text-ink', tone === 'caution' && 'bg-amber-soft text-amber-ink', className)}>
      <Icon weight="fill" aria-hidden className="mt-0.5 shrink-0 text-xl" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        <div>{children}</div>
      </div>
      {onRetry && <Button size="sm" variant="secondary" onClick={onRetry} leading={<ArrowClockwiseIcon aria-hidden />}>{t('common.retry')}</Button>}
    </div>
  )
}

/** A number without a box around it: the digits carry the weight, not a card. */
export function Readout({ value, label, detail, to, tone }: { value: number | string; label: string; detail?: string; to?: string; tone?: 'caution' }) {
  const body = (
    <>
      <span className={cn('numeric block text-5xl font-bold', tone === 'caution' && 'text-amber-ink')}>
        {typeof value === 'number' ? <RollingNumber value={value} /> : value}
      </span>
      <span className="mt-1 block font-semibold">{label}</span>
      {detail && <span className="block text-sm text-slate">{detail}</span>}
    </>
  )
  return to ? <Link to={to} className="group block rounded-control transition-colors transition-quick hover:text-lagoon-deep">{body}</Link> : <div>{body}</div>
}

export function PageHeader({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <div className="min-w-0 max-w-[62ch]">
        <h1 className="text-4xl font-bold">{title}</h1>
        {description && <p className="mt-2 text-lg text-slate">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

export function SectionHeading({ title, action, className }: { title: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-3 flex items-center justify-between gap-4', className)}>
      <h2 className="text-2xl font-bold">{title}</h2>
      {action}
    </div>
  )
}

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <RadixTooltip.Root delayDuration={250}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content sideOffset={6} className="z-50 max-w-64 rounded-md bg-ink px-2.5 py-1.5 text-sm text-paper shadow-float">{label}</RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )
}

type TabsProps = { value: string; onChange: (value: string) => void; label: string; tabs: ReadonlyArray<{ value: string; label: string; count?: number }>; className?: string }

/**
 * Filters a list on the same page, so these are toggle buttons rather than tabs: there are no separate panels to announce.
 * The marker slides like the rail needle.
 */
export function Tabs({ value, onChange, label, tabs, className }: TabsProps) {
  const group = useId()
  return (
    <div role="group" aria-label={label} className={cn('flex flex-wrap gap-x-6 border-b border-line', className)}>
      {tabs.map((tab) => {
        const active = tab.value === value
        return (
          <button key={tab.value} type="button" aria-pressed={active} onClick={() => onChange(tab.value)}
            className={cn('relative min-h-11 font-semibold transition-colors transition-quick hover:text-ink', active ? 'text-ink' : 'text-slate')}>
            {tab.label}{tab.count !== undefined && <span className="numeric ml-1.5 text-sm font-normal text-slate">{tab.count}</span>}
            {active && <motion.span layoutId={group} transition={spring.needle} className="absolute inset-x-0 -bottom-px h-0.5 bg-lagoon" />}
          </button>
        )
      })}
    </div>
  )
}
