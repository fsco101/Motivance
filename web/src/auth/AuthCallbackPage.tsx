import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { ButtonLink } from '@/components/Button'
import { Notice } from '@/components/Display'
import { supabase } from '@/data/client'
import { exchangeOutcome, googleOutcome, type GoogleOutcome } from '@/data/signIn'
import { MotionArc } from '@/motion/MotionArc'
import { useAuth } from './AuthProvider'
import { clearActivity } from './idle'
import { homePath, workspacePath } from './roles'

type Problem = Exclude<GoogleOutcome, 'cancelled'>

/**
 * Google sends the person back here. A cancelled Google page returns to sign-in with a quiet note; any other error is named in plain
 * words; otherwise the code is exchanged for a session in this browser, and the account goes home as after a password sign-in.
 */
export function AuthCallbackPage() {
  const { t } = useTranslation()
  const { state } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [problem, setProblem] = useState<Problem | null>(null)
  const started = useRef(false)
  const book = params.get('next') === 'book'

  useEffect(() => {
    // The code works once, and development renders effects twice.
    if (started.current) return
    started.current = true
    const fragment = new URLSearchParams(window.location.hash.slice(1))
    const read = (key: string) => params.get(key) ?? fragment.get(key)
    const fail = (outcome: GoogleOutcome) => {
      clearActivity()
      if (outcome === 'cancelled') void navigate(`/sign-in?google=cancelled${book ? '&next=book' : ''}`, { replace: true })
      else setProblem(outcome)
    }
    const error = read('error')
    const code = params.get('code')
    if (error || !code) {
      fail(googleOutcome(error, read('error_code'), read('error_description')))
      return
    }
    supabase().auth.exchangeCodeForSession(code)
      .then(({ error: failure }) => { if (failure) fail(exchangeOutcome(failure)) })
      .catch((failure: unknown) => fail(exchangeOutcome(failure)))
  }, [book, navigate, params])

  if (problem) {
    return (
      <main className="mx-auto grid min-h-dvh max-w-[34rem] content-center gap-5 px-6">
        <Notice title={t('auth.googleProblemTitle')}>{t(problem)}</Notice>
        <ButtonLink to={`/sign-in${book ? '?next=book' : ''}`} variant="secondary" className="self-start justify-self-start">{t('auth.backToSignIn')}</ButtonLink>
      </main>
    )
  }
  if (state.status === 'signedIn') {
    return <Navigate to={book && homePath(state.roles) === workspacePath('patient') ? '/patient/book' : '/'} replace />
  }
  // A disabled account is signed straight out again, and sign-in says why. A dropped connection gets the usual retry page.
  if ((state.status === 'signedOut' && state.reason) || state.status === 'unavailable') return <Navigate to={state.status === 'unavailable' ? '/' : '/sign-in'} replace />

  return (
    <div role="status" className="grid min-h-dvh place-items-center">
      <div className="flex flex-col items-center gap-4">
        <MotionArc progress={0.72} size={96} stroke={9} />
        <p className="text-slate">{t('auth.googleFinishing')}</p>
      </div>
    </div>
  )
}
