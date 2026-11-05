import { BookOpenIcon, HeartbeatIcon, LinkSimpleIcon, ShieldCheckIcon, UsersIcon, type Icon } from '@phosphor-icons/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadMore } from '@/components/DataTable'
import { EmptyState, PageHeader, Tabs } from '@/components/Display'
import { Loadable, SkeletonLines, useFormat, type Load } from '@/features/shared'
import type { AuditCategory, AuditEvent } from './types'

const icons: Record<AuditCategory, Icon> = { accounts: UsersIcon, links: LinkSimpleIcon, catalogue: BookOpenIcon, clinical: HeartbeatIcon, privacy: ShieldCheckIcon }
const CATEGORIES: readonly AuditCategory[] = ['accounts', 'links', 'catalogue', 'clinical', 'privacy']

export function ActivityList({ events }: { events: readonly AuditEvent[] }) {
  const { t } = useTranslation()
  const format = useFormat()
  return (
    <ol className="relative">
      {events.map((event) => {
        const CategoryIcon = icons[event.category]
        return (
          <li key={event.id} className="relative flex gap-3 pb-5 last:pb-0">
            <span aria-hidden className="absolute bottom-0 left-[1.0625rem] top-9 w-px bg-line last:hidden" />
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-tide text-lg text-lagoon-deep"><CategoryIcon aria-hidden /></span>
            <div className="min-w-0 pt-0.5">
              <p><span className="font-semibold">{t(`admin.event.${event.kind}`, t('admin.event.other'))}</span> <span className="text-slate">{event.target}</span></p>
              <p className="text-sm text-slate">
                <span>{t('admin.eventBy', { actor: event.actor ?? t('admin.eventSystem') })}</span>{', '}
                <time dateTime={event.recordedAt}>{format.dateTime(event.recordedAt)}</time>
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export function ActivityView({ load, onMore }: { load: Load<{ events: AuditEvent[]; hasMore: boolean }>; onMore: () => void }) {
  const { t } = useTranslation()
  const [category, setCategory] = useState<'all' | AuditCategory>('all')
  return (
    <>
      <PageHeader title={t('nav.activity')} description={t('admin.activityHelp')} />
      <Tabs className="mb-6" label={t('admin.filterLabel')} value={category} onChange={(value) => setCategory(value as 'all' | AuditCategory)}
        tabs={[{ value: 'all', label: t('admin.filter.all') }, ...CATEGORIES.map((value) => ({ value, label: t(`admin.category.${value}`) }))]} />
      <Loadable load={load} skeleton={<SkeletonLines rows={8} />}>
        {({ events, hasMore }) => {
          const shown = events.filter((event) => category === 'all' || event.category === category)
          return (
            <div className="max-w-3xl">
              {shown.length === 0 ? <EmptyState title={t('admin.activityEmpty')} detail={t(hasMore ? 'admin.activityEmptyMore' : 'admin.activityEmptyDetail')} /> : <ActivityList events={shown} />}
              <LoadMore shown={t('admin.shownCount', { shown: shown.length, total: events.length })} onLoad={hasMore ? onMore : undefined} label={t('admin.activityMore')} />
            </div>
          )
        }}
      </Loadable>
    </>
  )
}
