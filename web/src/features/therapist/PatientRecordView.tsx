import { PencilSimpleIcon, PlusIcon } from '@phosphor-icons/react'
import { m as motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { ButtonLink } from '@/components/Button'
import { Avatar, EmptyState, SectionHeading, Skeleton, StatusPill } from '@/components/Display'
import { Fact, Loadable, SkeletonLines, useFormat, type Load } from '@/features/shared'
import { ExpandableCard } from '@/motion/InteractiveCard'
import { RangeDial } from '@/motion/RangeDial'
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

function Plan({ plan, editTo }: { plan: PlanCard; editTo: string }) {
  const { t } = useTranslation()
  const side = t(`common.${plan.side}`)
  return (
    <ExpandableCard summary={
      <div className="flex items-center gap-5">
        <RangeDial low={plan.low} high={plan.high} reached={plan.reached} width={92} label={t('patients.dialTarget', { targetLow: plan.low, targetHigh: plan.high })} />
        <div className="min-w-0">
          <h3 className="truncate text-lg font-bold">{plan.exercise}</h3>
          <p className="text-sm text-slate">{t('record.planLine', { side, low: plan.low, high: plan.high, count: plan.repetitions })}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <StatusPill tone="primary">{t('record.version', { version: plan.version })}</StatusPill>
            {plan.custom && <StatusPill>{t('record.custom')}</StatusPill>}
          </div>
        </div>
      </div>
    }>
      <p className="max-w-[62ch]">{plan.instructions}</p>
      <dl className="mt-4 grid grid-cols-2 gap-4 tablet:grid-cols-3">
        <Fact term={t('record.side')}>{side}</Fact>
        <Fact term={t('record.focus')}>{plan.focus ?? t('record.focusAutomatic')}</Fact>
        <Fact term={t('record.repetitions')}>{plan.repetitions}</Fact>
      </dl>
      {plan.locked
        ? <p className="mt-4 text-sm text-slate">{t('record.otherTherapist')}</p>
        : <ButtonLink to={`${editTo}?plan=${plan.id}`} variant="secondary" size="sm" className="mt-4" leading={<PencilSimpleIcon aria-hidden />}>{t('record.edit')}</ButtonLink>}
    </ExpandableCard>
  )
}

export function PatientRecordView({ load, base }: { load: Load<PatientRecord>; base: string }) {
  const { t } = useTranslation()
  const format = useFormat()
  return (
    <Loadable load={load} skeleton={<div className="grid gap-8 desk:grid-cols-[20rem_minmax(0,1fr)]"><Skeleton className="h-96 rounded-card" /><SkeletonLines /></div>}>
      {(patient) => (
        <div className="grid items-start gap-10 desk:grid-cols-[19rem_minmax(0,1fr)]">
          <aside className="desk:sticky desk:top-6">
            <motion.span layoutId={`patient-${patient.id}`} transition={spring.layout} className="inline-flex"><Avatar name={patient.name} photo={patient.photo} size={88} /></motion.span>
            <h1 className="mt-4 text-3xl font-bold">{patient.name}</h1>
            {patient.username && <p className="text-slate">@{patient.username}</p>}
            <dl className="mt-6 grid gap-3 border-t border-line pt-5">
              {patient.gender && <Fact term={t('record.gender')}>{patient.gender}</Fact>}
              {patient.birthdate && <Fact term={t('record.birthdate')}>{format.day(patient.birthdate)}</Fact>}
              {patient.contact && <Fact term={t('record.contact')}>{patient.contact}</Fact>}
              {patient.address && <Fact term={t('record.address')}>{patient.address}</Fact>}
            </dl>
          </aside>
          <div className="flex min-w-0 flex-col gap-10">
            <section>
              <SectionHeading title={t('record.plans')} action={<ButtonLink to={`${base}/patients/${patient.id}/assign`} size="sm" leading={<PlusIcon weight="bold" aria-hidden />}>{t('record.assign')}</ButtonLink>} />
              {patient.plans.length === 0
                ? <EmptyState title={t('record.noPlansTitle')} detail={t('record.noPlansDetail')} />
                : <div className="flex flex-col gap-3">{patient.plans.map((plan) => <Plan key={plan.id} plan={plan} editTo={`${base}/patients/${patient.id}/assign`} />)}</div>}
            </section>
            <section>
              <SectionHeading title={t('record.progress')} action={<Link to={`${base}/progress?patient=${patient.id}`} className="font-semibold text-lagoon-deep hover:underline">{t('record.allProgress')}</Link>} />
              {patient.trend === null ? <p className="text-slate">{t('patients.noSessions')}</p> : (
                <>
                  <h3 className="font-bold">{patient.trend.exercise}</h3>
                  <p className="mb-3 text-sm text-slate">{patient.trend.detail}</p>
                  <TrendChart title={t('progress.rom')} points={patient.trend.points} unit="°" />
                </>
              )}
              <p className="mt-3 max-w-[62ch] text-sm text-slate">{t('progress.notValidated')}</p>
            </section>
          </div>
        </div>
      )}
    </Loadable>
  )
}
