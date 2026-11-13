import { useQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { Dialog } from '@/components/Dialog'
import { Avatar, Notice, StatusPill } from '@/components/Display'
import { SelectField, TextField } from '@/components/Field'
import { CENTER_ZONE, shiftMonth, todayAt, type Availability, type Slot } from '@/data/booking'
import type { PatientChoice, SeriesDate, SeriesDraft, TherapistChoice } from '@/data/scheduler'
import { useCenterFormat } from '@/features/booking/format'
import { SlotPicker } from '@/features/booking/SlotPicker'
import { asLoad, Loadable, SkeletonLines } from '@/features/shared'
import { cn } from '@/lib/cn'

export type SeriesActions = {
  patients: (search: string) => Promise<PatientChoice[]>
  availability: (month: string) => Promise<Availability>
  preview: (draft: SeriesDraft) => Promise<SeriesDate[]>
  create: (request: string, draft: SeriesDraft) => Promise<void>
}

const MIN_WEEKS = 2
const MAX_WEEKS = 26

function PatientPicker({ actions, value, onChange }: { actions: Pick<SeriesActions, 'patients'>; value: PatientChoice | null; onChange: (patient: PatientChoice) => void }) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const patients = useQuery({ queryKey: ['scheduler', 'series-patients', search.trim()], queryFn: () => actions.patients(search.trim()) })
  return (
    <fieldset>
      <legend className="mb-2 font-semibold">{t('scheduler.patient')}</legend>
      <TextField label={t('scheduler.seriesPatientSearch')} value={search} maxLength={100} onChange={(event) => setSearch(event.target.value)} />
      <div className="mt-2 grid max-h-44 gap-2 overflow-y-auto">
        <Loadable load={asLoad(patients)} skeleton={<SkeletonLines rows={2} />}>
          {(choices) => (choices.length === 0 ? <p className="text-sm text-slate">{t('scheduler.seriesNoPatients')}</p> : choices.map((choice) => (
            <label key={choice.id} className={cn('flex min-h-11 cursor-pointer items-center gap-3 rounded-control border border-line px-3 py-2 hover:border-lagoon', value?.id === choice.id && 'border-lagoon bg-tide')}>
              <input type="radio" name="series-patient" className="accent-lagoon" checked={value?.id === choice.id} onChange={() => onChange(choice)} />
              <Avatar name={choice.name} photo={choice.photo} size={28} />
              <span className="min-w-0 flex-1 font-semibold">{choice.name}</span>
            </label>
          )))}
        </Loadable>
      </div>
    </fieldset>
  )
}

/** Every date of the course with what would stop it, so nothing is saved blind. */
function DateList({ dates }: { dates: readonly SeriesDate[] }) {
  const { t } = useTranslation()
  const format = useCenterFormat()
  return (
    <ol className="max-h-[50dvh] divide-y divide-line overflow-y-auto border-y border-line">
      {dates.map((date) => (
        <li key={date.startsAt} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
          <span className={cn('text-sm', date.problem ? 'text-slate' : 'font-semibold')}>{format.when(date.startsAt, date.endsAt)}</span>
          <StatusPill tone={date.problem ? 'caution' : 'positive'}>{date.problem ? t(`scheduler.seriesProblem.${date.problem}`, date.problem) : t('scheduler.seriesFree')}</StatusPill>
        </li>
      ))}
    </ol>
  )
}

export function WeeklySeriesDialog({ therapists, actions, onClose }: { therapists: readonly TherapistChoice[]; actions: SeriesActions; onClose: () => void }) {
  const { t } = useTranslation()
  const [today] = useState(() => todayAt(CENTER_ZONE))
  const first = today.slice(0, 7)
  const [month, setMonth] = useState(first)
  const [date, setDate] = useState<string | null>(null)
  const [slot, setSlot] = useState<Slot | null>(null)
  const [patient, setPatient] = useState<PatientChoice | null>(null)
  const [therapist, setTherapist] = useState('')
  const [weeks, setWeeks] = useState('8')
  const [dates, setDates] = useState<readonly SeriesDate[] | null>(null)
  const [busy, setBusy] = useState(false)
  // One ID per course, so trying again after a lost response returns the same bookings instead of a second set.
  const attempt = useRef<{ key: string; request: string } | null>(null)
  const availability = useQuery({ queryKey: ['scheduler', 'availability', month], queryFn: () => actions.availability(month) })

  const count = Number(weeks)
  const weeksValid = Number.isInteger(count) && count >= MIN_WEEKS && count <= MAX_WEEKS
  const draft: SeriesDraft | null = patient && therapist && slot && weeksValid ? { patient: patient.id, therapist, startsAt: slot.startsAt, weeks: count } : null
  const free = dates?.filter((item) => !item.problem).length ?? 0
  const therapistName = therapists.find((item) => item.id === therapist)?.name ?? ''

  const check = async () => {
    if (!draft) return
    setBusy(true)
    // A refusal has already been shown, and the choices stay as they were.
    await actions.preview(draft).then(setDates, () => undefined)
    setBusy(false)
  }
  const book = async () => {
    if (!draft) return
    const key = JSON.stringify(draft)
    if (attempt.current?.key !== key) attempt.current = { key, request: crypto.randomUUID() }
    setBusy(true)
    try {
      await actions.create(attempt.current.request, draft)
      onClose()
    } catch {
      // Something changed since the check, so what is on screen must not stand.
      await actions.preview(draft).then(setDates, () => undefined)
    } finally {
      setBusy(false)
    }
  }

  if (dates) {
    return (
      <Dialog wide open onOpenChange={onClose} title={t('scheduler.seriesReviewTitle')} description={t('scheduler.seriesFor', { patient: patient?.name ?? '', therapist: therapistName })}>
        <DateList dates={dates} />
        {free === 0 ? <Notice tone="info" className="mt-4">{t('scheduler.seriesNoneFree')}</Notice>
          : free < dates.length && <Notice tone="info" className="mt-4">{t('scheduler.seriesSomeBlocked')}</Notice>}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => setDates(null)}>{t('scheduler.seriesBack')}</Button>
          <Button busy={busy} busyLabel={t('common.working')} disabled={free === 0} onClick={() => void book()}>{t('scheduler.seriesBook', { count: free })}</Button>
        </div>
      </Dialog>
    )
  }
  return (
    <Dialog wide open onOpenChange={onClose} title={t('scheduler.seriesTitle')} description={t('scheduler.seriesDetail')}>
      <div className="grid max-h-[60dvh] gap-5 overflow-y-auto pr-1">
        <PatientPicker actions={actions} value={patient} onChange={setPatient} />
        <div className="grid items-start gap-4 tablet:grid-cols-2">
          <SelectField label={t('booking.therapist')} value={therapist} placeholder={t('scheduler.seriesChooseTherapist')} onChange={setTherapist} options={therapists.map((item) => ({ value: item.id, label: item.name }))} />
          <TextField label={t('scheduler.seriesWeeks')} hint={t('scheduler.seriesWeeksHint')} type="number" inputMode="numeric" min={MIN_WEEKS} max={MAX_WEEKS} value={weeks} error={weeks && !weeksValid ? t('scheduler.seriesWeeksHint') : undefined} onChange={(event) => setWeeks(event.target.value)} />
        </div>
        <div>
          <h3 className="mb-3 font-sans text-base font-bold">{t('scheduler.seriesFirst')}</h3>
          <SlotPicker load={asLoad(availability)} month={month} onMonth={(next) => { setMonth(next); setDate(null); setSlot(null) }} canGoBack={month > first} canGoForward={month < shiftMonth(first, 12)} today={today}
            date={date} onDate={(next) => { setDate(next); setSlot(null) }} chosen={slot} onChoose={setSlot} />
        </div>
      </div>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        <Button busy={busy} busyLabel={t('common.working')} disabled={!draft} onClick={() => void check()}>{t('scheduler.seriesCheck')}</Button>
      </div>
    </Dialog>
  )
}
