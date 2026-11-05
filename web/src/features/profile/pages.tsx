import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useSignedIn } from '@/auth/AuthProvider'
import { toast } from '@/components/Toast'
import { supabase } from '@/data/client'
import { changePassword, loadMyProfile, removeMyPhoto, saveMyProfile, uploadPhoto } from '@/data/profile'
import { asLoad } from '@/features/shared'
import { preparePhoto } from './photo'
import { ProfileView } from './ProfileView'

export function ProfilePage() {
  const { t } = useTranslation()
  const { userId, email } = useSignedIn()
  const client = useQueryClient()
  const profile = useQuery({ queryKey: ['profile', userId], queryFn: () => loadMyProfile(supabase(), userId, email) })
  // The name and photo appear across the app, so everything reloads, not just this page.
  const refresh = () => client.invalidateQueries()
  return (
    <ProfileView load={asLoad(profile)} actions={{
      onSave: async (details) => {
        await saveMyProfile(supabase(), details)
        await refresh()
        toast.show(t('profile.saved'))
      },
      onPhoto: async (file) => {
        await uploadPhoto(supabase(), await preparePhoto(file))
        await refresh()
        toast.show(t('profile.photoSaved'))
      },
      onRemovePhoto: async () => {
        await removeMyPhoto(supabase())
        await refresh()
        toast.show(t('profile.photoRemoved'))
      },
      onPassword: async (current, next) => {
        await changePassword(supabase(), userId, email, current, next)
        toast.show(t('profile.passwordSaved'))
      },
    }} />
  )
}
