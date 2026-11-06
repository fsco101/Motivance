import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { EmptyState, PageHeader, Panel } from '@/components/Display'
import type { AppNotification, Inbox } from '@/data/notifications'
import { useCenterFormat, useReasonText } from '@/features/booking/format'
import { Loadable, SkeletonLines, type Load } from '@/features/shared'
import { cn } from '@/lib/cn'

/** The sentence for a notification, written here from its facts so it follows the reader's language and the center's time. */
export function useNotificationText() {
  const { t } = useTranslation()
  const format = useCenterFormat()
  return (note: AppNotification) => {
    // A therapist who lost a session knows it by the time they had, not the time it moved to.
    const was = note.previousStartsAt ?? note.startsAt
    return t(`notifications.${note.kind}`, {
      when: format.when(note.startsAt, note.endsAt), was: `${format.day(was)}, ${format.time(was)}`, patient: note.patient ?? '', therapist: note.therapist ?? t('booking.noTherapist'),
    })
  }
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
                    <span aria-hidden className={cn('mt-2 size-2 shrink-0 rounded-full', !note.readAt && 'bg-lagoon')} />
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
