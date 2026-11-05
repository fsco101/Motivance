import { CameraIcon, PencilSimpleIcon, TrashIcon } from '@phosphor-icons/react'
import { useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { ConfirmDialog } from '@/components/Dialog'
import { Avatar, Notice, PageHeader, Panel } from '@/components/Display'
import { PasswordField, SelectField, TextArea, TextField } from '@/components/Field'
import { failureKey } from '@/data/errors'
import { ageOn, GENDERS, PhotoFailure, usernameBlocked, validAddress, validBirthdate, validContact, validDetails, validName, validUsername, type MyProfile, type ProfileDetails } from '@/data/profile'
import { Fact, Loadable, SkeletonLines, useFormat, type Load } from '@/features/shared'

export type ProfileActions = {
  onSave: (details: ProfileDetails) => Promise<void>
  onPhoto: (file: File) => Promise<void>
  onRemovePhoto: () => Promise<void>
  onPassword: (current: string, next: string) => Promise<void>
}

const displayName = (profile: MyProfile) => [profile.firstName, profile.lastName].filter(Boolean).join(' ') || profile.email

function PhotoPanel({ profile, actions }: { profile: MyProfile; actions: ProfileActions }) {
  const { t } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const attempt = async (work: () => Promise<void>) => {
    setBusy(true)
    setProblem(null)
    try {
      await work()
    } catch (failure) {
      setProblem(t(failure instanceof PhotoFailure ? `profile.photoProblem.${failure.problem}` : 'profile.photoProblem.failed'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <aside className="flex flex-col gap-4 rounded-card border border-line bg-paper p-5 shadow-rest">
      <Avatar name={displayName(profile)} photo={profile.photo} size={88} />
      <div>
        <h2 className="text-lg font-bold">{displayName(profile)}</h2>
        <p className="break-all text-sm text-slate">{profile.email}</p>
        <p className="mt-1 text-sm text-slate">{t('profile.emailFixed')}</p>
      </div>
      <div className="border-t border-line pt-4">
        <h3 className="text-sm font-bold">{t('profile.photo')}</h3>
        <p className="mb-3 text-sm text-slate">{t(profile.photo ? 'profile.photoSet' : 'profile.photoEmpty')}</p>
        {problem && <Notice className="mb-3">{problem}</Notice>}
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden aria-label={t('profile.photo')}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void attempt(() => actions.onPhoto(file))
          }} />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" busy={busy} busyLabel={t('profile.photoUploading')} leading={<CameraIcon aria-hidden />} onClick={() => input.current?.click()}>
            {t(profile.photo ? 'profile.photoChange' : 'profile.photoAdd')}
          </Button>
          {profile.photo && <Button variant="quiet" size="sm" disabled={busy} leading={<TrashIcon aria-hidden />} onClick={() => setRemoving(true)}>{t('profile.photoRemove')}</Button>}
        </div>
        <p className="mt-3 text-sm text-slate">{t('profile.photoNotice')}</p>
      </div>
      <ConfirmDialog open={removing} onOpenChange={setRemoving} destructive title={t('profile.photoRemove')} message={t('profile.photoRemoveConfirm')} confirmLabel={t('profile.photoRemove')}
        onConfirm={() => void attempt(actions.onRemovePhoto)} />
    </aside>
  )
}

function DetailsForm({ profile, onSave, onCancel }: { profile: MyProfile; onSave: ProfileActions['onSave']; onCancel?: () => void }) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<ProfileDetails>(profile)
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const set = (change: Partial<ProfileDetails>) => setDraft((value) => ({ ...value, ...change }))
  // A field speaks up once it has something in it, or once saving was tried.
  const flag = (value: string, valid: boolean, message: string) => ((tried || value.length > 0) && !valid ? message : null)
  const age = ageOn(draft.birthdate)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setTried(true)
    if (!validDetails(draft)) return
    setBusy(true)
    setProblem(null)
    try {
      await onSave(draft)
    } catch (failure) {
      setProblem(t((failure as { code?: string }).code === '23505' ? 'profile.usernameTaken' : 'profile.failed'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="flex max-w-2xl flex-col gap-4">
      {problem && <Notice>{problem}</Notice>}
      <div className="grid gap-4 tablet:grid-cols-2">
        <TextField label={t('profile.firstName')} value={draft.firstName} autoComplete="given-name" maxLength={60} onChange={(event) => set({ firstName: event.target.value })} error={flag(draft.firstName, validName(draft.firstName), t('profile.nameError'))} />
        <TextField label={t('profile.lastName')} value={draft.lastName} autoComplete="family-name" maxLength={60} onChange={(event) => set({ lastName: event.target.value })} error={flag(draft.lastName, validName(draft.lastName), t('profile.nameError'))} />
        <TextField label={t('profile.birthdate')} type="date" value={draft.birthdate} hint={age === null ? undefined : t('profile.age', { age })} onChange={(event) => set({ birthdate: event.target.value })}
          error={flag(draft.birthdate, validBirthdate(draft.birthdate), t('profile.birthdateError'))} />
        <SelectField label={t('profile.gender')} value={draft.gender} placeholder={t('profile.genderChoose')} onChange={(gender) => set({ gender })} options={GENDERS.map((value) => ({ value, label: t(`genders.${value}`) }))}
          error={tried && !draft.gender ? t('profile.genderError') : null} />
      </div>
      <TextField label={t('profile.username')} value={draft.username} maxLength={30} autoComplete="username" hint={t('profile.usernameHelp')} onChange={(event) => set({ username: event.target.value.trim() })}
        error={flag(draft.username, validUsername(draft.username), t(usernameBlocked(draft.username) ? 'profile.usernameBlocked' : 'profile.usernameError'))} />
      <TextField label={t('profile.contact')} type="tel" value={draft.contact} maxLength={25} autoComplete="tel" hint={t('profile.contactHelp')} onChange={(event) => set({ contact: event.target.value })}
        error={flag(draft.contact, validContact(draft.contact), t('profile.contactError'))} />
      <TextArea label={t('profile.address')} rows={2} value={draft.address} maxLength={500} autoComplete="street-address" onChange={(event) => set({ address: event.target.value })}
        error={flag(draft.address, validAddress(draft.address), t('profile.addressError'))} />
      {!profile.consent && (
        <div className="rounded-control bg-tide p-4">
          <h3 className="font-bold">{t('profile.privacyTitle')}</h3>
          <p className="mt-1 max-w-[62ch] text-sm">{t('profile.privacyText')}</p>
          <label className="mt-3 flex min-h-11 items-start gap-3 font-semibold">
            <input type="checkbox" className="mt-1 size-5 accent-lagoon" checked={draft.consent} onChange={(event) => set({ consent: event.target.checked })} />
            <span>{t('profile.agree')}</span>
          </label>
          {tried && !draft.consent && <p className="mt-1 text-sm text-alarm">{t('profile.agreeError')}</p>}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" busy={busy} busyLabel={t('profile.saving')}>{t('profile.save')}</Button>
        {onCancel && <Button variant="secondary" disabled={busy} onClick={onCancel}>{t('common.cancel')}</Button>}
      </div>
    </form>
  )
}

function Details({ profile, onSave }: { profile: MyProfile; onSave: ProfileActions['onSave'] }) {
  const { t } = useTranslation()
  const format = useFormat()
  const [editing, setEditing] = useState(false)
  if (!profile.complete) {
    return (
      <Panel title={t('profile.details')} description={t('profile.incomplete')}>
        <DetailsForm profile={profile} onSave={onSave} />
      </Panel>
    )
  }
  if (editing) {
    return (
      <Panel title={t('profile.details')}>
        <DetailsForm profile={profile} onCancel={() => setEditing(false)} onSave={async (details) => { await onSave(details); setEditing(false) }} />
      </Panel>
    )
  }
  return (
    <Panel title={t('profile.details')} action={<Button variant="secondary" size="sm" leading={<PencilSimpleIcon aria-hidden />} onClick={() => setEditing(true)}>{t('profile.edit')}</Button>}>
      <dl className="grid gap-4 tablet:grid-cols-3">
        <Fact term={t('profile.username')}>{profile.username}</Fact>
        <Fact term={t('profile.birthdate')}>{format.day(profile.birthdate)}</Fact>
        <Fact term={t('profile.gender')}>{t(`genders.${profile.gender}`, profile.gender)}</Fact>
        <Fact term={t('profile.contact')}>{profile.contact}</Fact>
        <Fact term={t('profile.address')}>{profile.address}</Fact>
      </dl>
    </Panel>
  )
}

function Password({ onPassword }: { onPassword: ProfileActions['onPassword'] }) {
  const { t } = useTranslation()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [wrong, setWrong] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const nextError = !next ? null : next.length < 8 ? t('auth.passwordShort') : next === current ? t('profile.passwordSame') : null
  const ready = current.length > 0 && next.length >= 8 && next !== current && next === confirmation
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!ready) return
    setBusy(true)
    setWrong(false)
    setProblem(null)
    try {
      await onPassword(current, next)
      setCurrent('')
      setNext('')
      setConfirmation('')
    } catch (failure) {
      if ((failure as { code?: string }).code === 'invalid_credentials') setWrong(true)
      else setProblem(t(failureKey(failure)))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Panel title={t('profile.password')} description={t('profile.passwordHelp')}>
      <form onSubmit={(event) => void submit(event)} className="flex max-w-md flex-col gap-4">
        {problem && <Notice>{problem}</Notice>}
        <PasswordField label={t('profile.currentPassword')} autoComplete="current-password" value={current} error={wrong ? t('profile.currentWrong') : null} onChange={(event) => { setCurrent(event.target.value); setWrong(false) }} />
        <PasswordField label={t('profile.newPassword')} autoComplete="new-password" value={next} error={nextError} onChange={(event) => setNext(event.target.value)} />
        <PasswordField label={t('profile.confirmPassword')} autoComplete="new-password" value={confirmation} error={confirmation && confirmation !== next ? t('profile.passwordMatch') : null} onChange={(event) => setConfirmation(event.target.value)} />
        <Button type="submit" variant="secondary" className="self-start" disabled={!ready} busy={busy} busyLabel={t('profile.saving')}>{t('profile.password')}</Button>
      </form>
    </Panel>
  )
}

export function ProfileView({ load, actions }: { load: Load<MyProfile>; actions: ProfileActions }) {
  const { t } = useTranslation()
  return (
    <>
      <PageHeader title={t('account.profile')} />
      <Loadable load={load} skeleton={<SkeletonLines rows={8} />}>
        {(profile) => (
          <div className="grid items-start gap-5 desk:grid-cols-[17rem_minmax(0,1fr)]">
            <PhotoPanel profile={profile} actions={actions} />
            <div className="flex min-w-0 flex-col gap-5">
              <Details profile={profile} onSave={actions.onSave} />
              <Password onPassword={actions.onPassword} />
            </div>
          </div>
        )}
      </Loadable>
    </>
  )
}
