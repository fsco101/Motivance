import { CalendarCheckIcon, PersonSimpleTaiChiIcon } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { Avatar, EmptyState, PageHeader, Panel } from '@/components/Display'
import { BOOKING_KINDS, type AppNotification, type Inbox } from '@/data/notifications'
import { useCenterFormat, useReasonText } from '@/features/booking/format'
import { Loadable, SkeletonLines, type Load } from '@/features/shared'
import { cn } from '@/lib/cn'

const bookingKinds = new Set<string>(BOOKING_KINDS)

/** The sentence for a notification, written here from its facts so it follows the reader's language and the center's time. */
export function useNotificationText() {
  const { t } = useTranslation()
  const format = useCenterFormat()
  return (note: AppNotification) => {
    // A therapist who lost a session knows it by the time they had, not the time it moved to.
    const was = note.previousStartsAt ?? note.startsAt
    return t(`notifications.${note.kind}`, {
      when: note.startsAt && note.endsAt ? format.when(note.startsAt, note.endsAt) : '', was: was ? `${format.day(was)}, ${format.time(was)}` : '',
      patient: note.patient ?? '', therapist: note.therapist ?? t('booking.noTherapist'),
      sessions: note.sessions, last: note.lastStartsAt ? format.day(note.lastStartsAt) : '', completed: note.completed ?? 0, target: note.target ?? 0, days: note.days ?? 0,
    })
  }
}

/** The face of whoever it is about, or what it is about when nobody else is involved. The sentence already names them. */
function NoteFace({ note }: { note: AppNotification }) {
  if (note.subjectId) return <Avatar name={note.subjectName || '?'} photo={note.subjectPhoto} size={36} />
  const Icon = bookingKinds.has(note.kind) ? CalendarCheckIcon : PersonSimpleTaiChiIcon
  return <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-tide text-lg text-lagoon-deep"><Icon /></span>
}

export function NotificationsView({ load, onOpen, onMarkAll }: { load: Load<Inbox>; onOpen: (note: AppNotification) => void; onMarkAll: () => void }) {
  const { t } = useTranslation()
  const format = useCenterFormat()
  const text = useNotificationText()
  const reasonText = useReasonText()
  const unread = load.status === 'ready' ? load.data.unread : 0
  return (
    <>
      <PageHeader title={t('nav.notifications')} description={t('notifications.detail')} actions={unread > 0 && <Button size="sm" variant="secondary" onClick={onMarkAll}>{t('notifications.markAll')}</Button>} />
      <Panel flush>
        <Loadable load={load} skeleton={<div className="p-5"><SkeletonLines rows={4} /></div>}>
          {({ rows }) => (rows.length === 0 ? <EmptyState title={t('notifications.noneTitle')} detail={t('notifications.noneDetail')} /> : (
            <ul className="divide-y divide-line">
              {rows.map((note) => (
                <li key={note.id}>
                  <button type="button" onClick={() => onOpen(note)} className={cn('flex w-full items-start gap-3 px-5 py-3 text-left transition-colors transition-quick hover:bg-mist', !note.readAt && 'bg-tide')}>
                    <span aria-hidden className={cn('mt-4 size-2 shrink-0 rounded-full', !note.readAt && 'bg-lagoon')} />
                    <NoteFace note={note} />
                    <span className="min-w-0 flex-1">
                      <span className={cn('block', !note.readAt && 'font-semibold')}>{text(note)}</span>
                      {note.reason && <span className="block text-sm">{reasonText(note.reason)}</span>}
                      <span className="block text-sm text-slate">
                        {format.day(note.createdAt)}, {format.time(note.createdAt)}
                        {!note.readAt && <span className="sr-only">, {t('notifications.unread')}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ))}
        </Loadable>
      </Panel>
    </>
  )
}
