import { AnimatePresence, m as motion, useMotionValue, useReducedMotion, useSpring } from 'motion/react'
import { createContext, useContext, useId, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { CaretDownIcon } from '@phosphor-icons/react'
import { cn } from '@/lib/cn'
import { duration, ease, spring } from './tokens'

const CardActive = createContext(false)
/** True while the surrounding card is hovered or focused, so its content can respond. */
export const useCardActive = () => useContext(CardActive)

type Props = {
  children: ReactNode
  /** Makes the whole card a link. Other buttons inside the card keep working above it. */
  to?: string
  linkLabel?: string
  dark?: boolean
  className?: string
}

const GLOW = 360

/**
 * Cards are for things a person can act on. A card rises with a light that follows the pointer, settles under a press,
 * and keyboard focus gets the same emphasis as hover. Content can react through useCardActive.
 */
export function InteractiveCard({ children, to, linkLabel, dark, className }: Props) {
  const reduced = useReducedMotion()
  const surface = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const x = useSpring(useMotionValue(0), spring.layout)
  const y = useSpring(useMotionValue(0), spring.layout)
  const active = hovered || focused

  const follow = (event: PointerEvent) => {
    const box = surface.current?.getBoundingClientRect()
    if (!box) return
    x.set(event.clientX - box.left - GLOW / 2)
    y.set(event.clientY - box.top - GLOW / 2)
  }

  return (
    // whileTap makes an element focusable unless it says otherwise. The link and buttons inside are the tab stops, not the surface.
    <motion.div ref={surface} data-active={active || undefined} tabIndex={-1}
      className={cn('relative isolate overflow-hidden rounded-card border transition-[border-color] transition-quick',
        dark ? 'on-dark border-night-line bg-night-panel text-paper' : 'border-line bg-paper',
        active && (dark ? 'border-sprout-bright' : 'border-lagoon'), className)}
      animate={{ y: active && !reduced ? -3 : 0, boxShadow: active ? 'var(--shadow-lift)' : 'var(--shadow-rest)' }}
      whileTap={reduced ? undefined : { scale: 0.985 }} transition={spring.press}
      onPointerEnter={(event) => { setHovered(true); x.jump(event.clientX - (surface.current?.getBoundingClientRect().left ?? 0) - GLOW / 2); y.jump(event.clientY - (surface.current?.getBoundingClientRect().top ?? 0) - GLOW / 2) }}
      onPointerLeave={() => setHovered(false)} onPointerMove={follow}
      onFocusCapture={(event) => setFocused(event.target.matches(':focus-visible'))} onBlurCapture={() => setFocused(false)}>
      {!reduced && (
        <motion.span aria-hidden style={{ x, y, width: GLOW, height: GLOW }} animate={{ opacity: hovered ? 1 : 0 }} transition={{ duration: duration.standard }}
          className={cn('pointer-events-none absolute left-0 top-0 -z-10 rounded-full blur-2xl', dark ? 'bg-night-line' : 'bg-tide')} />
      )}
      {to && <Link to={to} aria-label={linkLabel} className="absolute inset-0 z-0 rounded-card outline-offset-[-3px]" />}
      <CardActive.Provider value={active}>
        <div className={cn('relative', to && 'pointer-events-none [&_a]:pointer-events-auto [&_button]:pointer-events-auto')}>{children}</div>
      </CardActive.Provider>
    </motion.div>
  )
}

type ExpandableProps = Omit<Props, 'to' | 'linkLabel'> & { summary: ReactNode; defaultOpen?: boolean }

/** A card that opens in place, so a person keeps their position in the list. */
export function ExpandableCard({ summary, children, defaultOpen = false, dark, className }: ExpandableProps) {
  const [open, setOpen] = useState(defaultOpen)
  const panel = useId()
  return (
    <motion.div layout="position" transition={spring.layout}>
      <InteractiveCard dark={dark} className={className}>
        <button type="button" aria-expanded={open} aria-controls={panel} onClick={() => setOpen((value) => !value)}
          className="flex w-full items-center gap-4 p-5 text-left outline-offset-[-3px]">
          <div className="min-w-0 flex-1">{summary}</div>
          <motion.span animate={{ rotate: open ? 180 : 0 }} transition={spring.layout} className="grid size-8 shrink-0 place-items-center rounded-full bg-mist text-ink">
            <CaretDownIcon weight="bold" aria-hidden />
          </motion.span>
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div id={panel} className="overflow-hidden" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              transition={{ duration: duration.slow, ease: ease.out }}>
              <div className="border-t border-line p-5">{children}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </InteractiveCard>
    </motion.div>
  )
}
