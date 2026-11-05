/** Translation keys for failures. Raw server errors never reach the screen. Mirrors AuthViewModel on Android. */
export type FailureKey =
  | 'errors.credentials' | 'errors.rateLimited' | 'errors.unconfirmed' | 'errors.invalidCode'
  | 'errors.passwordPolicy' | 'errors.sessionExpired' | 'errors.forbidden' | 'errors.offline' | 'errors.request'

type Failure = { status?: number; code?: string; message?: string; name?: string }

export function failureKey(error: unknown): FailureKey {
  const failure = (error ?? {}) as Failure
  const code = failure.code
  if (failure.status === 429 || code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') return 'errors.rateLimited'
  if (code === 'invalid_credentials') return 'errors.credentials'
  if (code === 'email_not_confirmed') return 'errors.unconfirmed'
  if (code === 'otp_expired') return 'errors.invalidCode'
  if (code === 'weak_password' || code === 'same_password') return 'errors.passwordPolicy'
  if (failure.status === 401 || code === 'PGRST301' || code === 'session_not_found') return 'errors.sessionExpired'
  if (failure.status === 403 || code === '42501') return 'errors.forbidden'
  // PostgREST reports a dropped connection as a plain object whose message quotes the browser's error.
  if (failure.name === 'AuthRetryableFetchError' || /failed to fetch|networkerror|load failed/i.test(failure.message ?? '')) return 'errors.offline'
  return 'errors.request'
}
