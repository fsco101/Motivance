import { CalendarPlusIcon, CheckIcon, DeviceMobileIcon } from '@phosphor-icons/react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Button, ButtonLink } from '@/components/Button'
import { EmptyState, PageHeader, Panel, Skeleton, StatusPill } from '@/components/Display'
import type { Booking } from '@/data/booking'
import type { MyExercise, RecentSession } from '@/data/patient'
import { useCenterFormat } from '@/features/booking/format'
import { cn } from '@/lib/cn'
import { Loadable, useFormat, type Load } from '@/features/shared'
import { statusTone } from './MyBookingsView'

export type PatientHome = { name: string; next: MyExercise | null; exerciseCount: number; week: ReadonlyArray<{ day: Date; done: boolean }>; recent: readonly RecentSession[]; session: Booking | null }

/** The next exercise is the page's one bold element. Starting it leads to the phone, because that is where it runs. */
function NextExercise({ exercise, count, base, onStart }: { exercise: MyExercise | null; count: number; base: string; onStart: (exercise: MyExercise) => void }) {
  const { t } = useTranslation()
  if (!exercise) return <Panel><EmptyState title={t('patient.noExercisesTitle')} detail={t('patient.noExercisesDetail')} /></Panel>
  return (
    <section aria-labelledby="next-exercise" className="on-dark rounded-card bg-ink p-6 text-paper">
      <p className="text-sm font-semibold text-night-ink">{t('patient.todayExercise')}</p>
      <h2 id="next-exercise" className="mt-1 text-3xl font-bold">{exercise.name}</h2>
      <p className="mt-2 text-night-ink">{t('patient.exerciseLine', { side: t(`common.${exercise.side}`, exercise.side), low: exercise.low, high: exercise.high, count: exercise.repetitions })}</p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button variant="bright" leading={<DeviceMobileIcon aria-hidden />} onClick={() => onStart(exercise)}>{t('patient.startExercise')}</Button>
        {count > 1 && <Link to={`${base}/exercises`} className="font-semibold underline-offset-4 hover:underline">{t('patient.allExercises', { count })}</Link>}
      </div>
    </section>
  )
}

function NextSession({ session, base }: { session: Booking | null; base: string }) {
  const { t } = useTranslation()
  const format = useCenterFormat()
  return (
    <section aria-label={t('booking.nextSession')}>
      <Panel title={t('booking.nextSession')}>
        {session ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">{format.day(session.startsAt)}</p>
              <StatusPill tone={statusTone[session.status]}>{t(`booking.status.${session.status}`)}</StatusPill>
            </div>
            <p className="text-lg font-semibold text-lagoon-deep">{format.range(session.startsAt, session.endsAt)}</p>
            <p className="mt-1 text-sm text-slate">{session.therapist ?? t('booking.noTherapist')}</p>
            <Link to={`${base}/bookings`} className="mt-3 inline-block text-sm font-semibold text-lagoon-deep underline underline-offset-4">{t('booking.viewAll')}</Link>
          </>
        ) : (
          <>
            <p className="mb-3 text-sm text-slate">{t('booking.noneNext')}</p>
            <ButtonLink to={`${base}/book`} leading={<CalendarPlusIcon aria-hidden />}>{t('booking.title')}</ButtonLink>
          </>
        )}
      </Panel>
    </section>
  )
}

function ThisWeek({ week }: { week: PatientHome['week'] }) {
  const { t, i18n } = useTranslation()
  const letter = useMemo(() => new Intl.DateTimeFormat(i18n.language === 'fil' ? 'fil-PH' : 'en-PH', { weekday: 'short' }), [i18n.language])
  const count = week.filter(({ done }) => done).length
  return (
    <Panel title={t('patient.week')} description={t('patient.weekDetail', { count })}>
      <ul aria-label={t('patient.weekDetail', { count })} className="grid grid-cols-7 gap-1">
        {week.map(({ day, done }) => (
          <li key={day.toISOString()} className="flex flex-col items-center gap-1.5">
            <span aria-hidden className={cn('grid size-9 place-items-center rounded-full text-sm', done ? 'bg-sprout-bright text-ink' : 'bg-tide text-slate')}>{done ? <CheckIcon weight="bold" /> : day.getDate()}</span>
            <span aria-hidden className="text-xs text-slate">{letter.format(day)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function Recent({ sessions }: { sessions: readonly RecentSession[] }) {
  const { t } = useTranslation()
  const format = useFormat()
  return (
    <Panel title={t('patient.recentSessions')} flush>
      {sessions.length === 0 ? <div className="p-5"><EmptyState title={t('patient.noSessionsTitle')} detail={t('patient.noSessionsDetail')} /></div> : (
        <ul className="divide-y divide-line">
          {sessions.slice(0, 5).map((session) => (
            <li key={session.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <span className="text-sm">{format.dateTime(session.startedAt)}</span>
              <StatusPill tone={session.status === 'completed' ? 'positive' : 'neutral'}>{t(`progress.status.${session.status}`, session.status)}</StatusPill>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

export function PatientHomeView({ load, base, onStart }: { load: Load<PatientHome>; base: string; onStart: (exercise: MyExercise) => void }) {
  const { t } = useTranslation()
  return (
    <Loadable load={load} skeleton={<div className="flex flex-col gap-5"><Skeleton className="h-16 w-64" /><Skeleton className="h-44 rounded-card" /><Skeleton className="h-36 rounded-card" /></div>}>
      {(home) => (
        <>
          <PageHeader title={home.name ? t('patient.greeting', { name: home.name.split(' ')[0] }) : t('patient.greetingPlain')} description={t('patient.scope')} />
          <div className="grid items-start gap-5 desk:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-5">
              <NextExercise exercise={home.next} count={home.exerciseCount} base={base} onStart={onStart} />
              <ThisWeek week={home.week} />
            </div>
            <div className="flex min-w-0 flex-col gap-5">
              <NextSession session={home.session} base={base} />
              <Recent sessions={home.recent} />
            </div>
          </div>
        </>
      )}
    </Loadable>
  )
}
