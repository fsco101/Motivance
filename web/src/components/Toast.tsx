import { CheckCircleIcon, InfoIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react'
import { AnimatePresence, m as motion } from 'motion/react'
import { useEffect, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { Spinner } from './Button'
import { cn } from '@/lib/cn'
import { spring } from '@/motion/tokens'

export type ToastTone = 'success' | 'info' | 'error' | 'pending'
type Toast = { id: number; message: string; tone: ToastTone }

/** Matches Android: every toast lasts this long, and only the latest is kept. */
export const TOAST_DURATION_MS = 5000

let current: Toast | null = null
let nextId = 1
const listeners = new Set<() => void>()
const publish = () => listeners.forEach((listener) => listener())

export const toast = {
  show(message: string, tone: ToastTone = 'success') {
    current = { id: nextId++, message, tone }
    publish()
  },
  clear(id?: number) {
    if (id === undefined || current?.id === id) {
      current = null
      publish()
    }
  },
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

const icons = { success: CheckCircleIcon, info: InfoIcon, error: WarningCircleIcon }

export function Toaster() {
  const { t } = useTranslation()
  const active = useSyncExternalStore(subscribe, () => current)
  useEffect(() => {
    if (!active) return
    const timer = window.setTimeout(() => toast.clear(active.id), TOAST_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [active])
  const Icon = active && active.tone !== 'pending' ? icons[active.tone] : null
  return (
    <div className="pointer-events-none fixed right-5 top-17 z-[60] flex w-[min(24rem,calc(100vw-2.5rem))] justify-end desk:right-7">
      <AnimatePresence mode="popLayout">
        {active && (
          <motion.div key={active.id} role={active.tone === 'error' ? 'alert' : 'status'} initial={{ opacity: 0, x: 24, scale: 0.98 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 16 }} transition={spring.layout}
            className="on-dark pointer-events-auto relative w-full overflow-hidden rounded-control bg-ink text-paper shadow-float">
            <div className="flex items-center gap-3 py-3 pl-4 pr-2">
              {Icon ? <Icon weight="fill" aria-hidden className={cn('shrink-0 text-xl', active.tone === 'error' ? 'text-night-caution' : 'text-sprout-bright')} /> : <Spinner className="shrink-0" />}
              <p className="min-w-0 flex-1 text-sm">{active.message}</p>
              <button type="button" onClick={() => toast.clear(active.id)} aria-label={t('common.close')} className="grid size-9 shrink-0 place-items-center rounded-control hover:bg-night-panel">
                <XIcon aria-hidden />
              </button>
            </div>
            <motion.div aria-hidden initial={{ scaleX: 1 }} animate={{ scaleX: 0 }} transition={{ duration: TOAST_DURATION_MS / 1000, ease: 'linear' }}
              className="h-0.5 origin-left bg-sprout-bright" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
