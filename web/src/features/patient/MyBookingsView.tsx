import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ButtonLink, Button } from '@/components/Button'
import { ConfirmDialog } from '@/components/Dialog'
import { EmptyState, PageHeader, Panel, StatusPill } from '@/components/Display'
import { ACTIVE, isUpcoming, upcomingBookings, type Booking, type BookingStatus } from '@/data/booking'
import { useCenterFormat } from '@/features/booking/format'
import { Fact, Loadable, SkeletonCards, type Load } from '@/features/shared'

export const statusTone: Record<BookingStatus, 'positive' | 'neutral' | 'caution' | 'danger' | 'primary'> = {
  pending: 'caution', confirmed: 'positive', rescheduled: 'primary', rejected: 'danger', cancelled: 'neutral',
}

function BookingCard({ booking, onCancel }: { booking: Booking; onCancel: (booking: Booking) => void }) {
  const { t } = useTranslation()
  const format = useCenterFormat()
  const active = isUpcoming(booking)
  return (
    <li className="rounded-card border border-line bg-paper p-5 shadow-rest">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-sans text-base font-bold">{format.day(booking.startsAt)}</h3>
          <p className="text-lg font-semibold text-lagoon-deep">{format.range(booking.startsAt, booking.endsAt)}</p>
        </div>
        <StatusPill tone={statusTone[booking.status]}>{t(`booking.status.${booking.status}`)}</StatusPill>
      </div>
      <dl className="mt-3 grid gap-3 tablet:grid-cols-3">
        {(booking.therapist || ACTIVE.includes(booking.status)) && <Fact term={t('booking.therapist')}>{booking.therapist ?? t('booking.noTherapist')}</Fact>}
        {booking.location && <Fact term={t('booking.location')}>{booking.location}</Fact>}
        <Fact term={t('booking.reference')}>{booking.reference}</Fact>
      </dl>
      {booking.previousStartsAt && <p className="mt-3 text-sm text-slate">{t('booking.movedFrom', { when: format.day(booking.previousStartsAt) })}</p>}
      {booking.reason && <p className="mt-3 text-sm"><span className="font-semibold">{t('booking.reason')}: </span>{booking.reason === 'therapist_unavailable' ? t('booking.reasonTherapist') : booking.reason}</p>}
      {active && (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          {booking.canCancel ? (
            <>
              <Button size="sm" variant="secondary" onClick={() => onCancel(booking)}>{t('booking.cancel')}</Button>
              {booking.cancelUntil && <span className="text-sm text-slate">{t('booking.cancelUntil', { when: `${format.day(booking.cancelUntil)}, ${format.time(booking.cancelUntil)}` })}</span>}
            </>
          ) : <span className="text-sm text-slate">{t('booking.cancelClosed')}</span>}
        </div>
      )}
    </li>
  )
}

function Section({ title, bookings, onCancel }: { title: string; bookings: readonly Booking[]; onCancel: (booking: Booking) => void }) {
  if (bookings.length === 0) return null
  return (
    <section aria-label={title} className="mb-6">
      <h2 className="mb-3 text-xl font-bold">{title}</h2>
      <ul className="grid items-start gap-4 desk:grid-cols-2">{bookings.map((booking) => <BookingCard key={booking.id} booking={booking} onCancel={onCancel} />)}</ul>
    </section>
  )
}

export function MyBookingsView({ load, base, onCancel }: { load: Load<readonly Booking[]>; base: string; onCancel: (booking: Booking) => void }) {
  const { t } = useTranslation()
  const format = useCenterFormat()
  const [confirming, setConfirming] = useState<Booking | null>(null)
  const book = <ButtonLink to={`${base}/book`}>{t('booking.title')}</ButtonLink>
  return (
    <>
      <PageHeader title={t('booking.myTitle')} description={t('booking.myDetail')} actions={book} />
      <Loadable load={load} skeleton={<SkeletonCards count={2} />}>
        {(bookings) => {
          if (bookings.length === 0) return <Panel><EmptyState title={t('booking.emptyTitle')} detail={t('booking.emptyDetail')} /></Panel>
          return (
            <>
              <Section title={t('booking.upcoming')} bookings={upcomingBookings(bookings)} onCancel={setConfirming} />
              <Section title={t('booking.earlier')} bookings={bookings.filter((booking) => !isUpcoming(booking))} onCancel={setConfirming} />
            </>
          )
        }}
      </Loadable>
      <ConfirmDialog open={confirming !== null} onOpenChange={(open) => { if (!open) setConfirming(null) }} title={t('booking.cancel')}
        message={confirming ? t('booking.cancelMessage', { when: format.when(confirming.startsAt, confirming.endsAt) }) : ''} confirmLabel={t('booking.cancel')} cancelLabel={t('booking.keep')} destructive
        onConfirm={() => { if (confirming) onCancel(confirming) }} />
    </>
  )
}
