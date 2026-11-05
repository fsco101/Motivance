import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { ButtonLink } from '@/components/Button'
import { EmptyState, Readout, SectionHeading, Skeleton } from '@/components/Display'
import { Loadable, SkeletonCards, type Load } from '@/features/shared'
import { PatientCard, type PatientSummary } from './PatientCard'
import { SessionFan, type FanSession } from './SessionFan'

export type TherapistHome = { name: string; patients: number; plans: number; sessions: number; latest: FanSession[]; recent: PatientSummary[] }

export function TherapistHomeView({ load, base }: { load: Load<TherapistHome>; base: string }) {
  const { t } = useTranslation()
  return (
    <Loadable load={load} skeleton={<div className="flex flex-col gap-6"><Skeleton className="h-10 w-72" /><Skeleton className="h-96 rounded-stage" /><SkeletonCards count={3} /></div>}>
      {(data) => (
        <>
          <h1 className="mb-6 text-4xl font-bold">{t('home.greeting', { name: data.name })}</h1>
          {data.patients === 0 ? (
            <EmptyState title={t('home.emptyTitle')} detail={t('home.emptyDetail')} action={<ButtonLink to={`${base}/patients`}>{t('patients.invite')}</ButtonLink>} />
          ) : (
            <div className="flex flex-col gap-10">
              <div className="grid gap-8 wide:grid-cols-[minmax(0,1fr)_13rem]">
                {data.latest.length > 0 ? <SessionFan sessions={data.latest} base={base} /> : <EmptyState title={t('home.noSessionsTitle')} detail={t('home.noSessionsDetail')} />}
                <div className="flex flex-wrap gap-x-12 gap-y-6 wide:flex-col wide:justify-center">
                  <Readout value={data.patients} label={t('home.patients')} to={`${base}/patients`} />
                  <Readout value={data.plans} label={t('home.plans')} />
                  <Readout value={data.sessions} label={t('home.sessions')} detail={t('home.sessionsDetail')} to={`${base}/progress`} />
                </div>
              </div>
              <section>
                <SectionHeading title={t('home.recentPatients')} action={<Link to={`${base}/patients`} className="font-semibold text-lagoon-deep hover:underline">{t('home.seeAll')}</Link>} />
                <div className="grid gap-4 tablet:grid-cols-2 wide:grid-cols-3">
                  {data.recent.map((patient) => <PatientCard key={patient.id} patient={patient} to={`${base}/patients/${patient.id}`} />)}
                </div>
              </section>
            </div>
          )}
        </>
      )}
    </Loadable>
  )
}
