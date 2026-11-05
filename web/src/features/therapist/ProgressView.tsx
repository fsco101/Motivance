import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { DataTable, LoadMore, type Column } from '@/components/DataTable'
import { EmptyState, Notice, PageHeader, SectionHeading, StatusPill } from '@/components/Display'
import { SelectField, TextField } from '@/components/Field'
import { rehabilitationProgress, resultStatus, rom, roundDegrees, usable, type HistoricalSession, type ResultStatus } from '@/data/history'
import { Loadable, SkeletonLines, useFormat, type Load } from '@/features/shared'
import { TrendChart } from './TrendChart'

/** Applied by the query, not to loaded rows, so older matching sessions are never hidden behind a page boundary. */
export type ProgressFilters = { exerciseVersionId: string; side: string; from: string; through: string }
export const NO_FILTERS: ProgressFilters = { exerciseVersionId: 'all', side: 'all', from: '', through: '' }

export type ProgressData = {
  patients: Array<{ id: string; name: string }>; patientId: string; exercises: Array<{ id: string; name: string }>
  sessions: HistoricalSession[]; more: boolean
}

const statusTone: Record<ResultStatus, 'positive' | 'neutral' | 'caution' | 'danger'> = { completed: 'positive', partial: 'caution', interrupted: 'neutral', empty: 'neutral', invalid: 'danger' }

type Props = {
  load: Load<ProgressData>
  filters: ProgressFilters
  onFilters: (filters: ProgressFilters) => void
  /** The owner clears the filters here: one patient's exercise means nothing for the next. */
  onPatient: (id: string) => void
  onMore: () => void
}

export function ProgressView({ load, filters, onFilters, onPatient, onMore }: Props) {
  const { t } = useTranslation()
  const format = useFormat()
  const sessions = load.status === 'ready' ? load.data.sessions : null
  const series = useMemo(() => rehabilitationProgress(sessions ?? []), [sessions])
  const filtered = filters.exerciseVersionId !== 'all' || filters.side !== 'all' || Boolean(filters.from) || Boolean(filters.through)

  const columns: ReadonlyArray<Column<HistoricalSession>> = [
    { key: 'date', header: t('progress.date'), cell: (s) => <span className="whitespace-nowrap">{format.dateTime(s.startedAt)}</span> },
    { key: 'exercise', header: t('assign.exercise'), cell: (s) => <span className="font-semibold">{s.prescription?.exerciseName ?? t('progress.unknown')}</span> },
    { key: 'side', header: t('record.side'), hideBelow: 'desk', cell: (s) => (s.prescription ? t(`common.${s.prescription.side}`, s.prescription.side) : '') },
    { key: 'range', header: t('progress.targets'), hideBelow: 'wide', align: 'end', cell: (s) => (s.prescription ? <span className="numeric">{s.prescription.low}° to {s.prescription.high}°</span> : '') },
    { key: 'rom', header: t('progress.rom'), align: 'end', cell: (s) => (
      s.measurements.length === 0 ? <span className="numeric">{t('progress.notMeasured')}</span>
        : s.measurements.map((m) => <span key={`${m.key}-${m.side}`} className="numeric block">{usable(m) ? `${roundDegrees(rom(m)!)}°` : t('progress.notMeasured')}</span>)
    ) },
    { key: 'reps', header: t('record.repetitions'), align: 'end', cell: (s) => (
      s.measurements.length === 0 ? <span className="numeric">0 / {s.prescription?.targetRepetitions ?? 0}</span>
        : s.measurements.map((m) => <span key={`${m.key}-${m.side}`} className="numeric block">{m.repetitions} / {s.prescription?.targetRepetitions ?? 0}</span>)
    ) },
    { key: 'status', header: t('progress.result'), align: 'end', cell: (s) => { const status = resultStatus(s); return <StatusPill tone={statusTone[status]}>{t(`progress.status.${status}`)}</StatusPill> } },
  ]
  return (
    <>
      <PageHeader title={t('nav.progress')} description={t('progress.description')} />
      <Loadable load={load} skeleton={<SkeletonLines />}>
        {(data) => (
          <>
            <div className="mb-8 grid gap-4 tablet:grid-cols-2 wide:grid-cols-5">
              <SelectField label={t('progress.patient')} value={data.patientId} onChange={onPatient} options={data.patients.map((p) => ({ value: p.id, label: p.name }))} />
              <SelectField label={t('assign.exercise')} value={filters.exerciseVersionId} onChange={(exerciseVersionId) => onFilters({ ...filters, exerciseVersionId })}
                options={[{ value: 'all', label: t('progress.allExercises') }, ...data.exercises.map((item) => ({ value: item.id, label: item.name }))]} />
              <SelectField label={t('record.side')} value={filters.side} onChange={(side) => onFilters({ ...filters, side })} options={[{ value: 'all', label: t('progress.bothSides') }, { value: 'left', label: t('common.left') }, { value: 'right', label: t('common.right') }]} />
              <TextField label={t('progress.from')} type="date" value={filters.from} onChange={(event) => onFilters({ ...filters, from: event.target.value })} />
              <TextField label={t('progress.through')} type="date" value={filters.through} onChange={(event) => onFilters({ ...filters, through: event.target.value })} />
            </div>
            {data.sessions.length === 0 ? (filtered ? <Notice tone="info">{t('progress.noMatch')}</Notice> : <EmptyState title={t('progress.emptyTitle')} detail={t('progress.emptyDetail')} />) : (
              <div className="flex flex-col gap-12">
                {series.map((item) => (
                  <section key={item.key}>
                    <SectionHeading title={item.prescription.exerciseName} />
                    <p className="-mt-2 mb-4 text-slate">{t('progress.seriesLine', { side: t(`common.${item.side}`, item.side), version: item.prescription.version, low: item.prescription.low, high: item.prescription.high })}</p>
                    <div className="grid gap-8 desk:grid-cols-2">
                      <TrendChart title={t('progress.rom')} unit="°" points={item.points.map((p) => ({ id: p.session.id, label: format.short(p.session.startedAt), value: p.rom === null ? null : roundDegrees(p.rom) }))} />
                      <TrendChart title={t('record.repetitions')} unit="" max={Math.max(item.prescription.targetRepetitions * 2, 2)} points={item.points.map((p) => ({ id: p.session.id, label: format.short(p.session.startedAt), value: p.repetitions }))} />
                    </div>
                  </section>
                ))}
                <section>
                  <SectionHeading title={t('progress.sessions')} />
                  <DataTable caption={t('progress.sessions')} columns={columns} rows={data.sessions} rowKey={(s) => s.id} />
                  <LoadMore shown={t('progress.shown', { count: data.sessions.length })} onLoad={data.more ? onMore : undefined} label={t('progress.loadOlder')} />
                </section>
                <p className="max-w-[62ch] text-sm text-slate">{t('progress.notValidated')}</p>
              </div>
            )}
          </>
        )}
      </Loadable>
    </>
  )
}
