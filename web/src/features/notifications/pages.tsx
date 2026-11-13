import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { toast } from '@/components/Toast'
import { supabase } from '@/data/client'
import { failureKey } from '@/data/errors'
import { loadInbox, markRead, notificationTarget, type AppNotification, type NotificationWorkspace } from '@/data/notifications'
import { asLoad } from '@/features/shared'
import '@/locales/booking'
import { NotificationsView } from './NotificationsView'

/** Opening a notification marks it read and goes where the thing it describes can be seen. */
function NotificationsPage({ workspace }: { workspace: NotificationWorkspace }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const navigate = useNavigate()
  const inbox = useQuery({ queryKey: ['notifications'], queryFn: () => loadInbox(supabase()) })
  const mark = async (ids?: readonly string[]) => {
    try {
      await markRead(supabase(), ids)
    } catch (failure) {
      toast.show(t(failureKey(failure)), 'error')
    }
    await client.invalidateQueries({ queryKey: ['notifications'] })
  }
  const open = (note: AppNotification) => {
    if (!note.readAt) void mark([note.id])
    void navigate(notificationTarget(note, workspace))
  }
  return <NotificationsView load={asLoad(inbox)} onOpen={open} onMarkAll={() => void mark()} />
}

export const PatientNotificationsPage = () => <NotificationsPage workspace="patient" />
export const TherapistNotificationsPage = () => <NotificationsPage workspace="therapist" />
export const SchedulerNotificationsPage = () => <NotificationsPage workspace="scheduler" />
