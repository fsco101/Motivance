import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Navigate, Outlet, useNavigate, type RouteObject } from 'react-router'
import { useAuth, useSignedIn } from '@/auth/AuthProvider'
import { IdleGuard } from '@/auth/IdleGuard'
import { SignInPage } from '@/auth/SignInPage'
import { homePath, workspacePath, workspacesOf, type Workspace } from '@/auth/roles'
import { LandingPage } from '@/landing/LandingPage'
import { Button } from '@/components/Button'
import { EmptyState, Notice } from '@/components/Display'
import { supabase } from '@/data/client'
import { Shell } from '@/layout/Shell'
import { MotionArc } from '@/motion/MotionArc'
import { AnimatedOutlet } from '@/motion/AnimatedOutlet'

// Development only: this condition is replaced at build time, so the gallery and its sample data are not bundled.
const gallery: RouteObject[] = import.meta.env.DEV ? (await import('@/gallery/routes')).galleryRoutes : []

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
  return <LandingPage />
}

function UseMobile() {
  const { t } = useTranslation()
  const { signOut } = useAuth()
  const { roles } = useSignedIn()
  if (workspacesOf(roles).length > 0) return <Navigate to="/" replace />
  return (
    <main className="mx-auto grid min-h-dvh max-w-[40rem] content-center px-6">
      <EmptyState title={t('useMobile.title')} detail={t('useMobile.detail')} action={<Button variant="secondary" onClick={() => void signOut()}>{t('account.signOut')}</Button>} />
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
  if (!held.includes(workspace)) return <Navigate to={homePath(roles)} replace />
  return (
    <Shell workspace={workspace} base={workspacePath(workspace)} onSignOut={() => void signOut()} onSwitch={(next) => void navigate(workspacePath(next))}
      account={{ name: profile.data?.display_name || email, email, photo: profile.data?.photo_url, workspaces: held }}>
      <AnimatedOutlet />
    </Shell>
  )
}

/** Feature screens land in S7 and S8, after the designs are approved. */
function Pending() {
  const { t } = useTranslation()
  return <EmptyState title={t('pending.title')} detail={t('pending.detail')} />
}

const pages = (entries: ReadonlyArray<readonly [string, string]>): RouteObject[] =>
  entries.map(([path, crumb]) => ({ path, element: <Pending />, handle: { crumb } }))

export const routes: RouteObject[] = [
  { index: true, element: <Front /> },
  { path: 'sign-in', element: <SignedOutOnly /> },
  {
    element: <SignedInOnly />,
    children: [
      { path: 'use-mobile', element: <UseMobile /> },
      {
        path: 'therapist', element: <WorkspaceFrame workspace="therapist" />, handle: { crumb: 'nav.home' },
        children: [{ index: true, element: <Pending /> }, ...pages([['patients', 'nav.patients'], ['exercises', 'nav.exercises'], ['progress', 'nav.progress'], ['profile', 'account.profile']])],
      },
      {
        path: 'admin', element: <WorkspaceFrame workspace="admin" />, handle: { crumb: 'nav.overview' },
        children: [{ index: true, element: <Pending /> }, ...pages([['accounts', 'nav.accounts'], ['links', 'nav.links'], ['catalogue', 'nav.catalogue'], ['activity', 'nav.activity'], ['profile', 'account.profile']])],
      },
    ],
  },
  ...gallery,
  { path: '*', element: <Navigate to="/" replace /> },
]
