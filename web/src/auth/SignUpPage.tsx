import { CheckCircleIcon, CircleIcon, LockKeyIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import { Button } from '@/components/Button'
import { Notice } from '@/components/Display'
import { PasswordField, TextArea, TextField } from '@/components/Field'
import { ageOn, GENDERS } from '@/data/profile'
import { failureKey } from '@/data/errors'
import { LanguageSwitch } from '@/layout/LanguageSwitch'
import '@/locales/landing'
import { cn } from '@/lib/cn'
import { FormFigure } from './FormFigure'
import { BLANK_SIGNUP, codeFailureKey, confirmSignup, resendSignup, signupProblems, STEPS, stepReady, submitSignup, usernameRefused, type Signup, type SignupStep } from './signup'

const BAND: readonly [number, number] = [20, 120]
type Stage = SignupStep | 'code'

function Requirement({ met, children }: { met: boolean; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <li className={cn('flex items-center gap-2 text-sm', met ? 'text-sprout-deep' : 'text-slate')}>
      {met ? <CheckCircleIcon aria-hidden weight="fill" className="shrink-0 text-base" /> : <CircleIcon aria-hidden className="shrink-0 text-base" />}
      {children}<span className="sr-only">{t(met ? 'signup.reqMet' : 'signup.reqUnmet')}</span>
    </li>
  )
}

function ReviewGroup({ title, onEdit, children }: { title: string; onEdit: () => void; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <section className="border-t border-line py-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-sans text-base font-bold">{title}</h2>
        <Button variant="quiet" size="sm" aria-label={t('signup.editSection', { section: title })} onClick={onEdit}>{t('signup.edit')}</Button>
      </div>
      <dl className="mt-1 grid gap-1 text-sm">{children}</dl>
    </section>
  )
}

const Fact = ({ term, children }: { term: string; children: ReactNode }) => <div className="flex flex-wrap gap-x-2"><dt className="text-slate">{term}:</dt><dd className="min-w-0 break-words font-semibold">{children}</dd></div>

/** Patient registration, one concern per step, with the same steps, rules and agreement as Android, then the emailed code. */
export function SignUpPage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const [stage, setStage] = useState<Stage>('account')
  const [form, setForm] = useState<Signup>(BLANK_SIGNUP)
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [full, setFull] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const started = useRef(false)
  const next = params.get('next') === 'book' ? '?next=book' : ''

  // Each step is a new page to a screen reader, so attention follows it. The first one is left alone, so the page opens normally.
  useEffect(() => {
    if (started.current) heading.current?.focus()
    started.current = true
    window.scrollTo({ top: 0 })
  }, [stage])

  const set = (change: Partial<Signup>) => setForm((current) => ({ ...current, ...change }))
  const go = (target: Stage) => { setStage(target); setTried(false); setError(null) }
  const index = stage === 'code' ? STEPS.length : STEPS.indexOf(stage)
  const problems = stage === 'code' ? {} : signupProblems(stage, form)
  const shown = (key: keyof typeof problems) => (tried && problems[key] ? t(problems[key]) : undefined)

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (failure) {
      if (usernameRefused(failure)) {
        go('contact')
        setError(t('signup.usernameRefused'))
      } else setError(t(stage === 'code' ? codeFailureKey(failure) : failureKey(failure)))
    } finally {
      setBusy(false)
    }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (stage === 'code') {
      if (!code.trim()) { setTried(true); return }
      void run(() => confirmSignup(form.email, code))
      return
    }
    if (!stepReady(stage, form)) { setTried(true); return }
    if (stage !== 'review') { go(STEPS[index + 1]!); return }
    void run(async () => { await submitSignup(form); go('code'); setSent(true) })
  }

  const title = stage === 'code' ? t('signup.codeTitle') : t(`signup.${stage}`)
  const detail = stage === 'code' ? t('signup.codeDetail', { email: form.email.trim() }) : t(`signup.${stage}Help`)
  const age = ageOn(form.birthdate)
  const reach = busy ? 124 : 20 + (index / STEPS.length) * 100
  return (
    <div className="grid min-h-dvh bg-paper desk:grid-cols-[minmax(0,1.05fr)_minmax(28rem,1fr)]">
      <aside className="on-dark relative hidden flex-col justify-between overflow-hidden bg-ink p-12 text-paper desk:flex">
        <Link to="/" className="flex w-fit items-center gap-3 rounded-control">
          <img src="/logo-96.png" alt="" width={40} height={40} className="rounded-lg" />
          <span className="font-display text-2xl font-bold">Motivance</span>
        </Link>
        <div className="grid min-h-0 flex-1 place-items-center py-4"><FormFigure reach={reach} band={BAND} /></div>
        <p className="max-w-[30ch] font-display text-3xl font-semibold">{t('signup.promise')}</p>
      </aside>
      <main className="flex flex-col px-6 py-6 tablet:px-12 tablet:py-8">
        <div className="flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2 rounded-control desk:hidden">
            <img src="/logo-96.png" alt="" width={32} height={32} className="rounded-md" />
            <span className="font-display text-xl font-bold">Motivance</span>
          </Link>
          <Link to="/" className="hidden rounded-control font-semibold text-lagoon-deep underline-offset-4 hover:underline desk:inline">{t('auth.backHome')}</Link>
          <LanguageSwitch />
        </div>
        <div className="mx-auto flex w-full max-w-[28rem] flex-1 flex-col justify-center py-8">
          {stage !== 'code' && (
            <div className="mb-4">
              <p className="mb-2 font-semibold text-lagoon-deep">{t('signup.stepOf', { step: index + 1, total: STEPS.length })}</p>
              <div aria-hidden className="flex gap-1.5">{STEPS.map((step, position) => <span key={step} className={cn('h-1.5 flex-1 rounded-full', position <= index ? 'bg-lagoon' : 'bg-tide')} />)}</div>
            </div>
          )}
          <h1 ref={heading} tabIndex={-1} className="text-4xl font-bold outline-none">{title}</h1>
          <p className="mt-2 text-lg text-slate">{detail}</p>
          {error && <Notice className="mt-6">{error}</Notice>}
          {tried && stage !== 'code' && stage !== 'review' && !stepReady(stage, form) && <p role="status" className="mt-4 text-sm font-semibold text-alarm">{t('signup.fixFields')}</p>}
          <form noValidate onSubmit={submit} className="mt-6 flex flex-col gap-5">
            {stage === 'account' && (
              <>
                <TextField label={t('auth.email')} type="email" autoComplete="email" autoFocus value={form.email} error={shown('email')} onChange={(event) => set({ email: event.target.value })} />
                <PasswordField label={t('auth.password')} autoComplete="new-password" value={form.password} error={shown('password')} onChange={(event) => set({ password: event.target.value })} />
                <PasswordField label={t('signup.confirmPassword')} autoComplete="new-password" value={form.confirmation} error={shown('confirmation')} onChange={(event) => set({ confirmation: event.target.value })} />
                <ul aria-label={t('signup.requirements')} className="grid gap-1">
                  <Requirement met={!problems.email}>{t('signup.reqEmail')}</Requirement>
                  <Requirement met={!problems.password}>{t('signup.reqLength')}</Requirement>
                  <Requirement met={!problems.confirmation}>{t('signup.reqMatch')}</Requirement>
                </ul>
              </>
            )}
            {stage === 'personal' && (
              <>
                <div className="grid gap-4 tablet:grid-cols-2">
                  <TextField label={t('profile.firstName')} autoComplete="given-name" autoCapitalize="words" maxLength={60} value={form.firstName} error={shown('firstName')} onChange={(event) => set({ firstName: event.target.value })} />
                  <TextField label={t('profile.lastName')} autoComplete="family-name" autoCapitalize="words" maxLength={60} value={form.lastName} error={shown('lastName')} onChange={(event) => set({ lastName: event.target.value })} />
                </div>
                <TextField label={t('profile.birthdate')} type="date" autoComplete="bday" value={form.birthdate} hint={age === null ? undefined : t('profile.age', { age })} error={shown('birthdate')} onChange={(event) => set({ birthdate: event.target.value })} />
                <fieldset>
                  <legend className="mb-2 text-sm font-semibold">{t('profile.gender')}</legend>
                  <div className="grid gap-2 tablet:grid-cols-2">
                    {GENDERS.map((value) => (
                      <label key={value} className={cn('flex min-h-11 cursor-pointer items-center gap-3 rounded-control border border-line-strong px-3 py-2 text-sm hover:border-lagoon', form.gender === value && 'border-lagoon bg-tide font-semibold')}>
                        <input type="radio" name="gender" className="accent-lagoon" checked={form.gender === value} onChange={() => set({ gender: value })} />
                        {t(`genders.${value}`)}
                      </label>
                    ))}
                  </div>
                  {shown('gender') && <p className="mt-1 text-sm text-alarm">{shown('gender')}</p>}
                </fieldset>
              </>
            )}
            {stage === 'contact' && (
              <>
                <TextArea label={t('profile.address')} rows={2} autoComplete="street-address" maxLength={500} value={form.address} error={shown('address')} onChange={(event) => set({ address: event.target.value })} />
                <TextField label={t('profile.contact')} type="tel" autoComplete="tel" hint={t('profile.contactHelp')} maxLength={25} value={form.contact} error={shown('contact')} onChange={(event) => set({ contact: event.target.value })} />
                <TextField label={t('profile.username')} autoComplete="username" hint={t('profile.usernameHelp')} maxLength={30} value={form.username} error={shown('username')} onChange={(event) => set({ username: event.target.value })} />
              </>
            )}
            {stage === 'review' && (
              <>
                <div>
                  <ReviewGroup title={t('signup.reviewAccount')} onEdit={() => go('account')}><Fact term={t('auth.email')}>{form.email.trim()}</Fact></ReviewGroup>
                  <ReviewGroup title={t('signup.personal')} onEdit={() => go('personal')}>
                    <Fact term={t('profile.firstName')}>{form.firstName.trim()}</Fact>
                    <Fact term={t('profile.lastName')}>{form.lastName.trim()}</Fact>
                    <Fact term={t('profile.birthdate')}>{form.birthdate}</Fact>
                    <Fact term={t('profile.gender')}>{form.gender && t(`genders.${form.gender}`)}</Fact>
                  </ReviewGroup>
                  <ReviewGroup title={t('signup.contact')} onEdit={() => go('contact')}>
                    <Fact term={t('profile.address')}>{form.address.trim()}</Fact>
                    <Fact term={t('profile.contact')}>{form.contact.trim()}</Fact>
                    <Fact term={t('profile.username')}>{form.username.trim()}</Fact>
                  </ReviewGroup>
                </div>
                <section aria-label={t('profile.privacyTitle')} className="rounded-card bg-tide p-4">
                  <h2 className="font-sans text-base font-bold">{t('profile.privacyTitle')}</h2>
                  <ul className="mt-2 grid list-disc gap-1 pl-5 text-sm">{(['point1', 'point2', 'point3', 'point4'] as const).map((point) => <li key={point}>{t(`signup.${point}`)}</li>)}</ul>
                  <Button variant="quiet" size="sm" className="-ml-3 mt-2" aria-expanded={full} onClick={() => setFull((value) => !value)}>{t(full ? 'signup.hideFull' : 'signup.readFull')}</Button>
                  {full && <p className="mt-1 text-sm">{t('profile.privacyText')}</p>}
                  <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-control border border-lagoon bg-paper p-3 text-sm font-semibold">
                    <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-lagoon" checked={form.consent} onChange={(event) => set({ consent: event.target.checked })} />
                    {t('profile.agree')}
                  </label>
                </section>
                {!form.consent && <p className="text-center text-sm text-slate">{t('signup.consentNeeded')}</p>}
              </>
            )}
            {stage === 'code' && (
              <>
                {sent && !error && <Notice tone="info">{t('signup.codeNote')}</Notice>}
                <TextField label={t('auth.emailCode')} inputMode="numeric" autoComplete="one-time-code" autoFocus value={code} error={tried && !code.trim() ? t('auth.codeRequired') : undefined} onChange={(event) => setCode(event.target.value)} />
              </>
            )}
            {stage === 'code' ? <Button type="submit" size="lg" busy={busy} busyLabel={t('common.working')} className="w-full">{t('signup.verify')}</Button> : (
              <div className="flex gap-3">
                {index > 0 && <Button variant="secondary" size="lg" disabled={busy} className="flex-1" onClick={() => go(STEPS[index - 1]!)}>{t('signup.back')}</Button>}
                <Button type="submit" size="lg" busy={busy} busyLabel={t('common.working')} disabled={stage === 'review' && !stepReady('review', form)} className="flex-1">{t(stage === 'review' ? 'signup.create' : 'signup.continue')}</Button>
              </div>
            )}
          </form>
          {stage === 'code' && (
            <div className="mt-3 flex flex-wrap justify-between gap-2">
              <Button variant="quiet" size="sm" className="-ml-3" onClick={() => go('account')}>{t('signup.otherEmail')}</Button>
              <Button variant="quiet" size="sm" className="-mr-3" disabled={busy} onClick={() => void run(async () => { await resendSignup(form.email); setSent(true) })}>{t('auth.resendCode')}</Button>
            </div>
          )}
        </div>
        <div className="mx-auto w-full max-w-[28rem] border-t border-line pt-4 text-sm text-slate">
          <p>{t('signup.haveAccount')} <Link to={`/sign-in${next}`} className="font-semibold text-lagoon-deep underline underline-offset-4">{t('auth.signIn')}</Link></p>
          <p className="mt-1 flex items-start gap-2"><LockKeyIcon aria-hidden className="mt-0.5 shrink-0 text-base" />{t('signup.staffNote')}</p>
        </div>
      </main>
    </div>
  )
}
