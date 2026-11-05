import { CalendarCheckIcon, ClipboardTextIcon, UserPlusIcon, UsersThreeIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { ButtonLink } from '@/components/Button'
import { EmptyState, PageHeader, Panel, Skeleton } from '@/components/Display'
import { StatCard } from '@/components/StatCard'
import { Loadable, SkeletonLines, type Load } from '@/features/shared'
import { PatientTable, type PatientSummary } from './PatientTable'
import { SessionFan, type FanSession } from './SessionFan'

export type TherapistHome = { name: string; patients: number; plans: number; sessions: number; withoutPlan: number; latest: FanSession[]; recent: PatientSummary[] }

export function TherapistHomeView({ load, base }: { load: Load<TherapistHome>; base: string }) {
  const { t } = useTranslation()
  return (
    <Loadable load={load} skeleton={<div className="flex flex-col gap-5"><Skeleton className="h-10 w-72" /><div className="grid gap-4 tablet:grid-cols-4">{[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-28 rounded-card" />)}</div><SkeletonLines rows={6} /></div>}>
      {(data) => (
        <>
          <PageHeader title={t('home.greeting', { name: data.name })} description={t('home.subtitle')}
            actions={<ButtonLink to={`${base}/patients`} leading={<UserPlusIcon aria-hidden />}>{t('patients.invite')}</ButtonLink>} />
          {data.patients === 0 ? (
            <Panel><EmptyState title={t('home.emptyTitle')} detail={t('home.emptyDetail')} /></Panel>
          ) : (
            <div className="flex flex-col gap-5">
              <div className="grid gap-4 tablet:grid-cols-2 desk:grid-cols-4">
                <StatCard icon={UsersThreeIcon} value={data.patients} label={t('home.patients')} to={`${base}/patients`} />
                <StatCard icon={ClipboardTextIcon} value={data.plans} label={t('home.plans')} to={`${base}/patients`} />
                <StatCard icon={CalendarCheckIcon} value={data.sessions} label={t('home.sessions')} detail={t('home.sessionsDetail')} to={`${base}/progress`} />
                <StatCard icon={WarningCircleIcon} value={data.withoutPlan} label={t('home.withoutPlan')} tone={data.withoutPlan > 0 ? 'caution' : undefined} to={`${base}/patients`} />
              </div>
              {data.latest.length > 0 ? <SessionFan sessions={data.latest} base={base} /> : <Panel><EmptyState title={t('home.noSessionsTitle')} detail={t('home.noSessionsDetail')} /></Panel>}
              <Panel title={t('home.recentPatients')} flush action={<Link to={`${base}/patients`} className="text-sm font-semibold text-lagoon-deep hover:underline">{t('home.seeAll')}</Link>}>
                <PatientTable patients={data.recent} base={base} />
              </Panel>
            </div>
          )}
        </>
      )}
    </Loadable>
  )
}
