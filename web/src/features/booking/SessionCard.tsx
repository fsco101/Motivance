import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Avatar } from '@/components/Display'
import { TextArea } from '@/components/Field'
import { VISIT_REASON_MAX, VISIT_REASON_MIN } from '@/data/booking'
import { cn } from '@/lib/cn'

export type SessionPerson = {
  name: string | null; photo: string | null
  /** The signed-in person's own place in the session, named "You" so the card reads from where they stand. */
  you?: boolean
  /** Where the person's record opens, when the reader may open it. */
  to?: string | null
}

/** One person in a session: face, name and part, as a small profile card. A therapist not yet chosen still has a place. */
function PersonTile({ person, role }: { person: SessionPerson; role: 'patient' | 'therapist' }) {
  const { t } = useTranslation()
  const missing = !person.name
  const name = person.name ?? t('booking.noTherapist')
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-control border border-line bg-paper p-3">
      {missing
        ? <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-full border border-dashed border-line-strong text-lg text-slate">?</span>
        : <Avatar name={name} photo={person.photo} size={48} />}
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate">
          {t(role === 'patient' ? 'booking.patientRole' : 'booking.therapistRole')}{person.you && ` · ${t('booking.youSuffix')}`}
        </p>
        <p className={cn('break-words font-semibold', missing && 'font-normal text-slate')}>
          {person.to ? <Link to={person.to} className="underline underline-offset-4">{name}</Link> : name}
        </p>
      </div>
    </div>
  )
}

/** Why the patient is coming, kept as they wrote it. Older bookings have none, and then nothing is shown. */
export function VisitReason({ reason }: { reason: string | null }) {
  const { t } = useTranslation()
  if (!reason) return null
  return (
    <div className="rounded-control bg-mist p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate">{t('booking.visitReason')}</p>
      <p className="mt-0.5 whitespace-pre-line break-words">{reason}</p>
    </div>
  )
}

/**
 * A session as a card: when it is and its state, both people side by side, why the patient is coming, then the details and any
 * actions. Patients, therapists and Schedulers all read a session this way, on the web and on Android.
 */
export function SessionCard({ heading, status, patient, therapist, reason, children, className }: {
  heading?: ReactNode; status?: ReactNode; patient: SessionPerson; therapist: SessionPerson; reason: string | null; children?: ReactNode; className?: string
}) {
  return (
    <div className={cn('@container flex min-w-0 flex-col gap-3', className)}>
      {(heading || status) && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">{heading}</div>
          {status}
        </div>
      )}
      <div className="grid gap-2 @sm:grid-cols-2">
        <PersonTile person={patient} role="patient" />
        <PersonTile person={therapist} role="therapist" />
      </div>
      <VisitReason reason={reason} />
      {children}
    </div>
  )
}

/**
 * The reason for a visit, as a patient or a Scheduler writes it. The count shows how much room is left, and the error appears
 * only once the person has tried to send, so it does not scold them while they type.
 */
export function VisitReasonField({ value, onChange, showError, label, hint, required = true, disabled }: {
  value: string; onChange: (value: string) => void; showError: boolean; label?: string; hint?: string; required?: boolean; disabled?: boolean
}) {
  const { t } = useTranslation()
  const length = value.trim().length
  const invalid = required ? length < VISIT_REASON_MIN || length > VISIT_REASON_MAX : length > 0 && (length < VISIT_REASON_MIN || length > VISIT_REASON_MAX)
  return (
    <div>
      <TextArea label={label ?? t('booking.visitReason')} hint={hint ?? t('booking.visitReasonHint')} rows={3} value={value} maxLength={VISIT_REASON_MAX} required={required} disabled={disabled}
        error={showError && invalid ? t('booking.visitReasonError') : null} onChange={(event) => onChange(event.target.value)} />
      <p className="mt-1 text-right text-xs text-slate" aria-hidden>{t('booking.visitReasonCount', { count: value.length })}</p>
    </div>
  )
}
