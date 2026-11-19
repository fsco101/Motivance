import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { useSignedIn } from '@/auth/AuthProvider'
import { ButtonLink } from '@/components/Button'
import { toast } from '@/components/Toast'
import { addDays, bookingFailureKey, cancelMyBooking, CENTER_ZONE, joinWaitlist, leaveWaitlist, loadAvailability, loadHorizonDays, loadMyBookings, loadMyWaitlist, nextBooking, requestBooking, rescheduleMyBooking, todayAt, validVisitReason, type Booking, type Slot, type WaitlistEntry } from '@/data/booking'
import { supabase } from '@/data/client'
import { failureKey } from '@/data/errors'
import { loadExerciseDay, planForToday, type TodayPlan } from '@/data/exerciseSchedule'
import {
  joinTherapist, loadConsent, loadDataRequests, loadMyExercises, loadMySessions, requestData, thisWeek, withdrawConsent, type DataRequestKind, type MyExercise,
} from '@/data/patient'
import { SchedulePage } from '@/features/booking/SchedulePage'
import { asLoad, Loadable, ready, SkeletonCards, type Load } from '@/features/shared'
import { ProfilePage } from '@/features/profile/pages'
import { ChatConsentPanel } from '@/features/chat/ChatAgreement'
import { useChatAgreement } from '@/features/chat/pages'
import { useShareProgress } from '@/features/chat/ShareDialog'
import { useActivity, useProgressResults } from '@/features/therapist/history'
import { NO_FILTERS, ProgressView, type ProgressChoices } from '@/features/therapist/ProgressView'
import { useSessionVideos } from '@/features/therapist/SessionVideoDialog'
import '@/locales/booking'
import { BookSessionView } from './BookSessionView'
import { MyBookingsView } from './MyBookingsView'
import { MoveClosedView, RescheduleView } from './RescheduleView'
import { ConnectPanel, PrivacyPanel, type PrivacyState } from './PatientCareView'
import { PatientExercisesView } from './PatientExercisesView'
import { PatientHomeView, type PatientHome } from './PatientHomeView'
import { UseThePhone } from './UseThePhone'
import { cameraSupport } from '@/features/exercise/pose/support'

const BASE = '/patient'

function useMyExercises() {
  const { userId } = useSignedIn()
  const { i18n } = useTranslation()
  return useQuery({ queryKey: ['patient', 'exercises', userId, i18n.language], queryFn: () => loadMyExercises(supabase(), userId, i18n.language) })
}

/** Today's exercises at the center, read fresh whenever the page comes back, so one finished on the phone leaves the list. */
function useMyToday() {
  const { userId } = useSignedIn()
  const exercises = useMyExercises()
  const day = useQuery({ queryKey: ['patient', 'day', userId], queryFn: () => loadExerciseDay(supabase(), userId), refetchOnWindowFocus: 'always' })
  const load: Load<TodayPlan<MyExercise>> = exercises.data && day.data ? ready(planForToday(exercises.data, day.data))
    : exercises.isError || day.isError ? { status: 'error', retry: () => { void exercises.refetch(); void day.refetch() } } : { status: 'loading' }
  return load
}

const useMyBookings = () => useQuery({ queryKey: ['booking', 'mine'], queryFn: () => loadMyBookings(supabase()) })

/**
 * Starting an exercise opens the suggestion to use the phone, with the exercise's name. The camera check runs here,
 * unless this browser cannot run the camera, when it suggests the phone too.
 */
function usePhonePrompt() {
  const [prompt, setPrompt] = useState<{ exercise: string | null } | null>(null)
  const navigate = useNavigate()
  return {
    start: (exercise: MyExercise) => setPrompt({ exercise: exercise.name }),
    camera: () => (cameraSupport().ok ? navigate(`${BASE}/camera-check`) : setPrompt({ exercise: null })),
    dialog: <UseThePhone open={prompt !== null} onOpenChange={(open) => { if (!open) setPrompt(null) }} exercise={prompt?.exercise} />,
  }
}

export function PatientHomePage() {
  const { userId } = useSignedIn()
  const today = useMyToday()
  const sessions = useQuery({ queryKey: ['patient', 'sessions', userId], queryFn: () => loadMySessions(supabase(), userId) })
  const bookings = useMyBookings()
  const name = useQuery({
    queryKey: ['patient', 'name', userId],
    queryFn: async () => (await supabase().from('profiles').select('display_name').eq('id', userId).maybeSingle()).data?.display_name ?? '',
  })
  const phone = usePhonePrompt()
  const load: Load<PatientHome> = today.status === 'ready' && sessions.data
    ? ready({ name: name.data ?? '', today: today.data, week: thisWeek(sessions.data, new Date()), recent: sessions.data, session: nextBooking(bookings.data ?? []) })
    : today.status === 'error' ? today : sessions.isError ? { status: 'error', retry: () => void sessions.refetch() } : { status: 'loading' }
  return <><PatientHomeView load={load} base={BASE} onStart={phone.start} />{phone.dialog}</>
}

export function PatientExercisesPage() {
  const today = useMyToday()
  const phone = usePhonePrompt()
  return <><PatientExercisesView load={today} base={BASE} onStart={phone.start} onCamera={phone.camera} />{phone.dialog}</>
}

export function PatientSchedulePage() {
  const { t } = useTranslation()
  return <SchedulePage audience="patient" actions={<ButtonLink to={`${BASE}/book`}>{t('booking.title')}</ButtonLink>} />
}

/** The month, date and time being chosen, shared by booking a session and moving one. */
function useSlotChoice() {
  const [today] = useState(() => todayAt(CENTER_ZONE))
  const first = today.slice(0, 7)
  const [month, setMonth] = useState(first)
  const [date, setDate] = useState<string | null>(null)
  const [chosen, setChosen] = useState<Slot | null>(null)
  const availability = useQuery({ queryKey: ['booking', 'availability', month], queryFn: () => loadAvailability(supabase(), month) })
  const horizon = useQuery({ queryKey: ['booking', 'horizon'], queryFn: () => loadHorizonDays(supabase()) })
  const last = addDays(today, horizon.data ?? 0).slice(0, 7)
  const picker = {
    load: asLoad(availability), month, canGoBack: month > first, canGoForward: month < last, today, date, chosen,
    onMonth: (next: string) => { setMonth(next); setDate(null); setChosen(null) },
    onDate: (next: string) => { setDate(next); setChosen(null) },
    onChoose: setChosen,
  }
  return { chosen, setChosen, availability, picker }
}

export function PatientBookPage() {
  const { t } = useTranslation()
  const client = useQueryClient()
  const navigate = useNavigate()
  const { chosen, setChosen, availability, picker } = useSlotChoice()
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('')
  const [reasonTried, setReasonTried] = useState(false)
  // One ID per chosen time, so trying again after a lost response returns the same booking instead of a second one.
  const attempt = useRef<{ startsAt: string; request: string } | null>(null)
  const request = async () => {
    if (!chosen) return
    setReasonTried(true)
    if (!validVisitReason(reason)) return
    if (attempt.current?.startsAt !== chosen.startsAt) attempt.current = { startsAt: chosen.startsAt, request: crypto.randomUUID() }
    setBusy(true)
    try {
      await requestBooking(supabase(), attempt.current.request, chosen.startsAt, reason)
      await client.invalidateQueries({ queryKey: ['booking'] })
      toast.show(t('booking.requested'))
      void navigate(`${BASE}/bookings`)
    } catch (failure) {
      toast.show(t(bookingFailureKey(failure)), 'error')
      // The time may be gone, so what is on screen must not stand.
      setChosen(null)
      await availability.refetch()
    } finally {
      setBusy(false)
    }
  }
  // Either way the slot on screen is out of date, so it goes back to the calendar to be read again.
  const waitlist = async (work: (startsAt: string) => Promise<void>, done: string) => {
    if (!chosen) return
    setBusy(true)
    try {
      await work(chosen.startsAt)
      toast.show(t(done))
    } catch (failure) {
      toast.show(t(bookingFailureKey(failure)), 'error')
    } finally {
      setChosen(null)
      await client.invalidateQueries({ queryKey: ['booking'] })
      setBusy(false)
    }
  }
  return (
    <BookSessionView {...picker} busy={busy} onRequest={() => void request()} reason={reason} onReason={setReason} showReasonError={reasonTried}
      onJoin={() => void waitlist((startsAt) => joinWaitlist(supabase(), startsAt), 'booking.joinedWaitlist')} onLeave={() => void waitlist((startsAt) => leaveWaitlist(supabase(), startsAt), 'booking.leftWaitlist')} />
  )
}

export function PatientReschedulePage() {
  const { t } = useTranslation()
  const { id } = useParams()
  const client = useQueryClient()
  const navigate = useNavigate()
  const bookings = useMyBookings()
  const { chosen, setChosen, availability, picker } = useSlotChoice()
  const [busy, setBusy] = useState(false)
  const move = async () => {
    if (!chosen || !id) return
    setBusy(true)
    try {
      await rescheduleMyBooking(supabase(), id, chosen.startsAt)
      toast.show(t('booking.moved'))
      // Leaving first: this page would otherwise flash that the session cannot be moved once its last move is used.
      void navigate(`${BASE}/bookings`)
      await client.invalidateQueries({ queryKey: ['booking'] })
    } catch (failure) {
      toast.show(t(bookingFailureKey(failure)), 'error')
      // The time may be gone, so what is on screen must not stand.
      setChosen(null)
      await availability.refetch()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Loadable load={asLoad(bookings)} skeleton={<SkeletonCards count={1} />}>
      {(rows) => {
        const booking = rows.find((item) => item.id === id)
        return booking?.canReschedule ? <RescheduleView booking={booking} {...picker} busy={busy} onMove={() => void move()} /> : <MoveClosedView base={BASE} />
      }}
    </Loadable>
  )
}

export function PatientBookingsPage() {
  const { t } = useTranslation()
  const client = useQueryClient()
  const bookings = useMyBookings()
  const waitlist = useQuery({ queryKey: ['booking', 'waitlist'], queryFn: () => loadMyWaitlist(supabase()) })
  const act = async (work: () => Promise<unknown>, done: string) => {
    try {
      await work()
      toast.show(t(done))
    } catch (failure) {
      toast.show(t(bookingFailureKey(failure)), 'error')
    }
    await client.invalidateQueries({ queryKey: ['booking'] })
  }
  return (
    <MyBookingsView load={asLoad(bookings)} waitlist={waitlist.data ?? []} base={BASE} onCancel={(booking: Booking) => void act(() => cancelMyBooking(supabase(), booking.id), 'booking.cancelled')}
      onBook={(entry: WaitlistEntry, reason: string) => act(() => requestBooking(supabase(), crypto.randomUUID(), entry.startsAt, reason), 'booking.requested')}
      onLeave={(entry: WaitlistEntry) => void act(() => leaveWaitlist(supabase(), entry.startsAt), 'booking.leftWaitlist')} />
  )
}

export function PatientProgressPage() {
  const { userId } = useSignedIn()
  const exercises = useMyExercises()
  const [filters, setFilters] = useState(NO_FILTERS)
  const { results, onMore } = useProgressResults(userId, filters)
  const activity = useActivity(userId)
  const sharing = useShareProgress(userId, true)
  const videos = useSessionVideos(userId, true)
  const state = asLoad(exercises)
  const choices: Load<ProgressChoices> = state.status !== 'ready' ? state : ready({
    patients: [], patientId: userId, exercises: [...new Map(state.data.map((item) => [item.exerciseVersionId, { id: item.exerciseVersionId, name: item.name }])).values()],
  })
  return <><ProgressView self choices={choices} results={results} activity={activity} filters={filters} onFilters={setFilters} onPatient={() => undefined} onMore={onMore} onShare={sharing.share} videoFor={videos.videoFor} onWatch={videos.onWatch} />{sharing.dialog}{videos.dialog}</>
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
  const messages = useChatAgreement(true)
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
        <ChatConsentPanel load={asLoad(messages.load)} onChange={messages.change} />
      </div>
    </>
  )
}
