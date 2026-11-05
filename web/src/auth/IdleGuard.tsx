import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { Dialog } from '@/components/Dialog'
import { useAuth } from './AuthProvider'
import { IDLE_LIMIT_MS, idleState, readActivity, writeActivity } from './idle'

const WRITE_EVERY_MS = 15_000

/** Warns before signing out an idle session, so a shared computer is not left open on patient data. */
export function IdleGuard() {
  const { t } = useTranslation()
  const { signOut } = useAuth()
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const lastWrite = useRef(0)

  useEffect(() => {
    const seen = () => {
      const now = Date.now()
      // While warning, only the button counts: a stray mouse move must not hide the question.
      if (idleState(now, readActivity()) !== 'active' || now - lastWrite.current < WRITE_EVERY_MS) return
      lastWrite.current = now
      writeActivity(now)
    }
    const events = ['pointerdown', 'pointermove', 'keydown', 'scroll'] as const
    events.forEach((name) => window.addEventListener(name, seen, { passive: true }))
    const check = window.setInterval(() => {
      const now = Date.now()
      const activity = readActivity()
      const state = idleState(now, activity)
      if (state === 'expired') void signOut('idle')
      setSecondsLeft(state === 'warning' && activity ? Math.ceil((activity + IDLE_LIMIT_MS - now) / 1000) : null)
    }, 1000)
    return () => {
      events.forEach((name) => window.removeEventListener(name, seen))
      window.clearInterval(check)
    }
  }, [signOut])

  const stay = () => {
    writeActivity(Date.now())
    setSecondsLeft(null)
  }
  return (
    <Dialog open={secondsLeft !== null} onOpenChange={(open) => { if (!open) stay() }} title={t('idle.title')} description={t('idle.message', { count: secondsLeft ?? 0 })}>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={() => void signOut()}>{t('account.signOut')}</Button>
        <Button onClick={stay}>{t('idle.stay')}</Button>
      </div>
    </Dialog>
  )
}
