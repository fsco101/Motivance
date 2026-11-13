import { useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { Dialog } from '@/components/Dialog'
import { Avatar, Notice, PersonName } from '@/components/Display'
import { SelectField, TextArea, TextField } from '@/components/Field'
import { CENTER_ZONE, shiftMonth, todayAt, type Availability, type Slot } from '@/data/booking'
import { centerInstant, dayRange, type AffectedBooking, type Closure, type ClosureDraft, type Holiday, type HolidayDraft, type HolidayKind, type Resolution, type TimeOff, type TimeOffDraft } from '@/data/calendar'
import type { TherapistChoice } from '@/data/scheduler'
import { useCenterFormat } from '@/features/booking/format'
import { SlotPicker } from '@/features/booking/SlotPicker'
import { asLoad } from '@/features/shared'
import { pick, TherapistPicker, useTherapists } from './RequestDialogs'

type Range = { startsAt: string; endsAt: string }

/** Each save reports its own success and failure, so a dialog only has to wait for it and close. */
export type CalendarActions = {
  impact: (range: Range, therapist?: string) => Promise<AffectedBooking[]>
  availability: (month: string) => Promise<Availability>
  therapists: (booking: string, startsAt?: string) => Promise<TherapistChoice[]>
  saveHoliday: (draft: HolidayDraft, resolutions: readonly Resolution[]) => Promise<void>
  saveClosure: (draft: ClosureDraft, resolutions: readonly Resolution[]) => Promise<void>
  saveTimeOff: (draft: TimeOffDraft, resolutions: readonly Resolution[]) => Promise<void>
}

const KINDS: readonly HolidayKind[] = ['regular', 'special', 'seasonal']
const isUnresolved = (error: unknown) => (error as { message?: string } | null)?.message === 'booking_unresolved'

/** The time being closed cannot be a new home for a booking, and availability does not know about it until the save. */
function withoutRange(availability: Availability, { startsAt, endsAt }: Range): Availability {
  const [from, to] = [Date.parse(startsAt), Date.parse(endsAt)]
  return {
    ...availability,
    days: availability.days.map((day) => {
      const slots = day.slots.filter((slot) => !(Date.parse(slot.startsAt) < to && Date.parse(slot.endsAt) > from))
      return { ...day, slots, status: day.status === 'open' && slots.length === 0 ? 'closure' : day.status }
    }),
  }
}

type Decision = { action: 'cancel' } | { action: 'reschedule'; slot: Slot; therapist: string } | { action: 'assign'; therapist: string; name: string }

/** With several bookings to decide, each step says whose this one is. */
function BookingLine({ booking }: { booking: AffectedBooking }) {
  const format = useCenterFormat()
  return (
    <p className="mb-4 flex items-center gap-2 text-sm text-slate">
      <Avatar name={booking.patient} photo={booking.patientPhoto} size={24} />
      <span><span className="font-semibold text-ink">{booking.patient}</span>, {format.when(booking.startsAt, booking.endsAt)}</span>
    </p>
  )
}

/** Someone else at the same time, which is usually the kindest answer when a therapist is away. */
function CoverStep({ booking, away, actions, onChoose, onBack }: { booking: AffectedBooking; away: string; actions: CalendarActions; onChoose: (therapist: string, name: string) => void; onBack: () => void }) {
  const { t } = useTranslation()
  const [chosen, setChosen] = useState<string | null>(null)
  const choices = useTherapists(actions, booking)
  const others = choices.data?.filter((choice) => choice.id !== away)
  const therapist = pick(chosen, others, null)
  return (
    <>
      <BookingLine booking={booking} />
      <TherapistPicker load={asLoad({ data: others, isError: choices.isError, refetch: choices.refetch })} value={therapist} onChange={setChosen} current={null} />
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onBack}>{t('calendar.back')}</Button>
        <Button disabled={!therapist} onClick={() => onChoose(therapist!, others!.find((choice) => choice.id === therapist)!.name)}>{t('calendar.useTherapist')}</Button>
      </div>
    </>
  )
}

function TimeStep({ booking, blocked, actions, onChoose, onBack }: { booking: AffectedBooking; blocked?: Range; actions: CalendarActions; onChoose: (slot: Slot, therapist: string) => void; onBack: () => void }) {
  const { t } = useTranslation()
  const [today] = useState(() => todayAt(CENTER_ZONE))
  const first = today.slice(0, 7)
  const [month, setMonth] = useState(first)
  const [date, setDate] = useState<string | null>(null)
  const [slot, setSlot] = useState<Slot | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)
  const availability = useQuery({ queryKey: ['scheduler', 'availability', month], queryFn: () => actions.availability(month) })
  const choices = useTherapists(actions, booking, slot?.startsAt)
  const therapist = pick(chosen, choices.data, booking.therapistId)
  const load = asLoad({ data: availability.data && (blocked ? withoutRange(availability.data, blocked) : availability.data), isError: availability.isError, refetch: availability.refetch })
  return (
    <>
      <BookingLine booking={booking} />
      <div className="max-h-[60dvh] overflow-y-auto pr-1">
        <SlotPicker load={load} month={month} onMonth={(next) => { setMonth(next); setDate(null); setSlot(null) }} canGoBack={month > first} canGoForward={month < shiftMonth(first, 12)} today={today}
          date={date} onDate={(next) => { setDate(next); setSlot(null) }} chosen={slot} onChoose={setSlot} />
        {slot && <div className="mt-5"><TherapistPicker load={asLoad(choices)} value={therapist} onChange={setChosen} current={booking.therapistId} /></div>}
      </div>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onBack}>{t('calendar.back')}</Button>
        <Button disabled={!slot || !therapist} onClick={() => onChoose(slot!, therapist!)}>{t('calendar.useTime')}</Button>
      </div>
    </>
  )
}

/** Every booking gets a decision before anything is saved, so a closure can never leave one stranded without anyone choosing that. */
function ResolveStep({ affected, blocked, away, reason, actions, busy, onBack, onFinish }: {
  /** Time the whole center is shut, so no booking can move into it. */ blocked?: Range
  /** The therapist going on leave. The center stays open, so someone else can take the session instead. */ away?: string
  affected: readonly AffectedBooking[]; reason: string; actions: CalendarActions; busy: boolean; onBack: () => void; onFinish: (resolutions: Resolution[]) => void
}) {
  const { t } = useTranslation()
  const format = useCenterFormat()
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [picking, setPicking] = useState<AffectedBooking | null>(null)
  const [covering, setCovering] = useState<AffectedBooking | null>(null)
  const decide = (booking: string, decision: Decision) => setDecisions((current) => ({ ...current, [booking]: decision }))
  if (picking) {
    return <TimeStep booking={picking} blocked={blocked} actions={actions} onBack={() => setPicking(null)}
      onChoose={(slot, therapist) => { decide(picking.id, { action: 'reschedule', slot, therapist }); setPicking(null) }} />
  }
  if (covering && away) {
    return <CoverStep booking={covering} away={away} actions={actions} onBack={() => setCovering(null)}
      onChoose={(therapist, name) => { decide(covering.id, { action: 'assign', therapist, name }); setCovering(null) }} />
  }
  const done = affected.filter((booking) => decisions[booking.id]).length
  const resolutions = (): Resolution[] => affected.map((booking) => {
    const decision = decisions[booking.id]!
    if (decision.action === 'cancel') return { booking: booking.id, action: 'cancel', reason }
    if (decision.action === 'assign') return { booking: booking.id, action: 'assign', therapist: decision.therapist }
    return { booking: booking.id, action: 'reschedule', starts_at: decision.slot.startsAt, therapist: decision.therapist }
  })
  return (
    <>
      <Notice tone="caution">{t('calendar.resolveDetail', { count: affected.length })}</Notice>
      <ol className="mt-3 max-h-[50dvh] divide-y divide-line overflow-y-auto">
        {affected.map((booking) => {
          const decision = decisions[booking.id]
          return (
            <li key={booking.id} aria-label={booking.patient} className="py-3">
              <p className="font-semibold"><PersonName name={booking.patient} photo={booking.patientPhoto} size={28} /></p>
              <p className="text-sm text-slate">{format.when(booking.startsAt, booking.endsAt)}, {booking.reference}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {away && <Button size="sm" variant="secondary" aria-pressed={decision?.action === 'assign'} onClick={() => setCovering(booking)}>{t('scheduler.changeTherapist')}</Button>}
                <Button size="sm" variant="secondary" aria-pressed={decision?.action === 'reschedule'} onClick={() => setPicking(booking)}>{t('scheduler.reschedule')}</Button>
                <Button size="sm" variant="secondary" aria-pressed={decision?.action === 'cancel'} onClick={() => decide(booking.id, { action: 'cancel' })}>{t('booking.cancel')}</Button>
                {decision && <span className="text-sm font-semibold">{decision.action === 'cancel' ? t('calendar.willCancel') : decision.action === 'assign' ? t('calendar.willPass', { name: decision.name }) : t('calendar.willMove', { when: format.when(decision.slot.startsAt, decision.slot.endsAt) })}</span>}
              </div>
            </li>
          )
        })}
      </ol>
      <p aria-live="polite" className="mt-3 text-sm text-slate">{t('calendar.decided', { done, total: affected.length })}</p>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onBack}>{t('calendar.back')}</Button>
        <Button busy={busy} busyLabel={t('common.working')} disabled={done < affected.length} onClick={() => onFinish(resolutions())}>{t('calendar.saveResolved')}</Button>
      </div>
    </>
  )
}

/** Details first, then a decision for every booking they would strand. A booking made in between is caught by the server and read again here. */
function useTwoStepSave(impact: (range: Range) => Promise<AffectedBooking[]>, save: (resolutions: readonly Resolution[]) => Promise<void>, onClose: () => void) {
  const [affected, setAffected] = useState<AffectedBooking[] | null>(null)
  const [busy, setBusy] = useState(false)
  const during = (work: () => Promise<void>) => { setBusy(true); void work().catch(() => undefined).finally(() => setBusy(false)) }
  return {
    affected, busy, back: () => setAffected(null),
    check: (range: Range) => during(async () => {
      const found = await impact(range)
      if (found.length > 0) { setAffected(found); return }
      await save([])
      onClose()
    }),
    finish: (range: Range, resolutions: readonly Resolution[]) => during(async () => {
      try {
        await save(resolutions)
        onClose()
      } catch (failure) {
        if (isUnresolved(failure)) setAffected(await impact(range))
      }
    }),
  }
}

function Footer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation()
  return <div className="mt-6 flex flex-wrap justify-end gap-2"><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>{children}</div>
}

export function HolidayDialog({ holiday, actions, onClose }: { holiday: Holiday | null; actions: CalendarActions; onClose: () => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState(holiday?.name ?? '')
  const [kind, setKind] = useState<HolidayKind>(holiday?.kind ?? 'seasonal')
  const [startsOn, setStartsOn] = useState(holiday?.startsOn ?? '')
  const [endsOn, setEndsOn] = useState(holiday?.endsOn ?? '')
  const draft: HolidayDraft = { id: holiday?.id ?? null, name: name.trim(), kind, startsOn, endsOn: endsOn || startsOn }
  const steps = useTwoStepSave(actions.impact, (resolutions) => actions.saveHoliday(draft, resolutions), onClose)
  const range = () => dayRange(draft.startsOn, draft.endsOn)
  const ready = draft.name.length > 0 && Boolean(startsOn) && draft.endsOn >= startsOn
  const title = t(holiday ? 'calendar.editHoliday' : 'calendar.addHoliday')
  return (
    <Dialog wide={Boolean(steps.affected)} open onOpenChange={onClose} title={title}>
      {steps.affected ? <ResolveStep affected={steps.affected} blocked={range()} reason={t('calendar.closedFor', { name: draft.name })} actions={actions} busy={steps.busy} onBack={steps.back} onFinish={(resolutions) => steps.finish(range(), resolutions)} /> : (
        <>
          <div className="grid gap-3">
            <TextField label={t('calendar.holidayName')} value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
            <SelectField label={t('calendar.kind')} value={kind} onChange={(value) => setKind(value as HolidayKind)} options={KINDS.map((value) => ({ value, label: t(`calendar.kinds.${value}`) }))} />
            <div className="grid gap-3 tablet:grid-cols-2">
              <TextField label={t('progress.from')} type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} />
              <TextField label={t('progress.through')} hint={t('calendar.throughHint')} type="date" value={endsOn} min={startsOn} onChange={(event) => setEndsOn(event.target.value)} />
            </div>
          </div>
          <Footer onClose={onClose}><Button busy={steps.busy} busyLabel={t('common.working')} disabled={!ready} onClick={() => steps.check(range())}>{t('calendar.save')}</Button></Footer>
        </>
      )}
    </Dialog>
  )
}

const localDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: CENTER_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
const localTime = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: CENTER_ZONE, hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

export function ClosureDialog({ closure, actions, onClose }: { closure: Closure | null; actions: CalendarActions; onClose: () => void }) {
  const { t } = useTranslation()
  const [allDay, setAllDay] = useState(closure?.allDay ?? true)
  const [date, setDate] = useState(closure ? localDate(closure.startsAt) : '')
  const [from, setFrom] = useState(closure && !closure.allDay ? localTime(closure.startsAt) : '13:00')
  const [to, setTo] = useState(closure && !closure.allDay ? localTime(closure.endsAt) : '15:00')
  const [reason, setReason] = useState(closure?.reason ?? '')
  const range = (): Range => (allDay ? dayRange(date, date) : { startsAt: centerInstant(date, from), endsAt: centerInstant(date, to) })
  const draft = (): ClosureDraft => ({ id: closure?.id ?? null, ...range(), allDay, reason: reason.trim() })
  const steps = useTwoStepSave(actions.impact, (resolutions) => actions.saveClosure(draft(), resolutions), onClose)
  const ready = Boolean(date) && reason.trim().length >= 3 && (allDay || from < to)
  return (
    <Dialog wide={Boolean(steps.affected)} open onOpenChange={onClose} title={t(closure ? 'calendar.editClosure' : 'calendar.addClosure')}>
      {steps.affected ? <ResolveStep affected={steps.affected} blocked={range()} reason={reason.trim()} actions={actions} busy={steps.busy} onBack={steps.back} onFinish={(resolutions) => steps.finish(range(), resolutions)} /> : (
        <>
          <div className="grid gap-3">
            <TextField label={t('calendar.closureDate')} type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            <label className="flex min-h-11 items-center gap-2 font-semibold">
              <input type="checkbox" className="size-4 accent-lagoon" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} />
              {t('calendar.allDay')}
            </label>
            {!allDay && (
              <div className="grid gap-3 tablet:grid-cols-2">
                <TextField label={t('calendar.closedFrom')} type="time" value={from} onChange={(event) => setFrom(event.target.value)} />
                <TextField label={t('calendar.closedUntil')} type="time" value={to} onChange={(event) => setTo(event.target.value)} />
              </div>
            )}
            <TextArea label={t('booking.reason')} hint={t('calendar.reasonHint')} value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} />
          </div>
          <Footer onClose={onClose}><Button busy={steps.busy} busyLabel={t('common.working')} disabled={!ready} onClick={() => steps.check(range())}>{t('calendar.save')}</Button></Footer>
        </>
      )}
    </Dialog>
  )
}

const localMoment = (iso: string) => `${localDate(iso)}T${localTime(iso)}`
const instantOf = (moment: string) => centerInstant(moment.slice(0, 10), moment.slice(11, 16))

export function TimeOffDialog({ entry, therapists, actions, onClose }: { entry: TimeOff | null; therapists: readonly TherapistChoice[]; actions: CalendarActions; onClose: () => void }) {
  const { t } = useTranslation()
  const [therapist, setTherapist] = useState(entry?.therapistId ?? '')
  const [from, setFrom] = useState(entry ? localMoment(entry.startsAt) : '')
  const [until, setUntil] = useState(entry ? localMoment(entry.endsAt) : '')
  const [reason, setReason] = useState(entry?.reason ?? '')
  const range = (): Range => ({ startsAt: instantOf(from), endsAt: instantOf(until) })
  const steps = useTwoStepSave((value) => actions.impact(value, therapist), (resolutions) => actions.saveTimeOff({ id: entry?.id ?? null, therapistId: therapist, ...range(), reason: reason.trim() }, resolutions), onClose)
  const ready = Boolean(therapist) && Boolean(from) && from < until && reason.trim().length >= 3
  return (
    <Dialog wide={Boolean(steps.affected)} open onOpenChange={onClose} title={t(entry ? 'calendar.editTimeOff' : 'calendar.addTimeOff')}>
      {/* A patient sees why a booking was cancelled, and a therapist's reason for being away is theirs, so this says only that they are away. */}
      {steps.affected ? <ResolveStep affected={steps.affected} away={therapist} reason={t('calendar.therapistAway')} actions={actions} busy={steps.busy} onBack={steps.back} onFinish={(resolutions) => steps.finish(range(), resolutions)} /> : (
        <>
          <div className="grid gap-3">
            <SelectField label={t('booking.therapist')} placeholder={t('calendar.chooseTherapist')} value={therapist} onChange={setTherapist} options={therapists.map((item) => ({ value: item.id, label: item.name }))} />
            <div className="grid gap-3 tablet:grid-cols-2">
              <TextField label={t('calendar.awayFrom')} type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} />
              <TextField label={t('calendar.backAt')} type="datetime-local" value={until} min={from} onChange={(event) => setUntil(event.target.value)} />
            </div>
            <TextArea label={t('booking.reason')} hint={t('calendar.timeOffReasonHint')} value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} />
          </div>
          <Footer onClose={onClose}><Button busy={steps.busy} busyLabel={t('common.working')} disabled={!ready} onClick={() => steps.check(range())}>{t('calendar.save')}</Button></Footer>
        </>
      )}
    </Dialog>
  )
}
