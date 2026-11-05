import { CaretRightIcon, EnvelopeIcon, LockIcon, UserIcon, WarningIcon, type Icon } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Notice, PageHeader, Readout, SectionHeading, Skeleton } from '@/components/Display'
import { Loadable, SkeletonLines, type Load } from '@/features/shared'
import { ActivityList } from './ActivityView'
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
  if (items.length === 0) return <Notice tone="info">{t('admin.attentionClear')}</Notice>
  return (
    <ul className="divide-y divide-line">
      {items.map((item) => {
        const body = (
          <>
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-amber-soft text-xl text-amber-ink"><item.icon aria-hidden /></span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{item.title}</span>
              <span className="block text-sm text-slate">{item.detail}</span>
            </span>
            <span className="numeric text-2xl font-bold">{item.count}</span>
          </>
        )
        return (
          <li key={item.title}>
            {item.to
              ? <Link to={item.to} className="group flex items-center gap-3 py-3 transition-colors transition-quick hover:text-lagoon-deep">{body}<CaretRightIcon aria-hidden className="shrink-0 text-slate" /></Link>
              : <div className="flex items-center gap-3 py-3">{body}<span className="w-4" /></div>}
          </li>
        )
      })}
    </ul>
  )
}

export function AdminOverviewView({ load, base }: { load: Load<AdminOverview>; base: string }) {
  const { t } = useTranslation()
  return (
    <>
      <PageHeader title={t('admin.title')} description={t('admin.scope')} />
      <Loadable load={load} skeleton={<div className="flex flex-col gap-8"><div className="grid grid-cols-2 gap-6 desk:grid-cols-4">{[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-24" />)}</div><SkeletonLines rows={4} /></div>}>
        {({ summary, recent }) => (
          <div className="flex flex-col gap-12">
            <div className="grid gap-x-10 gap-y-8 border-b border-line pb-10 tablet:grid-cols-3 wide:grid-cols-6">
              <Readout value={summary.accounts} label={t('admin.accounts')} detail={t('admin.disabledCount', { count: summary.disabled })} to={`${base}/accounts`} />
              <Readout value={summary.patients} label={t('admin.patients')} detail={t('admin.unlinkedCount', { count: summary.unlinkedPatients })} to={`${base}/accounts?filter=patients`} />
              <Readout value={summary.therapists} label={t('admin.therapists')} to={`${base}/accounts?filter=therapists`} />
              <Readout value={summary.activeLinks} label={t('admin.activeLinks')} to={`${base}/links`} />
              <Readout value={summary.activeExercises} label={t('admin.activeExercises')} detail={t('admin.exercisesTotal', { count: summary.exercises })} to={`${base}/catalogue`} />
              <Readout value={summary.sessionsWeek} label={t('admin.sessions')} detail={t('admin.sessionsWindow')} />
            </div>
            <div className="grid items-start gap-12 desk:grid-cols-2">
              <section>
                <SectionHeading title={t('admin.attention')} />
                <Attention summary={summary} base={base} />
                <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-3 text-sm">
                  <div className="flex items-baseline gap-2"><dt className="text-slate">{t('admin.admins')}</dt><dd className="numeric font-semibold">{summary.admins}</dd></div>
                  <div className="flex items-baseline gap-2"><dt className="text-slate">{t('admin.requests')}</dt><dd className="numeric font-semibold">{summary.pendingRequests}</dd></div>
                </dl>
              </section>
              <section>
                <SectionHeading title={t('admin.recentActivity')} action={<Link to={`${base}/activity`} className="font-semibold text-lagoon-deep hover:underline">{t('admin.viewAll')}</Link>} />
                <ActivityList events={recent} />
              </section>
            </div>
          </div>
        )}
      </Loadable>
    </>
  )
}
