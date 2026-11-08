import { describe, expect, it, vi } from 'vitest'
import { BLANK_SIGNUP, codeFailureKey, profileOf, signupProblems, stepReady, usernameRefused, type Signup } from './signup'

vi.mock('@/data/client', () => ({ supabase: vi.fn(), recoveryClient: vi.fn() }))

const complete: Signup = {
  email: 'ana@example.test', password: 'a-password', confirmation: 'a-password', firstName: ' Ana ', lastName: 'Dela Cruz', birthdate: '1990-02-14', gender: 'female',
  address: ' 12 Mabini Street ', contact: '+63 912 345 6789', username: 'ana_cruz', consent: true,
}

describe('patient sign-up follows SignupFlow.kt', () => {
  it('needs an email, 8 characters and a matching password on the first step', () => {
    expect(signupProblems('account', BLANK_SIGNUP)).toEqual({ email: 'auth.invalidEmail', password: 'auth.passwordShort', confirmation: 'profile.passwordMatch' })
    expect(stepReady('account', complete)).toBe(true)
    expect(stepReady('account', { ...complete, confirmation: 'other' })).toBe(false)
    expect(stepReady('account', { ...complete, password: 'short', confirmation: 'short' })).toBe(false)
  })

  it('needs a real name, birthdate and gender on the second', () => {
    expect(Object.keys(signupProblems('personal', BLANK_SIGNUP))).toEqual(['firstName', 'lastName', 'birthdate', 'gender'])
    expect(stepReady('personal', complete)).toBe(true)
    expect(stepReady('personal', { ...complete, gender: 'other' })).toBe(false)
    expect(stepReady('personal', { ...complete, birthdate: '2999-01-01' })).toBe(false)
  })

  it('needs an address, a number and a respectful username on the third', () => {
    expect(Object.keys(signupProblems('contact', BLANK_SIGNUP))).toEqual(['address', 'contact', 'username'])
    expect(stepReady('contact', complete)).toBe(true)
    expect(signupProblems('contact', { ...complete, username: 'ab' }).username).toBe('profile.usernameError')
    expect(signupProblems('contact', { ...complete, username: 't4ng4' }).username).toBe('profile.usernameBlocked')
  })

  it('checks everything again at the end, and cannot finish without the agreement', () => {
    expect(stepReady('review', complete)).toBe(true)
    expect(stepReady('review', { ...complete, consent: false })).toBe(false)
    expect(stepReady('review', { ...complete, email: '' })).toBe(false)
    expect(stepReady('review', { ...complete, contact: '1' })).toBe(false)
  })

  it('sends the same details under the same names as Android, trimmed', () => {
    expect(profileOf(complete)).toEqual({
      username: 'ana_cruz', first_name: 'Ana', last_name: 'Dela Cruz', gender: 'female', birthdate: '1990-02-14', address: '12 Mabini Street', contact: '+63 912 345 6789', consent: true,
    })
  })

  it('reads a database refusal as a username problem, and nothing else as one', () => {
    expect(usernameRefused({ status: 500, message: 'Database error saving new user' })).toBe(true)
    expect(usernameRefused({ status: 500, message: 'Something else' })).toBe(false)
    expect(usernameRefused({ status: 429, message: 'Database error' })).toBe(false)
    expect(usernameRefused(null)).toBe(false)
  })

  it('tells a person whose code is wrong or expired to sign up again, since an expired sign-up is deleted', () => {
    expect(codeFailureKey({ status: 403, code: 'otp_expired' })).toBe('signup.codeExpired')
    expect(codeFailureKey({ status: 429 })).toBe('errors.rateLimited')
    expect(codeFailureKey(new TypeError('Failed to fetch'))).toBe('errors.offline')
  })
})
