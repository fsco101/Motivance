import { AnimatePresence, m as motion } from 'motion/react'
import { AlertDialog, Dialog as RadixDialog } from 'radix-ui'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { XIcon } from '@phosphor-icons/react'
import { duration, ease, spring } from '@/motion/tokens'
import { Button, IconButton } from './Button'

const overlay = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: duration.standard, ease: ease.out } }
const panel = { initial: { opacity: 0, y: 14, scale: 0.98 }, animate: { opacity: 1, y: 0, scale: 1 }, exit: { opacity: 0, y: 8, scale: 0.985 }, transition: spring.layout }
const shell = 'fixed left-1/2 top-1/2 z-50 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2'

type DialogProps = { open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; children: ReactNode }

export function Dialog({ open, onOpenChange, title, description, children }: DialogProps) {
  const { t } = useTranslation()
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <RadixDialog.Portal forceMount>
            <RadixDialog.Overlay asChild forceMount><motion.div {...overlay} className="fixed inset-0 z-40 bg-night/55" /></RadixDialog.Overlay>
            <div className={shell}>
              <RadixDialog.Content asChild forceMount aria-describedby={description ? undefined : undefined}>
                <motion.div {...panel} className="rounded-card bg-paper p-6 shadow-float">
                  <div className="mb-3 flex items-start justify-between gap-4">
                    <RadixDialog.Title className="text-2xl font-bold">{title}</RadixDialog.Title>
                    <RadixDialog.Close asChild><IconButton label={t('common.close')}><XIcon aria-hidden /></IconButton></RadixDialog.Close>
                  </div>
                  {description && <RadixDialog.Description className="mb-4 text-slate">{description}</RadixDialog.Description>}
                  {children}
                </motion.div>
              </RadixDialog.Content>
            </div>
          </RadixDialog.Portal>
        )}
      </AnimatePresence>
    </RadixDialog.Root>
  )
}

type ConfirmProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** Name the record, so the person approves one specific change. */
  message: string
  confirmLabel: string
  destructive?: boolean
  onConfirm: () => void
}

export function ConfirmDialog({ open, onOpenChange, title, message, confirmLabel, destructive, onConfirm }: ConfirmProps) {
  const { t } = useTranslation()
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <AlertDialog.Portal forceMount>
            <AlertDialog.Overlay asChild forceMount><motion.div {...overlay} className="fixed inset-0 z-40 bg-night/55" /></AlertDialog.Overlay>
            <div className={shell}>
              <AlertDialog.Content asChild forceMount>
                <motion.div {...panel} className="rounded-card bg-paper p-6 shadow-float">
                  <AlertDialog.Title className="text-2xl font-bold">{title}</AlertDialog.Title>
                  <AlertDialog.Description className="mt-2 text-slate">{message}</AlertDialog.Description>
                  <div className="mt-6 flex flex-wrap justify-end gap-2">
                    <AlertDialog.Cancel asChild><Button variant="secondary">{t('common.cancel')}</Button></AlertDialog.Cancel>
                    <AlertDialog.Action asChild><Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button></AlertDialog.Action>
                  </div>
                </motion.div>
              </AlertDialog.Content>
            </div>
          </AlertDialog.Portal>
        )}
      </AnimatePresence>
    </AlertDialog.Root>
  )
}
