import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { useSignedIn } from '@/auth/AuthProvider'
import { EmptyState, PageHeader } from '@/components/Display'
import { toast } from '@/components/Toast'
import { supabase } from '@/data/client'
import { failureKey } from '@/data/errors'
import { loadHistory, usable, type HistoricalSession } from '@/data/history'
import { archiveCustomExercise, createCustomExercise, invitePatient, loadLatestSessions, loadPatientProfile, publishPrescription, revokePatientLink, type CustomExerciseDraft, type PrescriptionDraft } from '@/data/therapist'
import { endSchedule, loadExerciseDay, publishScheduledPrescription, saveSchedule, stopExercise, type ExerciseDay } from '@/data/exerciseSchedule'
import { loadCatalogue, loadOverview, loadPatients, loadPlans } from '@/data/workspace'
import { SchedulePage } from '@/features/booking/SchedulePage'
import { asLoad, ready, SkeletonLines, useFormat, type Load } from '@/features/shared'
import { AssignmentEditorView } from './AssignmentEditorView'
import { ExercisesView } from './ExercisesView'
import { loadConversations, sendMessage, shareExercise } from '@/data/chat'
import { canAskToRecord, everSharedVideo } from '@/data/sessionVideos'
import { colleagueFailureKey, endColleague, inviteColleague, loadColleagueAccess, loadColleaguePatients, loadColleaguePlan, loadColleagues, openColleaguePatient, respondColleague } from '@/data/colleagues'
import { ColleagueAccessPanel, ColleaguePatientHeader, ColleaguePatientsPanel, ColleaguePlan, ColleaguesPanel, ColleagueUnavailable } from './ColleaguesView'
import { useShareProgress } from '@/features/chat/ShareDialog'
import { useActivity, useProgressResults } from './history'
import { PatientRecordView, type PatientRecord, type PlanCard } from './PatientRecordView'
import { PatientsView } from './PatientsView'
import { useSessionVideos } from './SessionVideoDialog'
import { NO_FILTERS, ProgressView, type ProgressChoices } from './ProgressView'
import { TherapistHomeView, type TherapistHome } from './TherapistHomeView'
import { latestMovement, latestSeries, nameOf, reachedBy, recentFirst, romPoints, summarisePatients } from './summaries'

const BASE = '/therapist'

export function TherapistSchedulePage() {
  return <SchedulePage audience="therapist" recordPath={(id) => `${BASE}/patients/${id}`} />
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
      patients: patients.length, plans: plans.length, sessions: overview.sessions.length, withoutPlan: patients.filter((patient) => !plans.some((plan) => plan.patientId === patient.id)).length,
      latest: latestMovement(patients, sessions), recent: recentFirst(summarisePatients(patients, plans, catalogue, sessions)).slice(0, 6),
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
  // Colleagues (#173): their patients who opted in are listed apart from one's own, and read-only.
  const client = useQueryClient()
  const colleagues = useQuery({ queryKey: ['colleagues'], queryFn: () => loadColleagues(supabase()) })
  const colleaguePatients = useQuery({ queryKey: ['colleague-patients'], queryFn: () => loadColleaguePatients(supabase()) })
  const colleagueAct = (done: string) => async (work: Promise<unknown>) => {
    try {
      await work
      await Promise.all([client.invalidateQueries({ queryKey: ['colleagues'] }), client.invalidateQueries({ queryKey: ['colleague-patients'] })])
      toast.show(t(done))
    } catch (failure) {
      toast.show(t(colleagueFailureKey(failure) ?? failureKey(failure)), 'error')
      throw failure
    }
  }
  return (
    <>
      <PatientsView load={load} base={BASE} onRevoke={(id) => revoke.mutate(id)}
        onInvite={async (email) => {
          const code = await invitePatient(supabase(), email)
          toast.show(t('toast.invitationCreated'))
          return code
        }} />
      <div className="mt-5 grid items-start gap-5 desk:grid-cols-2">
        <ColleaguePatientsPanel load={asLoad(colleaguePatients)} base={BASE} />
        <ColleaguesPanel load={asLoad(colleagues)} actions={{
          onInvite: (email) => colleagueAct('colleagues.invited')(inviteColleague(supabase(), email)),
          onRespond: (colleague, accept) => colleagueAct(accept ? 'colleagues.accepted' : 'colleagues.declined')(respondColleague(supabase(), colleague.id, accept)),
          onEnd: (colleague) => colleagueAct('colleagues.ended')(endColleague(supabase(), colleague.id)),
        }} />
      </div>
    </>
  )
}

/**
 * A colleague's patient (#173), read-only: progress, results, shared videos and the current plan. Opening it is recorded in the
 * audit trail first, and only then is anything read; the server allows the reads for 30 minutes after.
 */
export function ColleaguePatientPage() {
  const { id = '' } = useParams()
  const opened = useQuery({ queryKey: ['colleague-open', id], queryFn: () => openColleaguePatient(supabase(), id), retry: false, staleTime: 20 * 60_000, gcTime: 0 })
  const ready_ = opened.isSuccess
  const plan = useQuery({ queryKey: ['colleague-plan', id], queryFn: () => loadColleaguePlan(supabase(), id), enabled: ready_ })
  const [filters, setFilters] = useState(NO_FILTERS)
  const { results, onMore } = useProgressResults(ready_ ? id : '', filters)
  const activity = useActivity(ready_ ? id : '')
  const videos = useSessionVideos(ready_ ? id : '', false)
  if (opened.isError) return <ColleagueUnavailable />
  if (!opened.data) return <SkeletonLines />
  const choices: Load<ProgressChoices> = ready({ patients: [{ id, name: opened.data.name, photo: opened.data.photo }], patientId: id, exercises: [] })
  return (
    <>
      <ColleaguePatientHeader patient={opened.data} />
      <ColleaguePlan load={asLoad(plan)} />
      <ProgressView choices={choices} results={results} activity={activity} filters={filters} onFilters={setFilters} onPatient={() => undefined} onMore={onMore}
        videoFor={videos.videoFor} onWatch={videos.onWatch} />
      {videos.dialog}
    </>
  )
}

function usePlanCards(patientId: string, sessions: readonly HistoricalSession[], day: ExerciseDay | undefined) {
  const { t } = useTranslation()
  const { userId } = useSignedIn()
  const workspace = useWorkspace()
  return useMemo(() => {
    if (!workspace.data) return []
    const { plans, catalogue } = workspace.data
    return plans.filter((plan) => plan.patientId === patientId).map((plan): PlanCard & { scheduleId: string | null } => {
      const exercise = catalogue.find((item) => item.id === plan.exerciseId)
      const session = sessions.find((item) => item.prescription?.assignmentId === plan.assignmentId && item.measurements.some(usable))
      const measurement = session?.measurements.find(usable)
      const focus = plan.parameters.focus_joint
      const today = day?.exercises.find((item) => item.assignmentId === plan.assignmentId)
      return {
        id: plan.assignmentId, scheduleId: plan.scheduleId, exercise: exercise?.name ?? t('progress.unknown'), custom: exercise?.custom, version: plan.version,
        side: plan.side === 'right' || plan.side === 'bilateral' ? plan.side : 'left', sideSeconds: plan.sideSeconds,
        low: plan.low, high: plan.high, repetitions: plan.repetitions, focus: typeof focus === 'string' ? t(`joints.${focus}`) : null, instructions: exercise?.instructions ?? '',
        reached: measurement ? reachedBy(measurement) : null, locked: plan.therapistId !== userId,
        today: today ? (today.done ? 'done' : today.due ? 'todo' : 'rest') : null,
      }
    })
  }, [workspace.data, patientId, sessions, day, t, userId])
}

export function PatientRecordPage() {
  const { t } = useTranslation()
  const { id = '' } = useParams()
  const { userId } = useSignedIn()
  const format = useFormat()
  const workspace = useWorkspace()
  const refresh = useRefresh()
  const details = useQuery({
    queryKey: ['record', id],
    queryFn: async () => {
      const db = supabase()
      const [profile, history] = await Promise.all([loadPatientProfile(db, id), loadHistory(db, { patientId: id })])
      return { profile, sessions: history.sessions }
    },
  })
  const day = useQuery({ queryKey: ['exercise-day', id], queryFn: () => loadExerciseDay(supabase(), id), enabled: id !== '' })
  // "Ask to record" needs a conversation the patient agreed to, and no video ever shared (#175). Either failing to load hides it.
  const conversations = useQuery({ queryKey: ['conversations'], queryFn: () => loadConversations(supabase()) })
  const everShared = useQuery({ queryKey: ['ever-shared-video', id], queryFn: () => everSharedVideo(supabase(), id), enabled: id !== '' })
  const [asked, setAsked] = useState(false)
  const access = useQuery({ queryKey: ['colleague-access', id], queryFn: () => loadColleagueAccess(supabase(), id), enabled: id !== '' })
  const sessions = useMemo(() => details.data?.sessions ?? [], [details.data])
  const plans = usePlanCards(id, sessions, day.data)
  const patient = workspace.data?.patients.find((item) => item.id === id)
  if (workspace.data && !patient) return <EmptyState title={t('record.notFoundTitle')} detail={t('record.notFoundDetail')} />
  const shared = asLoad(details)
  const overall = asLoad(workspace)
  const today = asLoad(day)
  const series = latestSeries(sessions)
  const load: Load<PatientRecord> = overall.status === 'error' ? overall : today.status === 'error' ? today : shared.status !== 'ready' ? shared
    : !patient || today.status !== 'ready' ? { status: 'loading' } : ready({
      id, name: patient.name || shared.data.profile?.fullName || id.slice(0, 8), photo: patient.photoUrl, username: shared.data.profile?.username,
      gender: shared.data.profile ? t(`genders.${shared.data.profile.gender}`, shared.data.profile.gender) : undefined, birthdate: shared.data.profile?.birthdate,
      contact: shared.data.profile?.contact, address: shared.data.profile?.address, today: today.data.day,
      schedules: today.data.schedules.map((schedule) => ({ ...schedule, mine: schedule.therapistId === userId, plans: plans.filter((plan) => plan.scheduleId === schedule.id) })),
      everyDay: plans.filter((plan) => plan.scheduleId === null),
      ended: plans.filter((plan) => plan.scheduleId !== null && !today.data.schedules.some((schedule) => schedule.id === plan.scheduleId)),
      missed: today.data.missed,
      trend: series && {
        exercise: series.prescription.exerciseName, points: romPoints(series, format.short),
        detail: t('progress.seriesLine', { side: t(`common.${series.side}`, series.side), version: series.prescription.version, low: series.prescription.low, high: series.prescription.high }),
      },
    })
  // Each change says so, and a failure is shown and passed on, so the dialog stays open to try again.
  const act = (done: string) => async (work: Promise<unknown>) => {
    try {
      await work
      await refresh()
      toast.show(t(done))
    } catch (failure) {
      toast.show(t(failureKey(failure)), 'error')
      throw failure
    }
  }
  // Sends the plan into this patient's conversation, written by the server from the plan itself.
  const sendExercise = async (planId: string) => {
    try {
      const conversation = (await loadConversations(supabase())).find((item) => item.otherId === id && item.open)
      if (!conversation) { toast.show(t('chat.cards.noConversation'), 'error'); return }
      await shareExercise(supabase(), crypto.randomUUID(), conversation.id, planId)
      toast.show(t('chat.cards.exerciseSent'))
    } catch (failure) {
      toast.show(t(failureKey(failure)), 'error')
    }
  }
  const askToRecord = async () => {
    const conversation = conversations.data?.find((item) => item.otherId === id && item.open)
    if (!conversation) return
    try {
      await sendMessage(supabase(), crypto.randomUUID(), conversation.id, t('record.askToRecordMessage'))
      setAsked(true)
      toast.show(t('record.askedToRecord'))
    } catch (failure) {
      toast.show(t(failureKey(failure)), 'error')
      throw failure
    }
  }
  const offerAsk = !asked && canAskToRecord(conversations.data?.find((item) => item.otherId === id && item.open), everShared.data)
  return (
    <PatientRecordView load={load} base={BASE} aside={<ColleagueAccessPanel load={asLoad(access)} />} actions={{
      onAskToRecord: offerAsk ? askToRecord : undefined,
      onSaveSchedule: (draft) => act('toast.scheduleSaved')(saveSchedule(supabase(), draft)),
      onEndSchedule: (scheduleId) => act('toast.scheduleEnded')(endSchedule(supabase(), scheduleId)),
      onRemovePlan: (planId) => act('toast.planExerciseRemoved')(stopExercise(supabase(), planId)),
      onSendExercise: (planId) => void sendExercise(planId),
    }} />
  )
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
  // A new exercise goes into the schedule it was added from. An edited one stays where it is.
  const day = useQuery({ queryKey: ['exercise-day', id], queryFn: () => loadExerciseDay(supabase(), id), enabled: id !== '' })
  const format = useFormat()
  const scheduleId = existing ? existing.scheduleId : params.get('schedule')
  const schedule = scheduleId ? day.data?.schedules.find((item) => item.id === scheduleId) : undefined
  // A new plan gets its own ID, so it can never replace one the patient already has.
  const [newAssignment] = useState(() => crypto.randomUUID())
  const request = useRef({ key: '', id: '' })
  const publish = useMutation({
    mutationFn: (draft: PrescriptionDraft) => {
      // The same contents keep the same ID, which makes a retry after a lost response safe.
      const key = JSON.stringify(draft)
      if (request.current.key !== key) request.current = { key, id: crypto.randomUUID() }
      const prescription = { ...draft, assignmentId: existing?.assignmentId ?? newAssignment, requestId: request.current.id, patientId: id }
      return !existing && scheduleId ? publishScheduledPrescription(supabase(), scheduleId, prescription) : publishPrescription(supabase(), prescription)
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
  const load = state.status !== 'ready' ? state : !patient || (scheduleId && day.isPending) ? { status: 'loading' as const }
    : ready({ patient: { id, name: nameOf(patient), photo: patient.photoUrl }, catalogue: state.data.catalogue,
      schedule: schedule ? t('schedule.range', { from: format.day(schedule.startsOn), to: format.day(schedule.endsOn) }) : scheduleId ? null : undefined })
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
  const { results, onMore } = useProgressResults(patientId, filters)
  const activity = useActivity(patientId)
  const sharing = useShareProgress(patientId, false)
  const videos = useSessionVideos(patientId, false)
  if (workspace.data && patients.length === 0) {
    return <><PageHeader title={t('nav.progress')} description={t('progress.description')} /><EmptyState title={t('progress.noPatientsTitle')} detail={t('progress.noPatientsDetail')} /></>
  }
  const exercises = (workspace.data?.plans ?? []).filter((plan) => plan.patientId === patientId).flatMap((plan) => {
    const item = workspace.data?.catalogue.find((entry) => entry.id === plan.exerciseId)
    return item ? [{ id: item.id, name: item.name }] : []
  })
  const choices: Load<ProgressChoices> = state.status !== 'ready' ? state
    : ready({ patients: patients.map((patient) => ({ id: patient.id, name: nameOf(patient), photo: patient.photoUrl })), patientId, exercises: [...new Map(exercises.map((item) => [item.id, item])).values()] })
  return (
    <>
      <ProgressView choices={choices} results={results} activity={activity} filters={filters} onFilters={(next) => setChosen({ patientId, filters: next })}
        onPatient={(id) => setParams({ patient: id })} onMore={onMore} onShare={sharing.share} videoFor={videos.videoFor} onWatch={videos.onWatch}
        recordPath={(id) => `${BASE}/patients/${id}`} />
      {sharing.dialog}
      {videos.dialog}
    </>
  )
}
