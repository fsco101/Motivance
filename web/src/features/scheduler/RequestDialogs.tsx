import { useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { Dialog } from '@/components/Dialog'
import { StatusPill } from '@/components/Display'
import { TextArea } from '@/components/Field'
import { CENTER_ZONE, shiftMonth, todayAt, type Availability, type Slot } from '@/data/booking'
import type { RequestRow, TherapistChoice } from '@/data/scheduler'
import { useCenterFormat } from '@/features/booking/format'
import { SlotPicker } from '@/features/booking/SlotPicker'
import { asLoad, Loadable, SkeletonLines, type Load } from '@/features/shared'
import { cn } from '@/lib/cn'

export type RequestActionKind = 'confirm' | 'assign' | 'reject' | 'cancel' | 'reschedule'

/** Every action reports its own success and failure, so a dialog only has to wait for it and close. */
export type RequestActions = {
  therapists: (booking: string, startsAt?: string) => Promise<TherapistChoice[]>
  availability: (month: string) => Promise<Availability>
  confirm: (row: RequestRow, therapist: string) => Promise<void>
  assign: (row: RequestRow, therapist: string) => Promise<void>
  reject: (row: RequestRow, reason: string) => Promise<void>
  cancel: (row: RequestRow, reason: string) => Promise<void>
  reschedule: (row: RequestRow, startsAt: string, therapist: string) => Promise<void>
  bulkReject: (reason: string) => Promise<void>
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
function TherapistPicker({ load, value, onChange, current }: { load: Load<TherapistChoice[]>; value: string | null; onChange: (id: string) => void; current: string | null }) {
  const { t } = useTranslation()
  return (
    <Loadable load={load} skeleton={<SkeletonLines rows={3} />}>
      {(choices) => (choices.length === 0 ? <p className="text-slate">{t('scheduler.noTherapists')}</p> : (
        <fieldset>
          <legend className="mb-2 font-semibold">{t('booking.therapist')}</legend>
          <div className="grid max-h-64 gap-2 overflow-y-auto">
            {choices.map((choice) => {
              const blocked = choice.busy && choice.id !== current
              return (
                <label key={choice.id} className={cn('flex min-h-11 items-center gap-3 rounded-control border border-line px-3 py-2', blocked ? 'bg-mist text-slate' : 'cursor-pointer hover:border-lagoon', value === choice.id && 'border-lagoon bg-tide')}>
                  <input type="radio" name="therapist" className="accent-lagoon" disabled={blocked} checked={value === choice.id} onChange={() => onChange(choice.id)} />
                  <span className="min-w-0 flex-1 font-semibold">{choice.name}</span>
                  {choice.linked && <StatusPill tone="positive">{t('scheduler.linked')}</StatusPill>}
                  {blocked && <StatusPill tone="caution">{t('scheduler.busy')}</StatusPill>}
                </label>
              )
            })}
          </div>
        </fieldset>
      ))}
    </Loadable>
  )
}

function useTherapists(actions: RequestActions, row: RequestRow, startsAt?: string) {
  return useQuery({ queryKey: ['scheduler', 'choices', row.id, startsAt ?? null], queryFn: () => actions.therapists(row.id, startsAt) })
}

/** The first free therapist, unless one is already chosen and still free. */
function pick(chosen: string | null, choices: readonly TherapistChoice[] | undefined, current: string | null) {
  const usable = (choices ?? []).filter((choice) => !choice.busy || choice.id === current)
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

function ReasonDialog({ kind, row, actions, onClose }: { kind: 'reject' | 'cancel'; row: RequestRow; actions: RequestActions; onClose: () => void }) {
  const { t } = useTranslation()
  const format = useCenterFormat()
  const [reason, setReason] = useState('')
  const { busy, run } = useSubmit(onClose)
  const confirm = t(kind === 'reject' ? 'scheduler.reject' : 'booking.cancel')
  return (
    <Dialog open onOpenChange={onClose} title={confirm} description={t('scheduler.forWhom', { patient: row.patient, when: format.when(row.startsAt, row.endsAt) })}>
      <TextArea label={t('booking.reason')} hint={t('scheduler.reasonHint')} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} />
      <Actions onClose={onClose} keep={kind === 'cancel' ? t('booking.keep') : undefined}>
        <Button variant="danger" busy={busy} busyLabel={t('common.working')} disabled={!validReason(reason)} onClick={() => run(() => actions[kind](row, reason.trim()))}>{confirm}</Button>
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
  const [reason, setReason] = useState('')
  const { busy, run } = useSubmit(onClose)
  return (
    <Dialog open onOpenChange={onClose} title={t('scheduler.rejectSelected')} description={t('scheduler.bulkDetail', { count })}>
      <TextArea label={t('booking.reason')} hint={t('scheduler.reasonHint')} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} />
      <Actions onClose={onClose}>
        <Button variant="danger" busy={busy} busyLabel={t('common.working')} disabled={!validReason(reason)} onClick={() => run(() => actions.bulkReject(reason.trim()))}>{t('scheduler.rejectCount', { count })}</Button>
      </Actions>
    </Dialog>
  )
}

export function RequestDialog({ kind, row, actions, onClose }: { kind: RequestActionKind; row: RequestRow; actions: RequestActions; onClose: () => void }) {
  if (kind === 'reschedule') return <RescheduleDialog row={row} actions={actions} onClose={onClose} />
  if (kind === 'reject' || kind === 'cancel') return <ReasonDialog kind={kind} row={row} actions={actions} onClose={onClose} />
  return <TherapistDialog kind={kind} row={row} actions={actions} onClose={onClose} />
}
