import { CalendarPlusIcon, ChatCircleDotsIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react'
import { m as motion } from 'motion/react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Button, ButtonLink } from '@/components/Button'
import { RangeBar } from '@/components/Charts'
import { DataTable, type Column } from '@/components/DataTable'
import { ConfirmDialog, Dialog } from '@/components/Dialog'
import { Avatar, EmptyState, Panel, Skeleton, StatusPill } from '@/components/Display'
import type { MissedDay, ScheduleDraft, ScheduleOnDay } from '@/data/exerciseSchedule'
import { clock } from '@/data/therapist'
import { Fact, Loadable, SkeletonLines, useFormat, type Load } from '@/features/shared'
import { spring } from '@/motion/tokens'
import { ScheduleForm, useWeekdayNames } from './ScheduleForm'
import { TrendChart, type TrendPoint } from './TrendChart'

export type PlanCard = {
  id: string; exercise: string; custom?: boolean; version: number; side: 'left' | 'right' | 'bilateral'; low: number; high: number; repetitions: number
  /** The time for each side, when the plan sets one. */
  sideSeconds?: number | null
  focus?: string | null; instructions: string; reached?: readonly [number, number] | null
  /** Only the therapist who assigned a plan can publish to it. */
  locked?: boolean
  /** Where the exercise stands today, when that is known. */
  today?: 'done' | 'todo' | 'rest' | null
}
/** A schedule with its exercises. Only the therapist who set it can change it. */
export type ScheduleGroup = ScheduleOnDay & { plans: PlanCard[]; mine: boolean }
export type PatientRecord = {
  id: string; name: string; photo?: string | null; username?: string; gender?: string; birthdate?: string; contact?: string; address?: string
  /** The center's date, which is what schedules count from. */
  today: string
  schedules: ScheduleGroup[]
  /** Exercises without a schedule, due every day. */
  everyDay: PlanCard[]
  /** Exercises still on the plan whose schedule has ended, so the patient no longer sees them. */
  ended: PlanCard[]
  /** Finished exercise days of the last 30 with something left undone, newest first (#128). */
  missed: MissedDay[]
  trend: RecordTrend | null
}

/** One series only, named, so a reader knows exactly what the line measures. */
export type RecordTrend = { exercise: string; detail: string; points: TrendPoint[] }

export type RecordActions = {
  onSaveSchedule: (draft: ScheduleDraft) => Promise<void>
  onEndSchedule: (scheduleId: string) => Promise<void>
  onRemovePlan: (planId: string) => Promise<void>
  onSendExercise?: (planId: string) => void
}

const todayTone = { done: 'positive', todo: 'primary', rest: 'neutral' } as const
const todayLabel = { done: 'schedule.todayDone', todo: 'schedule.todayToDo', rest: 'schedule.todayRest' } as const

function PlanTable({ plans, editTo, onSend, onRemove }: { plans: readonly PlanCard[]; editTo: string; onSend?: (planId: string) => void; onRemove?: (plan: PlanCard) => void }) {
  const { t } = useTranslation()
  const columns: ReadonlyArray<Column<PlanCard>> = [
    { key: 'exercise', header: t('exercises.columnName'), cell: (plan) => (
      <div className="min-w-0">
        <h3 className="flex flex-wrap items-center gap-2 font-sans text-sm font-semibold">
          {plan.exercise}{plan.custom && <StatusPill>{t('record.custom')}</StatusPill>}
          {plan.today && <StatusPill tone={todayTone[plan.today]}>{t(todayLabel[plan.today])}</StatusPill>}
        </h3>
        <p className="text-slate">{t('record.planLine', { side: t(`common.${plan.side}`), low: plan.low, high: plan.high, count: plan.repetitions })}</p>
        {plan.sideSeconds != null && <p className="text-slate">{t(plan.side === 'bilateral' ? 'record.timeEach' : 'record.time', { time: clock(plan.sideSeconds) })}</p>}
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
    { key: 'action', header: t('patients.columnActions'), align: 'end', cell: (plan) => (
      <div className="flex flex-wrap items-center justify-end gap-2">
        {plan.locked
          ? <span className="text-xs text-slate">{t('record.otherTherapist')}</span>
          : <ButtonLink to={`${editTo}?plan=${plan.id}`} variant="secondary" size="sm" leading={<PencilSimpleIcon aria-hidden />}>{t('record.edit')}</ButtonLink>}
        {onSend && <Button variant="secondary" size="sm" leading={<ChatCircleDotsIcon aria-hidden />} onClick={() => onSend(plan.id)}>{t('chat.cards.sendExercise')}</Button>}
        {onRemove && !plan.locked && <Button variant="quiet" size="sm" leading={<TrashIcon aria-hidden />} onClick={() => onRemove(plan)}>{t('schedule.remove')}</Button>}
      </div>) },
  ]
  return <DataTable caption={t('record.plans')} columns={columns} rows={plans} rowKey={(plan) => plan.id} />
}

const stateTone = { exercise: 'primary', rest: 'neutral', upcoming: 'caution', ended: 'neutral' } as const

function ScheduleCard({ schedule, today, assignTo, onEdit, onEnd, children }: {
  schedule: ScheduleGroup; today: string; assignTo: string; onEdit?: () => void; onEnd?: () => void; children: ReactNode
}) {
  const { t } = useTranslation()
  const format = useFormat()
  const weekday = useWeekdayNames('long')
  const rest = [
    ...schedule.restWeekdays.map((day) => t('schedule.everyWeekday', { day: weekday(day) })),
    ...schedule.restDates.filter((date) => date >= today).map((date) => format.day(date)),
  ]
  const state = schedule.state === 'upcoming' ? t('schedule.stateUpcoming', { date: format.day(schedule.startsOn) })
    : schedule.state === 'rest' ? t('schedule.stateRest') : t('schedule.stateExercise')
  return (
    <section aria-label={t('schedule.range', { from: format.day(schedule.startsOn), to: format.day(schedule.endsOn) })} className="border-b border-line last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 font-sans text-base font-bold">
            {t('schedule.range', { from: format.day(schedule.startsOn), to: format.day(schedule.endsOn) })}
            <StatusPill tone={stateTone[schedule.state]}>{state}</StatusPill>
          </h3>
          <p className="text-sm text-slate">
            {t('schedule.summary', { exercise: t('schedule.exerciseDays', { count: schedule.exerciseDays }), rest: t('schedule.restDays', { count: schedule.restDays }) })}
            {' · '}{t('schedule.daysLeft', { count: schedule.daysLeft })}
          </p>
          <p className="text-sm text-slate">{rest.length ? t('schedule.restLine', { days: rest.join(', ') }) : t('schedule.noRest')}</p>
          {!schedule.mine && <p className="text-xs text-slate">{t('schedule.setBy', { name: schedule.therapistName })}</p>}
        </div>
        {schedule.mine && (
          <div className="flex flex-wrap gap-2">
            <ButtonLink to={`${assignTo}?schedule=${schedule.id}`} size="sm" leading={<PlusIcon weight="bold" aria-hidden />}>{t('schedule.addExercise')}</ButtonLink>
            {onEdit && <Button variant="secondary" size="sm" leading={<PencilSimpleIcon aria-hidden />} onClick={onEdit}>{t('schedule.edit')}</Button>}
            {onEnd && <Button variant="quiet" size="sm" onClick={onEnd}>{t('schedule.end')}</Button>}
          </div>
        )}
      </div>
      {children}
    </section>
  )
}

type Asking = { kind: 'form'; schedule?: ScheduleGroup } | { kind: 'end'; schedule: ScheduleGroup } | { kind: 'remove'; plan: PlanCard } | null

export function PatientRecordView({ load, base, actions }: { load: Load<PatientRecord>; base: string; actions?: RecordActions }) {
  const { t } = useTranslation()
  const format = useFormat()
  const [asking, setAsking] = useState<Asking>(null)
  const [busy, setBusy] = useState(false)
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    try { await work(); setAsking(null) } catch { /* The page has already said what went wrong. */ } finally { setBusy(false) }
  }
  return (
    <Loadable load={load} skeleton={<div className="grid gap-8 desk:grid-cols-[20rem_minmax(0,1fr)]"><Skeleton className="h-96 rounded-card" /><SkeletonLines /></div>}>
      {(patient) => {
        const assignTo = `${base}/patients/${patient.id}/assign`
        const remove = actions ? (plan: PlanCard) => setAsking({ kind: 'remove', plan }) : undefined
        const table = (plans: readonly PlanCard[]) => <PlanTable plans={plans} editTo={assignTo} onSend={actions?.onSendExercise} onRemove={remove} />
        return (
          <div className="grid items-start gap-5 desk:grid-cols-[17rem_minmax(0,1fr)]">
            <aside className="rounded-card border border-line bg-paper p-5 shadow-rest desk:sticky desk:top-19">
              <motion.span layoutId={`patient-${patient.id}`} transition={spring.layout} className="inline-flex"><Avatar name={patient.name} photo={patient.photo} size={72} /></motion.span>
              <h1 className="mt-3 text-title font-bold">{patient.name}</h1>
              {patient.username && <p className="text-slate">@{patient.username}</p>}
              <ButtonLink to={`${base}/messages?with=${patient.id}`} variant="secondary" size="sm" className="mt-4" leading={<ChatCircleDotsIcon aria-hidden />}>{t('record.message')}</ButtonLink>
              <dl className="mt-6 grid gap-3 border-t border-line pt-5">
                {patient.gender && <Fact term={t('record.gender')}>{patient.gender}</Fact>}
                {patient.birthdate && <Fact term={t('record.birthdate')}>{format.day(patient.birthdate)}</Fact>}
                {patient.contact && <Fact term={t('record.contact')}>{patient.contact}</Fact>}
                {patient.address && <Fact term={t('record.address')}>{patient.address}</Fact>}
              </dl>
            </aside>
            <div className="flex min-w-0 flex-col gap-5">
              <Panel title={t('schedule.title')} description={t('schedule.help')} flush
                action={actions && <Button size="sm" leading={<CalendarPlusIcon aria-hidden />} onClick={() => setAsking({ kind: 'form' })}>{t('schedule.new')}</Button>}>
                {patient.schedules.length === 0
                  ? <EmptyState title={t('schedule.noneTitle')} detail={t('schedule.noneDetail')}
                      action={patient.everyDay.length === 0 ? <Link to={assignTo} className="font-semibold text-lagoon-deep hover:underline">{t('schedule.everyDayLink')}</Link> : undefined} />
                  : patient.schedules.map((schedule) => (
                    <ScheduleCard key={schedule.id} schedule={schedule} today={patient.today} assignTo={assignTo}
                      onEdit={actions ? () => setAsking({ kind: 'form', schedule }) : undefined} onEnd={actions ? () => setAsking({ kind: 'end', schedule }) : undefined}>
                      {schedule.plans.length === 0 ? <p className="px-4 pb-4 text-sm text-slate">{t('schedule.empty')}</p> : table(schedule.plans)}
                    </ScheduleCard>
                  ))}
                {patient.missed.length > 0 && (
                  <section aria-labelledby="missed-days" className="border-t border-line px-4 py-4">
                    <h3 id="missed-days" className="font-sans text-sm font-bold">{t('schedule.missedTitle')}</h3>
                    <p className="text-sm text-slate">{t('schedule.missedHelp')}</p>
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {patient.missed.map((day) => (
                        <li key={`${day.day}-${day.therapistId}`}><StatusPill tone={day.done === 0 ? 'danger' : 'caution'}>{t('schedule.missedItem', { day: format.day(day.day), done: day.done, due: day.due })}</StatusPill></li>
                      ))}
                    </ul>
                  </section>
                )}
              </Panel>
              {patient.everyDay.length > 0 && (
                <Panel title={t('schedule.everyDay')} description={t('schedule.everyDayHelp')} flush
                  action={<ButtonLink to={assignTo} variant="secondary" size="sm" leading={<PlusIcon weight="bold" aria-hidden />}>{t('record.assign')}</ButtonLink>}>
                  {table(patient.everyDay)}
                </Panel>
              )}
              {patient.ended.length > 0 && <Panel title={t('schedule.ended')} description={t('schedule.endedHelp')} flush>{table(patient.ended)}</Panel>}
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
            {actions && (
              <>
                <Dialog open={asking?.kind === 'form'} onOpenChange={(open) => { if (!open) setAsking(null) }}
                  title={t(asking?.kind === 'form' && asking.schedule ? 'schedule.formEdit' : 'schedule.formNew')} description={t('schedule.formHelp')}>
                  {asking?.kind === 'form' && (
                    <ScheduleForm patientId={patient.id} today={patient.today} existing={asking.schedule} busy={busy}
                      onCancel={() => setAsking(null)} onSave={(draft) => void run(() => actions.onSaveSchedule(draft))} />
                  )}
                </Dialog>
                <ConfirmDialog open={asking?.kind === 'end'} onOpenChange={(open) => { if (!open) setAsking(null) }} title={t('schedule.endTitle')} destructive
                  message={asking?.kind === 'end' ? t(asking.schedule.state === 'upcoming' ? 'schedule.endUpcoming' : 'schedule.endStarted', { name: patient.name }) : ''}
                  confirmLabel={t('schedule.end')} onConfirm={() => { if (asking?.kind === 'end') void run(() => actions.onEndSchedule(asking.schedule.id)) }} />
                <ConfirmDialog open={asking?.kind === 'remove'} onOpenChange={(open) => { if (!open) setAsking(null) }} title={t('schedule.removeTitle')} destructive
                  message={asking?.kind === 'remove' ? t('schedule.removeMessage', { exercise: asking.plan.exercise, name: patient.name }) : ''}
                  confirmLabel={t('schedule.removeConfirm')} onConfirm={() => { if (asking?.kind === 'remove') void run(() => actions.onRemovePlan(asking.plan.id)) }} />
              </>
            )}
          </div>
        )
      }}
    </Loadable>
  )
}
