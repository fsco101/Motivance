import { LockKeyIcon } from '@phosphor-icons/react'
import { AnimatePresence, animate, m as motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Button } from '@/components/Button'
import { Notice } from '@/components/Display'
import { PasswordField, TextField } from '@/components/Field'
import { recoveryClient, supabase } from '@/data/client'
import { failureKey } from '@/data/errors'
import { LanguageSwitch } from '@/layout/LanguageSwitch'
import { FACE_START, FACE_SWEEP, arcPath, faceAngle, polar } from '@/motion/geometry'
import { duration, ease, spring } from '@/motion/tokens'
import { useAuth } from './AuthProvider'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SIZE = 560
const C = SIZE / 2
const R = C - 34
const BAND: readonly [number, number] = [20, 120]

/** The needle answers the form: it rests low, climbs as the form is completed and drops back on an error. */
function FormDial({ reach, compact }: { reach: number; compact?: boolean }) {
  const reduced = useReducedMotion()
  const value = useMotionValue(reduced ? reach : 0)
  const reading = useTransform(value, (latest) => `${Math.round(latest)}°`)
  const rotate = useTransform(value, (latest) => faceAngle(latest))
  useEffect(() => {
    if (reduced) {
      value.jump(reach)
      return
    }
    const controls = animate(value, reach, spring.needle)
    return () => controls.stop()
  }, [reach, reduced, value])
  const ticks = Array.from({ length: 49 }, (_, index) => index)
  return (
    <div aria-hidden className={compact ? 'relative aspect-square w-40' : 'relative aspect-square w-full max-w-[32rem]'}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="size-full overflow-visible">
        {ticks.map((index) => {
          const angle = FACE_START + (FACE_SWEEP / 48) * index
          const major = index % 6 === 0
          const a = polar(C, C, R - 30, angle)
          const b = polar(C, C, R - (major ? 48 : 40), angle)
          return <line key={index} x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={major ? 2.5 : 1.25} className={major ? 'stroke-night-ink' : 'stroke-night-line'} />
        })}
        <path d={arcPath(C, C, R, FACE_START, FACE_START + FACE_SWEEP)} fill="none" strokeWidth={22} strokeLinecap="round" className="stroke-night-panel" />
        <motion.path d={arcPath(C, C, R, faceAngle(BAND[0]), faceAngle(BAND[1]))} fill="none" strokeWidth={22} strokeLinecap="butt" className="stroke-sprout-bright"
          initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: duration.sweep, ease: ease.inOut, delay: 0.1 }} />
        <motion.g style={{ rotate, transformOrigin: `${C}px ${C}px`, transformBox: 'view-box' }}>
          <line x1={C} y1={C} x2={C + R - 6} y2={C} strokeWidth={3} strokeLinecap="round" className="stroke-paper" />
        </motion.g>
        <circle cx={C} cy={C} r={9} className="fill-paper" />
      </svg>
      <motion.span className={compact ? 'numeric absolute inset-x-0 bottom-[14%] text-center text-2xl font-bold text-paper' : 'numeric absolute inset-x-0 bottom-[17%] text-center text-6xl font-bold text-paper'}>{reading}</motion.span>
    </div>
  )
}

type Step = 'signIn' | 'requestCode' | 'newPassword'

export function SignInPage({ notice }: { notice?: 'idle' | 'disabled' }) {
  const { t } = useTranslation()
  const { signIn } = useAuth()
  const reduced = useReducedMotion()
  const [step, setStep] = useState<Step>('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [field, setField] = useState<{ email?: string; password?: string; code?: string }>({})
  const [sent, setSent] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  // A recovery code works once. Keeping the verified session lets someone correct a rejected password without a new code.
  const verified = useRef<{ key: string; client: ReturnType<typeof recoveryClient>; saved?: string } | null>(null)

  const go = (next: Step) => {
    verified.current = null
    setStep(next)
    setError(null)
    setField({})
    setPassword('')
    setCode('')
    if (next !== 'newPassword') setSent(false)
  }
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (failure) {
      setError(t(failureKey(failure)))
      setAttempt((value) => value + 1)
    } finally {
      setBusy(false)
    }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const address = email.trim()
    const problems = {
      email: EMAIL.test(address) ? undefined : t('auth.invalidEmail'),
      password: step === 'requestCode' ? undefined : !password ? t('auth.passwordRequired')
        : step === 'newPassword' && password.length < 8 ? t('auth.passwordShort') : undefined,
      code: step === 'newPassword' && !code.trim() ? t('auth.codeRequired') : undefined,
    }
    setField(problems)
    if (problems.email || problems.password || problems.code) return
    if (step === 'signIn') void run(() => signIn(address, password))
    if (step === 'requestCode') {
      void run(async () => {
        const { error: failure } = await supabase().auth.resetPasswordForEmail(address)
        if (failure) throw failure
        go('newPassword')
        setSent(true)
      })
    }
    if (step === 'newPassword') {
      void run(async () => {
        const key = `${address}:${code.trim()}`
        if (verified.current?.key !== key) {
          const client = recoveryClient()
          const { error: failure } = await client.auth.verifyOtp({ email: address, token: code.trim(), type: 'recovery' })
          if (failure) throw failure
          verified.current = { key, client }
        }
        // If only the sign-in failed, the password is already saved, and saving it again would be refused as "same password".
        if (verified.current.saved !== password) {
          const changed = await verified.current.client.auth.updateUser({ password })
          if (changed.error) throw changed.error
          verified.current.saved = password
        }
        await signIn(address, password)
      })
    }
  }
  const watchCapsLock = (event: KeyboardEvent) => setCapsLock(event.getModifierState('CapsLock'))

  const emailReady = EMAIL.test(email.trim())
  const steps = step === 'signIn' ? [emailReady, password.length > 0] : step === 'requestCode' ? [emailReady] : [emailReady, code.trim().length > 0, password.length >= 8]
  const share = steps.filter(Boolean).length / steps.length
  const reach = busy ? 124 : error ? Math.max(BAND[0], 20 + share * 40) : 20 + share * 96

  const heading = step === 'signIn' ? t('auth.welcome') : t('auth.recoveryHeading')
  const detail = step === 'signIn' ? t('auth.description') : step === 'requestCode' ? t('auth.recoveryDescription') : t('auth.newPasswordDescription')
  return (
    <div className="grid min-h-dvh bg-paper desk:grid-cols-[minmax(0,1.05fr)_minmax(28rem,1fr)]">
      <aside className="on-dark relative hidden flex-col justify-between overflow-hidden bg-ink p-12 text-paper desk:flex">
        <Link to="/" className="flex w-fit items-center gap-3 rounded-control">
          <img src="/logo-96.png" alt="" width={40} height={40} className="rounded-lg" />
          <span className="font-display text-2xl font-bold">Motivance</span>
        </Link>
        <div className="grid place-items-center py-6"><FormDial reach={reach} /></div>
        <p className="max-w-[30ch] font-display text-3xl font-semibold">{t('auth.promise')}</p>
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
        <div className="mx-auto flex w-full max-w-[26rem] flex-1 flex-col justify-center py-8">
          <div className="on-dark mb-6 grid place-items-center rounded-stage bg-ink py-3 desk:hidden"><FormDial reach={reach} compact /></div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={step} initial={{ opacity: 0, x: reduced ? 0 : 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: reduced ? 0 : -10 }} transition={{ duration: duration.standard, ease: ease.out }}>
              {step !== 'signIn' && <p className="mb-2 font-semibold text-lagoon-deep">{t('auth.recoveryStep', { step: step === 'requestCode' ? 1 : 2 })}</p>}
              <h1 className="text-4xl font-bold">{heading}</h1>
              <p className="mt-2 text-lg text-slate">{detail}</p>
              {notice && step === 'signIn' && <Notice tone="info" className="mt-6">{t(notice === 'idle' ? 'auth.signedOutIdle' : 'auth.accountDisabled')}</Notice>}
              {sent && !error && <Notice tone="info" className="mt-6">{t('auth.recoverySent')}</Notice>}
              {error && (
                <motion.div key={attempt} className="mt-6" initial={false} animate={reduced ? undefined : { x: [0, -7, 6, -3, 0] }} transition={{ duration: duration.slow }}>
                  <Notice>{error}</Notice>
                </motion.div>
              )}
              <form noValidate onSubmit={submit} className="mt-8 flex flex-col gap-5">
                <TextField label={t('auth.email')} type="email" autoComplete="username" autoFocus={step !== 'newPassword'} value={email} error={field.email} onChange={(event) => setEmail(event.target.value)} disabled={busy} />
                {step === 'newPassword' && <TextField label={t('auth.emailCode')} inputMode="numeric" autoComplete="one-time-code" autoFocus value={code} error={field.code} onChange={(event) => setCode(event.target.value)} disabled={busy} />}
                {step !== 'requestCode' && (
                  <PasswordField label={t(step === 'signIn' ? 'auth.password' : 'auth.newPassword')} autoComplete={step === 'signIn' ? 'current-password' : 'new-password'} value={password} error={field.password}
                    hint={capsLock ? t('auth.capsLock') : undefined} onKeyUp={watchCapsLock} onKeyDown={watchCapsLock} onChange={(event) => setPassword(event.target.value)} disabled={busy} />
                )}
                <Button type="submit" size="lg" busy={busy} busyLabel={t('common.working')} className="mt-1 w-full">
                  {t(step === 'signIn' ? 'auth.signIn' : step === 'requestCode' ? 'auth.sendCode' : 'auth.savePassword')}
                </Button>
              </form>
              <div className="mt-3 flex flex-wrap justify-between gap-2">
                {step === 'signIn'
                  ? <Button variant="quiet" size="sm" className="-ml-3" onClick={() => go('requestCode')}>{t('auth.forgotPassword')}</Button>
                  : <Button variant="quiet" size="sm" className="-ml-3" onClick={() => go('signIn')}>{t('auth.backToSignIn')}</Button>}
                {step === 'newPassword' && <Button variant="quiet" size="sm" className="-mr-3" onClick={() => go('requestCode')}>{t('auth.resendCode')}</Button>}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="mx-auto w-full max-w-[26rem] border-t border-line pt-4 text-sm text-slate">
          <p className="flex items-start gap-2"><LockKeyIcon aria-hidden className="mt-0.5 shrink-0 text-base" />{t('auth.sharedComputer')}</p>
          <p className="mt-1 pl-6">{t('auth.mobileHint')}</p>
        </div>
      </main>
    </div>
  )
}
