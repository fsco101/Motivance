import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSignedIn } from '@/auth/AuthProvider'
import { toast } from '@/components/Toast'
import { supabase } from '@/data/client'
import { failureKey } from '@/data/errors'
import {
  joinTherapist, loadConsent, loadDataRequests, loadMyExercises, loadMySessions, requestData, thisWeek, withdrawConsent, type DataRequestKind, type MyExercise,
} from '@/data/patient'
import { asLoad, ready, type Load } from '@/features/shared'
import { ProfilePage } from '@/features/profile/pages'
import { useProgressResults } from '@/features/therapist/history'
import { NO_FILTERS, ProgressView, type ProgressChoices } from '@/features/therapist/ProgressView'
import '@/locales/booking'
import { ConnectPanel, PrivacyPanel, type PrivacyState } from './PatientCareView'
import { PatientExercisesView } from './PatientExercisesView'
import { PatientHomeView, type PatientHome } from './PatientHomeView'
import { UseThePhone } from './UseThePhone'

const BASE = '/patient'

function useMyExercises() {
  const { userId } = useSignedIn()
  const { i18n } = useTranslation()
  return useQuery({ queryKey: ['patient', 'exercises', userId, i18n.language], queryFn: () => loadMyExercises(supabase(), userId, i18n.language) })
}

/** Starting an exercise or the camera check opens the suggestion, with the exercise's name when there is one. */
function usePhonePrompt() {
  const [prompt, setPrompt] = useState<{ exercise: string | null } | null>(null)
  return {
    start: (exercise: MyExercise) => setPrompt({ exercise: exercise.name }),
    camera: () => setPrompt({ exercise: null }),
    dialog: <UseThePhone open={prompt !== null} onOpenChange={(open) => { if (!open) setPrompt(null) }} exercise={prompt?.exercise} />,
  }
}

export function PatientHomePage() {
  const { userId } = useSignedIn()
  const exercises = useMyExercises()
  const sessions = useQuery({ queryKey: ['patient', 'sessions', userId], queryFn: () => loadMySessions(supabase(), userId) })
  const name = useQuery({
    queryKey: ['patient', 'name', userId],
    queryFn: async () => (await supabase().from('profiles').select('display_name').eq('id', userId).maybeSingle()).data?.display_name ?? '',
  })
  const phone = usePhonePrompt()
  const load: Load<PatientHome> = exercises.data && sessions.data
    ? ready({ name: name.data ?? '', next: exercises.data[0] ?? null, exerciseCount: exercises.data.length, week: thisWeek(sessions.data, new Date()), recent: sessions.data })
    : exercises.isError || sessions.isError ? { status: 'error', retry: () => { void exercises.refetch(); void sessions.refetch() } } : { status: 'loading' }
  return <><PatientHomeView load={load} base={BASE} onStart={phone.start} />{phone.dialog}</>
}

export function PatientExercisesPage() {
  const exercises = useMyExercises()
  const phone = usePhonePrompt()
  return <><PatientExercisesView load={asLoad(exercises)} base={BASE} onStart={phone.start} onCamera={phone.camera} />{phone.dialog}</>
}

export function PatientProgressPage() {
  const { userId } = useSignedIn()
  const exercises = useMyExercises()
  const [filters, setFilters] = useState(NO_FILTERS)
  const { results, onMore } = useProgressResults(userId, filters)
  const state = asLoad(exercises)
  const choices: Load<ProgressChoices> = state.status !== 'ready' ? state : ready({
    patients: [], patientId: userId, exercises: [...new Map(state.data.map((item) => [item.exerciseVersionId, { id: item.exerciseVersionId, name: item.name }])).values()],
  })
  return <ProgressView self choices={choices} results={results} filters={filters} onFilters={setFilters} onPatient={() => undefined} onMore={onMore} />
}

export function PatientProfilePage() {
  const { t } = useTranslation()
  const { userId } = useSignedIn()
  const client = useQueryClient()
  const privacy = useQuery({
    queryKey: ['patient', 'privacy', userId],
    queryFn: async (): Promise<PrivacyState> => {
      const [consent, requests] = await Promise.all([loadConsent(supabase(), userId), loadDataRequests(supabase(), userId)])
      return { consent, requests }
    },
  })
  // Reports the result here, so the panels only have to show they are working.
  const act = async (work: () => Promise<void>, done: string) => {
    try {
      await work()
      await client.invalidateQueries({ queryKey: ['patient'] })
      toast.show(done)
    } catch (failure) {
      toast.show(t(failureKey(failure)), 'error')
    }
  }
  return (
    <>
      <ProfilePage />
      <div className="mt-5 grid items-start gap-5 desk:grid-cols-2">
        <ConnectPanel onConnect={(code) => act(() => joinTherapist(supabase(), code), t('patient.connected'))} />
        <PrivacyPanel load={asLoad(privacy)}
          onWithdraw={() => act(() => withdrawConsent(supabase()), t('patient.consentWithdrawn'))}
          onRequest={(kind: DataRequestKind) => act(() => requestData(supabase(), kind), t('patient.requestStatus.requested'))} />
      </div>
    </>
  )
}
