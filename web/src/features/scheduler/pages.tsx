import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ButtonLink } from '@/components/Button'
import { ConfirmDialog } from '@/components/Dialog'
import { PageHeader, Panel } from '@/components/Display'
import { toast } from '@/components/Toast'
import { addDays, bookingFailureKey, CENTER_ZONE, isStale, markAttendance, todayAt, type Attendance } from '@/data/booking'
import { useCenterFormat } from '@/features/booking/format'
import { deleteClosure, deleteHoliday, deleteTimeOff, loadCalendar, loadImpact, saveClosure, saveHoliday, saveHours, saveSettings, saveTimeOff, type CenterDay, type CenterSettings, type Closure, type Holiday, type TimeOff } from '@/data/calendar'
import { supabase } from '@/data/client'
import {
  assignTherapist, bulkReject, cancelBooking, cancelSeries, confirmBooking, createSeries, loadAllConfirmed, loadCenterName, loadConfirmed, loadDetail, loadPatientChoices, loadRequests, loadStaffAvailability, loadTherapists, logExport,
  NO_FILTERS, NO_SCHEDULE_FILTERS, PAGE_SIZE, previewSeries, rejectBooking, rescheduleBooking, searchPatients, type RequestFilters, type RequestRow, type RequestSort, type ScheduleFilters,
} from '@/data/scheduler'
import { asLoad } from '@/features/shared'
import '@/locales/booking'
import { ClosureDialog, HolidayDialog, TimeOffDialog, type CalendarActions } from './CalendarDialogs'
import { CalendarView, type CalendarTab } from './CalendarView'
import { ConfirmedScheduleView, type ExportFormat } from './ConfirmedScheduleView'
import { BulkRejectDialog, RequestDialog, type RequestActionKind, type RequestActions } from './RequestDialogs'
import { RequestsView } from './RequestsView'
import { WeeklySeriesDialog, type SeriesActions } from './WeeklySeriesDialog'

/** Where a Scheduler lands. The dashboard takes this place once there are counts to show. */
export function SchedulerHomePage() {
  const { t } = useTranslation()
  return (
    <>
      <PageHeader title={t('scheduler.title')} description={t('scheduler.scope')} />
      <Panel><div className="flex flex-wrap gap-2"><ButtonLink to="/scheduler/requests">{t('scheduler.requestsTitle')}</ButtonLink><ButtonLink variant="secondary" to="/scheduler/calendar">{t('calendar.title')}</ButtonLink></div></Panel>
    </>
  )
}

/** Whatever happens, what is on screen reloads, so a Scheduler never acts on what another person has already changed. */
function useSchedulerAction(onStale: () => void = () => undefined) {
  const { t } = useTranslation()
  const client = useQueryClient()
  return async <T,>(work: () => Promise<T>, done: string | ((result: T) => string)) => {
    let result: T
    try {
      result = await work()
      toast.show(typeof done === 'string' ? done : done(result))
    } catch (failure) {
      toast.show(t(bookingFailureKey(failure)), 'error')
      if (isStale(failure)) onStale()
      await client.invalidateQueries({ queryKey: ['scheduler'] })
      throw failure
    }
    await client.invalidateQueries({ queryKey: ['scheduler'] })
    return result
  }
}

export function SchedulerRequestsPage() {
  const { t } = useTranslation()
  const [today] = useState(() => todayAt(CENTER_ZONE))
  const [filters, setFilters] = useState(NO_FILTERS)
  const [sort, setSort] = useState<RequestSort>({ key: 'created_at', direction: 'desc' })
  const [page, setPage] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [checked, setChecked] = useState<readonly string[]>([])
  const [action, setAction] = useState<{ kind: RequestActionKind; row: RequestRow } | null>(null)
  const [bulk, setBulk] = useState(false)

  const requests = useQuery({ queryKey: ['scheduler', 'requests', filters, sort, page], queryFn: () => loadRequests(supabase(), filters, sort, page), placeholderData: keepPreviousData })
  const therapists = useQuery({ queryKey: ['scheduler', 'therapists'], queryFn: () => loadTherapists(supabase()) })
  const detail = useQuery({ queryKey: ['scheduler', 'detail', selectedId], enabled: Boolean(selectedId), queryFn: () => loadDetail(supabase(), selectedId!) })
  const rows = requests.data?.rows ?? []
  const selected = rows.find((row) => row.id === selectedId) ?? null
  // The list can change under a selection, so only rows still pending count towards it.
  const selection = rows.filter((row) => row.status === 'pending' && checked.includes(row.id)).map((row) => row.id)
  // Deciding the only row on the last page leaves that page empty, so step back to one with rows.
  const lastPage = Math.max(Math.ceil((requests.data?.total ?? 0) / PAGE_SIZE) - 1, 0)
  if (requests.data && page > lastPage) setPage(lastPage)

  // A filter or page shows different rows, so anything chosen from the old ones must not carry over.
  const reset = () => { setPage(0); setChecked([]) }
  const changeFilters = (next: RequestFilters) => { setFilters(next); reset() }

  // A busy therapist can be swapped in the dialog. A booking someone else has changed cannot, so it closes to show what happened.
  const act = useSchedulerAction(() => { setAction(null); setBulk(false) })
  const actAndForget = async <T,>(work: () => Promise<T>, done: string | ((result: T) => string)) => { await act(work, done) }
  const actions: RequestActions = {
    therapists: (booking, startsAt) => loadTherapists(supabase(), booking, startsAt),
    availability: (month) => loadStaffAvailability(supabase(), month),
    confirm: (row, therapist) => actAndForget(() => confirmBooking(supabase(), row.id, therapist), t('scheduler.confirmed')),
    assign: (row, therapist) => actAndForget(() => assignTherapist(supabase(), row.id, therapist), t('scheduler.assigned')),
    reject: (row, reason) => actAndForget(() => rejectBooking(supabase(), row.id, reason), t('scheduler.rejected')),
    cancel: (row, reason) => actAndForget(() => cancelBooking(supabase(), row.id, reason), t('booking.cancelled')),
    reschedule: (row, startsAt, therapist) => actAndForget(() => rescheduleBooking(supabase(), row.id, startsAt, therapist), t('scheduler.rescheduled')),
    bulkReject: (reason) => actAndForget(async () => { const count = await bulkReject(supabase(), selection, reason); setChecked([]); return count }, (count) => t('scheduler.bulkDone', { count })),
    cancelSeries: (row, reason) => actAndForget(() => cancelSeries(supabase(), row.seriesId!, reason), (count) => t('scheduler.seriesCancelled', { count })),
  }
  return (
    <>
      <RequestsView load={asLoad(requests)} therapists={therapists.data ?? []} filters={filters} onFilters={changeFilters} sort={sort} onSort={(next) => { setSort(next); reset() }}
        page={page} onPage={(next) => { setPage(next); setChecked([]) }} selected={selected} onSelect={(row) => setSelectedId(row?.id ?? null)} detail={selectedId ? asLoad(detail) : null}
        checked={selection} onChecked={setChecked} onAct={(kind, row) => setAction({ kind, row })} onBulk={() => setBulk(true)}
        onOutdated={() => changeFilters({ ...NO_FILTERS, search: filters.search, status: 'pending', to: addDays(today, -1) })} />
      {action && <RequestDialog kind={action.kind} row={action.row} remaining={detail.data?.seriesRemaining} actions={actions} onClose={() => setAction(null)} />}
      {bulk && <BulkRejectDialog count={selection.length} actions={actions} onClose={() => setBulk(false)} />}
    </>
  )
}

export function SchedulerSchedulePage() {
  const { t } = useTranslation()
  const format = useCenterFormat()
  const [today] = useState(() => todayAt(CENTER_ZONE))
  const [filters, setFilters] = useState(NO_SCHEDULE_FILTERS)
  const [sort, setSort] = useState<RequestSort>({ key: 'starts_at', direction: 'asc' })
  const [page, setPage] = useState(0)
  const [exporting, setExporting] = useState<ExportFormat | null>(null)
  const [marking, setMarking] = useState(false)
  const [series, setSeries] = useState(false)
  const act = useSchedulerAction()
  const sessions = useQuery({ queryKey: ['scheduler', 'schedule', filters, sort, page], queryFn: () => loadConfirmed(supabase(), filters, sort, page), placeholderData: keepPreviousData })
  const therapists = useQuery({ queryKey: ['scheduler', 'therapists'], queryFn: () => loadTherapists(supabase()) })
  const patients = useQuery({ queryKey: ['scheduler', 'patients'], queryFn: () => loadPatientChoices(supabase()) })

  const range = () => {
    const date = (value: string) => format.calendarDay(value)
    if (filters.from && filters.to) return t('scheduler.exportBetween', { from: date(filters.from), to: date(filters.to) })
    if (filters.from) return t('scheduler.exportFrom', { from: date(filters.from) })
    if (filters.to) return t('scheduler.exportUntil', { to: date(filters.to) })
    return t('scheduler.exportAllDates')
  }
  const mark = async (row: RequestRow, attendance: Attendance) => {
    setMarking(true)
    // A refusal has already been shown, and the table has been read again.
    await act(() => markAttendance(supabase(), row.id, attendance), t('booking.attendanceSaved')).catch(() => undefined)
    setMarking(false)
  }
  const save = async (kind: ExportFormat) => {
    setExporting(kind)
    try {
      const [rows, center] = await Promise.all([loadAllConfirmed(supabase(), filters, sort), loadCenterName(supabase())])
      // Recorded before the file exists: a file that fails to build leaves one line too many, which is better than a file nobody recorded.
      await logExport(supabase(), kind, rows.length)
      const { saveXlsx, savePdf } = await import('./exportSchedule')
      const now = new Date().toISOString()
      // The PDF's built-in font has no narrow space, which is what browsers put before AM and PM.
      const plain = (value: string) => value.replace(/\s+/g, ' ')
      const document = {
        center, title: t('scheduler.scheduleTitle'), range: range(), generated: t('scheduler.exportGenerated', { when: plain(`${format.day(now)}, ${format.time(now)}`) }), fileName: `motivance-schedule-${today}`,
        columns: { date: t('scheduler.exportDate'), time: t('scheduler.exportTime'), patient: t('scheduler.patient'), therapist: t('booking.therapist'), status: t('scheduler.status'), attendance: t('booking.attendanceTitle'), reference: t('booking.reference') },
        lines: rows.map((row) => ({ date: format.day(row.startsAt), time: plain(format.range(row.startsAt, row.endsAt)), patient: row.patient, therapist: row.therapist ?? '', status: t(`booking.status.${row.status}`), attendance: row.attendance ? t(`booking.attendance.${row.attendance}`) : '', reference: row.reference })),
      }
      await (kind === 'xlsx' ? saveXlsx(document) : savePdf(document))
      toast.show(t('scheduler.exported', { count: rows.length }))
    } catch {
      toast.show(t('scheduler.exportFailed'), 'error')
    } finally {
      setExporting(null)
    }
  }
  const seriesActions: SeriesActions = {
    patients: (search) => searchPatients(supabase(), search),
    availability: (month) => loadStaffAvailability(supabase(), month),
    preview: async (draft) => {
      try {
        return await previewSeries(supabase(), draft)
      } catch (failure) {
        toast.show(t(bookingFailureKey(failure)), 'error')
        throw failure
      }
    },
    create: async (request, draft) => { await act(() => createSeries(supabase(), request, draft), (made) => t('scheduler.seriesBooked', { booked: made.booked, weeks: made.weeks })) },
  }
  const lastPage = Math.max(Math.ceil((sessions.data?.total ?? 0) / PAGE_SIZE) - 1, 0)
  if (sessions.data && page > lastPage) setPage(lastPage)
  return (
    <>
    <ConfirmedScheduleView load={asLoad(sessions)} therapists={therapists.data ?? []} patients={patients.data ?? []} filters={filters} onFilters={(next: ScheduleFilters) => { setFilters(next); setPage(0) }}
      sort={sort} onSort={(next) => { setSort(next); setPage(0) }} page={page} onPage={setPage} exporting={exporting} onExport={(kind) => void save(kind)} onMark={(row, attendance) => void mark(row, attendance)} marking={marking} onSeries={() => setSeries(true)} />
    {series && <WeeklySeriesDialog therapists={therapists.data ?? []} actions={seriesActions} onClose={() => setSeries(false)} />}
    </>
  )
}

type Deleting = { kind: 'holiday'; item: Holiday; name: string } | { kind: 'closure'; item: Closure; name: string } | { kind: 'timeoff'; item: TimeOff; name: string }

export function SchedulerCalendarPage() {
  const { t } = useTranslation()
  const [today] = useState(() => todayAt(CENTER_ZONE))
  const [tab, setTab] = useState<CalendarTab>('hours')
  const [holiday, setHoliday] = useState<Holiday | null | undefined>()
  const [closure, setClosure] = useState<Closure | null | undefined>()
  const [timeOff, setTimeOff] = useState<TimeOff | null | undefined>()
  const [deleting, setDeleting] = useState<Deleting | null>(null)
  const [outsideHours, setOutsideHours] = useState(0)
  const act = useSchedulerAction()
  const calendar = useQuery({ queryKey: ['scheduler', 'calendar', today], queryFn: () => loadCalendar(supabase(), today) })
  const therapists = useQuery({ queryKey: ['scheduler', 'therapists'], queryFn: () => loadTherapists(supabase()) })
  const actions: CalendarActions = {
    impact: async ({ startsAt, endsAt }, therapist) => {
      try {
        return await loadImpact(supabase(), startsAt, endsAt, therapist)
      } catch (failure) {
        toast.show(t(bookingFailureKey(failure)), 'error')
        throw failure
      }
    },
    availability: (month) => loadStaffAvailability(supabase(), month),
    therapists: (booking, startsAt) => loadTherapists(supabase(), booking, startsAt),
    saveHoliday: (draft, resolutions) => act(() => saveHoliday(supabase(), draft, resolutions), t('calendar.holidaySaved')),
    saveClosure: (draft, resolutions) => act(() => saveClosure(supabase(), draft, resolutions), t('calendar.closureSaved')),
    saveTimeOff: (draft, resolutions) => act(() => saveTimeOff(supabase(), draft, resolutions), t('calendar.timeOffSaved')),
  }
  const remove = (target: Deleting) => {
    if (target.kind === 'holiday') return act(() => deleteHoliday(supabase(), target.item.id), t('calendar.holidayDeleted'))
    if (target.kind === 'closure') return act(() => deleteClosure(supabase(), target.item.id), t('calendar.closureDeleted'))
    return act(() => deleteTimeOff(supabase(), target.item.id), t('calendar.timeOffDeleted'))
  }
  const deleteTitle = { holiday: 'calendar.deleteHolidayTitle', closure: 'calendar.deleteClosureTitle', timeoff: 'calendar.deleteTimeOffTitle' }[deleting?.kind ?? 'closure']
  return (
    <>
      <CalendarView load={asLoad(calendar)} tab={tab} onTab={setTab} outsideHours={outsideHours}
        onSaveHours={async (hours: CenterDay[]) => setOutsideHours(await act(() => saveHours(supabase(), hours), t('calendar.hoursSaved')))}
        onSaveSettings={(settings: CenterSettings) => act(() => saveSettings(supabase(), settings), t('calendar.rulesSaved'))}
        onEditHoliday={setHoliday} onDeleteHoliday={(item) => setDeleting({ kind: 'holiday', item, name: item.name })}
        onEditClosure={setClosure} onDeleteClosure={(item) => setDeleting({ kind: 'closure', item, name: item.reason })}
        onEditTimeOff={setTimeOff} onDeleteTimeOff={(item) => setDeleting({ kind: 'timeoff', item, name: item.therapist })} />
      {holiday !== undefined && <HolidayDialog holiday={holiday} actions={actions} onClose={() => setHoliday(undefined)} />}
      {closure !== undefined && <ClosureDialog closure={closure} actions={actions} onClose={() => setClosure(undefined)} />}
      {timeOff !== undefined && <TimeOffDialog entry={timeOff} therapists={therapists.data ?? []} actions={actions} onClose={() => setTimeOff(undefined)} />}
      <ConfirmDialog open={Boolean(deleting)} onOpenChange={(open) => { if (!open) setDeleting(null) }} destructive title={t(deleteTitle)}
        message={t(deleting?.kind === 'timeoff' ? 'calendar.deleteTimeOffMessage' : 'calendar.deleteMessage', { name: deleting?.name ?? '' })} confirmLabel={t('calendar.delete')} cancelLabel={t('calendar.keep')}
        onConfirm={() => { if (deleting) void remove(deleting).catch(() => undefined); setDeleting(null) }} />
    </>
  )
}
