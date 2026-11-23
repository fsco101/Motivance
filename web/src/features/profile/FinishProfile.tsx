import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useAuth, useSignedIn } from '@/auth/AuthProvider'
import { Button } from '@/components/Button'
import { Panel } from '@/components/Display'
import { toast } from '@/components/Toast'
import { supabase } from '@/data/client'
import { loadMyProfile, saveMyProfile } from '@/data/profile'
import { asLoad, Loadable, SkeletonLines } from '@/features/shared'
import { LanguageSwitch } from '@/layout/LanguageSwitch'
import { DetailsForm } from './ProfileView'

/**
 * A patient who came through Google has no username or details, and has not read the privacy agreement. They finish here before
 * Home, with the same form and the same agreement as an email sign-up. Saving lets the workspace open.
 */
export function FinishProfile() {
  const { t } = useTranslation()
  const { userId, email } = useSignedIn()
  const { signOut } = useAuth()
  const client = useQueryClient()
  const profile = useQuery({ queryKey: ['profile', userId], queryFn: () => loadMyProfile(supabase(), userId, email) })
  return (
    <div className="min-h-dvh bg-mist">
      <header className="flex items-center justify-between gap-4 px-6 py-4 tablet:px-12">
        <Link to="/" className="flex items-center gap-2 rounded-control">
          <img src="/logo-96.png" alt="" width={32} height={32} className="rounded-md" />
          <span className="font-display text-xl font-bold">Motivance</span>
        </Link>
        <div className="flex items-center gap-2">
          <LanguageSwitch />
          <Button variant="quiet" size="sm" onClick={() => void signOut()}>{t('finishProfile.signOut')}</Button>
        </div>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-5 px-6 pb-12 tablet:px-12">
        <div>
          <h1 className="text-4xl font-bold">{t('finishProfile.title')}</h1>
          <p className="mt-2 max-w-[62ch] text-lg text-slate">{t('finishProfile.detail')}</p>
          <p className="mt-2 break-all text-sm text-slate">{t('finishProfile.signedInAs', { email })}</p>
        </div>
        <Panel title={t('profile.details')}>
          <Loadable load={asLoad(profile)} skeleton={<SkeletonLines rows={6} />}>
            {(loaded) => (
              <DetailsForm profile={loaded} onSave={async (details) => {
                await saveMyProfile(supabase(), details)
                await client.invalidateQueries()
                toast.show(t('finishProfile.saved'))
              }} />
            )}
          </Loadable>
        </Panel>
      </main>
    </div>
  )
}
