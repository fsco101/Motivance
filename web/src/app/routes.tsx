import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, Outlet, useNavigate, type RouteObject } from 'react-router'
import { useAuth, useSignedIn } from '@/auth/AuthProvider'
import { IdleGuard } from '@/auth/IdleGuard'
import { SignInPage } from '@/auth/SignInPage'
import { homePath, workspacePath, workspacesOf, type Workspace } from '@/auth/roles'
import { ButtonLink } from '@/components/Button'
import { EmptyState, Notice } from '@/components/Display'
import { supabase } from '@/data/client'
import { SkeletonLines } from '@/features/shared'
import { Shell } from '@/layout/Shell'
import { MotionArc } from '@/motion/MotionArc'
import { AnimatedOutlet } from '@/motion/AnimatedOutlet'

// Development only: this condition is replaced at build time, so the gallery and its sample data are not bundled.
const gallery: RouteObject[] = import.meta.env.DEV ? (await import('@/gallery/routes')).galleryRoutes : []

/** Each page is its own download, which keeps the first load small. */
const therapist = (name: keyof typeof import('@/features/therapist/pages')) => lazy(async () => ({ default: (await import('@/features/therapist/pages'))[name] as ComponentType }))
const TherapistHome = therapist('TherapistHomePage')
const Patients = therapist('PatientsPage')
const PatientRecord = therapist('PatientRecordPage')
const AssignExercise = therapist('AssignExercisePage')
const Exercises = therapist('ExercisesPage')
const Progress = therapist('ProgressPage')
const TherapistSchedule = therapist('TherapistSchedulePage')
const admin = (name: keyof typeof import('@/features/admin/pages')) => lazy(async () => ({ default: (await import('@/features/admin/pages'))[name] as ComponentType }))
const AdminOverview = admin('AdminOverviewPage')
const Accounts = admin('AccountsPage')
const Links = admin('LinksPage')
const Catalogue = admin('CataloguePage')
const Activity = admin('ActivityPage')
const scheduler = (name: keyof typeof import('@/features/scheduler/pages')) => lazy(async () => ({ default: (await import('@/features/scheduler/pages'))[name] as ComponentType }))
const SchedulerHome = scheduler('SchedulerHomePage')
const SchedulerRequests = scheduler('SchedulerRequestsPage')
const patient = (name: keyof typeof import('@/features/patient/pages')) => lazy(async () => ({ default: (await import('@/features/patient/pages'))[name] as ComponentType }))
const PatientHome = patient('PatientHomePage')
const PatientSchedule = patient('PatientSchedulePage')
const PatientBook = patient('PatientBookPage')
const PatientBookings = patient('PatientBookingsPage')
const PatientExercises = patient('PatientExercisesPage')
const PatientProgress = patient('PatientProgressPage')
const PatientProfile = patient('PatientProfilePage')
const Profile = lazy(async () => ({ default: (await import('@/features/profile/pages')).ProfilePage }))
const LandingPage = lazy(async () => ({ default: (await import('@/landing/LandingPage')).LandingPage }))

function Splash() {
  const { t } = useTranslation()
  return (
    <div role="status" className="grid min-h-dvh place-items-center">
      <div className="flex flex-col items-center gap-4">
        <MotionArc progress={0.72} size={96} stroke={9} />
        <p className="text-slate">{t('common.preparing')}</p>
      </div>
    </div>
  )
}

function Unavailable() {
  const { t } = useTranslation()
  const { retry } = useAuth()
  return <main className="mx-auto grid min-h-dvh max-w-[40rem] content-center px-6"><Notice title={t('common.loadFailedTitle')} onRetry={retry}>{t('common.loadFailed')}</Notice></main>
}

function SignedOutOnly() {
  const { state } = useAuth()
  if (state.status === 'loading') return <Splash />
  if (state.status === 'unavailable') return <Unavailable />
  if (state.status === 'signedIn') return <Navigate to="/" replace />
  return <SignInPage notice={state.reason} />
}

function SignedInOnly() {
  const { state } = useAuth()
  if (state.status === 'loading') return <Splash />
  if (state.status === 'unavailable') return <Unavailable />
  if (state.status === 'signedOut') return <Navigate to="/sign-in" replace />
  return <><IdleGuard /><Outlet /></>
}

/** Visitors get the landing page. An account always goes to its own home, never to an address a previous person left open. */
function Front() {
  const { state } = useAuth()
  if (state.status === 'loading') return <Splash />
  if (state.status === 'unavailable') return <Unavailable />
  if (state.status === 'signedIn') return <Navigate to={homePath(state.roles)} replace />
  return <Suspense fallback={<Splash />}><LandingPage /></Suspense>
}

/** Scheduling answers with a 403 rather than quietly moving the person, so they know the page exists and why they cannot use it. */
function Forbidden() {
  const { t } = useTranslation()
  const { roles } = useSignedIn()
  return (
    <main className="mx-auto grid min-h-dvh max-w-[40rem] content-center px-6">
      <EmptyState title={t('forbidden.title')} detail={t('forbidden.detail')} action={<ButtonLink to={homePath(roles)} variant="secondary">{t('forbidden.back')}</ButtonLink>} />
    </main>
  )
}

function WorkspaceFrame({ workspace }: { workspace: Workspace }) {
  const { signOut } = useAuth()
  const { userId, email, roles } = useSignedIn()
  const navigate = useNavigate()
  const held = workspacesOf(roles)
  const profile = useQuery({
    queryKey: ['account', userId],
    queryFn: async () => {
      const { data, error } = await supabase().from('profiles').select('display_name,photo_url').eq('id', userId).maybeSingle()
      if (error) throw error
      return data
    },
  })
  // The server enforces this too; here it simply keeps people out of pages that would only fail.
  if (!held.includes(workspace)) return workspace === 'scheduler' ? <Forbidden /> : <Navigate to={homePath(roles)} replace />
  return (
    <Shell workspace={workspace} base={workspacePath(workspace)} onSignOut={() => void signOut()} onSwitch={(next) => void navigate(workspacePath(next))}
      account={{ name: profile.data?.display_name || email, email, photo: profile.data?.photo_url, workspaces: held }}>
      <Suspense fallback={<SkeletonLines />}><AnimatedOutlet /></Suspense>
    </Shell>
  )
}

export const routes: RouteObject[] = [
  { index: true, element: <Front /> },
  { path: 'sign-in', element: <SignedOutOnly /> },
  {
    element: <SignedInOnly />,
    children: [
      {
        path: 'therapist', element: <WorkspaceFrame workspace="therapist" />, handle: { crumb: 'nav.home' },
        children: [
          { index: true, element: <TherapistHome /> },
          { path: 'schedule', element: <TherapistSchedule />, handle: { crumb: 'nav.schedule' } },
          {
            path: 'patients', handle: { crumb: 'nav.patients' },
            children: [
              { index: true, element: <Patients /> },
              {
                path: ':id', handle: { crumb: 'record.crumb' },
                children: [{ index: true, element: <PatientRecord /> }, { path: 'assign', element: <AssignExercise />, handle: { crumb: 'assign.title' } }],
              },
            ],
          },
          { path: 'exercises', element: <Exercises />, handle: { crumb: 'nav.exercises' } },
          { path: 'progress', element: <Progress />, handle: { crumb: 'nav.progress' } },
          { path: 'profile', element: <Profile />, handle: { crumb: 'account.profile' } },
        ],
      },
      {
        path: 'patient', element: <WorkspaceFrame workspace="patient" />, handle: { crumb: 'nav.home' },
        children: [
          { index: true, element: <PatientHome /> },
          { path: 'schedule', element: <PatientSchedule />, handle: { crumb: 'nav.schedule' } },
          { path: 'book', element: <PatientBook />, handle: { crumb: 'nav.book' } },
          { path: 'bookings', element: <PatientBookings />, handle: { crumb: 'nav.bookings' } },
          { path: 'exercises', element: <PatientExercises />, handle: { crumb: 'nav.exercises' } },
          { path: 'progress', element: <PatientProgress />, handle: { crumb: 'nav.progress' } },
          { path: 'profile', element: <PatientProfile />, handle: { crumb: 'account.profile' } },
        ],
      },
      {
        path: 'scheduler', element: <WorkspaceFrame workspace="scheduler" />, handle: { crumb: 'nav.home' },
        children: [
          { index: true, element: <SchedulerHome /> },
          { path: 'requests', element: <SchedulerRequests />, handle: { crumb: 'nav.requests' } },
          { path: 'profile', element: <Profile />, handle: { crumb: 'account.profile' } },
        ],
      },
      {
        path: 'admin', element: <WorkspaceFrame workspace="admin" />, handle: { crumb: 'nav.overview' },
        children: [
          { index: true, element: <AdminOverview /> },
          { path: 'accounts', element: <Accounts />, handle: { crumb: 'nav.accounts' } },
          { path: 'links', element: <Links />, handle: { crumb: 'nav.links' } },
          { path: 'catalogue', element: <Catalogue />, handle: { crumb: 'nav.catalogue' } },
          { path: 'activity', element: <Activity />, handle: { crumb: 'nav.activity' } },
          { path: 'profile', element: <Profile />, handle: { crumb: 'account.profile' } },
        ],
      },
    ],
  },
  ...gallery,
  { path: '*', element: <Navigate to="/" replace /> },
]
