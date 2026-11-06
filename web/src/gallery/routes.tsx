import { useState } from 'react'
import { Link, useSearchParams, type RouteObject } from 'react-router'
import type { Slot } from '@/data/booking'
import { SignInPage } from '@/auth/SignInPage'
import type { Workspace } from '@/auth/roles'
import { toast } from '@/components/Toast'
import { AccountsView } from '@/features/admin/AccountsView'
import { ActivityView } from '@/features/admin/ActivityView'
import { AdminOverviewView } from '@/features/admin/AdminOverviewView'
import { CatalogueView } from '@/features/admin/CatalogueView'
import { LinksView } from '@/features/admin/LinksView'
import { BookSessionView } from '@/features/patient/BookSessionView'
import { MyBookingsView } from '@/features/patient/MyBookingsView'
import { ConnectPanel, PrivacyPanel } from '@/features/patient/PatientCareView'
import { PatientExercisesView } from '@/features/patient/PatientExercisesView'
import { PatientHomeView } from '@/features/patient/PatientHomeView'
import { UseThePhone } from '@/features/patient/UseThePhone'
import { ready, type Load } from '@/features/shared'
import { AssignmentEditorView } from '@/features/therapist/AssignmentEditorView'
import { ProfileView, type ProfileActions } from '@/features/profile/ProfileView'
import { ExercisesView } from '@/features/therapist/ExercisesView'
import { PatientRecordView } from '@/features/therapist/PatientRecordView'
import { PatientsView } from '@/features/therapist/PatientsView'
import { NO_FILTERS, ProgressView } from '@/features/therapist/ProgressView'
import { TherapistHomeView } from '@/features/therapist/TherapistHomeView'
import { LandingPage } from '@/landing/LandingPage'
import '@/locales/booking'
import { Shell } from '@/layout/Shell'
import { AnimatedOutlet } from '@/motion/AnimatedOutlet'
import { ComponentGallery } from './ComponentGallery'
import * as data from './fixtures'

const THERAPIST = '/design/therapist'
const ADMIN = '/design/admin'
const PATIENT = '/design/patient'

/** Any screen can be reviewed in any state: add ?state=loading, ?state=error or ?state=empty to its address. */
function useDemo<T>(value: T, empty: T): Load<T> {
  const [params] = useSearchParams()
  const state = params.get('state')
  if (state === 'loading') return { status: 'loading' }
  if (state === 'error') return { status: 'error', retry: () => toast.show('Retried') }
  return ready(state === 'empty' ? empty : value)
}

const said = (message: string) => () => toast.show(message)

function Frame({ workspace }: { workspace: Workspace }) {
  return (
    <Shell workspace={workspace} base={workspace === 'admin' ? ADMIN : workspace === 'patient' ? PATIENT : THERAPIST} onSignOut={said('Signed out')} onSwitch={said('Switched workspace')}
      account={{ name: 'Dana Reyes', email: 'dana.reyes@example.test', workspaces: ['admin', 'therapist', 'patient'] }}>
      <AnimatedOutlet />
    </Shell>
  )
}

const Home = () => <TherapistHomeView base={THERAPIST} load={useDemo(data.therapistHome, { ...data.therapistHome, patients: 0, withoutPlan: 0, latest: [], recent: [] })} />
const many = data.patients.flatMap((patient, index) => Array.from({ length: 9 }, (_, copy) => ({ ...patient, id: `${patient.id}-${copy}`, name: `${patient.name} ${index * 9 + copy}` })))
const Patients = () => <PatientsView base={THERAPIST} load={useDemo(useSearchParams()[0].has('many') ? many : data.patients, [])} onInvite={async () => 'f3a9c1d27b6e4c0588a1d2e3f4a5b6c7d8e9f0a1b2c3d4e5'} onRevoke={said('Access revoked')} />
const Record = () => <PatientRecordView base={THERAPIST} load={useDemo(data.record, { ...data.record, plans: [], trend: null })} />
const Assign = () => <AssignmentEditorView load={useDemo({ patient: { id: 'p1', name: 'Ana Dela Cruz' }, catalogue: data.catalogue }, { patient: { id: 'p1', name: 'Ana Dela Cruz' }, catalogue: [] })} onPublish={said('Prescription published')} onCreateExercise={async () => 'v3'} />
function Progress() {
  const [filters, setFilters] = useState(NO_FILTERS)
  const base = { patients: [{ id: 'p1', name: 'Ana Dela Cruz' }], patientId: 'p1', exercises: [{ id: 'v1', name: 'Elbow flexion' }] }
  // Sample data stands in for the query, which applies these filters on the server.
  const sessions = data.sessions.filter((s) => (filters.exerciseVersionId === 'all' || s.prescription?.exerciseVersionId === filters.exerciseVersionId)
    && (filters.side === 'all' || s.prescription?.side === filters.side) && (!filters.from || s.startedAt.slice(0, 10) >= filters.from) && (!filters.through || s.startedAt.slice(0, 10) <= filters.through))
  return <ProgressView choices={useDemo(base, base)} results={useDemo({ sessions, more: true }, { sessions: [], more: false })} filters={filters} onFilters={setFilters} onPatient={() => setFilters(NO_FILTERS)} onMore={said('Loaded older sessions')} />
}
function PatientHome() {
  const [open, setOpen] = useState(false)
  return <><PatientHomeView base={PATIENT} load={useDemo(data.patientHome, { ...data.patientHome, next: null, exerciseCount: 0, recent: [] })} onStart={() => setOpen(true)} /><UseThePhone open={open} onOpenChange={setOpen} exercise={data.patientHome.next?.name} /></>
}
const PatientExercises = () => <PatientExercisesView base={PATIENT} load={useDemo(data.myExercises, [])} onStart={said('Suggested the phone')} onCamera={said('Suggested the phone')} />
function PatientBook() {
  const [date, setDate] = useState<string | null>(data.availability.days[0]!.date)
  const [chosen, setChosen] = useState<Slot | null>(null)
  return <BookSessionView load={useDemo(data.availability, { ...data.availability, days: [] })} month={data.availability.days[0]!.date.slice(0, 7)} onMonth={said('Changed month')} canGoBack={false} canGoForward today={data.availability.days[0]!.date}
    date={date} onDate={setDate} chosen={chosen} onChoose={setChosen} onRequest={said('Requested')} busy={false} />
}
const PatientBookings = () => <MyBookingsView base={PATIENT} load={useDemo(data.myBookings, [])} onCancel={said('Cancelled')} />
function PatientProgress() {
  const [filters, setFilters] = useState(NO_FILTERS)
  const base = { patients: [], patientId: 'p1', exercises: [{ id: 'v1', name: 'Elbow flexion' }] }
  return <ProgressView self choices={useDemo(base, base)} results={useDemo({ sessions: data.sessions, more: false }, { sessions: [], more: false })} filters={filters} onFilters={setFilters} onPatient={() => undefined} onMore={said('Loaded more')} />
}
function PatientProfile() {
  return (
    <>
      <Profile />
      <div className="mt-5 grid items-start gap-5 desk:grid-cols-2">
        <ConnectPanel onConnect={async () => toast.show('Connected')} />
        <PrivacyPanel load={useDemo(data.privacy, { consent: null, requests: [] })} onWithdraw={async () => toast.show('Withdrawn')} onRequest={async () => toast.show('Requested')} />
      </div>
    </>
  )
}
const Exercises = () => <ExercisesView load={useDemo(data.catalogue, data.catalogue.filter((item) => !item.custom))} onCreate={async () => toast.show('Exercise saved')} onRemove={said('Exercise removed')} />

const Overview = () => <AdminOverviewView base={ADMIN} load={useDemo({ summary: data.summary, recent: data.activity.slice(0, 5) }, { summary: { ...data.summary, unlinkedPatients: 0, disabled: 0, pendingRequests: 0 }, recent: [] })} />
const Accounts = () => (
  <AccountsView self={data.accounts[1]!.id} load={useDemo({ accounts: data.accounts, hasMore: true }, { accounts: [], hasMore: false })}
    actions={{ onSearch: () => undefined, onMore: said('Loaded more'), onActive: said('Account status updated.'), onRole: said('Access updated.'), onClearPhoto: said('Profile photo removed.') }} />
)
const Links = () => <LinksView load={useDemo({ links: data.links, accounts: data.accounts }, { links: [], accounts: data.accounts })} onLink={said('Care-team link updated.')} />
const Catalogue = () => <CatalogueView load={useDemo(data.exercises, [])} actions={{ onActive: said('Exercise availability updated.'), onPublish: said('New exercise version published.') }} />
const Activity = () => <ActivityView load={useDemo({ events: data.activity, hasMore: true }, { events: [], hasMore: false })} onMore={said('Loaded older activity')} />

const profileActions: ProfileActions = {
  onSave: async () => toast.show('Profile updated.'), onPhoto: async () => toast.show('Profile photo updated.'), onRemovePhoto: async () => toast.show('Profile photo removed.'), onPassword: async () => toast.show('Password changed.'),
}
const Profile = () => <ProfileView load={useDemo(data.profile, { ...data.profile, complete: false, consent: false, username: '', photo: null })} actions={profileActions} />

const SCREENS = [
  ['Landing', '/design/landing'], ['Sign-in', '/design/sign-in'], ['Components', '/design/components'],
  ['Therapist home', THERAPIST], ['Patients', `${THERAPIST}/patients`], ['Patient record', `${THERAPIST}/patients/p1`], ['Assignment editor', `${THERAPIST}/patients/p1/assign`], ['Exercises', `${THERAPIST}/exercises`], ['Progress', `${THERAPIST}/progress`],
  ['Admin overview', ADMIN], ['Accounts', `${ADMIN}/accounts`], ['Links', `${ADMIN}/links`], ['Catalogue', `${ADMIN}/catalogue`], ['Activity', `${ADMIN}/activity`], ['Profile', `${ADMIN}/profile`],
] as const

function Index() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-4xl font-bold">Motivance web design review</h1>
      <p className="mt-2 text-lg text-slate">Real components on sample data. Every screen also takes ?state=loading, ?state=error or ?state=empty.</p>
      <ul className="mt-6 divide-y divide-line">{SCREENS.map(([name, to]) => <li key={to}><Link to={to} className="block py-3 font-semibold hover:text-lagoon-deep">{name}</Link></li>)}</ul>
    </main>
  )
}

export const galleryRoutes: RouteObject[] = [{
  path: 'design',
  children: [
    { index: true, element: <Index /> },
    { path: 'components', element: <ComponentGallery /> },
    { path: 'sign-in', element: <SignInPage /> },
    { path: 'landing', element: <LandingPage /> },
    {
      path: 'therapist', element: <Frame workspace="therapist" />, handle: { crumb: 'nav.home' },
      children: [
        { index: true, element: <Home /> },
        { path: 'patients', handle: { crumb: 'nav.patients' }, children: [
          { index: true, element: <Patients /> },
          { path: ':id', handle: { crumb: () => 'Ana Dela Cruz' }, children: [
            { index: true, element: <Record /> },
            { path: 'assign', element: <Assign />, handle: { crumb: 'assign.title' } },
          ] },
        ] },
        { path: 'exercises', element: <Exercises />, handle: { crumb: 'nav.exercises' } },
        { path: 'progress', element: <Progress />, handle: { crumb: 'nav.progress' } },
        { path: 'profile', element: <Profile />, handle: { crumb: 'account.profile' } },
      ],
    },
    {
      path: 'patient', element: <Frame workspace="patient" />, handle: { crumb: 'nav.home' },
      children: [
        { index: true, element: <PatientHome /> },
        { path: 'book', element: <PatientBook />, handle: { crumb: 'nav.book' } },
        { path: 'bookings', element: <PatientBookings />, handle: { crumb: 'nav.bookings' } },
        { path: 'exercises', element: <PatientExercises />, handle: { crumb: 'nav.exercises' } },
        { path: 'progress', element: <PatientProgress />, handle: { crumb: 'nav.progress' } },
        { path: 'profile', element: <PatientProfile />, handle: { crumb: 'account.profile' } },
      ],
    },
    {
      path: 'admin', element: <Frame workspace="admin" />, handle: { crumb: 'nav.overview' },
      children: [
        { index: true, element: <Overview /> },
        { path: 'accounts', element: <Accounts />, handle: { crumb: 'nav.accounts' } },
        { path: 'links', element: <Links />, handle: { crumb: 'nav.links' } },
        { path: 'catalogue', element: <Catalogue />, handle: { crumb: 'nav.catalogue' } },
        { path: 'activity', element: <Activity />, handle: { crumb: 'nav.activity' } },
        { path: 'profile', element: <Profile />, handle: { crumb: 'account.profile' } },
      ],
    },
  ],
}]
