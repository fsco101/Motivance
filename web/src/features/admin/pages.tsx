import type { SupabaseClient } from '@supabase/supabase-js'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSignedIn } from '@/auth/AuthProvider'
import { toast } from '@/components/Toast'
import { clearPhoto, describeEvent, loadAccounts, loadActivity, loadAdminCatalogue, loadLinks, loadSummary, publishExercise, setAccount, setExercise, setLink, setRole } from '@/data/admin'
import { supabase } from '@/data/client'
import type { Database } from '@/data/database.types'
import { asLoad, ready, type Load } from '@/features/shared'
import { AccountsView } from './AccountsView'
import { ActivityView } from './ActivityView'
import { AdminOverviewView } from './AdminOverviewView'
import { CatalogueView } from './CatalogueView'
import { LinksView } from './LinksView'

const BASE = '/admin'
const RECENT_EVENTS = 5

type Query = { isError: boolean; refetch: () => unknown }

/** As on Android, a failed read clears what is on screen: account lists are too sensitive to leave up once they may be out of date. */
function adminLoad<T>(queries: readonly Query[], value: T | undefined): Load<T> {
  const failed = queries.filter((query) => query.isError)
  if (failed.length > 0) return { status: 'error', retry: () => failed.forEach((query) => void query.refetch()) }
  return value === undefined ? { status: 'loading' } : ready(value)
}

type Change = { saved: string; change: (db: SupabaseClient<Database>) => Promise<unknown> }

/** Changes run one at a time, in order, so a second one made while the first is saving is never lost. Every list then reloads. */
function useAdminChange() {
  const { t } = useTranslation()
  const client = useQueryClient()
  const mutation = useMutation({
    scope: { id: 'admin-change' },
    onMutate: () => toast.show(t('toast.saving'), 'pending'),
    mutationFn: ({ change }: Change) => change(supabase()),
    onSuccess: async (_, { saved }) => {
      await client.invalidateQueries()
      toast.show(t(saved))
    },
    onError: async () => {
      toast.show(t('admin.failed'), 'error')
      await client.invalidateQueries({ queryKey: ['admin'] })
    },
  })
  return (saved: string, change: Change['change']) => mutation.mutate({ saved, change })
}

function useAccounts(search: string) {
  return useInfiniteQuery({
    queryKey: ['admin', 'accounts', search],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => loadAccounts(supabase(), search, pageParam),
    getNextPageParam: (page) => page.next,
  })
}

function useActivity() {
  return useInfiniteQuery({
    queryKey: ['admin', 'activity'],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => loadActivity(supabase(), pageParam),
    getNextPageParam: (page) => page.next,
  })
}

export function AdminOverviewPage() {
  const { t } = useTranslation()
  const summary = useQuery({ queryKey: ['admin', 'summary'], queryFn: () => loadSummary(supabase()) })
  const activity = useActivity()
  const recent = activity.data?.pages.flatMap((page) => page.events).slice(0, RECENT_EVENTS).map((row) => describeEvent(row, t))
  return <AdminOverviewView base={BASE} load={adminLoad([summary, activity], summary.data && recent ? { summary: summary.data, recent } : undefined)} />
}

export function AccountsPage() {
  const { userId } = useSignedIn()
  const [search, setSearch] = useState('')
  const accounts = useAccounts(search)
  const change = useAdminChange()
  const value = accounts.data && { accounts: accounts.data.pages.flatMap((page) => page.accounts), hasMore: accounts.hasNextPage, loadingMore: accounts.isFetchingNextPage }
  return (
    <AccountsView self={userId} load={adminLoad([accounts], value)} actions={{
      onSearch: setSearch,
      onMore: () => void accounts.fetchNextPage(),
      onActive: (id, active) => change('admin.savedAccount', (db) => setAccount(db, id, active)),
      onRole: (id, role, granted) => change('admin.savedRole', (db) => setRole(db, id, role, granted)),
      onClearPhoto: (id) => change('admin.savedPhoto', (db) => clearPhoto(db, id)),
    }} />
  )
}

export function LinksPage() {
  const links = useQuery({ queryKey: ['admin', 'links'], queryFn: () => loadLinks(supabase()) })
  const accounts = useAccounts('')
  const change = useAdminChange()
  const value = links.data && accounts.data ? { links: links.data, accounts: accounts.data.pages.flatMap((page) => page.accounts), hasMore: accounts.hasNextPage } : undefined
  return <LinksView load={adminLoad([links, accounts], value)} onMore={() => void accounts.fetchNextPage()} onLink={(therapist, patient, active) => change('admin.savedLink', (db) => setLink(db, therapist, patient, active))} />
}

export function CataloguePage() {
  const exercises = useQuery({ queryKey: ['admin', 'catalogue'], queryFn: () => loadAdminCatalogue(supabase()) })
  const change = useAdminChange()
  return (
    // The catalogue holds nothing sensitive, so a failed refresh keeps it on screen, with any edit in progress.
    <CatalogueView load={asLoad(exercises)} actions={{
      onActive: (id, active) => change('admin.savedExercise', (db) => setExercise(db, id, active)),
      onPublish: (id, name, english, filipino) => change('admin.savedPublish', (db) => publishExercise(db, id, name, english, filipino)),
    }} />
  )
}

export function ActivityPage() {
  const { t } = useTranslation()
  const activity = useActivity()
  const value = activity.data && { events: activity.data.pages.flatMap((page) => page.events).map((row) => describeEvent(row, t)), hasMore: activity.hasNextPage, loadingMore: activity.isFetchingNextPage }
  return <ActivityView load={adminLoad([activity], value)} onMore={() => void activity.fetchNextPage()} />
}
