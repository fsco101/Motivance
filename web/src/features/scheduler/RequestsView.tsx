import { MagnifyingGlassIcon, XIcon } from '@phosphor-icons/react'
import { AnimatePresence, m as motion } from 'motion/react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, IconButton } from '@/components/Button'
import { DataTable, type Column, type Sort } from '@/components/DataTable'
import { EmptyState, Notice, PageHeader, Panel, StatusPill } from '@/components/Display'
import { SelectField, TextField } from '@/components/Field'
import { ACTIVE, type BookingStatus } from '@/data/booking'
import { NO_FILTERS, type RequestDetail, type RequestFilters, type RequestRow, type RequestSort, type SortKey, type TherapistChoice } from '@/data/scheduler'
import { statusTone, useCenterFormat, useReasonText } from '@/features/booking/format'
import { Fact, Loadable, SkeletonLines, type Load } from '@/features/shared'
import { spring } from '@/motion/tokens'
import { Pager } from './Pager'
import type { RequestActionKind } from './RequestDialogs'

const STATUSES: ReadonlyArray<BookingStatus | 'all'> = ['all', 'pending', 'confirmed', 'rescheduled', 'rejected', 'cancelled']

export type RequestsData = { rows: readonly RequestRow[]; total: number }

type Props = {
  load: Load<RequestsData>; therapists: readonly TherapistChoice[]; filters: RequestFilters; onFilters: (filters: RequestFilters) => void; sort: RequestSort; onSort: (sort: RequestSort) => void
  page: number; onPage: (page: number) => void; selected: RequestRow | null; onSelect: (row: RequestRow | null) => void; detail: Load<RequestDetail> | null
  checked: readonly string[]; onChecked: (ids: readonly string[]) => void; onAct: (kind: RequestActionKind, row: RequestRow) => void; onBulk: () => void; onOutdated: () => void
}

function History({ load }: { load: Load<RequestDetail> }) {
  const { t } = useTranslation()
  const format = useCenterFormat()
  const reasonText = useReasonText('scheduler')
  return (
    <Loadable load={load} skeleton={<SkeletonLines rows={3} />}>
      {({ events }) => (
        <ol className="divide-y divide-line border-y border-line">
          {events.map((event) => (
            <li key={event.id} className="py-2 text-sm">
              <p className="font-semibold">{t(`scheduler.event.${event.action}`, event.action)}</p>
              <p className="text-slate">{event.actor ?? t('scheduler.system')}, {format.day(event.recordedAt)} {format.time(event.recordedAt)}</p>
              {event.toStartsAt && event.action === 'rescheduled' && <p className="text-slate">{t('scheduler.movedTo', { when: `${format.day(event.toStartsAt)}, ${format.time(event.toStartsAt)}` })}</p>}
              {event.toAttendance && <p className="text-slate">{t(`booking.attendance.${event.toAttendance}`)}</p>}
              {event.reason && <p className="text-slate">{reasonText(event.reason)}</p>}
            </li>
          ))}
        </ol>
      )}
    </Loadable>
  )
}

function Details({ row, detail, onClose, onAct }: { row: RequestRow; detail: Load<RequestDetail> | null; onClose: () => void; onAct: Props['onAct'] }) {
  const { t } = useTranslation()
  const format = useCenterFormat()
  const reasonText = useReasonText('scheduler')
  const active = ACTIVE.includes(row.status)
  // The rest of the course can go together, from any of its sessions.
  const remaining = detail?.status === 'ready' ? detail.data.seriesRemaining : 0
  return (
    <motion.aside aria-label={t('scheduler.details', { reference: row.reference })} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={spring.layout}
      className="rounded-card border border-line bg-paper p-5 shadow-rest desk:sticky desk:top-19">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-bold">{row.patient}</h2>
          <p className="text-sm text-slate">{row.reference}</p>
        </div>
        <IconButton label={t('common.close')} onClick={onClose} className="-mr-2 -mt-2"><XIcon aria-hidden /></IconButton>
      </div>
      <div className="mt-3"><StatusPill tone={statusTone[row.status]}>{t(`booking.status.${row.status}`)}</StatusPill></div>
      <dl className="mt-4 grid gap-3">
        <Fact term={t('scheduler.when')}>{format.when(row.startsAt, row.endsAt)}</Fact>
        {(row.therapist || active) && <Fact term={t('booking.therapist')}>{row.therapist ?? t('booking.noTherapist')}</Fact>}
        {row.reason && <Fact term={t('booking.reason')}>{reasonText(row.reason)}</Fact>}
        {remaining > 0 && <Fact term={t('scheduler.seriesRemaining')}>{remaining}</Fact>}
      </dl>
      {active && (
        <div className="mt-5 flex flex-wrap gap-2">
          {row.status === 'pending' && <Button size="sm" onClick={() => onAct('confirm', row)}>{t('scheduler.confirm')}</Button>}
          <Button size="sm" variant="secondary" onClick={() => onAct('reschedule', row)}>{t('scheduler.reschedule')}</Button>
          <Button size="sm" variant="secondary" onClick={() => onAct('assign', row)}>{t(row.therapist ? 'scheduler.changeTherapist' : 'scheduler.assignTherapist')}</Button>
          {row.status === 'pending'
            ? <Button size="sm" variant="quiet" onClick={() => onAct('reject', row)}>{t('scheduler.reject')}</Button>
            : <Button size="sm" variant="quiet" onClick={() => onAct('cancel', row)}>{t('booking.cancel')}</Button>}
        </div>
      )}
      {remaining > 0 && <Button className="mt-2" size="sm" variant="quiet" onClick={() => onAct('series', row)}>{t('scheduler.seriesCancel')}</Button>}
      <h3 className="mb-2 mt-6 font-sans text-base font-bold">{t('scheduler.history')}</h3>
      {detail && <History load={detail} />}
    </motion.aside>
  )
}

export function RequestsView({ load, therapists, filters, onFilters, sort, onSort, page, onPage, selected, onSelect, detail, checked, onChecked, onAct, onBulk, onOutdated }: Props) {
  const { t } = useTranslation()
  const format = useCenterFormat()
  const [search, setSearch] = useState(filters.search)
  const rows = load.status === 'ready' ? load.data.rows : []
  const total = load.status === 'ready' ? load.data.total : 0
  const pending = rows.filter((row) => row.status === 'pending')
  const columns: ReadonlyArray<Column<RequestRow>> = [
    { key: 'select', header: t('scheduler.select'), cell: (row) => row.status === 'pending' && (
      <input type="checkbox" aria-label={t('scheduler.selectRow', { reference: row.reference })} checked={checked.includes(row.id)} onClick={(event) => event.stopPropagation()}
        onChange={(event) => onChecked(event.target.checked ? [...checked, row.id] : checked.filter((id) => id !== row.id))} className="size-4 accent-lagoon" />
    ) },
    { key: 'starts_at', header: t('scheduler.when'), sortable: true, cell: (row) => <><span className="block whitespace-nowrap font-semibold">{format.day(row.startsAt)}</span><span className="whitespace-nowrap text-slate">{format.range(row.startsAt, row.endsAt)}</span></> },
    { key: 'patient', header: t('scheduler.patient'), sortable: true, cell: (row) => <button type="button" onClick={(event) => { event.stopPropagation(); onSelect(row) }} className="text-left font-semibold hover:underline">{row.patient}</button> },
    { key: 'therapist', header: t('booking.therapist'), sortable: true, cell: (row) => row.therapist ?? (ACTIVE.includes(row.status) && <span className="text-slate">{t('booking.noTherapist')}</span>) },
    { key: 'status', header: t('scheduler.status'), sortable: true, cell: (row) => <span className="flex flex-wrap gap-1"><StatusPill tone={statusTone[row.status]}>{t(`booking.status.${row.status}`)}</StatusPill>{row.seriesId && <StatusPill>{t('scheduler.seriesLabel')}</StatusPill>}</span> },
    { key: 'reference_no', header: t('booking.reference'), hideBelow: 'desk', sortable: true, cell: (row) => <span className="numeric whitespace-nowrap">{row.reference}</span> },
    { key: 'created_at', header: t('scheduler.requested'), hideBelow: 'wide', sortable: true, cell: (row) => <span className="whitespace-nowrap">{format.day(row.createdAt)}</span> },
  ]
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onFilters({ ...filters, search })
  }
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS)
  return (
    <>
      <PageHeader title={t('scheduler.requestsTitle')} description={t('scheduler.requestsDetail')} />
      <div className="grid items-start gap-5 desk:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <Panel flush
            toolbar={(
              <form onSubmit={submit} className="grid w-full items-end gap-3 tablet:grid-cols-2 wide:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_auto]">
                <div className="flex items-end gap-2">
                  <TextField className="min-w-0 flex-1" label={t('scheduler.search')} value={search} maxLength={100} onChange={(event) => setSearch(event.target.value)} />
                  <IconButton type="submit" label={t('scheduler.searchAction')}><MagnifyingGlassIcon aria-hidden /></IconButton>
                </div>
                <SelectField label={t('scheduler.status')} value={filters.status} onChange={(status) => onFilters({ ...filters, status: status as RequestFilters['status'] })}
                  options={STATUSES.map((value) => ({ value, label: value === 'all' ? t('scheduler.allStatuses') : t(`booking.status.${value}`) }))} />
                <SelectField label={t('booking.therapist')} value={filters.therapist} onChange={(therapist) => onFilters({ ...filters, therapist })}
                  options={[{ value: 'all', label: t('scheduler.allTherapists') }, ...therapists.map((item) => ({ value: item.id, label: item.name }))]} />
                <TextField label={t('progress.from')} type="date" value={filters.from} onChange={(event) => onFilters({ ...filters, from: event.target.value })} />
                <TextField label={t('progress.through')} type="date" value={filters.to} onChange={(event) => onFilters({ ...filters, to: event.target.value })} />
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={onOutdated}>{t('scheduler.outdated')}</Button>
                  {filtered && <Button variant="quiet" onClick={() => { setSearch(''); onFilters(NO_FILTERS) }}>{t('scheduler.clearFilters')}</Button>}
                </div>
              </form>
            )}
            footer={<Pager page={page} total={total} onPage={onPage} />}>
            {pending.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 border-b border-line bg-mist px-4 py-2 text-sm">
                <span>{t('scheduler.selected', { count: checked.length })}</span>
                <Button size="sm" variant="quiet" onClick={() => onChecked(pending.map((row) => row.id))}>{t('scheduler.selectPage')}</Button>
                <Button size="sm" variant="secondary" disabled={checked.length === 0} onClick={onBulk}>{t('scheduler.rejectSelected')}</Button>
              </div>
            )}
            {load.status === 'error' ? <div className="p-5"><Notice title={t('common.loadFailedTitle')} onRetry={load.retry}>{t('common.loadFailed')}</Notice></div> : (
              <DataTable caption={t('scheduler.requestsTitle')} columns={columns} rows={rows} rowKey={(row) => row.id} loading={load.status === 'loading'} sort={sort as Sort}
                onSort={(next) => onSort({ key: next.key as SortKey, direction: next.direction })} onRowClick={onSelect} selectedKey={selected?.id ?? null}
                empty={<div className="p-5"><EmptyState title={t('scheduler.noneTitle')} detail={t(filtered ? 'scheduler.noneFiltered' : 'scheduler.noneDetail')} /></div>} />
            )}
          </Panel>
        </div>
        <AnimatePresence>
          {selected && <div className="w-full desk:w-80"><Details key={selected.id} row={selected} detail={detail} onClose={() => onSelect(null)} onAct={onAct} /></div>}
        </AnimatePresence>
      </div>
    </>
  )
}
