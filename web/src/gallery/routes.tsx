import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams, type RouteObject } from 'react-router'
import { SignInPage } from '@/auth/SignInPage'
import type { Workspace } from '@/auth/roles'
import { EmptyState } from '@/components/Display'
import { toast } from '@/components/Toast'
import { AccountsView } from '@/features/admin/AccountsView'
import { ActivityView } from '@/features/admin/ActivityView'
import { AdminOverviewView } from '@/features/admin/AdminOverviewView'
import { CatalogueView } from '@/features/admin/CatalogueView'
import { LinksView } from '@/features/admin/LinksView'
import { ready, type Load } from '@/features/shared'
import { AssignmentEditorView } from '@/features/therapist/AssignmentEditorView'
import { PatientRecordView } from '@/features/therapist/PatientRecordView'
import { PatientsView } from '@/features/therapist/PatientsView'
import { NO_FILTERS, ProgressView } from '@/features/therapist/ProgressView'
import { TherapistHomeView } from '@/features/therapist/TherapistHomeView'
import { LandingPage } from '@/landing/LandingPage'
import { Shell } from '@/layout/Shell'
import { AnimatedOutlet } from '@/motion/AnimatedOutlet'
import { ComponentGallery } from './ComponentGallery'
import * as data from './fixtures'

const THERAPIST = '/design/therapist'
const ADMIN = '/design/admin'

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
    <Shell workspace={workspace} base={workspace === 'admin' ? ADMIN : THERAPIST} onSignOut={said('Signed out')} onSwitch={said('Switched workspace')}
      account={{ name: 'Dana Reyes', email: 'dana.reyes@example.test', workspaces: ['admin', 'therapist'] }}>
      <AnimatedOutlet />
    </Shell>
  )
}

const Home = () => <TherapistHomeView base={THERAPIST} load={useDemo(data.therapistHome, { ...data.therapistHome, patients: 0, latest: [], recent: [] })} />
const many = data.patients.flatMap((patient, index) => Array.from({ length: 9 }, (_, copy) => ({ ...patient, id: `${patient.id}-${copy}`, name: `${patient.name} ${index * 9 + copy}` })))
const Patients = () => <PatientsView base={THERAPIST} load={useDemo(useSearchParams()[0].has('many') ? many : data.patients, [])} onInvite={async () => 'f3a9c1d27b6e4c0588a1d2e3f4a5b6c7d8e9f0a1b2c3d4e5'} onRevoke={said('Access revoked')} />
const Record = () => <PatientRecordView base={THERAPIST} load={useDemo(data.record, { ...data.record, plans: [], trend: [] })} />
const Assign = () => <AssignmentEditorView load={useDemo({ patient: { id: 'p1', name: 'Ana Dela Cruz' }, catalogue: data.catalogue }, { patient: { id: 'p1', name: 'Ana Dela Cruz' }, catalogue: [] })} onPublish={said('Prescription published')} />
function Progress() {
  const [filters, setFilters] = useState(NO_FILTERS)
  const base = { patients: [{ id: 'p1', name: 'Ana Dela Cruz' }], patientId: 'p1', exercises: [{ id: 'v1', name: 'Elbow flexion' }] }
  // Sample data stands in for the query, which applies these filters on the server.
  const sessions = data.sessions.filter((s) => (filters.exerciseVersionId === 'all' || s.prescription?.exerciseVersionId === filters.exerciseVersionId)
    && (filters.side === 'all' || s.prescription?.side === filters.side) && (!filters.from || s.startedAt.slice(0, 10) >= filters.from) && (!filters.through || s.startedAt.slice(0, 10) <= filters.through))
  return <ProgressView load={useDemo({ ...base, sessions, more: true }, { ...base, sessions: [], more: false })} filters={filters} onFilters={setFilters} onPatient={() => setFilters(NO_FILTERS)} onMore={said('Loaded older sessions')} />
}
const Exercises = () => { const { t } = useTranslation(); return <EmptyState title={t('nav.exercises')} detail={t('pending.detail')} /> }

const Overview = () => <AdminOverviewView base={ADMIN} load={useDemo({ summary: data.summary, recent: data.activity.slice(0, 5) }, { summary: { ...data.summary, unlinkedPatients: 0, disabled: 0, pendingRequests: 0 }, recent: [] })} />
const Accounts = () => (
  <AccountsView self={data.accounts[1]!.id} load={useDemo({ accounts: data.accounts, hasMore: true }, { accounts: [], hasMore: false })}
    actions={{ onSearch: () => undefined, onMore: said('Loaded more'), onActive: said('Account status updated.'), onRole: said('Access updated.'), onClearPhoto: said('Profile photo removed.') }} />
)
const Links = () => <LinksView load={useDemo({ links: data.links, accounts: data.accounts }, { links: [], accounts: data.accounts })} onLink={said('Care-team link updated.')} />
const Catalogue = () => <CatalogueView load={useDemo(data.exercises, [])} actions={{ onActive: said('Exercise availability updated.'), onPublish: said('New exercise version published.') }} />
const Activity = () => <ActivityView load={useDemo({ events: data.activity, hasMore: true }, { events: [], hasMore: false })} onMore={said('Loaded older activity')} />

const SCREENS = [
  ['Landing', '/design/landing'], ['Sign-in', '/design/sign-in'], ['Components', '/design/components'],
  ['Therapist home', THERAPIST], ['Patients', `${THERAPIST}/patients`], ['Patient record', `${THERAPIST}/patients/p1`], ['Assignment editor', `${THERAPIST}/patients/p1/assign`], ['Progress', `${THERAPIST}/progress`],
  ['Admin overview', ADMIN], ['Accounts', `${ADMIN}/accounts`], ['Links', `${ADMIN}/links`], ['Catalogue', `${ADMIN}/catalogue`], ['Activity', `${ADMIN}/activity`],
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
      ],
    },
  ],
}]
