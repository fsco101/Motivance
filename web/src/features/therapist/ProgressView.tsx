import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { DataTable, LoadMore, type Column } from '@/components/DataTable'
import { EmptyState, Notice, PageHeader, Panel, StatusPill } from '@/components/Display'
import { SelectField, TextField } from '@/components/Field'
import { rehabilitationProgress, resultStatus, rom, roundDegrees, usable, type HistoricalSession, type ResultStatus } from '@/data/history'
import { Loadable, SkeletonLines, useFormat, type Load } from '@/features/shared'
import { cn } from '@/lib/cn'
import { romPoints } from './summaries'
import { TrendChart } from './TrendChart'

/** Applied by the query, not to loaded rows, so older matching sessions are never hidden behind a page boundary. */
export type ProgressFilters = { exerciseVersionId: string; side: string; from: string; through: string }
export const NO_FILTERS: ProgressFilters = { exerciseVersionId: 'all', side: 'all', from: '', through: '' }

export type ProgressChoices = { patients: Array<{ id: string; name: string }>; patientId: string; exercises: Array<{ id: string; name: string }> }
export type ProgressResults = { sessions: HistoricalSession[]; more: boolean; loadingMore?: boolean }

const statusTone: Record<ResultStatus, 'positive' | 'neutral' | 'caution' | 'danger'> = { completed: 'positive', partial: 'caution', interrupted: 'neutral', empty: 'neutral', invalid: 'danger' }

type Props = {
  /** A patient reading their own progress, so there is no patient to choose. */
  self?: boolean
  /** Separate from the results, so the filters stay on screen and keep focus while a new query runs. */
  choices: Load<ProgressChoices>
  results: Load<ProgressResults>
  filters: ProgressFilters
  onFilters: (filters: ProgressFilters) => void
  /** The owner clears the filters here: one patient's exercise means nothing for the next. */
  onPatient: (id: string) => void
  onMore: () => void
}

/** A table cannot fit a phone without hiding the results, so there each session stacks. Only patients use this page on a phone. */
function SessionList({ sessions }: { sessions: readonly HistoricalSession[] }) {
  const { t } = useTranslation()
  const format = useFormat()
  return (
    <ul aria-label={t('progress.sessions')} className="divide-y divide-line tablet:hidden">
      {sessions.map((session) => {
        const status = resultStatus(session)
        return (
          <li key={session.id} className="px-5 py-3">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 font-semibold">{session.prescription?.exerciseName ?? t('progress.unknown')}</p>
              <StatusPill tone={statusTone[status]}>{t(`progress.status.${status}`)}</StatusPill>
            </div>
            <p className="text-sm text-slate">{format.dateTime(session.startedAt)}</p>
            {session.measurements.length === 0 ? <p className="mt-1 text-sm">{t('progress.notMeasured')}</p> : session.measurements.map((measurement) => (
              <p key={`${measurement.key}-${measurement.side}`} className="mt-1 text-sm">
                {t('progress.rom')}: <span className="numeric font-semibold">{usable(measurement) ? `${roundDegrees(rom(measurement)!)}°` : t('progress.notMeasured')}</span>
                {', '}{t('record.repetitions')}: <span className="numeric font-semibold">{measurement.repetitions} / {session.prescription?.targetRepetitions ?? 0}</span>
              </p>
            ))}
          </li>
        )
      })}
    </ul>
  )
}

export function ProgressView({ self, choices, results, filters, onFilters, onPatient, onMore }: Props) {
  const { t } = useTranslation()
  const format = useFormat()
  const sessions = results.status === 'ready' ? results.data.sessions : null
  const series = useMemo(() => rehabilitationProgress(sessions ?? []), [sessions])
  const filtered = filters.exerciseVersionId !== 'all' || filters.side !== 'all' || Boolean(filters.from) || Boolean(filters.through)

  const columns: ReadonlyArray<Column<HistoricalSession>> = [
    { key: 'date', header: t('progress.date'), cell: (s) => <span className="whitespace-nowrap">{format.dateTime(s.startedAt)}</span> },
    { key: 'exercise', header: t('assign.exercise'), cell: (s) => <span className="font-semibold">{s.prescription?.exerciseName ?? t('progress.unknown')}</span> },
    // The side measured: each side of a both-sides plan is its own session.
    { key: 'side', header: t('record.side'), hideBelow: 'desk', cell: (s) => {
      const side = s.measurements[0]?.side ?? s.prescription?.side
      return side ? t(`common.${side}`, side) : ''
    } },
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
      <PageHeader title={t('nav.progress')} description={t(self ? 'progress.selfDescription' : 'progress.description')} />
      <Loadable load={choices} skeleton={<SkeletonLines />}>
        {(data) => (
          <>
            <div className={cn('mb-5 grid gap-3 rounded-card border border-line bg-paper p-4 shadow-rest tablet:grid-cols-2', self ? 'desk:grid-cols-4' : 'desk:grid-cols-5')}>
              {!self && <SelectField label={t('progress.patient')} value={data.patientId} onChange={onPatient} options={data.patients.map((p) => ({ value: p.id, label: p.name }))} />}
              <SelectField label={t('assign.exercise')} value={filters.exerciseVersionId} onChange={(exerciseVersionId) => onFilters({ ...filters, exerciseVersionId })}
                options={[{ value: 'all', label: t('progress.allExercises') }, ...data.exercises.map((item) => ({ value: item.id, label: item.name }))]} />
              <SelectField label={t('record.side')} value={filters.side} onChange={(side) => onFilters({ ...filters, side })} options={[{ value: 'all', label: t('progress.bothSides') }, { value: 'left', label: t('common.left') }, { value: 'right', label: t('common.right') }]} />
              <TextField label={t('progress.from')} type="date" value={filters.from} onChange={(event) => onFilters({ ...filters, from: event.target.value })} />
              <TextField label={t('progress.through')} type="date" value={filters.through} onChange={(event) => onFilters({ ...filters, through: event.target.value })} />
            </div>
            <Loadable load={results} skeleton={<SkeletonLines />}>
              {(found) => (found.sessions.length === 0 ? (filtered ? <Notice tone="info">{t('progress.noMatch')}</Notice> : <EmptyState title={t('progress.emptyTitle')} detail={t('progress.emptyDetail')} />) : (
              <div className="flex flex-col gap-5">
                {series.map((item) => (
                  <Panel key={item.key} title={item.prescription.exerciseName} description={t('progress.seriesLine', { side: t(`common.${item.side}`, item.side), version: item.prescription.version, low: item.prescription.low, high: item.prescription.high })}>
                    <div className="grid gap-8 desk:grid-cols-2">
                      <TrendChart title={t('progress.rom')} unit="°" points={romPoints(item, format.short)} />
                      <TrendChart title={t('record.repetitions')} unit="" max={Math.max(item.prescription.targetRepetitions * 2, 2)} points={item.points.map((p) => ({ id: p.session.id, label: format.short(p.session.startedAt), value: p.repetitions }))} />
                    </div>
                  </Panel>
                ))}
                <Panel title={t('progress.sessions')} flush footer={<LoadMore shown={t('progress.shown', { count: found.sessions.length })} onLoad={found.more ? onMore : undefined} busy={found.loadingMore} label={t('progress.loadOlder')} />}>
                  {self && <SessionList sessions={found.sessions} />}
                  <div className={cn(self && 'hidden tablet:block')}><DataTable caption={t('progress.sessions')} columns={columns} rows={found.sessions} rowKey={(s) => s.id} /></div>
                </Panel>
                <p className="max-w-[62ch] text-sm text-slate">{t('progress.notValidated')}</p>
              </div>
              ))}
            </Loadable>
          </>
        )}
      </Loadable>
    </>
  )
}
