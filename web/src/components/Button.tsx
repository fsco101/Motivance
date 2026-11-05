import { m as motion, type HTMLMotionProps } from 'motion/react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { cn } from '@/lib/cn'
import { spring } from '@/motion/tokens'

type Props = Omit<HTMLMotionProps<'button'>, 'children'> & {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger' | 'bright'
  size?: 'sm' | 'md' | 'lg'
  busy?: boolean
  /** Replaces the label while working, so the button says what is happening. */
  busyLabel?: string
  leading?: ReactNode
  children: ReactNode
}

const variants = {
  primary: 'bg-lagoon text-paper hover:bg-lagoon-deep',
  secondary: 'border border-line-strong bg-paper text-ink hover:border-lagoon hover:bg-mist',
  quiet: 'text-lagoon-deep hover:bg-tide',
  danger: 'bg-alarm text-paper hover:brightness-90',
  bright: 'bg-sprout-bright text-ink hover:brightness-95',
}
const sizes = { sm: 'min-h-8 whitespace-nowrap px-3 text-sm', md: 'min-h-10 px-4 text-sm', lg: 'min-h-12 px-6 text-base' }

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className={cn('size-4 animate-spin motion-reduce:animate-none', className)}>
      <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2.5" opacity="0.3" />
      <path d="M10 2a8 8 0 0 1 8 8" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

export function Button({ variant = 'primary', size = 'md', busy, busyLabel, leading, children, className, disabled, type = 'button', ...rest }: Props) {
  const inactive = disabled || busy
  return (
    <motion.button type={type} disabled={inactive} aria-busy={busy || undefined} whileTap={inactive ? undefined : { scale: 0.97 }} transition={spring.press}
      className={cn('inline-flex select-none items-center justify-center gap-2 rounded-control font-semibold transition-colors transition-quick',
        'disabled:cursor-not-allowed disabled:opacity-55', variants[variant], sizes[size], className)} {...rest}>
      {busy ? <Spinner /> : leading}
      <span>{busy && busyLabel ? busyLabel : children}</span>
    </motion.button>
  )
}

/** Goes somewhere rather than doing something: a real link that looks like a button, never a button inside a link. */
export function ButtonLink({ to, variant = 'primary', size = 'md', leading, children, className }: { to: string; variant?: keyof typeof variants; size?: keyof typeof sizes; leading?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Link to={to} className={cn('inline-flex select-none items-center justify-center gap-2 rounded-control font-semibold transition-colors transition-quick', variants[variant], sizes[size], className)}>
      {leading}<span>{children}</span>
    </Link>
  )
}

/** Pass press={false} on a Radix menu trigger: Motion turns Enter into a pointer press, so the menu would open and close at once. */
export function IconButton({ label, children, className, press = true, ...rest }: Omit<HTMLMotionProps<'button'>, 'children'> & { label: string; children: ReactNode; press?: boolean }) {
  return (
    <motion.button type="button" aria-label={label} title={label} whileTap={press ? { scale: 0.92 } : undefined} transition={spring.press}
      className={cn('grid size-9 place-items-center rounded-control text-lg transition-colors transition-quick hover:bg-tide disabled:opacity-55', className)} {...rest}>
      {children}
    </motion.button>
  )
}
