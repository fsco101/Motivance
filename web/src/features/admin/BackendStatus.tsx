import { CheckCircleIcon, WarningIcon, XCircleIcon, type Icon } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { BarList, DailyColumns, Meter, meterLevel } from '@/components/Charts'
import { Panel, Skeleton } from '@/components/Display'
import { Loadable, useFormat, type Load } from '@/features/shared'
import { deliveriesStuck, formatBytes, jobFailing } from './backend'
import type { BackendStatus } from './types'

type Tone = 'good' | 'warning' | 'critical' | 'neutral'
const TONE: Record<Tone, { icon: Icon | null; className: string }> = {
  good: { icon: CheckCircleIcon, className: 'bg-sprout-soft text-sprout-deep' },
  warning: { icon: WarningIcon, className: 'bg-amber-soft text-amber-ink' },
  critical: { icon: XCircleIcon, className: 'bg-alarm-soft text-alarm' },
  neutral: { icon: null, className: '' },
}

/** One health fact: what it is, its number, and, when it needs a look, an icon and words that say so. */
function Health({ label, value, detail, tone = 'neutral' }: { label: string; value: string; detail?: string; tone?: Tone }) {
  const { icon: Glyph, className } = TONE[tone]
  return (
    <li className="flex items-start gap-3 px-5 py-3">
      <span className={`grid size-7 shrink-0 place-items-center rounded-control ${Glyph ? className : 'bg-mist'}`}>{Glyph && <Glyph aria-hidden />}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{label}</span>
        {detail && <span className="block text-sm text-slate">{detail}</span>}
      </span>
      <span className="numeric text-lg font-bold">{value}</span>
    </li>
  )
}

const SERIES = ['sessions', 'messages', 'bookings', 'accounts'] as const

function Panels({ status }: { status: BackendStatus }) {
  const { t, i18n } = useTranslation()
  const format = useFormat()
  const locale = i18n.language === 'fil' ? 'fil-PH' : 'en-PH'
  const bytes = (value: number) => formatBytes(value, locale)
  const meter = (used: number, limit: number) => {
    const share = limit > 0 ? used / limit : 0
    const level = meterLevel(share)
    return {
      used, limit, usedText: t('admin.backend.usedOf', { used: bytes(used), limit: bytes(limit) }),
      detail: t('admin.backend.remaining', { remaining: bytes(Math.max(limit - used, 0)), share: Math.round(share * 100) }),
      status: level === 'full' ? t('admin.backend.nearlyFull') : level === 'high' ? t('admin.backend.gettingFull') : undefined,
    }
  }
  const failing = status.jobs?.filter(jobFailing) ?? []
  const stuck = deliveriesStuck(status)
  const day = (value: string) => format.short(`${value}T00:00:00`)
  return (
    <>
      <div className="grid items-stretch gap-5 desk:grid-cols-3">
        <Panel title={t('admin.backend.storage')} description={t('admin.backend.plan', { plan: status.plan.name, time: format.time(status.generatedAt) })} className="desk:col-span-2">
          <div className="flex flex-col gap-5 pb-4 pt-2">
            <Meter label={t('admin.backend.database')} {...meter(status.database.bytes, status.plan.databaseBytes)} />
            <Meter label={t('admin.backend.files')} {...meter(status.storage.bytes, status.plan.storageBytes)} />
            <div className="grid gap-5 tablet:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-semibold text-slate">{t('admin.backend.largestTables')}</h3>
                <BarList items={status.database.tables.map((table) => ({ label: table.name, value: table.bytes }))} format={bytes} />
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold text-slate">{t('admin.backend.buckets')}</h3>
                <BarList items={status.storage.buckets.map((bucket) => ({ label: t('admin.backend.bucket', { name: t(`admin.backend.bucketName.${bucket.bucket}`, { defaultValue: bucket.bucket }), count: bucket.files }), value: bucket.bytes }))} format={bytes} />
              </div>
            </div>
          </div>
        </Panel>
        <Panel title={t('admin.backend.health')} flush>
          <ul className="divide-y divide-line">
            {status.jobs === null
              ? <Health label={t('admin.backend.jobs')} value="–" detail={t('admin.backend.jobsUnknown')} tone="warning" />
              : <Health label={t('admin.backend.jobs')} value={`${status.jobs.length - failing.length}/${status.jobs.length}`}
                  detail={failing.length ? t('admin.backend.jobsFailing', { names: failing.map((job) => job.name).join(', ') }) : t('admin.backend.jobsHealthy')}
                  tone={failing.length ? 'critical' : 'good'} />}
            <Health label={t('admin.backend.waiting')} value={String(status.deliveries.waiting)} tone={stuck ? 'warning' : status.deliveries.waiting ? 'neutral' : 'good'}
              detail={status.deliveries.oldestWaiting ? t(stuck ? 'admin.backend.waitingStuck' : 'admin.backend.waitingSince', { time: format.dateTime(status.deliveries.oldestWaiting) }) : t('admin.backend.waitingNone')} />
            <Health label={t('admin.backend.failed')} value={String(status.deliveries.failedWeek)} detail={t('admin.backend.failedDetail')} tone={status.deliveries.failedWeek ? 'warning' : 'good'} />
            <Health label={t('admin.backend.sent')} value={String(status.deliveries.sentDay)} detail={t('admin.backend.sentDetail')} />
            <Health label={t('admin.backend.signedIn')} value={String(status.accounts.signedInWeek)} detail={t('admin.backend.newAccounts', { count: status.accounts.newWeek })} />
            <Health label={t('admin.backend.devices')} value={String(status.accounts.devices)} detail={t('admin.backend.devicesDetail')} />
          </ul>
        </Panel>
      </div>
      <Panel title={t('admin.backend.activity')} description={t('admin.backend.activityDetail')}>
        <div className="grid gap-x-8 gap-y-5 pb-4 pt-2 tablet:grid-cols-2 desk:grid-cols-4">
          {SERIES.map((series) => {
            const total = status.activity.reduce((sum, row) => sum + row[series], 0)
            return (
              <DailyColumns key={series} title={t(`admin.backend.series.${series}`)} total={t('admin.backend.total', { count: total })}
                days={status.activity.map((row) => ({ label: day(row.day), value: row[series] }))}
                describe={(label, value) => t('admin.backend.onDay', { day: label, count: value })} />
            )
          })}
        </div>
        <details className="pb-4 text-sm">
          <summary className="cursor-pointer text-lagoon-deep">{t('progress.showTable')}</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-md text-left">
              <caption className="sr-only">{t('admin.backend.activity')}</caption>
              <thead><tr className="text-slate"><th scope="col" className="py-1 font-semibold">{t('progress.date')}</th>{SERIES.map((series) => <th key={series} scope="col" className="py-1 text-right font-semibold">{t(`admin.backend.series.${series}`)}</th>)}</tr></thead>
              <tbody>{status.activity.map((row) => <tr key={row.day} className="border-t border-line"><td className="py-1">{day(row.day)}</td>{SERIES.map((series) => <td key={series} className="numeric py-1 text-right">{row[series]}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </details>
      </Panel>
    </>
  )
}

/** Storage against the plan, the backend's health and the last 14 days. It loads on its own, so the rest of the overview never waits for it. */
export function BackendStatusPanels({ load }: { load: Load<BackendStatus> }) {
  return (
    <Loadable load={load} skeleton={<div className="grid gap-5 desk:grid-cols-3"><Skeleton className="h-80 rounded-card desk:col-span-2" /><Skeleton className="h-80 rounded-card" /></div>}>
      {(status) => <Panels status={status} />}
    </Loadable>
  )
}
