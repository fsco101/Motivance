import { supabase } from '@/data/client'
import { failureKey } from '@/data/errors'
import { GENDERS, usernameBlocked, validAddress, validBirthdate, validContact, validName, validUsername } from '@/data/profile'

export const STEPS = ['account', 'personal', 'contact', 'review'] as const
export type SignupStep = (typeof STEPS)[number]

export type Signup = {
  email: string; password: string; confirmation: string; firstName: string; lastName: string; birthdate: string; gender: string; address: string; contact: string; username: string; consent: boolean
}
export const BLANK_SIGNUP: Signup = { email: '', password: '', confirmation: '', firstName: '', lastName: '', birthdate: '', gender: '', address: '', contact: '', username: '', consent: false }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD = 8

type Problems = Partial<Record<keyof Signup, string>>

/** The translation key for each field that stops a step, so the page and its tests read the same rules. These are the rules in SignupFlow.kt. */
export function signupProblems(step: SignupStep, form: Signup): Problems {
  const found: Problems = {}
  if (step === 'account' || step === 'review') {
    if (!EMAIL.test(form.email.trim())) found.email = 'auth.invalidEmail'
    if (form.password.length < MIN_PASSWORD) found.password = 'auth.passwordShort'
    if (!form.confirmation || form.confirmation !== form.password) found.confirmation = 'profile.passwordMatch'
  }
  if (step === 'personal' || step === 'review') {
    if (!validName(form.firstName)) found.firstName = 'profile.nameError'
    if (!validName(form.lastName)) found.lastName = 'profile.nameError'
    if (!validBirthdate(form.birthdate)) found.birthdate = 'profile.birthdateError'
    if (!(GENDERS as readonly string[]).includes(form.gender)) found.gender = 'profile.genderError'
  }
  if (step === 'contact' || step === 'review') {
    if (!validAddress(form.address)) found.address = 'profile.addressError'
    if (!validContact(form.contact)) found.contact = 'profile.contactError'
    if (!validUsername(form.username)) found.username = usernameBlocked(form.username) ? 'profile.usernameBlocked' : 'profile.usernameError'
  }
  if (step === 'review' && !form.consent) found.consent = 'signup.consentNeeded'
  return found
}

export const stepReady = (step: SignupStep, form: Signup) => Object.keys(signupProblems(step, form)).length === 0

/** The same details Android sends, under the same name, so sign-up checks them with the same rules and saves them once the code is entered. */
export const profileOf = (form: Signup) => ({
  username: form.username.trim(), first_name: form.firstName.trim(), last_name: form.lastName.trim(), gender: form.gender, birthdate: form.birthdate,
  address: form.address.trim(), contact: form.contact.trim(), consent: form.consent,
})

export async function submitSignup(form: Signup) {
  const { error } = await supabase().auth.signUp({ email: form.email.trim(), password: form.password, options: { data: { patient_profile: profileOf(form) } } })
  if (error) throw error
}

/** Signing in here is what ends sign-up: the session arrives, and the app sends the account to its home. */
export async function confirmSignup(email: string, code: string) {
  const { error } = await supabase().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'signup' })
  if (error) throw error
}

export async function resendSignup(email: string) {
  const { error } = await supabase().auth.resend({ type: 'signup', email: email.trim() })
  if (error) throw error
}

/**
 * A sign-up is deleted once its code expires, and a new code cannot bring it back, so a wrong or expired code asks the person
 * to sign up again. Password reset keeps the general wording, since a new reset code does work. Mirrors AuthViewModel on Android.
 */
export const codeFailureKey = (failure: unknown) => {
  const key = failureKey(failure)
  return key === 'errors.invalidCode' ? 'signup.codeExpired' : key
}

/** A username already in use fails inside the database's sign-up trigger, which Auth reports only as a database error. Everything else was checked here first. */
export const usernameRefused = (failure: unknown) => {
  const { status, message } = (failure ?? {}) as { status?: number; message?: string }
  return status === 500 && /database error/i.test(message ?? '')
}
