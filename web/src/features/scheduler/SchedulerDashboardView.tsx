import { ArrowRightIcon, CalendarCheckIcon, ChartBarIcon, EnvelopeIcon } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Avatar, PageHeader, Panel, Skeleton } from '@/components/Display'
import { StatCard } from '@/components/StatCard'
import type { RequestRow, SchedulerSummary } from '@/data/scheduler'
import { useCenterFormat } from '@/features/booking/format'
import { Loadable, SkeletonLines, type Load } from '@/features/shared'

/** The first few rows of a list, and how many there are in all. */
export type Preview = { rows: readonly RequestRow[]; total: number }
/** How many rows a preview shows before "See all". */
export const PREVIEW_ROWS = 5

/** A short list on the dashboard: the first few rows, each leading to its page, and a way to the whole list (#153). */
function PreviewPanel({ title, load, empty, all, to, row }: {
  title: string; load: Load<Preview>; empty: string; all: (total: number) => string; to: string; row: (item: RequestRow) => { primary: string; secondary: string; person: string; photo: string | null }
}) {
  return (
    <div role="region" aria-label={title}>
    <Panel title={title} flush action={load.status === 'ready' && load.data.total > 0 ? (
      <Link to={to} className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-lagoon-deep hover:underline">{all(load.data.total)}<ArrowRightIcon aria-hidden /></Link>
    ) : undefined}>
      <Loadable load={load} skeleton={<div className="p-5"><SkeletonLines rows={3} /></div>}>
        {(preview) => preview.rows.length === 0 ? <p className="px-5 py-6 text-slate">{empty}</p> : (
          <ul className="divide-y divide-line">
            {preview.rows.slice(0, PREVIEW_ROWS).map((item) => {
              const shown = row(item)
              return (
                <li key={item.id} className="flex items-center gap-3 px-5 py-3">
                  <Avatar name={shown.person} photo={shown.photo} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{shown.primary}</p>
                    <p className="truncate text-sm text-slate">{shown.secondary}</p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Loadable>
    </Panel>
    </div>
  )
}

/** Three figures, each leading to the page that explains it, then the requests waiting and today's sessions. Everything here is counted on the server. */
export function SchedulerDashboardView({ load, pending, today, base }: { load: Load<SchedulerSummary>; pending: Load<Preview>; today: Load<Preview>; base: string }) {
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
      {/* What needs the Scheduler next, in place of buttons that repeated the sidebar. */}
      <div className="mt-5 grid items-start gap-5 desk:grid-cols-2">
        <PreviewPanel title={t('scheduler.previewPending')} load={pending} empty={t('scheduler.previewPendingEmpty')} all={(total) => t('scheduler.previewAll', { count: total })} to={`${base}/requests?status=pending`}
          row={(item) => ({ primary: item.patient, secondary: `${format.day(item.startsAt)} · ${format.range(item.startsAt, item.endsAt)}`, person: item.patient, photo: item.patientPhoto })} />
        <PreviewPanel title={t('scheduler.previewToday')} load={today} empty={t('scheduler.previewTodayEmpty')} all={(total) => t('scheduler.previewAll', { count: total })}
          to={load.status === 'ready' ? `${base}/schedule?from=${load.data.date}&to=${load.data.date}` : `${base}/schedule`}
          row={(item) => ({ primary: `${format.range(item.startsAt, item.endsAt)} · ${item.patient}`, secondary: item.therapist ?? t('booking.noTherapist'), person: item.patient, photo: item.patientPhoto })} />
      </div>
    </>
  )
}
