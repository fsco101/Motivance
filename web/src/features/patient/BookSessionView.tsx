import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { PageHeader, Panel } from '@/components/Display'
import type { Availability, Slot } from '@/data/booking'
import { useCenterFormat } from '@/features/booking/format'
import { SlotPicker } from '@/features/booking/SlotPicker'
import type { Load } from '@/features/shared'

type Props = {
  load: Load<Availability>; month: string; onMonth: (month: string) => void; canGoBack: boolean; canGoForward: boolean; today: string
  date: string | null; onDate: (date: string) => void; chosen: Slot | null; onChoose: (slot: Slot) => void; onRequest: () => void; onJoin: () => void; onLeave: () => void; busy: boolean
}

export function BookSessionView({ chosen, onRequest, onJoin, onLeave, busy, ...picker }: Props) {
  const { t } = useTranslation()
  const format = useCenterFormat()
  const next = useRef<HTMLDivElement>(null)
  // On a phone the times fill the screen, so choosing one brings the next step into view rather than leaving it below the fold.
  useEffect(() => {
    if (chosen) next.current?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [chosen])
  const full = chosen?.remaining === 0
  return (
    <>
      <PageHeader title={t('booking.title')} description={t('booking.detail')} />
      <Panel>
        <SlotPicker chosen={chosen} waitlist {...picker} />
        {chosen && (
          <div ref={next} className="mt-6 flex scroll-mb-24 flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
            <p className="min-w-0">
              <span className="block text-sm text-slate">{t(full ? 'booking.fullChoice' : 'booking.yourChoice')}</span>
              <span className="font-semibold">{format.when(chosen.startsAt, chosen.endsAt)}</span>
              {full && <span className="block text-sm text-slate">{t(chosen.waiting ? 'booking.waitingDetail' : 'booking.waitlistDetail')}</span>}
            </p>
            {!full ? <Button busy={busy} busyLabel={t('booking.requesting')} onClick={onRequest}>{t('booking.request')}</Button>
              : chosen.waiting ? <Button variant="secondary" busy={busy} busyLabel={t('booking.leavingWaitlist')} onClick={onLeave}>{t('booking.leaveWaitlist')}</Button>
                : <Button busy={busy} busyLabel={t('booking.joiningWaitlist')} onClick={onJoin}>{t('booking.joinWaitlist')}</Button>}
          </div>
        )}
      </Panel>
    </>
  )
}
