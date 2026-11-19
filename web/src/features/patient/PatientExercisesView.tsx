import { CameraIcon, PlayIcon } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Button } from '@/components/Button'
import { RangeBar } from '@/components/Charts'
import { EmptyState, PageHeader, Panel, StatusPill } from '@/components/Display'
import type { TodayPlan } from '@/data/exerciseSchedule'
import type { MyExercise } from '@/data/patient'
import { clock } from '@/data/therapist'
import { Loadable, SkeletonCards, useFormat, type Load } from '@/features/shared'

function ExerciseCard({ exercise, onStart }: { exercise: MyExercise; onStart: () => void }) {
  const { t } = useTranslation()
  const side = t(`common.${exercise.side}`, exercise.side)
  return (
    <Panel title={exercise.name} description={side}>
      <RangeBar low={exercise.low} high={exercise.high} />
      <div className="mt-3 flex flex-wrap gap-2">
        <StatusPill tone="positive">{t('patient.rangeValue', { low: exercise.low, high: exercise.high })}</StatusPill>
        <StatusPill tone="positive">{t('patient.repsValue', { count: exercise.repetitions })}</StatusPill>
        {exercise.sideSeconds !== null && <StatusPill tone="positive">{t(exercise.side === 'bilateral' ? 'record.timeEach' : 'record.time', { time: clock(exercise.sideSeconds) })}</StatusPill>}
      </div>
      {exercise.instructions && <p className="mt-4 max-w-[62ch]">{exercise.instructions}</p>}
      {exercise.focus && <p className="mt-2 text-sm text-slate">{t('patient.focus', { side, joint: t(`joints.${exercise.focus}`, exercise.focus) })}</p>}
      <Button className="mt-4" leading={<PlayIcon aria-hidden />} onClick={onStart}>{t('patient.startExercise')}</Button>
    </Panel>
  )
}

/** What to say on a day with nothing left to do: done, resting, not started yet, or over. */
export function TodayNotice({ plan }: { plan: TodayPlan<unknown> }) {
  const { t } = useTranslation()
  const format = useFormat()
  const next = plan.nextDay ? format.day(plan.nextDay) : null
  if (plan.state === 'done') return <EmptyState title={t('patient.allDoneTitle')} detail={next ? t('patient.allDoneNext', { date: next }) : t('patient.allDoneLast')} />
  if (plan.state === 'rest') return <EmptyState title={t('patient.restTitle')} detail={next ? t('patient.restNext', { date: next }) : t('patient.finishedDetail')} />
  if (plan.state === 'upcoming' && plan.startsOn) return <EmptyState title={t('patient.upcomingTitle')} detail={t('patient.upcomingDetail', { date: format.day(plan.startsOn) })} />
  return <EmptyState title={t('patient.finishedTitle')} detail={t('patient.finishedDetail')} />
}

/** Only today's exercises. One finished today is gone until its next exercise day, and a missed day is never carried over. */
export function PatientExercisesView({ load, base, onStart, onCamera }: { load: Load<TodayPlan<MyExercise>>; base: string; onStart: (exercise: MyExercise) => void; onCamera: () => void }) {
  const { t } = useTranslation()
  return (
    <>
      <PageHeader title={t('patient.exercisesTitle')} description={t('patient.exercisesDetail')}
        actions={<Button variant="secondary" leading={<CameraIcon aria-hidden />} onClick={onCamera}>{t('patient.cameraCheck')}</Button>} />
      <Loadable load={load} skeleton={<SkeletonCards count={2} />}>
        {(plan) => plan.state === 'none'
          ? <Panel><EmptyState title={t('patient.noExercisesTitle')} detail={t('patient.noExercisesDetail')} action={<Link to={`${base}/profile`} className="font-semibold text-lagoon-deep underline underline-offset-4">{t('patient.connectLink')}</Link>} /></Panel>
          : plan.state !== 'exercise' ? <Panel><TodayNotice plan={plan} /></Panel> : (
            <>
              {plan.due > 1 && <p role="status" className="mb-4 font-semibold text-lagoon-deep">{t('patient.todayDone', { done: plan.done, total: plan.due })}</p>}
              <div className="grid items-start gap-5 desk:grid-cols-2">{plan.todo.map((exercise) => <ExerciseCard key={exercise.versionId} exercise={exercise} onStart={() => onStart(exercise)} />)}</div>
            </>
          )}
      </Loadable>
    </>
  )
}
