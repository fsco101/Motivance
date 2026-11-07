import { CalendarCheckIcon, ChartBarIcon, EnvelopeIcon } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { ButtonLink } from '@/components/Button'
import { PageHeader, Panel, Skeleton } from '@/components/Display'
import { StatCard } from '@/components/StatCard'
import type { SchedulerSummary } from '@/data/scheduler'
import { useCenterFormat } from '@/features/booking/format'
import { Loadable, type Load } from '@/features/shared'

/** Three figures, each leading to the page that explains it. Everything here is counted on the server. */
export function SchedulerDashboardView({ load, base }: { load: Load<SchedulerSummary>; base: string }) {
  const { t } = useTranslation()
  const format = useCenterFormat()
  return (
    <>
      <PageHeader title={t('scheduler.title')} description={t('scheduler.scope')} />
      <Loadable load={load} skeleton={<div className="grid gap-3 tablet:grid-cols-3">{[0, 1, 2].map((index) => <Skeleton key={index} className="h-28 rounded-card" />)}</div>}>
        {(summary) => (
          <>
            <div className="grid gap-3 tablet:grid-cols-3">
              <StatCard icon={EnvelopeIcon} value={summary.pending} label={t('scheduler.pendingRequests')} detail={t('scheduler.pendingDetail')} tone={summary.pending > 0 ? 'caution' : undefined} to={`${base}/requests?status=pending`} />
              <StatCard icon={CalendarCheckIcon} value={summary.today} label={t('scheduler.todaySessions')} detail={format.calendarDay(summary.date)} to={`${base}/schedule?from=${summary.date}&to=${summary.date}`} />
              <StatCard icon={ChartBarIcon} value={summary.utilization} unit="%" label={t('scheduler.utilization')} detail={summary.places > 0 ? t('scheduler.utilizationCount', { booked: summary.booked, places: summary.places }) : t('scheduler.noOpenSlots')}
                to={`${base}/schedule?from=${summary.weekFrom}&to=${summary.weekTo}`} />
            </div>
            <p className="mt-3 max-w-[62ch] text-sm text-slate">{t('scheduler.utilizationMeaning', { from: format.calendarDay(summary.weekFrom), to: format.calendarDay(summary.weekTo) })}</p>
          </>
        )}
      </Loadable>
      <div className="mt-5">
        <Panel><div className="flex flex-wrap gap-2"><ButtonLink to={`${base}/requests`}>{t('scheduler.requestsTitle')}</ButtonLink><ButtonLink variant="secondary" to={`${base}/schedule`}>{t('scheduler.scheduleTitle')}</ButtonLink><ButtonLink variant="secondary" to={`${base}/calendar`}>{t('calendar.title')}</ButtonLink></div></Panel>
      </div>
    </>
  )
}
