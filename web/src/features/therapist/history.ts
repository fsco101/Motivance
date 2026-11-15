import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/components/Toast'
import { supabase } from '@/data/client'
import { failureKey } from '@/data/errors'
import { activitySummary, loadActivity, loadHistory, type HistoryCursor } from '@/data/history'
import { ready, type Load } from '@/features/shared'
import type { ProgressFilters, ProgressResults } from './ProgressView'

/** One person's session history, shared by the therapist's and the patient's Progress pages. */
export function useProgressResults(patientId: string, filters: ProgressFilters) {
  const { t } = useTranslation()
  const history = useInfiniteQuery({
    queryKey: ['history', patientId, filters],
    enabled: Boolean(patientId),
    initialPageParam: null as HistoryCursor | null,
    queryFn: ({ pageParam }) => loadHistory(supabase(), {
      patientId, exerciseVersionId: filters.exerciseVersionId === 'all' ? undefined : filters.exerciseVersionId,
      side: filters.side === 'all' ? undefined : filters.side, from: filters.from || undefined, through: filters.through || undefined,
    }, pageParam),
    getNextPageParam: (page) => page.next,
  })
  // Sessions already on screen stay there if a later page or a refresh fails.
  const results: Load<ProgressResults> = history.data
    ? ready({ sessions: history.data.pages.flatMap((page) => page.sessions), more: history.hasNextPage, loadingMore: history.isFetchingNextPage })
    : history.isError ? { status: 'error', retry: () => void history.refetch() } : { status: 'loading' }
  const onMore = () => void history.fetchNextPage().then((page) => { if (page.isError) toast.show(t(failureKey(page.error)), 'error') })
  return { results, onMore }
}

/** One person's last four weeks. It fails quietly: the summary is a help, and the sessions must not wait on it. */
export function useActivity(patientId: string) {
  const query = useQuery({ queryKey: ['history', patientId, 'activity'], enabled: Boolean(patientId), queryFn: () => loadActivity(supabase(), patientId) })
  return useMemo(() => (query.data ? activitySummary(query.data) : null), [query.data])
}
