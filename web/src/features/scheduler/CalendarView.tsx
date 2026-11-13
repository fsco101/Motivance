import { PencilSimpleIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, IconButton } from '@/components/Button'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState, Notice, PageHeader, Panel, PersonName, StatusPill, Tabs } from '@/components/Display'
import { SelectField, TextArea, TextField } from '@/components/Field'
import type { CenterCalendar, CenterDay, CenterSettings, Closure, Holiday, TimeOff } from '@/data/calendar'
import { useCenterFormat } from '@/features/booking/format'
import { Loadable, SkeletonLines, type Load } from '@/features/shared'

export type CalendarTab = 'hours' | 'holidays' | 'closures' | 'timeoff'

type Props = {
  load: Load<CenterCalendar>; tab: CalendarTab; onTab: (tab: CalendarTab) => void
  /** Sessions the last save of the hours left outside them. They keep their time, so someone needs to look at them. */
  outsideHours: number
  onSaveHours: (hours: CenterDay[]) => Promise<void>; onSaveSettings: (settings: CenterSettings) => Promise<void>
  onEditHoliday: (holiday: Holiday | null) => void; onDeleteHoliday: (holiday: Holiday) => void
  onEditClosure: (closure: Closure | null) => void; onDeleteClosure: (closure: Closure) => void
  onEditTimeOff: (entry: TimeOff | null) => void; onDeleteTimeOff: (entry: TimeOff) => void
}

const SLOT_LENGTHS = [15, 30, 45, 60, 90, 120]

function useSaving() {
  const [busy, setBusy] = useState(false)
  return { busy, run: (work: () => Promise<void>) => { setBusy(true); void work().catch(() => undefined).finally(() => setBusy(false)) } }
}

/** Keyed on what was loaded, so a save or a colleague's change starts it from the server's values. */
function HoursPanel({ hours, outside, onSave }: { hours: CenterDay[]; outside: number; onSave: Props['onSaveHours'] }) {
  const { t } = useTranslation()
  const format = useCenterFormat()
  const [days, setDays] = useState(hours)
  const { busy, run } = useSaving()
  const change = (weekday: number, part: Partial<CenterDay>) => setDays(days.map((day) => (day.weekday === weekday ? { ...day, ...part } : day)))
  const wrong = days.some((day) => day.isOpen && day.opensAt >= day.closesAt)
  return (
    <Panel title={t('calendar.hoursTitle')} description={t('calendar.hoursDetail')}>
      <div className="grid max-w-2xl gap-2">
        {days.map((day) => (
          <fieldset key={day.weekday} className="grid grid-cols-[6rem_minmax(0,1fr)_minmax(0,1fr)] items-end gap-3">
            <legend className="sr-only">{format.weekdays[day.weekday - 1]}</legend>
            <label className="flex min-h-11 items-center gap-2 font-semibold">
              <input type="checkbox" className="size-4 accent-lagoon" checked={day.isOpen} onChange={(event) => change(day.weekday, { isOpen: event.target.checked })} />
              {format.weekdays[day.weekday - 1]}
            </label>
            <TextField label={t('calendar.opens')} labelHidden={day.weekday !== 1} type="time" value={day.opensAt} disabled={!day.isOpen} onChange={(event) => change(day.weekday, { opensAt: event.target.value })} />
            <TextField label={t('calendar.closes')} labelHidden={day.weekday !== 1} type="time" value={day.closesAt} disabled={!day.isOpen} onChange={(event) => change(day.weekday, { closesAt: event.target.value })} />
          </fieldset>
        ))}
      </div>
      {wrong && <Notice tone="caution" className="mt-3">{t('calendar.hoursWrong')}</Notice>}
      {outside > 0 && <Notice tone="caution" className="mt-3">{t('calendar.outsideHours', { count: outside })}</Notice>}
      <div className="mt-4"><Button busy={busy} busyLabel={t('common.working')} disabled={wrong} onClick={() => run(() => onSave(days))}>{t('calendar.saveHours')}</Button></div>
    </Panel>
  )
}

function RulesPanel({ settings, onSave }: { settings: CenterSettings; onSave: Props['onSaveSettings'] }) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(settings)
  const { busy, run } = useSaving()
  const number = (key: keyof CenterSettings, label: string, min: number, max: number, hint?: string) => (
    <TextField label={label} hint={hint} type="number" min={min} max={max} value={String(draft[key])} onChange={(event) => setDraft({ ...draft, [key]: event.target.valueAsNumber })} />
  )
  const wrong = !draft.centerName.trim() || Object.values(draft).some((value) => typeof value === 'number' && Number.isNaN(value))
  return (
    <Panel title={t('calendar.rulesTitle')} description={t('calendar.rulesDetail')}>
      <div className="grid gap-3 tablet:grid-cols-2">
        <TextField label={t('calendar.centerName')} value={draft.centerName} maxLength={120} onChange={(event) => setDraft({ ...draft, centerName: event.target.value })} />
        <SelectField label={t('calendar.slotLength')} value={String(draft.slotMinutes)} onChange={(value) => setDraft({ ...draft, slotMinutes: Number(value) })}
          options={[...new Set([...SLOT_LENGTHS, draft.slotMinutes])].sort((a, b) => a - b).map((value) => ({ value: String(value), label: t('calendar.minutes', { count: value }) }))} />
        <TextArea className="tablet:col-span-2" rows={2} label={t('booking.location')} hint={t('calendar.locationHint')} value={draft.location} maxLength={300} onChange={(event) => setDraft({ ...draft, location: event.target.value })} />
        {number('slotCapacity', t('calendar.capacity'), 1, 100, t('calendar.capacityHint'))}
        {number('maxActiveBookings', t('calendar.maxActive'), 1, 50)}
        {number('minimumNoticeHours', t('calendar.notice'), 0, 336)}
        {number('bookingHorizonDays', t('calendar.horizon'), 1, 365)}
        {number('cancelCutoffHours', t('calendar.cancelCutoff'), 0, 336)}
        {number('rescheduleCutoffHours', t('calendar.rescheduleCutoff'), 0, 336)}
        {number('maxSelfReschedules', t('calendar.maxReschedules'), 0, 10)}
      </div>
      <div className="mt-4"><Button busy={busy} busyLabel={t('common.working')} disabled={wrong} onClick={() => run(() => onSave(draft))}>{t('calendar.saveRules')}</Button></div>
    </Panel>
  )
}

function HolidaysPanel({ holidays, onEdit, onDelete }: { holidays: Holiday[]; onEdit: Props['onEditHoliday']; onDelete: Props['onDeleteHoliday'] }) {
  const { t } = useTranslation()
  const format = useCenterFormat()
  const columns: ReadonlyArray<Column<Holiday>> = [
    { key: 'name', header: t('calendar.holidayName'), cell: (row) => <span className="font-semibold">{row.name}</span> },
    { key: 'kind', header: t('calendar.kind'), cell: (row) => <StatusPill tone="neutral">{t(`calendar.kinds.${row.kind}`)}</StatusPill> },
    { key: 'dates', header: t('calendar.dates'), cell: (row) => <span className="whitespace-nowrap">{row.startsOn === row.endsOn ? format.calendarDay(row.startsOn) : `${format.calendarDay(row.startsOn)} – ${format.calendarDay(row.endsOn)}`}</span> },
    { key: 'actions', header: t('calendar.actions'), align: 'end', cell: (row) => (
      <span className="inline-flex gap-1">
        <IconButton label={t('calendar.editNamed', { name: row.name })} onClick={() => onEdit(row)}><PencilSimpleIcon aria-hidden /></IconButton>
        <IconButton label={t('calendar.deleteNamed', { name: row.name })} onClick={() => onDelete(row)}><TrashIcon aria-hidden /></IconButton>
      </span>
    ) },
  ]
  return (
    <Panel flush title={t('calendar.holidaysTitle')} description={t('calendar.holidaysDetail')} action={<Button size="sm" leading={<PlusIcon aria-hidden />} onClick={() => onEdit(null)}>{t('calendar.addHoliday')}</Button>}>
      <DataTable caption={t('calendar.holidaysTitle')} columns={columns} rows={holidays} rowKey={(row) => row.id} empty={<div className="p-5"><EmptyState title={t('calendar.noHolidays')} detail={t('calendar.noHolidaysDetail')} /></div>} />
    </Panel>
  )
}

function ClosuresPanel({ closures, onEdit, onDelete }: { closures: Closure[]; onEdit: Props['onEditClosure']; onDelete: Props['onDeleteClosure'] }) {
  const { t } = useTranslation()
  const format = useCenterFormat()
  const when = (row: Closure) => (row.allDay ? format.day(row.startsAt) : `${format.day(row.startsAt)}, ${format.range(row.startsAt, row.endsAt)}`)
  const columns: ReadonlyArray<Column<Closure>> = [
    { key: 'when', header: t('scheduler.when'), cell: (row) => <span className="font-semibold">{when(row)}</span> },
    { key: 'reason', header: t('booking.reason'), cell: (row) => row.reason },
    { key: 'actions', header: t('calendar.actions'), align: 'end', cell: (row) => (
      <span className="inline-flex gap-1">
        <IconButton label={t('calendar.editNamed', { name: when(row) })} onClick={() => onEdit(row)}><PencilSimpleIcon aria-hidden /></IconButton>
        <IconButton label={t('calendar.deleteNamed', { name: when(row) })} onClick={() => onDelete(row)}><TrashIcon aria-hidden /></IconButton>
      </span>
    ) },
  ]
  return (
    <Panel flush title={t('calendar.closuresTitle')} description={t('calendar.closuresDetail')} action={<Button size="sm" leading={<PlusIcon aria-hidden />} onClick={() => onEdit(null)}>{t('calendar.addClosure')}</Button>}>
      <DataTable caption={t('calendar.closuresTitle')} columns={columns} rows={closures} rowKey={(row) => row.id} empty={<div className="p-5"><EmptyState title={t('calendar.noClosures')} detail={t('calendar.noClosuresDetail')} /></div>} />
    </Panel>
  )
}

function TimeOffPanel({ entries, onEdit, onDelete }: { entries: TimeOff[]; onEdit: Props['onEditTimeOff']; onDelete: Props['onDeleteTimeOff'] }) {
  const { t } = useTranslation()
  const format = useCenterFormat()
  const when = (row: TimeOff) => {
    const [from, to] = [format.day(row.startsAt), format.day(row.endsAt)]
    return from === to ? `${from}, ${format.range(row.startsAt, row.endsAt)}` : `${from}, ${format.time(row.startsAt)} – ${to}, ${format.time(row.endsAt)}`
  }
  const columns: ReadonlyArray<Column<TimeOff>> = [
    { key: 'therapist', header: t('booking.therapist'), cell: (row) => <PersonName name={row.therapist} photo={row.therapistPhoto} className="font-semibold" /> },
    { key: 'when', header: t('scheduler.when'), cell: (row) => when(row) },
    { key: 'reason', header: t('booking.reason'), cell: (row) => row.reason },
    { key: 'actions', header: t('calendar.actions'), align: 'end', cell: (row) => (
      <span className="inline-flex gap-1">
        <IconButton label={t('calendar.editNamed', { name: `${row.therapist}, ${when(row)}` })} onClick={() => onEdit(row)}><PencilSimpleIcon aria-hidden /></IconButton>
        <IconButton label={t('calendar.deleteNamed', { name: `${row.therapist}, ${when(row)}` })} onClick={() => onDelete(row)}><TrashIcon aria-hidden /></IconButton>
      </span>
    ) },
  ]
  return (
    <Panel flush title={t('calendar.timeOffTitle')} description={t('calendar.timeOffDetail')} action={<Button size="sm" leading={<PlusIcon aria-hidden />} onClick={() => onEdit(null)}>{t('calendar.addTimeOff')}</Button>}>
      <DataTable caption={t('calendar.timeOffTitle')} columns={columns} rows={entries} rowKey={(row) => row.id} empty={<div className="p-5"><EmptyState title={t('calendar.noTimeOff')} detail={t('calendar.noTimeOffDetail')} /></div>} />
    </Panel>
  )
}

export function CalendarView({ load, tab, onTab, outsideHours, onSaveHours, onSaveSettings, onEditHoliday, onDeleteHoliday, onEditClosure, onDeleteClosure, onEditTimeOff, onDeleteTimeOff }: Props) {
  const { t } = useTranslation()
  return (
    <>
      <PageHeader title={t('calendar.title')} description={t('calendar.detail')} />
      <Tabs className="mb-4" label={t('calendar.sections')} value={tab} onChange={(value) => onTab(value as CalendarTab)}
        tabs={[{ value: 'hours', label: t('calendar.hoursTab') }, { value: 'holidays', label: t('calendar.holidaysTab') }, { value: 'closures', label: t('calendar.closuresTab') }, { value: 'timeoff', label: t('calendar.timeOffTab') }]} />
      <Loadable load={load} skeleton={<SkeletonLines />}>
        {({ settings, hours, holidays, closures, timeOff }) => (
          <div className="grid gap-5">
            {tab === 'hours' && <HoursPanel key={JSON.stringify(hours)} hours={hours} outside={outsideHours} onSave={onSaveHours} />}
            {tab === 'hours' && <RulesPanel key={JSON.stringify(settings)} settings={settings} onSave={onSaveSettings} />}
            {tab === 'holidays' && <HolidaysPanel holidays={holidays} onEdit={onEditHoliday} onDelete={onDeleteHoliday} />}
            {tab === 'closures' && <ClosuresPanel closures={closures} onEdit={onEditClosure} onDelete={onDeleteClosure} />}
            {tab === 'timeoff' && <TimeOffPanel entries={timeOff} onEdit={onEditTimeOff} onDelete={onDeleteTimeOff} />}
          </div>
        )}
      </Loadable>
    </>
  )
}
