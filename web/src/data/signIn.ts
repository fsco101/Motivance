import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { must } from './workspace'

type Db = SupabaseClient<Database>

/** How the signed-in person can sign in. Read from my_sign_in(), the same answer Android gets. */
export type SignInMethods = {
  /** A Google-only account has no password, so Profile offers to set one rather than change it. */
  password: boolean
  google: boolean
  /** A patient who came through Google has no username or details yet, and finishes them before Home. */
  profileRequired: boolean
}

export async function loadSignInMethods(db: Db): Promise<SignInMethods> {
  const raw = must(await db.rpc('my_sign_in')) as { password?: boolean; google?: boolean; profile_required?: boolean } | null
  // A disabled account reads nothing. It is signed out elsewhere, so nothing here holds it back.
  return { password: raw?.password ?? true, google: raw?.google ?? false, profileRequired: raw?.profile_required ?? false }
}

/** A Google-only account has no current password to prove, so the signed-in session sets the first one. */
export async function setFirstPassword(db: Db, next: string) {
  const { error } = await db.auth.updateUser({ password: next })
  if (error) throw error
}

/** Where Google sends the person back. The address the sign-in started from decides it, so development and the live site each return home. */
export function googleRedirect(origin: string, next: string | null) {
  return `${origin}/auth/callback${next === 'book' ? '?next=book' : ''}`
}

export type GoogleOutcome = 'cancelled' | 'auth.googleFailed' | 'auth.googleExpired' | 'auth.googleRefused' | 'auth.googleClosed'

/**
 * Turns the error Google or Supabase Auth hands back into plain words. Auth puts it in the query or, for some failures, after the #.
 * Their own descriptions can be technical, so only the kind of problem is shown.
 */
export function googleOutcome(error: string | null, code: string | null, description: string | null): GoogleOutcome {
  const text = `${error ?? ''} ${code ?? ''} ${description ?? ''}`.toLowerCase()
  if (error === 'access_denied' || code === 'access_denied' || text.includes('cancel')) return 'cancelled'
  if (text.includes('signup') && (text.includes('disabled') || text.includes('not allowed'))) return 'auth.googleClosed'
  if (/flow[_ ]state|code[_ ]verifier|bad_oauth_state|expired/.test(text)) return 'auth.googleExpired'
  if (/bad_oauth_callback|unable to exchange|invalid_grant|bad_jwt|provider/.test(text)) return 'auth.googleRefused'
  return 'auth.googleFailed'
}

/** The failure from finishing the sign-in, as the same plain words. */
export function exchangeOutcome(failure: unknown): GoogleOutcome {
  const { code, name, message, status } = (failure ?? {}) as { code?: string; name?: string; message?: string; status?: number }
  if (name === 'AuthRetryableFetchError' || status === 0) return 'auth.googleFailed'
  return googleOutcome(null, code ?? name ?? null, message ?? null)
}
