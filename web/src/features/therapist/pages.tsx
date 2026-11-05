import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { useSignedIn } from '@/auth/AuthProvider'
import { EmptyState, PageHeader } from '@/components/Display'
import { toast } from '@/components/Toast'
import { supabase } from '@/data/client'
import { failureKey } from '@/data/errors'
import { loadHistory, usable, type HistoricalSession, type HistoryCursor } from '@/data/history'
import { archiveCustomExercise, createCustomExercise, invitePatient, loadLatestSessions, loadPatientProfile, publishPrescription, revokePatientLink, type CustomExerciseDraft, type PrescriptionDraft } from '@/data/therapist'
import { loadCatalogue, loadOverview, loadPatients, loadPlans } from '@/data/workspace'
import { ready, useFormat, type Load } from '@/features/shared'
import { AssignmentEditorView } from './AssignmentEditorView'
import { ExercisesView } from './ExercisesView'
import { PatientRecordView, type PatientRecord, type PlanCard } from './PatientRecordView'
import { PatientsView } from './PatientsView'
import { NO_FILTERS, ProgressView, type ProgressChoices, type ProgressResults } from './ProgressView'
import { TherapistHomeView, type TherapistHome } from './TherapistHomeView'
import { latestMovement, latestSeries, nameOf, reachedBy, recentFirst, romPoints, summarisePatients } from './summaries'

const BASE = '/therapist'

function asLoad<T>(query: UseQueryResult<T>): Load<T> {
  if (query.data !== undefined) return ready(query.data)
  return query.isError ? { status: 'error', retry: () => void query.refetch() } : { status: 'loading' }
}

/** Everything the list pages share, read once, for this therapist's linked patients. */
function useWorkspace() {
  const { userId } = useSignedIn()
  return useQuery({
    queryKey: ['workspace', userId],
    queryFn: async () => {
      const db = supabase()
      const [overview, patients, plans, catalogue, sessions] = await Promise.all([loadOverview(db, userId), loadPatients(db, userId), loadPlans(db, userId), loadCatalogue(db, userId), loadLatestSessions(db, userId)])
      return { overview, patients, plans, catalogue, sessions }
    },
  })
}

function useRefresh() {
  const queries = useQueryClient()
  return () => queries.invalidateQueries()
}

export function TherapistHomePage() {
  const { email } = useSignedIn()
  const workspace = useWorkspace()
  const state = asLoad(workspace)
  const home = (): Load<TherapistHome> => {
    if (state.status !== 'ready') return state
    const { overview, patients, plans, catalogue, sessions } = state.data
    return ready({
      name: overview.displayName.split(' ')[0] || email.split('@')[0] || '',
      patients: patients.length, plans: plans.length, sessions: overview.sessions.length,
      latest: latestMovement(patients, sessions), recent: recentFirst(summarisePatients(patients, plans, catalogue, sessions)).slice(0, 3),
    })
  }
  return <TherapistHomeView load={home()} base={BASE} />
}

export function PatientsPage() {
  const { t } = useTranslation()
  const workspace = useWorkspace()
  const refresh = useRefresh()
  const state = asLoad(workspace)
  const load: Load<ReturnType<typeof summarisePatients>> = state.status === 'ready'
    ? ready(summarisePatients(state.data.patients, state.data.plans, state.data.catalogue, state.data.sessions)) : state
  const revoke = useMutation({
    mutationFn: (id: string) => revokePatientLink(supabase(), id),
    onSuccess: async () => { await refresh(); toast.show(t('toast.accessRevoked')) },
    onError: (failure) => toast.show(t(failureKey(failure)), 'error'),
  })
  return (
    <PatientsView load={load} base={BASE} onRevoke={(id) => revoke.mutate(id)}
      onInvite={async (email) => {
        const code = await invitePatient(supabase(), email)
        toast.show(t('toast.invitationCreated'))
        return code
      }} />
  )
}

function usePlanCards(patientId: string, sessions: readonly HistoricalSession[]) {
  const { t } = useTranslation()
  const { userId } = useSignedIn()
  const workspace = useWorkspace()
  return useMemo(() => {
    if (!workspace.data) return []
    const { plans, catalogue } = workspace.data
    return plans.filter((plan) => plan.patientId === patientId).map((plan): PlanCard => {
      const exercise = catalogue.find((item) => item.id === plan.exerciseId)
      const session = sessions.find((item) => item.prescription?.assignmentId === plan.assignmentId && item.measurements.some(usable))
      const measurement = session?.measurements.find(usable)
      const focus = plan.parameters.focus_joint
      return {
        id: plan.assignmentId, exercise: exercise?.name ?? t('progress.unknown'), custom: exercise?.custom, version: plan.version, side: plan.side === 'right' ? 'right' : 'left',
        low: plan.low, high: plan.high, repetitions: plan.repetitions, focus: typeof focus === 'string' ? t(`joints.${focus}`) : null, instructions: exercise?.instructions ?? '',
        reached: measurement ? reachedBy(measurement) : null, locked: plan.therapistId !== userId,
      }
    })
  }, [workspace.data, patientId, sessions, t, userId])
}

export function PatientRecordPage() {
  const { t } = useTranslation()
  const { id = '' } = useParams()
  const format = useFormat()
  const workspace = useWorkspace()
  const details = useQuery({
    queryKey: ['record', id],
    queryFn: async () => {
      const db = supabase()
      const [profile, history] = await Promise.all([loadPatientProfile(db, id), loadHistory(db, { patientId: id })])
      return { profile, sessions: history.sessions }
    },
  })
  const sessions = useMemo(() => details.data?.sessions ?? [], [details.data])
  const plans = usePlanCards(id, sessions)
  const patient = workspace.data?.patients.find((item) => item.id === id)
  if (workspace.data && !patient) return <EmptyState title={t('record.notFoundTitle')} detail={t('record.notFoundDetail')} />
  const shared = asLoad(details)
  const overall = asLoad(workspace)
  const series = latestSeries(sessions)
  const load: Load<PatientRecord> = overall.status === 'error' ? overall : shared.status !== 'ready' ? shared : !patient ? { status: 'loading' } : ready({
    id, name: patient.name || shared.data.profile?.fullName || id.slice(0, 8), photo: patient.photoUrl, username: shared.data.profile?.username,
    gender: shared.data.profile ? t(`genders.${shared.data.profile.gender}`, shared.data.profile.gender) : undefined, birthdate: shared.data.profile?.birthdate,
    contact: shared.data.profile?.contact, address: shared.data.profile?.address, plans,
    trend: series && {
      exercise: series.prescription.exerciseName, points: romPoints(series, format.short),
      detail: t('progress.seriesLine', { side: t(`common.${series.side}`, series.side), version: series.prescription.version, low: series.prescription.low, high: series.prescription.high }),
    },
  })
  return <PatientRecordView load={load} base={BASE} />
}

export function AssignExercisePage() {
  const { t } = useTranslation()
  const { id = '' } = useParams()
  const { userId } = useSignedIn()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const workspace = useWorkspace()
  const refresh = useRefresh()
  const editing = params.get('plan')
  const existing = workspace.data?.plans.find((plan) => plan.assignmentId === editing && plan.patientId === id && plan.therapistId === userId)
  // A new plan gets its own ID, so it can never replace one the patient already has.
  const [newAssignment] = useState(() => crypto.randomUUID())
  const request = useRef({ key: '', id: '' })
  const publish = useMutation({
    mutationFn: (draft: PrescriptionDraft) => {
      // The same contents keep the same ID, which makes a retry after a lost response safe.
      const key = JSON.stringify(draft)
      if (request.current.key !== key) request.current = { key, id: crypto.randomUUID() }
      return publishPrescription(supabase(), { ...draft, assignmentId: existing?.assignmentId ?? newAssignment, requestId: request.current.id, patientId: id })
    },
    onSuccess: async () => {
      await refresh()
      toast.show(t('toast.published'))
      void navigate(`${BASE}/patients/${id}`)
    },
    onError: (failure) => toast.show(t(failureKey(failure)), 'error'),
  })
  const state = asLoad(workspace)
  const patient = workspace.data?.patients.find((item) => item.id === id)
  if (workspace.data && !patient) return <EmptyState title={t('record.notFoundTitle')} detail={t('record.notFoundDetail')} />
  const load = state.status !== 'ready' ? state : !patient ? { status: 'loading' as const } : ready({ patient: { id, name: nameOf(patient), photo: patient.photoUrl }, catalogue: state.data.catalogue })
  return (
    <AssignmentEditorView key={existing?.versionId ?? 'new'} load={load} existing={existing} busy={publish.isPending} onPublish={(draft) => publish.mutate(draft)}
      onCreateExercise={async (draft) => {
        const version = await createCustomExercise(supabase(), draft)
        await refresh()
        toast.show(t('toast.exerciseCreated'))
        return version
      }} />
  )
}

export function ExercisesPage() {
  const { t } = useTranslation()
  const workspace = useWorkspace()
  const refresh = useRefresh()
  const state = asLoad(workspace)
  const remove = useMutation({
    mutationFn: (exerciseId: string) => archiveCustomExercise(supabase(), exerciseId),
    onSuccess: async () => { await refresh(); toast.show(t('toast.exerciseRemoved')) },
    onError: (failure) => toast.show(t(failureKey(failure)), 'error'),
  })
  return (
    <ExercisesView load={state.status === 'ready' ? ready(state.data.catalogue) : state} onRemove={(item) => remove.mutate(item.exerciseId)}
      onCreate={async (draft: CustomExerciseDraft) => {
        await createCustomExercise(supabase(), draft)
        await refresh()
        toast.show(t('toast.exerciseCreated'))
      }} />
  )
}

export function ProgressPage() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const workspace = useWorkspace()
  const state = asLoad(workspace)
  const patients = workspace.data?.patients ?? []
  const requested = params.get('patient')
  const patientId = patients.find((patient) => patient.id === requested)?.id ?? patients[0]?.id ?? ''
  // Filters belong to one patient: another patient starts clean, however they were reached.
  const [chosen, setChosen] = useState({ patientId, filters: NO_FILTERS })
  const filters = chosen.patientId === patientId ? chosen.filters : NO_FILTERS
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
  if (workspace.data && patients.length === 0) {
    return <><PageHeader title={t('nav.progress')} description={t('progress.description')} /><EmptyState title={t('progress.noPatientsTitle')} detail={t('progress.noPatientsDetail')} /></>
  }
  const exercises = (workspace.data?.plans ?? []).filter((plan) => plan.patientId === patientId).flatMap((plan) => {
    const item = workspace.data?.catalogue.find((entry) => entry.id === plan.exerciseId)
    return item ? [{ id: item.id, name: item.name }] : []
  })
  const choices: Load<ProgressChoices> = state.status !== 'ready' ? state
    : ready({ patients: patients.map((patient) => ({ id: patient.id, name: nameOf(patient) })), patientId, exercises: [...new Map(exercises.map((item) => [item.id, item])).values()] })
  // Sessions already on screen stay there if a later page or a refresh fails.
  const results: Load<ProgressResults> = history.data
    ? ready({ sessions: history.data.pages.flatMap((page) => page.sessions), more: history.hasNextPage, loadingMore: history.isFetchingNextPage })
    : history.isError ? { status: 'error', retry: () => void history.refetch() } : { status: 'loading' }
  return (
    <ProgressView choices={choices} results={results} filters={filters} onFilters={(next) => setChosen({ patientId, filters: next })}
      onPatient={(id) => setParams({ patient: id })}
      onMore={() => void history.fetchNextPage().then((page) => { if (page.isError) toast.show(t(failureKey(page.error)), 'error') })} />
  )
}
