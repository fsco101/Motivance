import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Notice, PageHeader, Panel, Skeleton, StatusPill } from '@/components/Display'
import { sessionsOn, type Schedule, type ScheduleAudience, type ScheduleDay, type ScheduleSession } from '@/data/schedule'
import { Fact, Loadable, type Load } from '@/features/shared'
import { cn } from '@/lib/cn'
import { statusTone, useCenterFormat } from './format'
import { MonthCalendar, type CalendarDay } from './MonthCalendar'

type Props = {
  audience: ScheduleAudience; load: Load<Schedule>; month: string; onMonth: (month: string) => void; canGoBack: boolean; canGoForward: boolean; today: string
  date: string | null; onDate: (date: string) => void; actions?: ReactNode
  /** Where a linked patient's record opens. A booking alone opens nothing, so an unlinked patient has no link here. */
  recordPath?: (patientId: string) => string
}

function SessionDetails({ session, audience, recordPath }: { session: ScheduleSession; audience: ScheduleAudience; recordPath?: Props['recordPath'] }) {
  const { t } = useTranslation()
  const record = session.linked && session.patientId && recordPath ? recordPath(session.patientId) : null
  return (
    <div className="min-w-0 flex-1 basis-56 rounded-control bg-tide p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 font-semibold">
          {audience === 'patient' ? t('booking.scheduleSession') : record ? <Link to={record} className="underline underline-offset-4">{session.patient}</Link> : session.patient}
        </p>
        <StatusPill tone={statusTone[session.status]}>{t(`booking.status.${session.status}`)}</StatusPill>
      </div>
      <dl className="mt-2 grid gap-2 tablet:grid-cols-2">
        {audience === 'patient' && <Fact term={t('booking.therapist')}>{session.therapist ?? t('booking.noTherapist')}</Fact>}
        {audience === 'patient' && session.location && <Fact term={t('booking.location')}>{session.location}</Fact>}
        <Fact term={t('booking.reference')}><span className="numeric">{session.reference}</span></Fact>
      </dl>
      {audience === 'therapist' && !record && <p className="mt-2 text-sm text-slate">{t('booking.scheduleNotLinked')}</p>}
    </div>
  )
}

/** The chosen date by time, across the center's hours, so a session reads in its place in the day. */
function Agenda({ day, audience, recordPath }: { day: ScheduleDay | undefined; audience: ScheduleAudience; recordPath?: Props['recordPath'] }) {
  const { t } = useTranslation()
  const format = useCenterFormat()
  if (!day) return <p className="text-sm text-slate">{t('booking.scheduleChoose')}</p>
  const closed = day.status !== 'open'
  return (
    <>
      {closed && <Notice tone="info">{day.status === 'holiday' ? t('booking.day.holiday', { name: day.holiday }) : t(`booking.day.${day.status}`)}</Notice>}
      {day.rows.length > 0 && (
        <ol className={cn('divide-y divide-line', closed && 'mt-3')}>
          {day.rows.map((row) => (
            <li key={row.startsAt} className="flex flex-wrap items-start gap-x-4 gap-y-1 py-2.5">
              <span className={cn('w-40 shrink-0 text-sm', row.session ? 'font-semibold' : 'text-slate')}>{format.range(row.startsAt, row.endsAt)}</span>
              {row.session ? <SessionDetails session={row.session} audience={audience} recordPath={recordPath} /> : <span className={cn('text-sm', row.onLeave ? 'font-semibold' : 'text-slate')}>{t(row.onLeave ? 'scheduler.onLeave' : 'booking.scheduleFree')}</span>}
            </li>
          ))}
        </ol>
      )}
    </>
  )
}

/** What a Scheduler has confirmed: a month to find a date, and that date laid out by time. Requests still waiting stay on My bookings. */
export function ScheduleView({ audience, load, month, onMonth, canGoBack, canGoForward, today, date, onDate, actions, recordPath }: Props) {
  const { t } = useTranslation()
  const format = useCenterFormat()
  const days = load.status === 'ready' ? load.data.days : []
  const describe = (value: string): CalendarDay => {
    const day = days.find((item) => item.date === value)
    const count = sessionsOn(day).length
    const notes = [count > 0 && t('booking.scheduleCount', { count }), day?.onLeave && t('scheduler.onLeave')].filter(Boolean)
    return { enabled: true, quiet: count === 0 && !day?.onLeave, marked: count > 0, note: notes.join(', ') || undefined }
  }
  const nothing = load.status === 'ready' && !days.some((day) => sessionsOn(day).length > 0)
  return (
    <>
      <PageHeader title={t('nav.schedule')} description={t(audience === 'patient' ? 'booking.scheduleDetailPatient' : 'booking.scheduleDetailTherapist')} actions={actions} />
      <div className="grid items-start gap-5 desk:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <Panel>
          <MonthCalendar month={month} onMonth={onMonth} canGoBack={canGoBack} canGoForward={canGoForward} selected={date} today={today} onSelect={onDate} day={describe} label={t('nav.schedule')} />
          {nothing && <p className="mt-3 text-sm text-slate">{t('booking.scheduleNone')}</p>}
        </Panel>
        <Panel title={date ? format.calendarDay(date) : t('booking.scheduleDay')}>
          <Loadable load={load} skeleton={<div className="grid gap-2">{[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-12 rounded-control" />)}</div>}>
            {(schedule) => <Agenda day={schedule.days.find((item) => item.date === date)} audience={audience} recordPath={recordPath} />}
          </Loadable>
        </Panel>
      </div>
    </>
  )
}
