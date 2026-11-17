import { PlusIcon, XIcon } from '@phosphor-icons/react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, IconButton } from '@/components/Button'
import { TextField } from '@/components/Field'
import { addDays } from '@/data/booking'
import { countDays, draftProblem, WEEKDAYS, type ExerciseSchedule, type ScheduleDraft, type Weekday } from '@/data/exerciseSchedule'
import { useFormat } from '@/features/shared'
import { cn } from '@/lib/cn'

/** A weekday's name in the reader's language. 2026-11-16 was a Monday, so day n falls n - 1 days later. */
export function useWeekdayNames(style: 'short' | 'long') {
  const { i18n } = useTranslation()
  return useMemo(() => {
    const format = new Intl.DateTimeFormat(i18n.language === 'fil' ? 'fil-PH' : 'en-PH', { weekday: style })
    return (day: Weekday) => format.format(new Date(`${addDays('2026-11-16', day - 1)}T00:00:00`))
  }, [i18n.language, style])
}

type Props = {
  patientId: string; today: string; existing?: ExerciseSchedule; busy?: boolean
  onSave: (draft: ScheduleDraft) => void; onCancel: () => void
}

/** Start and end dates, rest weekdays and single rest dates, with the count of days they make before anything is saved. */
export function ScheduleForm({ patientId, today, existing, busy, onSave, onCancel }: Props) {
  const { t } = useTranslation()
  const format = useFormat()
  const weekday = useWeekdayNames('short')
  const fullWeekday = useWeekdayNames('long')
  const [id] = useState(() => existing?.id ?? crypto.randomUUID())
  const [startsOn, setStartsOn] = useState(existing?.startsOn ?? today)
  const [endsOn, setEndsOn] = useState(existing?.endsOn ?? addDays(today, 13))
  const [restWeekdays, setRestWeekdays] = useState<Weekday[]>(existing?.restWeekdays ?? [])
  const [restDates, setRestDates] = useState<string[]>(existing?.restDates ?? [])
  const [restDate, setRestDate] = useState('')
  const started = existing !== undefined && existing.startsOn <= today
  const draft: ScheduleDraft = { id, patientId, startsOn, endsOn, restWeekdays, restDates }
  const problem = draftProblem(draft, today, existing)
  const counts = countDays(draft)
  const toggle = (day: Weekday) => setRestWeekdays((days) => (days.includes(day) ? days.filter((item) => item !== day) : [...days, day].sort()))
  const canAdd = restDate !== '' && restDate >= startsOn && restDate <= endsOn && restDate >= today && !restDates.includes(restDate)
  const add = () => { if (canAdd) { setRestDates((dates) => [...dates, restDate].sort()); setRestDate('') } }
  return (
    <form className="flex flex-col gap-5" onSubmit={(event) => { event.preventDefault(); if (!problem) onSave(draft) }}>
      <div className="grid gap-4 tablet:grid-cols-2">
        <TextField label={t('schedule.startsOn')} type="date" required value={startsOn} min={started ? undefined : today} disabled={started}
          hint={started ? t('schedule.startedHint') : undefined} onChange={(event) => setStartsOn(event.target.value)} />
        <TextField label={t('schedule.endsOn')} type="date" required value={endsOn} min={startsOn > today ? startsOn : today} onChange={(event) => setEndsOn(event.target.value)} />
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">{t('schedule.restWeekdays')}</legend>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((day) => (
            <button key={day} type="button" aria-pressed={restWeekdays.includes(day)} onClick={() => toggle(day)}
              className={cn('min-h-10 min-w-12 rounded-control border px-3 text-sm font-semibold transition-colors transition-quick',
                restWeekdays.includes(day) ? 'border-lagoon-deep bg-lagoon-deep text-paper' : 'border-line-strong bg-paper hover:border-lagoon')}>
              {/* The short name fits the row; a screen reader hears the whole one. */}
              <span aria-hidden>{weekday(day)}</span><span className="sr-only">{fullWeekday(day)}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">{t('schedule.restDates')}</legend>
        <div className="flex flex-wrap items-end gap-2">
          <TextField label={t('schedule.restDateLabel')} labelHidden type="date" value={restDate} min={startsOn > today ? startsOn : today} max={endsOn}
            onChange={(event) => setRestDate(event.target.value)} className="w-48" />
          <Button variant="secondary" disabled={!canAdd} onClick={add} leading={<PlusIcon weight="bold" aria-hidden />}>{t('schedule.addRestDate')}</Button>
        </div>
        {restDates.length === 0 ? <p className="mt-2 text-sm text-slate">{t('schedule.noRestDates')}</p> : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {restDates.map((date) => (
              <li key={date} className="flex items-center gap-1 rounded-full bg-tide py-1 pl-3 pr-1 text-sm font-semibold">
                {format.day(date)}
                {/* A rest day already behind a started schedule is history, so it stays. */}
                {date >= today && <IconButton label={t('schedule.removeRestDate', { date: format.day(date) })} className="size-7" onClick={() => setRestDates((dates) => dates.filter((item) => item !== date))}><XIcon aria-hidden /></IconButton>}
              </li>
            ))}
          </ul>
        )}
      </fieldset>
      <p role="status" className={cn('rounded-control px-3 py-2 text-sm font-semibold', problem ? 'bg-alarm-soft text-alarm' : 'bg-mist text-ink')}>
        {problem ? t(`schedule.problems.${problem}`) : t('schedule.summary', { exercise: t('schedule.exerciseDays', { count: counts.exercise }), rest: t('schedule.restDays', { count: counts.rest }) })}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>{t('common.cancel')}</Button>
        <Button type="submit" disabled={problem !== null} busy={busy} busyLabel={t('common.working')}>{t('schedule.save')}</Button>
      </div>
    </form>
  )
}
