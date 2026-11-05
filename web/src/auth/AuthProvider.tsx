import type { Session } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { supabase } from '@/data/client'
import { clearActivity, idleState, readActivity, writeActivity } from './idle'
import type { Role } from './roles'

export type SignOutReason = 'idle' | 'disabled'
export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut'; reason?: SignOutReason }
  /** Signed in, but the roles could not be read. A dropped connection must not end the session. */
  | { status: 'unavailable' }
  | { status: 'signedIn'; userId: string; email: string; roles: Role[] }

type Auth = {
  state: AuthState
  signIn: (email: string, password: string) => Promise<void>
  signOut: (reason?: SignOutReason) => Promise<void>
  retry: () => void
}

const Context = createContext<Auth | null>(null)

export function useAuth() {
  const auth = useContext(Context)
  if (!auth) throw new Error('useAuth needs an AuthProvider')
  return auth
}

export function useSignedIn() {
  const { state } = useAuth()
  if (state.status !== 'signedIn') throw new Error('Only signed-in routes can read the account')
  return state
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queries = useQueryClient()
  const [state, setState] = useState<AuthState>({ status: 'loading' })
  const reason = useRef<SignOutReason | undefined>(undefined)
  // Late answers for an earlier session must not overwrite the current one.
  const generation = useRef(0)
  const [attempt, setAttempt] = useState(0)
  const account = useRef<string | null>(null)

  const signOut = useCallback(async (why?: SignOutReason) => {
    reason.current = why
    // Local scope ends this browser's session only, so a therapist stays signed in on their phone.
    await supabase().auth.signOut({ scope: 'local' })
  }, [])

  useEffect(() => {
    const db = supabase()
    const apply = async (event: string, session: Session | null) => {
      // These change only the token. Counting them as a new session would discard a role lookup already in flight.
      if (session && (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED')) return
      // Supabase repeats SIGNED_IN whenever a tab regains focus. Re-checking then could replace a half-finished form.
      if (session && event === 'SIGNED_IN' && session.user.id === account.current) return
      const current = ++generation.current
      if (!session) {
        account.current = null
        // Every tab reaches this when any tab signs out, so patient data never outlives the session.
        queries.clear()
        clearActivity()
        setState({ status: 'signedOut', reason: reason.current })
        reason.current = undefined
        return
      }
      if (event === 'INITIAL_SESSION' && idleState(Date.now(), readActivity()) === 'expired') {
        await signOut('idle')
        return
      }
      const { data, error } = await db.from('user_roles').select('role').eq('user_id', session.user.id)
      if (current !== generation.current) return
      if (error) {
        setState({ status: 'unavailable' })
        return
      }
      // Row-level security returns no roles for a disabled account.
      if (!data?.length) {
        await signOut('disabled')
        return
      }
      if (readActivity() === null) writeActivity(Date.now())
      account.current = session.user.id
      setState({ status: 'signedIn', userId: session.user.id, email: session.user.email ?? '', roles: data.map((row) => row.role as Role) })
    }
    // Supabase warns against calling it from inside this callback, so the work runs on the next tick.
    const { data } = db.auth.onAuthStateChange((event, session) => { window.setTimeout(() => void apply(event, session), 0) })
    return () => data.subscription.unsubscribe()
    // attempt re-subscribes, which replays the current session as INITIAL_SESSION.
  }, [queries, signOut, attempt])

  const signIn = useCallback(async (email: string, password: string) => {
    writeActivity(Date.now())
    const { error } = await supabase().auth.signInWithPassword({ email, password })
    if (error) {
      clearActivity()
      throw error
    }
  }, [])

  const retry = useCallback(() => {
    setState({ status: 'loading' })
    setAttempt((value) => value + 1)
  }, [])

  const value = useMemo(() => ({ state, signIn, signOut, retry }), [state, signIn, signOut, retry])
  return <Context.Provider value={value}>{children}</Context.Provider>
}
