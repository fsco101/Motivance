import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ButtonLink } from '@/components/Button'
import { PageHeader, Panel } from '@/components/Display'
import { toast } from '@/components/Toast'
import { addDays, bookingFailureKey, CENTER_ZONE, isStale, todayAt } from '@/data/booking'
import { supabase } from '@/data/client'
import {
  assignTherapist, bulkReject, cancelBooking, confirmBooking, loadDetail, loadRequests, loadStaffAvailability, loadTherapists, NO_FILTERS, PAGE_SIZE, rejectBooking, rescheduleBooking,
  type RequestFilters, type RequestRow, type RequestSort,
} from '@/data/scheduler'
import { asLoad } from '@/features/shared'
import '@/locales/booking'
import { BulkRejectDialog, RequestDialog, type RequestActionKind, type RequestActions } from './RequestDialogs'
import { RequestsView } from './RequestsView'

/** Where a Scheduler lands. The dashboard takes this place once there are counts to show. */
export function SchedulerHomePage() {
  const { t } = useTranslation()
  return (
    <>
      <PageHeader title={t('scheduler.title')} description={t('scheduler.scope')} />
      <Panel><ButtonLink to="/scheduler/requests">{t('scheduler.requestsTitle')}</ButtonLink></Panel>
    </>
  )
}

export function SchedulerRequestsPage() {
  const { t } = useTranslation()
  const client = useQueryClient()
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

  /** Whatever happens, the list reloads, so a Scheduler never acts on what another person has already changed. */
  const act = async <T,>(work: () => Promise<T>, done: string | ((result: T) => string)) => {
    try {
      const result = await work()
      toast.show(typeof done === 'string' ? done : done(result))
    } catch (failure) {
      toast.show(t(bookingFailureKey(failure)), 'error')
      // A busy therapist can be swapped in the dialog. A booking someone else has changed cannot, so it closes to show what happened.
      if (isStale(failure)) { setAction(null); setBulk(false) }
      await client.invalidateQueries({ queryKey: ['scheduler'] })
      throw failure
    }
    await client.invalidateQueries({ queryKey: ['scheduler'] })
  }
  const actions: RequestActions = {
    therapists: (booking, startsAt) => loadTherapists(supabase(), booking, startsAt),
    availability: (month) => loadStaffAvailability(supabase(), month),
    confirm: (row, therapist) => act(() => confirmBooking(supabase(), row.id, therapist), t('scheduler.confirmed')),
    assign: (row, therapist) => act(() => assignTherapist(supabase(), row.id, therapist), t('scheduler.assigned')),
    reject: (row, reason) => act(() => rejectBooking(supabase(), row.id, reason), t('scheduler.rejected')),
    cancel: (row, reason) => act(() => cancelBooking(supabase(), row.id, reason), t('booking.cancelled')),
    reschedule: (row, startsAt, therapist) => act(() => rescheduleBooking(supabase(), row.id, startsAt, therapist), t('scheduler.rescheduled')),
    bulkReject: (reason) => act(async () => { const count = await bulkReject(supabase(), selection, reason); setChecked([]); return count }, (count) => t('scheduler.bulkDone', { count })),
  }
  return (
    <>
      <RequestsView load={asLoad(requests)} therapists={therapists.data ?? []} filters={filters} onFilters={changeFilters} sort={sort} onSort={(next) => { setSort(next); reset() }}
        page={page} onPage={(next) => { setPage(next); setChecked([]) }} selected={selected} onSelect={(row) => setSelectedId(row?.id ?? null)} detail={selectedId ? asLoad(detail) : null}
        checked={selection} onChecked={setChecked} onAct={(kind, row) => setAction({ kind, row })} onBulk={() => setBulk(true)}
        onOutdated={() => changeFilters({ ...NO_FILTERS, search: filters.search, status: 'pending', to: addDays(today, -1) })} />
      {action && <RequestDialog kind={action.kind} row={action.row} actions={actions} onClose={() => setAction(null)} />}
      {bulk && <BulkRejectDialog count={selection.length} actions={actions} onClose={() => setBulk(false)} />}
    </>
  )
}
