import { DownloadSimpleIcon, MagnifyingGlassIcon } from '@phosphor-icons/react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, IconButton } from '@/components/Button'
import { DataTable, type Column, type Sort } from '@/components/DataTable'
import { EmptyState, Notice, PageHeader, Panel, StatusPill } from '@/components/Display'
import { SelectField, TextField } from '@/components/Field'
import type { Attendance } from '@/data/booking'
import { NO_SCHEDULE_FILTERS, type PatientChoice, type RequestRow, type RequestSort, type ScheduleFilters, type SortKey, type TherapistChoice } from '@/data/scheduler'
import { AttendanceControl } from '@/features/booking/AttendanceControl'
import { statusTone, useCenterFormat } from '@/features/booking/format'
import type { Load } from '@/features/shared'
import { Pager } from './Pager'
import type { RequestsData } from './RequestsView'

export type ExportFormat = 'xlsx' | 'pdf'

type Props = {
  load: Load<RequestsData>; therapists: readonly TherapistChoice[]; patients: readonly PatientChoice[]; filters: ScheduleFilters; onFilters: (filters: ScheduleFilters) => void
  sort: RequestSort; onSort: (sort: RequestSort) => void; page: number; onPage: (page: number) => void; exporting: ExportFormat | null; onExport: (format: ExportFormat) => void
  onMark: (row: RequestRow, attendance: Attendance) => void; marking: boolean; onSeries: () => void
}

export function ConfirmedScheduleView({ load, therapists, patients, filters, onFilters, sort, onSort, page, onPage, exporting, onExport, onMark, marking, onSeries }: Props) {
  const { t } = useTranslation()
  const format = useCenterFormat()
  const [search, setSearch] = useState(filters.search)
  const rows = load.status === 'ready' ? load.data.rows : []
  const total = load.status === 'ready' ? load.data.total : 0
  const columns: ReadonlyArray<Column<RequestRow>> = [
    { key: 'starts_at', header: t('scheduler.when'), sortable: true, cell: (row) => <><span className="block whitespace-nowrap font-semibold">{format.day(row.startsAt)}</span><span className="whitespace-nowrap text-slate">{format.range(row.startsAt, row.endsAt)}</span></> },
    { key: 'patient', header: t('scheduler.patient'), sortable: true, cell: (row) => <span className="font-semibold">{row.patient}</span> },
    { key: 'therapist', header: t('booking.therapist'), sortable: true, cell: (row) => row.therapist },
    { key: 'status', header: t('scheduler.status'), sortable: true, cell: (row) => <span className="flex flex-wrap gap-1"><StatusPill tone={statusTone[row.status]}>{t(`booking.status.${row.status}`)}</StatusPill>{row.seriesId && <StatusPill>{t('scheduler.seriesLabel')}</StatusPill>}</span> },
    {
      key: 'attendance', header: t('booking.attendanceTitle'), sortable: true,
      cell: (row) => (row.started ? <AttendanceControl value={row.attendance} label={t('booking.attendanceFor', { patient: row.patient })} disabled={marking} onMark={(value) => onMark(row, value)} />
        : <span className="text-sm text-slate">{t('scheduler.notStarted')}</span>),
    },
    { key: 'reference_no', header: t('booking.reference'), hideBelow: 'desk', sortable: true, cell: (row) => <span className="numeric whitespace-nowrap">{row.reference}</span> },
  ]
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onFilters({ ...filters, search })
  }
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_SCHEDULE_FILTERS)
  const exportButton = (kind: ExportFormat, label: string) => (
    <Button variant="secondary" leading={<DownloadSimpleIcon aria-hidden />} busy={exporting === kind} busyLabel={t('scheduler.exporting')} disabled={total === 0 || exporting !== null} onClick={() => onExport(kind)}>{label}</Button>
  )
  return (
    <>
      <PageHeader title={t('scheduler.scheduleTitle')} description={t('scheduler.scheduleDetail')} actions={<><Button onClick={onSeries}>{t('scheduler.seriesTitle')}</Button>{exportButton('xlsx', t('scheduler.exportXlsx'))}{exportButton('pdf', t('scheduler.exportPdf'))}</>} />
      <Panel flush
        toolbar={(
          <form onSubmit={submit} className="grid w-full items-end gap-3 tablet:grid-cols-2 wide:grid-cols-[minmax(0,2fr)_repeat(6,minmax(0,1fr))_auto]">
            <div className="flex items-end gap-2">
              <TextField className="min-w-0 flex-1" label={t('scheduler.search')} value={search} maxLength={100} onChange={(event) => setSearch(event.target.value)} />
              <IconButton type="submit" label={t('scheduler.searchAction')}><MagnifyingGlassIcon aria-hidden /></IconButton>
            </div>
            <SelectField label={t('scheduler.status')} value={filters.status} onChange={(status) => onFilters({ ...filters, status: status as ScheduleFilters['status'] })}
              options={[{ value: 'all', label: t('scheduler.allStatuses') }, { value: 'confirmed', label: t('booking.status.confirmed') }, { value: 'rescheduled', label: t('booking.status.rescheduled') }]} />
            <SelectField label={t('booking.therapist')} value={filters.therapist} onChange={(therapist) => onFilters({ ...filters, therapist })}
              options={[{ value: 'all', label: t('scheduler.allTherapists') }, ...therapists.map((item) => ({ value: item.id, label: item.name }))]} />
            <SelectField label={t('scheduler.patient')} value={filters.patient} onChange={(patient) => onFilters({ ...filters, patient })}
              options={[{ value: 'all', label: t('scheduler.allPatients') }, ...patients.map((item) => ({ value: item.id, label: item.name }))]} />
            <SelectField label={t('booking.attendanceTitle')} value={filters.attendance} onChange={(attendance) => onFilters({ ...filters, attendance: attendance as ScheduleFilters['attendance'] })}
              options={[{ value: 'all', label: t('scheduler.anyAttendance') }, { value: 'attended', label: t('booking.attendance.attended') }, { value: 'no_show', label: t('booking.attendance.no_show') }, { value: 'unmarked', label: t('scheduler.unmarked') }]} />
            <TextField label={t('progress.from')} type="date" value={filters.from} onChange={(event) => onFilters({ ...filters, from: event.target.value })} />
            <TextField label={t('progress.through')} type="date" value={filters.to} onChange={(event) => onFilters({ ...filters, to: event.target.value })} />
            {filtered && <Button variant="quiet" onClick={() => { setSearch(''); onFilters(NO_SCHEDULE_FILTERS) }}>{t('scheduler.clearFilters')}</Button>}
          </form>
        )}
        footer={<Pager page={page} total={total} onPage={onPage} />}>
        {load.status === 'error' ? <div className="p-5"><Notice title={t('common.loadFailedTitle')} onRetry={load.retry}>{t('common.loadFailed')}</Notice></div> : (
          <DataTable caption={t('scheduler.scheduleTitle')} columns={columns} rows={rows} rowKey={(row) => row.id} loading={load.status === 'loading'} sort={sort as Sort}
            onSort={(next) => onSort({ key: next.key as SortKey, direction: next.direction })}
            empty={<div className="p-5"><EmptyState title={t('scheduler.noneScheduled')} detail={t(filtered ? 'scheduler.noneFiltered' : 'scheduler.noneScheduledDetail')} /></div>} />
        )}
      </Panel>
    </>
  )
}
