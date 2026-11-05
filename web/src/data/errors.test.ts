import { describe, expect, it } from 'vitest'
import { failureKey } from './errors'

describe('failure messages', () => {
  it.each([
    [{ code: 'invalid_credentials', status: 400 }, 'errors.credentials'],
    [{ code: 'email_not_confirmed' }, 'errors.unconfirmed'],
    [{ code: 'otp_expired' }, 'errors.invalidCode'],
    [{ code: 'weak_password' }, 'errors.passwordPolicy'],
    [{ code: 'same_password' }, 'errors.passwordPolicy'],
    [{ status: 429 }, 'errors.rateLimited'],
    [{ code: 'over_email_send_rate_limit' }, 'errors.rateLimited'],
    [{ status: 401 }, 'errors.sessionExpired'],
    [{ code: '42501' }, 'errors.forbidden'],
    [new TypeError('Failed to fetch'), 'errors.offline'],
    [{ name: 'AuthRetryableFetchError' }, 'errors.offline'],
    [{ message: 'TypeError: Failed to fetch', code: '' }, 'errors.offline'],
  ])('maps %j', (error, key) => {
    expect(failureKey(error)).toBe(key)
  })

  it('never exposes an unknown server message', () => {
    expect(failureKey({ message: 'relation "secret_table" does not exist' })).toBe('errors.request')
    expect(failureKey(null)).toBe('errors.request')
  })
})
