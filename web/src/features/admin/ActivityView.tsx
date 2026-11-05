import { BookOpenIcon, HeartbeatIcon, LinkSimpleIcon, ShieldCheckIcon, UsersIcon, type Icon } from '@phosphor-icons/react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { DataTable, LoadMore, type Column } from '@/components/DataTable'
import { EmptyState, PageHeader, Panel, StatusPill, Tabs } from '@/components/Display'
import { Loadable, SkeletonLines, useFormat, type Load } from '@/features/shared'
import type { AuditCategory, AuditEvent } from './types'

const icons: Record<AuditCategory, Icon> = { accounts: UsersIcon, links: LinkSimpleIcon, catalogue: BookOpenIcon, clinical: HeartbeatIcon, privacy: ShieldCheckIcon }
const CATEGORIES: readonly AuditCategory[] = ['accounts', 'links', 'catalogue', 'clinical', 'privacy']

export function ActivityTable({ events, empty }: { events: readonly AuditEvent[]; empty?: ReactNode }) {
  const { t } = useTranslation()
  const format = useFormat()
  const columns: ReadonlyArray<Column<AuditEvent>> = [
    { key: 'event', header: t('admin.eventColumn'), cell: (event) => {
      const Glyph = icons[event.category]
      return (
        <span className="flex items-center gap-2.5">
          <span className="grid size-7 shrink-0 place-items-center rounded-control bg-tide text-base text-lagoon-deep"><Glyph aria-hidden /></span>
          <span className="font-semibold">{t(`admin.event.${event.kind}`, t('admin.event.other'))}</span>
        </span>
      )
    } },
    { key: 'target', header: t('admin.affectedColumn'), cell: (event) => event.target },
    { key: 'category', header: t('admin.categoryColumn'), hideBelow: 'wide', cell: (event) => <StatusPill>{t(`admin.category.${event.category}`)}</StatusPill> },
    { key: 'actor', header: t('admin.byColumn'), hideBelow: 'desk', cell: (event) => event.actor ?? <span className="text-slate">{t('admin.eventSystem')}</span> },
    { key: 'when', header: t('admin.whenColumn'), align: 'end', cell: (event) => <time dateTime={event.recordedAt} className="whitespace-nowrap text-slate">{format.dateTime(event.recordedAt)}</time> },
  ]
  return <DataTable caption={t('nav.activity')} columns={columns} rows={events} rowKey={(event) => String(event.id)} empty={empty} />
}

export function ActivityView({ load, onMore }: { load: Load<{ events: AuditEvent[]; hasMore: boolean; loadingMore?: boolean }>; onMore: () => void }) {
  const { t } = useTranslation()
  const [category, setCategory] = useState<'all' | AuditCategory>('all')
  const data = load.status === 'ready' ? load.data : null
  const shown = (data?.events ?? []).filter((event) => category === 'all' || event.category === category)
  return (
    <>
      <PageHeader title={t('nav.activity')} description={t('admin.activityHelp')} />
      <Panel flush
        toolbar={<Tabs label={t('admin.filterLabel')} value={category} onChange={(value) => setCategory(value as 'all' | AuditCategory)}
          tabs={[{ value: 'all', label: t('admin.filter.all') }, ...CATEGORIES.map((value) => ({ value, label: t(`admin.category.${value}`) }))]} />}
        footer={data && <LoadMore shown={t('admin.shownCount', { shown: shown.length, total: data.events.length })} onLoad={data.hasMore ? onMore : undefined} busy={data.loadingMore} label={t('admin.activityMore')} />}>
        <Loadable load={load} skeleton={<div className="p-4"><SkeletonLines rows={8} /></div>}>
          {({ hasMore }) => <ActivityTable events={shown} empty={<EmptyState title={t('admin.activityEmpty')} detail={t(hasMore ? 'admin.activityEmptyMore' : 'admin.activityEmptyDetail')} />} />}
        </Loadable>
      </Panel>
    </>
  )
}
