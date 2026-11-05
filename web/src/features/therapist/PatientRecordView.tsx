import { PencilSimpleIcon, PlusIcon } from '@phosphor-icons/react'
import { m as motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { ButtonLink } from '@/components/Button'
import { RangeBar } from '@/components/Charts'
import { DataTable, type Column } from '@/components/DataTable'
import { Avatar, EmptyState, Panel, Skeleton, StatusPill } from '@/components/Display'
import { Fact, Loadable, SkeletonLines, useFormat, type Load } from '@/features/shared'
import { spring } from '@/motion/tokens'
import { TrendChart, type TrendPoint } from './TrendChart'

export type PlanCard = {
  id: string; exercise: string; custom?: boolean; version: number; side: 'left' | 'right'; low: number; high: number; repetitions: number
  focus?: string | null; instructions: string; reached?: readonly [number, number] | null
  /** Only the therapist who assigned a plan can publish to it. */
  locked?: boolean
}
export type PatientRecord = {
  id: string; name: string; photo?: string | null; username?: string; gender?: string; birthdate?: string; contact?: string; address?: string
  plans: PlanCard[]; trend: RecordTrend | null
}

/** One series only, named, so a reader knows exactly what the line measures. */
export type RecordTrend = { exercise: string; detail: string; points: TrendPoint[] }

function PlanTable({ plans, editTo }: { plans: readonly PlanCard[]; editTo: string }) {
  const { t } = useTranslation()
  const columns: ReadonlyArray<Column<PlanCard>> = [
    { key: 'exercise', header: t('exercises.columnName'), cell: (plan) => (
      <div className="min-w-0">
        <h3 className="flex flex-wrap items-center gap-2 font-sans text-sm font-semibold">{plan.exercise}{plan.custom && <StatusPill>{t('record.custom')}</StatusPill>}</h3>
        <p className="text-slate">{t('record.planLine', { side: t(`common.${plan.side}`), low: plan.low, high: plan.high, count: plan.repetitions })}</p>
      </div>
    ) },
    { key: 'range', header: t('patients.columnRange'), hideBelow: 'wide', cell: (plan) => (
      <div className="w-40">
        <p className="mb-1 text-slate">{plan.reached ? t('patients.reached', { low: plan.reached[0], high: plan.reached[1] }) : t('patients.noSessions')}</p>
        <RangeBar low={plan.low} high={plan.high} reached={plan.reached} />
      </div>
    ) },
    { key: 'focus', header: t('record.focus'), hideBelow: 'desk', cell: (plan) => plan.focus ?? t('record.focusAutomatic') },
    { key: 'version', header: t('admin.versionColumn'), cell: (plan) => <StatusPill tone="primary">{t('record.version', { version: plan.version })}</StatusPill> },
    { key: 'action', header: t('patients.columnActions'), align: 'end', cell: (plan) => (plan.locked
      ? <span className="text-xs text-slate">{t('record.otherTherapist')}</span>
      : <ButtonLink to={`${editTo}?plan=${plan.id}`} variant="secondary" size="sm" leading={<PencilSimpleIcon aria-hidden />}>{t('record.edit')}</ButtonLink>) },
  ]
  return <DataTable caption={t('record.plans')} columns={columns} rows={plans} rowKey={(plan) => plan.id} />
}

export function PatientRecordView({ load, base }: { load: Load<PatientRecord>; base: string }) {
  const { t } = useTranslation()
  const format = useFormat()
  return (
    <Loadable load={load} skeleton={<div className="grid gap-8 desk:grid-cols-[20rem_minmax(0,1fr)]"><Skeleton className="h-96 rounded-card" /><SkeletonLines /></div>}>
      {(patient) => (
        <div className="grid items-start gap-5 desk:grid-cols-[17rem_minmax(0,1fr)]">
          <aside className="rounded-card border border-line bg-paper p-5 shadow-rest desk:sticky desk:top-19">
            <motion.span layoutId={`patient-${patient.id}`} transition={spring.layout} className="inline-flex"><Avatar name={patient.name} photo={patient.photo} size={72} /></motion.span>
            <h1 className="mt-3 text-title font-bold">{patient.name}</h1>
            {patient.username && <p className="text-slate">@{patient.username}</p>}
            <dl className="mt-6 grid gap-3 border-t border-line pt-5">
              {patient.gender && <Fact term={t('record.gender')}>{patient.gender}</Fact>}
              {patient.birthdate && <Fact term={t('record.birthdate')}>{format.day(patient.birthdate)}</Fact>}
              {patient.contact && <Fact term={t('record.contact')}>{patient.contact}</Fact>}
              {patient.address && <Fact term={t('record.address')}>{patient.address}</Fact>}
            </dl>
          </aside>
          <div className="flex min-w-0 flex-col gap-5">
            <Panel title={t('record.plans')} flush action={<ButtonLink to={`${base}/patients/${patient.id}/assign`} size="sm" leading={<PlusIcon weight="bold" aria-hidden />}>{t('record.assign')}</ButtonLink>}>
              {patient.plans.length === 0
                ? <EmptyState title={t('record.noPlansTitle')} detail={t('record.noPlansDetail')} />
                : <PlanTable plans={patient.plans} editTo={`${base}/patients/${patient.id}/assign`} />}
            </Panel>
            <Panel title={t('record.progress')} action={<Link to={`${base}/progress?patient=${patient.id}`} className="font-semibold text-lagoon-deep hover:underline">{t('record.allProgress')}</Link>}>
              {patient.trend === null ? <p className="text-slate">{t('patients.noSessions')}</p> : (
                <>
                  <h3 className="text-sm font-bold">{patient.trend.exercise}</h3>
                  <p className="mb-3 text-sm text-slate">{patient.trend.detail}</p>
                  <TrendChart title={t('progress.rom')} points={patient.trend.points} unit="°" />
                </>
              )}
              <p className="mt-3 max-w-[62ch] text-sm text-slate">{t('progress.notValidated')}</p>
            </Panel>
          </div>
        </div>
      )}
    </Loadable>
  )
}
