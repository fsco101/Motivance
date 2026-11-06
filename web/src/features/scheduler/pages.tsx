import { useTranslation } from 'react-i18next'
import { EmptyState, PageHeader, Panel } from '@/components/Display'
import '@/locales/booking'

/** Where a Scheduler lands. The dashboard takes this place once there are bookings to count. */
export function SchedulerHomePage() {
  const { t } = useTranslation()
  return (
    <>
      <PageHeader title={t('scheduler.title')} description={t('scheduler.scope')} />
      <Panel><EmptyState title={t('scheduler.emptyTitle')} detail={t('scheduler.emptyDetail')} /></Panel>
    </>
  )
}
