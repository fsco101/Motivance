import { BookOpenIcon, CalendarCheckIcon, CaretRightIcon, EnvelopeIcon, LinkSimpleIcon, LockIcon, PulseIcon, ShieldCheckIcon, StethoscopeIcon, UserIcon, UsersThreeIcon, WarningIcon, type Icon } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { BarList } from '@/components/Charts'
import { Notice, PageHeader, Panel, Skeleton } from '@/components/Display'
import { StatCard } from '@/components/StatCard'
import { Loadable, SkeletonLines, type Load } from '@/features/shared'
import { MotionArc } from '@/motion/MotionArc'
import { ActivityTable } from './ActivityView'
import type { AdminSummary, AuditEvent } from './types'

export type AdminOverview = { summary: AdminSummary; recent: AuditEvent[] }

type Item = { title: string; detail: string; count: number; icon: Icon; to?: string }

/** Items an administrator can act on now, each leading to the section that resolves it, as on Android. */
function Attention({ summary, base }: { summary: AdminSummary; base: string }) {
  const { t } = useTranslation()
  const items: Item[] = [
    summary.unlinkedPatients > 0 && { title: t('admin.attentionUnlinked'), detail: t('admin.attentionUnlinkedDetail'), count: summary.unlinkedPatients, icon: UserIcon, to: `${base}/links` },
    summary.disabled > 0 && { title: t('admin.attentionDisabled'), detail: t('admin.attentionDisabledDetail'), count: summary.disabled, icon: LockIcon, to: `${base}/accounts?filter=disabled` },
    summary.activeExercises === 0 && { title: t('admin.attentionCatalogue'), detail: t('admin.attentionCatalogueDetail'), count: 0, icon: WarningIcon, to: `${base}/catalogue` },
    summary.pendingRequests > 0 && { title: t('admin.attentionRequests'), detail: t('admin.attentionRequestsDetail'), count: summary.pendingRequests, icon: EnvelopeIcon },
  ].filter((item): item is Item => Boolean(item))
  if (items.length === 0) return <div className="p-5"><Notice tone="info">{t('admin.attentionClear')}</Notice></div>
  return (
    <ul className="divide-y divide-line">
      {items.map((item) => {
        const body = (
          <>
            <span className="grid size-8 shrink-0 place-items-center rounded-control bg-amber-soft text-lg text-amber-ink"><item.icon aria-hidden /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{item.title}</span>
              <span className="block text-sm text-slate">{item.detail}</span>
            </span>
            <span className="numeric text-lg font-bold">{item.count}</span>
          </>
        )
        return (
          <li key={item.title}>
            {item.to
              ? <Link to={item.to} className="flex items-center gap-3 px-5 py-3 transition-colors transition-quick hover:bg-mist">{body}<CaretRightIcon aria-hidden className="shrink-0 text-slate" /></Link>
              : <div className="flex items-center gap-3 px-5 py-3">{body}<span className="w-4" /></div>}
          </li>
        )
      })}
    </ul>
  )
}

/** How many patients have a therapist: a plain share of a count, shown on the product's own arc. */
function Coverage({ summary }: { summary: AdminSummary }) {
  const { t } = useTranslation()
  const linked = Math.max(summary.patients - summary.unlinkedPatients, 0)
  const share = summary.patients === 0 ? 0 : linked / summary.patients
  return (
    <div className="flex items-center gap-5">
      <div className="relative grid shrink-0 place-items-center">
        <MotionArc progress={share} size={132} stroke={12} />
        <span className="numeric absolute text-2xl font-bold">{Math.round(share * 100)}%</span>
      </div>
      <p className="text-sm text-slate">{t('admin.coverageDetail', { linked, total: summary.patients })}</p>
    </div>
  )
}

export function AdminOverviewView({ load, base }: { load: Load<AdminOverview>; base: string }) {
  const { t } = useTranslation()
  return (
    <>
      <PageHeader title={t('admin.title')} description={t('admin.scope')} />
      <Loadable load={load} skeleton={<div className="flex flex-col gap-5"><div className="grid gap-4 tablet:grid-cols-4">{[0, 1, 2, 3, 4, 5, 6, 7].map((index) => <Skeleton key={index} className="h-28 rounded-card" />)}</div><SkeletonLines rows={6} /></div>}>
        {({ summary, recent }) => (
          <div className="flex flex-col gap-5">
            <div className="grid gap-4 tablet:grid-cols-4">
              <StatCard icon={UsersThreeIcon} value={summary.accounts} label={t('admin.accounts')} detail={t('admin.disabledCount', { count: summary.disabled })} to={`${base}/accounts`} />
              <StatCard icon={UserIcon} value={summary.patients} label={t('admin.patients')} detail={t('admin.unlinkedCount', { count: summary.unlinkedPatients })} to={`${base}/accounts?filter=patients`} />
              <StatCard icon={StethoscopeIcon} value={summary.therapists} label={t('admin.therapists')} to={`${base}/accounts?filter=therapists`} />
              <StatCard icon={CalendarCheckIcon} value={summary.schedulers} label={t('admin.schedulers')} to={`${base}/accounts?filter=schedulers`} />
              <StatCard icon={ShieldCheckIcon} value={summary.admins} label={t('admin.admins')} to={`${base}/accounts?filter=admins`} />
              <StatCard icon={LinkSimpleIcon} value={summary.activeLinks} label={t('admin.activeLinks')} to={`${base}/links`} />
              <StatCard icon={BookOpenIcon} value={summary.activeExercises} label={t('admin.activeExercises')} detail={t('admin.exercisesTotal', { count: summary.exercises })} to={`${base}/catalogue`} />
              <StatCard icon={PulseIcon} value={summary.sessionsWeek} label={t('admin.sessions')} detail={t('admin.sessionsWindow')} />
            </div>
            <div className="grid items-stretch gap-5 desk:grid-cols-3">
              <Panel title={t('admin.attention')} flush><Attention summary={summary} base={base} /></Panel>
              <Panel title={t('admin.accountsByRole')}>
                <BarList items={[
                  { label: t('admin.patients'), value: summary.patients }, { label: t('admin.therapists'), value: summary.therapists },
                  { label: t('admin.schedulers'), value: summary.schedulers }, { label: t('admin.admins'), value: summary.admins }, { label: t('admin.filter.disabled'), value: summary.disabled },
                ]} />
              </Panel>
              <Panel title={t('admin.coverage')}><Coverage summary={summary} /></Panel>
            </div>
            <Panel title={t('admin.recentActivity')} flush action={<Link to={`${base}/activity`} className="text-sm font-semibold text-lagoon-deep hover:underline">{t('admin.viewAll')}</Link>}>
              <ActivityTable events={recent} />
            </Panel>
          </div>
        )}
      </Loadable>
    </>
  )
}
