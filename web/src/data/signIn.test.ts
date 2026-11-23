import { describe, expect, it } from 'vitest'
import { exchangeOutcome, googleOutcome, googleRedirect, loadSignInMethods } from './signIn'

describe('Google sign-in outcomes', () => {
  it('treats a cancelled Google page as a quiet return, not an error', () => {
    expect(googleOutcome('access_denied', null, 'The user denied the request')).toBe('cancelled')
    expect(googleOutcome('invalid_request', 'access_denied', null)).toBe('cancelled')
  })

  it('names each kind of failure in plain words', () => {
    expect(googleOutcome('server_error', 'unexpected_failure', 'Unable to exchange external code: 4/0Ab')).toBe('auth.googleRefused')
    expect(googleOutcome('invalid_request', 'bad_oauth_state', 'OAuth state parameter missing')).toBe('auth.googleExpired')
    expect(googleOutcome('access_denied_signup', 'signup_disabled', 'Signups not allowed for this instance')).toBe('auth.googleClosed')
    expect(googleOutcome(null, null, null)).toBe('auth.googleFailed')
    expect(googleOutcome('temporarily_unavailable', null, 'Try later')).toBe('auth.googleFailed')
  })

  it('maps a failed code exchange', () => {
    expect(exchangeOutcome({ name: 'AuthApiError', code: 'flow_state_not_found', message: 'invalid flow state, no valid flow state found', status: 404 })).toBe('auth.googleExpired')
    expect(exchangeOutcome({ name: 'AuthPKCECodeVerifierMissingError', message: 'PKCE code verifier not found in storage.' })).toBe('auth.googleExpired')
    expect(exchangeOutcome({ name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 })).toBe('auth.googleFailed')
    expect(exchangeOutcome(undefined)).toBe('auth.googleFailed')
  })

  it('returns to the address the sign-in started from, keeping a booking visit', () => {
    expect(googleRedirect('http://localhost:3000', null)).toBe('http://localhost:3000/auth/callback')
    expect(googleRedirect('https://motivance.vercel.app', 'book')).toBe('https://motivance.vercel.app/auth/callback?next=book')
    expect(googleRedirect('https://motivance.vercel.app', 'https://elsewhere.example')).toBe('https://motivance.vercel.app/auth/callback')
  })
})

describe('sign-in methods', () => {
  const db = (data: unknown) => ({ rpc: async () => ({ data, error: null }) }) as never

  it('reads the server answer', async () => {
    await expect(loadSignInMethods(db({ password: false, google: true, profile_required: true }))).resolves.toEqual({ password: false, google: true, profileRequired: true })
  })

  it('holds no one back when the account reads nothing', async () => {
    await expect(loadSignInMethods(db(null))).resolves.toEqual({ password: true, google: false, profileRequired: false })
  })
})
