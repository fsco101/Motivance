import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, ButtonLink } from '@/components/Button'
import { EmptyState, PageHeader, Panel } from '@/components/Display'
import type { Availability, Booking, Slot } from '@/data/booking'
import { useCenterFormat } from '@/features/booking/format'
import { SlotPicker } from '@/features/booking/SlotPicker'
import type { Load } from '@/features/shared'

type Props = {
  booking: Booking; load: Load<Availability>; month: string; onMonth: (month: string) => void; canGoBack: boolean; canGoForward: boolean; today: string
  date: string | null; onDate: (date: string) => void; chosen: Slot | null; onChoose: (slot: Slot) => void; onMove: () => void; busy: boolean
}

export function RescheduleView({ booking, chosen, onMove, busy, ...picker }: Props) {
  const { t } = useTranslation()
  const format = useCenterFormat()
  const next = useRef<HTMLDivElement>(null)
  // On a phone the times fill the screen, so choosing one brings the next step into view rather than leaving it below the fold.
  useEffect(() => {
    if (chosen) next.current?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [chosen])
  return (
    <>
      <PageHeader title={t('booking.rescheduleTitle')} description={t('booking.rescheduleDetail')} />
      <Panel>
        <p className="mb-5"><span className="block text-sm text-slate">{t('booking.currentTime')}</span><span className="font-semibold">{format.when(booking.startsAt, booking.endsAt)}</span></p>
        <SlotPicker chosen={chosen} {...picker} />
        {chosen && (
          <div ref={next} className="mt-6 flex scroll-mb-24 flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
            <p><span className="block text-sm text-slate">{t('booking.newTime')}</span><span className="font-semibold">{format.when(chosen.startsAt, chosen.endsAt)}</span></p>
            <Button busy={busy} busyLabel={t('booking.moving')} onClick={onMove}>{t('booking.moveHere')}</Button>
          </div>
        )}
      </Panel>
    </>
  )
}

/** Reached from an old link, or a session that has since been moved as often as it can be. */
export function MoveClosedView({ base }: { base: string }) {
  const { t } = useTranslation()
  return (
    <>
      <PageHeader title={t('booking.rescheduleTitle')} />
      <Panel><EmptyState title={t('booking.moveClosedTitle')} detail={t('booking.rescheduleClosed')} action={<ButtonLink to={`${base}/bookings`}>{t('booking.myTitle')}</ButtonLink>} /></Panel>
    </>
  )
}
