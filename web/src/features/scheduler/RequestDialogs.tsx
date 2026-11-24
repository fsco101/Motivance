import { useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { Dialog } from '@/components/Dialog'
import { Avatar, StatusPill } from '@/components/Display'
import { TextArea } from '@/components/Field'
import { CENTER_ZONE, REJECTION_CODES, REJECTION_NOTE_MAX, shiftMonth, todayAt, validRejection, type Availability, type Rejection, type Slot } from '@/data/booking'
import type { RequestRow, TherapistChoice } from '@/data/scheduler'
import { useCenterFormat } from '@/features/booking/format'
import { SlotPicker } from '@/features/booking/SlotPicker'
import { asLoad, Loadable, SkeletonLines, type Load } from '@/features/shared'
import { cn } from '@/lib/cn'

export type RequestActionKind = 'confirm' | 'assign' | 'reject' | 'cancel' | 'reschedule' | 'series'

/** Every action reports its own success and failure, so a dialog only has to wait for it and close. */
export type RequestActions = {
  therapists: (booking: string, startsAt?: string) => Promise<TherapistChoice[]>
  availability: (month: string) => Promise<Availability>
  confirm: (row: RequestRow, therapist: string) => Promise<void>
  assign: (row: RequestRow, therapist: string) => Promise<void>
  reject: (row: RequestRow, rejection: Rejection) => Promise<void>
  cancel: (row: RequestRow, reason: string) => Promise<void>
  reschedule: (row: RequestRow, startsAt: string, therapist: string) => Promise<void>
  bulkReject: (rejection: Rejection) => Promise<void>
  cancelSeries: (row: RequestRow, reason: string) => Promise<void>
}

const validReason = (reason: string) => reason.trim().length >= 3

function useSubmit(onClose: () => void) {
  const [busy, setBusy] = useState(false)
  return { busy, run: (work: () => Promise<void>) => { setBusy(true); void work().then(onClose, () => undefined).finally(() => setBusy(false)) } }
}

function Actions({ onClose, keep, children }: { onClose: () => void; keep?: string; children: ReactNode }) {
  const { t } = useTranslation()
  return <div className="mt-6 flex flex-wrap justify-end gap-2"><Button variant="secondary" onClick={onClose}>{keep ?? t('common.cancel')}</Button>{children}</div>
}

/** Linked therapists come first from the server. A busy therapist cannot be chosen, so the conflict is seen before it is refused. */
export function TherapistPicker({ load, value, onChange, current }: { load: Load<TherapistChoice[]>; value: string | null; onChange: (id: string) => void; current: string | null }) {
  const { t } = useTranslation()
  return (
    <Loadable load={load} skeleton={<SkeletonLines rows={3} />}>
      {(choices) => (choices.length === 0 ? <p className="text-slate">{t('scheduler.noTherapists')}</p> : (
        <fieldset>
          <legend className="mb-2 font-semibold">{t('booking.therapist')}</legend>
          <div className="grid max-h-64 gap-2 overflow-y-auto">
            {choices.map((choice) => {
              const blocked = choice.onLeave || (choice.busy && choice.id !== current)
              return (
                <label key={choice.id} className={cn('flex min-h-11 items-center gap-3 rounded-control border border-line px-3 py-2', blocked ? 'bg-mist text-slate' : 'cursor-pointer hover:border-lagoon', value === choice.id && 'border-lagoon bg-tide')}>
                  <input type="radio" name="therapist" className="accent-lagoon" disabled={blocked} checked={value === choice.id} onChange={() => onChange(choice.id)} />
                  <Avatar name={choice.name} photo={choice.photo} size={28} />
                  <span className="min-w-0 flex-1 font-semibold">{choice.name}</span>
                  {choice.linked && <StatusPill tone="positive">{t('scheduler.linked')}</StatusPill>}
                  {blocked && <StatusPill tone="caution">{t(choice.onLeave ? 'scheduler.onLeave' : 'scheduler.busy')}</StatusPill>}
                </label>
              )
            })}
          </div>
        </fieldset>
      ))}
    </Loadable>
  )
}

export function useTherapists(actions: Pick<RequestActions, 'therapists'>, row: { id: string }, startsAt?: string) {
  return useQuery({ queryKey: ['scheduler', 'choices', row.id, startsAt ?? null], queryFn: () => actions.therapists(row.id, startsAt) })
}

/** The first free therapist, unless one is already chosen and still free. */
export function pick(chosen: string | null, choices: readonly TherapistChoice[] | undefined, current: string | null) {
  const usable = (choices ?? []).filter((choice) => !choice.onLeave && (!choice.busy || choice.id === current))
  return usable.find((choice) => choice.id === chosen)?.id ?? usable.find((choice) => choice.id === current)?.id ?? usable[0]?.id ?? null
}

function TherapistDialog({ kind, row, actions, onClose }: { kind: 'confirm' | 'assign'; row: RequestRow; actions: RequestActions; onClose: () => void }) {
  const { t } = useTranslation()
  const format = useCenterFormat()
  const choices = useTherapists(actions, row)
  const [chosen, setChosen] = useState<string | null>(null)
  const { busy, run } = useSubmit(onClose)
  const therapist = pick(chosen, choices.data, row.therapistId)
  const title = t(kind === 'confirm' ? 'scheduler.confirmTitle' : row.therapist ? 'scheduler.changeTherapist' : 'scheduler.assignTherapist')
  return (
    <Dialog open onOpenChange={onClose} title={title} description={t('scheduler.forWhom', { patient: row.patient, when: format.when(row.startsAt, row.endsAt) })}>
      <TherapistPicker load={asLoad(choices)} value={therapist} onChange={setChosen} current={row.therapistId} />
      <Actions onClose={onClose}>
        <Button busy={busy} busyLabel={t('common.working')} disabled={!therapist} onClick={() => run(() => actions[kind](row, therapist!))}>{t(kind === 'confirm' ? 'scheduler.confirm' : 'scheduler.saveTherapist')}</Button>
      </Actions>
    </Dialog>
  )
}

const NO_REJECTION: Rejection = { code: 'slot_unavailable', reason: '', note: '' }

/** The center's common reasons, or Other in the Scheduler's own words (#172). A common reason can carry a short note. */
function RejectionFields({ value, onChange }: { value: Rejection; onChange: (next: Rejection) => void }) {
  const { t } = useTranslation()
  return (
    <div className="grid gap-4">
      <fieldset>
        <legend className="mb-1 font-semibold">{t('scheduler.rejectReasonLabel')}</legend>
        <p className="mb-2 text-sm text-slate">{t('scheduler.rejectReasonHint')}</p>
        <div className="grid gap-2">
          {[...REJECTION_CODES, 'other' as const].map((code) => (
            <label key={code} className={cn('flex min-h-11 cursor-pointer items-center gap-3 rounded-control border border-line px-3 py-2 hover:border-lagoon', value.code === code && 'border-lagoon bg-tide')}>
              <input type="radio" name="rejection" className="accent-lagoon" checked={value.code === code} onChange={() => onChange({ ...value, code })} />
              <span className="font-semibold">{t(`scheduler.rejectChoice.${code}`)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {value.code === 'other'
        ? <TextArea label={t('scheduler.rejectOther')} hint={t('scheduler.rejectOtherHint')} value={value.reason} onChange={(event) => onChange({ ...value, reason: event.target.value })} maxLength={300} />
        : <TextArea label={t('scheduler.rejectNote')} hint={t('scheduler.rejectNoteHint')} rows={2} value={value.note} onChange={(event) => onChange({ ...value, note: event.target.value })} maxLength={REJECTION_NOTE_MAX} />}
    </div>
  )
}

function RejectDialog({ row, actions, onClose }: { row: RequestRow; actions: Pick<RequestActions, 'reject'>; onClose: () => void }) {
  const { t } = useTranslation()
  const format = useCenterFormat()
  const [rejection, setRejection] = useState(NO_REJECTION)
  const { busy, run } = useSubmit(onClose)
  return (
    <Dialog open onOpenChange={onClose} title={t('scheduler.reject')} description={t('scheduler.forWhom', { patient: row.patient, when: format.when(row.startsAt, row.endsAt) })}>
      <div className="max-h-[60dvh] overflow-y-auto pr-1"><RejectionFields value={rejection} onChange={setRejection} /></div>
      <Actions onClose={onClose}>
        <Button variant="danger" busy={busy} busyLabel={t('common.working')} disabled={!validRejection(rejection)} onClick={() => run(() => actions.reject(row, rejection))}>{t('scheduler.reject')}</Button>
      </Actions>
    </Dialog>
  )
}

function ReasonDialog({ row, actions, onClose }: { row: RequestRow; actions: Pick<RequestActions, 'cancel'>; onClose: () => void }) {
  const { t } = useTranslation()
  const format = useCenterFormat()
  const [reason, setReason] = useState('')
  const { busy, run } = useSubmit(onClose)
  const confirm = t('booking.cancel')
  return (
    <Dialog open onOpenChange={onClose} title={confirm} description={t('scheduler.forWhom', { patient: row.patient, when: format.when(row.startsAt, row.endsAt) })}>
      <TextArea label={t('booking.reason')} hint={t('scheduler.reasonHint')} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} />
      <Actions onClose={onClose} keep={t('booking.keep')}>
        <Button variant="danger" busy={busy} busyLabel={t('common.working')} disabled={!validReason(reason)} onClick={() => run(() => actions.cancel(row, reason.trim()))}>{confirm}</Button>
      </Actions>
    </Dialog>
  )
}

function RescheduleDialog({ row, actions, onClose }: { row: RequestRow; actions: RequestActions; onClose: () => void }) {
  const { t } = useTranslation()
  const format = useCenterFormat()
  const [today] = useState(() => todayAt(CENTER_ZONE))
  const first = today.slice(0, 7)
  const [month, setMonth] = useState(first)
  const [date, setDate] = useState<string | null>(null)
  const [slot, setSlot] = useState<Slot | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)
  const availability = useQuery({ queryKey: ['scheduler', 'availability', month], queryFn: () => actions.availability(month) })
  const choices = useTherapists(actions, row, slot?.startsAt)
  const { busy, run } = useSubmit(onClose)
  const therapist = pick(chosen, choices.data, row.therapistId)
  return (
    <Dialog wide open onOpenChange={onClose} title={t('scheduler.reschedule')} description={t('scheduler.forWhom', { patient: row.patient, when: format.when(row.startsAt, row.endsAt) })}>
      <div className="max-h-[60dvh] overflow-y-auto pr-1">
        <SlotPicker load={asLoad(availability)} month={month} onMonth={(next) => { setMonth(next); setDate(null); setSlot(null) }} canGoBack={month > first} canGoForward={month < shiftMonth(first, 12)} today={today}
          date={date} onDate={(next) => { setDate(next); setSlot(null) }} chosen={slot} onChoose={setSlot} />
        {slot && <div className="mt-5"><TherapistPicker load={asLoad(choices)} value={therapist} onChange={setChosen} current={row.therapistId} /></div>}
      </div>
      <Actions onClose={onClose}>
        <Button busy={busy} busyLabel={t('common.working')} disabled={!slot || !therapist} onClick={() => run(() => actions.reschedule(row, slot!.startsAt, therapist!))}>{t('scheduler.reschedule')}</Button>
      </Actions>
    </Dialog>
  )
}

export function BulkRejectDialog({ count, actions, onClose }: { count: number; actions: Pick<RequestActions, 'bulkReject'>; onClose: () => void }) {
  const { t } = useTranslation()
  const [rejection, setRejection] = useState(NO_REJECTION)
  const { busy, run } = useSubmit(onClose)
  return (
    <Dialog open onOpenChange={onClose} title={t('scheduler.rejectSelected')} description={t('scheduler.bulkDetail', { count })}>
      <div className="max-h-[60dvh] overflow-y-auto pr-1"><RejectionFields value={rejection} onChange={setRejection} /></div>
      <Actions onClose={onClose}>
        <Button variant="danger" busy={busy} busyLabel={t('common.working')} disabled={!validRejection(rejection)} onClick={() => run(() => actions.bulkReject(rejection))}>{t('scheduler.rejectCount', { count })}</Button>
      </Actions>
    </Dialog>
  )
}

function SeriesCancelDialog({ row, remaining, actions, onClose }: { row: RequestRow; remaining: number; actions: Pick<RequestActions, 'cancelSeries'>; onClose: () => void }) {
  const { t } = useTranslation()
  const [reason, setReason] = useState('')
  const { busy, run } = useSubmit(onClose)
  return (
    <Dialog open onOpenChange={onClose} title={t('scheduler.seriesCancel')} description={t('scheduler.seriesCancelDetail', { count: remaining, patient: row.patient })}>
      <TextArea label={t('booking.reason')} hint={t('scheduler.reasonHint')} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} />
      <Actions onClose={onClose} keep={t('booking.keep')}>
        <Button variant="danger" busy={busy} busyLabel={t('common.working')} disabled={!validReason(reason)} onClick={() => run(() => actions.cancelSeries(row, reason.trim()))}>{t('scheduler.seriesCancel')}</Button>
      </Actions>
    </Dialog>
  )
}

export function RequestDialog({ kind, row, remaining = 0, actions, onClose }: { kind: RequestActionKind; row: RequestRow; remaining?: number; actions: RequestActions; onClose: () => void }) {
  if (kind === 'series') return <SeriesCancelDialog row={row} remaining={remaining} actions={actions} onClose={onClose} />
  if (kind === 'reschedule') return <RescheduleDialog row={row} actions={actions} onClose={onClose} />
  if (kind === 'reject') return <RejectDialog row={row} actions={actions} onClose={onClose} />
  if (kind === 'cancel') return <ReasonDialog row={row} actions={actions} onClose={onClose} />
  return <TherapistDialog kind={kind} row={row} actions={actions} onClose={onClose} />
}
