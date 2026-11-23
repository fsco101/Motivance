import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { createUser, removeUsers, signedIn, sql, type Role, type TestUser } from '../support/stack'

/**
 * Continue with Google against the real local backend, with Auth's two Google steps stubbed: the page that would open Google, and
 * the exchange of Google's answer for a session. The session handed back is a real one for a disposable account, so everything after
 * it is the real app. Nothing here reaches Google or sends email.
 */
test.describe.configure({ mode: 'serial' })

const users: TestUser[] = []
const account = async (roles: readonly Role[], name?: string) => {
  const user = await createUser(roles, name)
  users.push(user)
  return user
}
test.afterAll(() => {
  if (users.length) sql(`delete from auth.identities where provider='google' and user_id in (${users.map((user) => `'${user.id}'`).join(',')});`)
  removeUsers(users)
})

/** What Auth records when a Google account is linked, or made: a Google identity and, for a Google-only account, no password. */
function linkGoogle(user: TestUser, { only = false } = {}) {
  const sub = String(Date.now()) + String(Math.floor(Math.random() * 1e6))
  const data = JSON.stringify({ sub, email: user.email, email_verified: true, iss: 'https://accounts.google.com' })
  sql(`insert into auth.identities(provider_id,user_id,identity_data,provider,last_sign_in_at,created_at,updated_at) values('${sub}','${user.id}','${data}','google',now(),now(),now());`
    + (only ? `update auth.users set encrypted_password='' where id='${user.id}';` : ''))
}

/** A real session for the account, taken before any password is removed, standing in for the one Google would lead to. */
async function sessionFor(user: TestUser) {
  const db = await signedIn(user)
  const { data } = await db.auth.getSession()
  return data.session!
}

type Authorize = { url?: URL }

/** Auth's Google page answers by sending the browser straight back, as Google would after the person chooses an account. */
async function stubGoogle(page: Page, back: string, exchange?: { status: number; body: unknown }) {
  const seen: Authorize = {}
  await page.route('**/auth/v1/authorize?**', async (route) => {
    seen.url = new URL(route.request().url())
    await route.fulfill({ status: 302, headers: { location: `http://localhost:3000/auth/callback${back}` } })
  })
  if (exchange) {
    await page.route('**/auth/v1/token?grant_type=pkce', (route) => {
      const body = route.request().postDataJSON() as { auth_code?: string; code_verifier?: string }
      if (body.auth_code !== 'stub-code' || !body.code_verifier) return route.fulfill({ status: 400, json: { code: 'bad_code_verifier', message: 'code challenge does not match' } })
      // Auth answers with its API version, which tells supabase-js to read the error's code field.
      return route.fulfill({ status: exchange.status, json: exchange.body, headers: { 'x-supabase-api-version': '2024-01-01' } })
    })
  }
  return seen
}

test.beforeEach(async ({ page }) => {
  // Should anything try to reach Google itself, the test fails rather than leaving the machine.
  await page.route(/accounts\.google\.com|googleapis\.com/, (route) => route.abort())
})

test('the button is reachable by keyboard and named for screen readers, in both languages', async ({ page }) => {
  await page.goto('/sign-in')
  const button = page.getByRole('button', { name: 'Continue with Google' })
  await expect(button).toBeVisible()
  // It sits below the password form.
  const [form, google] = await Promise.all([page.getByRole('button', { name: 'Sign in', exact: true }).boundingBox(), button.boundingBox()])
  expect(google!.y).toBeGreaterThan(form!.y)
  expect(google!.height).toBeGreaterThanOrEqual(44)
  await page.getByRole('button', { name: 'Filipino' }).click()
  await expect(page.getByRole('button', { name: 'Magpatuloy gamit ang Google' })).toBeVisible()
  await page.getByRole('button', { name: 'English' }).click()
})

test('an existing account signs in with Google, through PKCE, and lands on its own workspace', async ({ page }) => {
  const patient = await account(['patient'], 'Google Existing')
  linkGoogle(patient)
  const seen = await stubGoogle(page, '?code=stub-code', { status: 200, body: await sessionFor(patient) })
  await page.goto('/sign-in')
  await page.getByRole('button', { name: 'Continue with Google' }).focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/patient$/)
  expect(seen.url!.searchParams.get('provider')).toBe('google')
  expect(seen.url!.searchParams.get('redirect_to')).toBe('http://localhost:3000/auth/callback')
  expect(seen.url!.searchParams.get('code_challenge_method')).toBe('s256')
  expect(seen.url!.searchParams.get('code_challenge')).toBeTruthy()
  expect(seen.url!.searchParams.get('prompt')).toBe('select_account')
  await expect(page.getByRole('heading', { name: 'Finish setting up your account' })).toHaveCount(0)
})

test('a staff account linked to Google lands on the staff workspace, with its password intact', async ({ page }) => {
  const therapist = await account(['patient', 'therapist'], 'Google Therapist')
  linkGoogle(therapist)
  await stubGoogle(page, '?code=stub-code', { status: 200, body: await sessionFor(therapist) })
  await page.goto('/sign-in')
  await page.getByRole('button', { name: 'Continue with Google' }).click()
  await expect(page).toHaveURL(/\/therapist$/)
  await page.goto('/therapist/profile')
  await expect(page.getByText('You can also sign in with Google.')).toBeVisible()
  await expect(page.getByLabel('Current password')).toBeVisible()
})

test('a new Google patient finishes their details and the privacy agreement before Home', async ({ page }) => {
  const patient = await account(['patient'], 'New Google Patient')
  const session = await sessionFor(patient)
  linkGoogle(patient, { only: true })
  await stubGoogle(page, '?code=stub-code', { status: 200, body: session })
  await page.goto('/sign-in')
  await page.getByRole('button', { name: 'Continue with Google' }).click()
  await expect(page.getByRole('heading', { name: 'Finish setting up your account' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Data privacy agreement' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Save profile' }).click()
  await expect(page.getByText('Accept the agreement to save your details.')).toBeVisible()
  await page.getByLabel('First name').fill('Gloria')
  await page.getByLabel('Last name').fill('Santos')
  await page.getByLabel('Birthdate').fill('1979-03-14')
  await page.getByLabel('Gender').click()
  await page.getByRole('option', { name: 'Female' }).click()
  await page.getByLabel('Username').fill(`gloria_${randomUUID().slice(0, 8)}`)
  await page.getByLabel('Contact number').fill('+63 912 345 6789')
  await page.getByLabel('Address').fill('Quezon City, Metro Manila')
  await page.getByLabel(/I have read this agreement/).check()
  await page.getByRole('button', { name: 'Save profile' }).click()
  await expect(page.getByRole('heading', { name: 'Finish setting up your account' })).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  expect(sql(`select consented_at is not null from public.patient_profiles where user_id='${patient.id}'`)).toBe('t')

  // Profile offers this Google-only account a first password rather than a change it could not make.
  await page.goto('/patient/profile')
  await expect(page.getByRole('heading', { name: 'Set a password' })).toBeVisible()
  await expect(page.getByLabel('Current password')).toHaveCount(0)
  const password = `${randomUUID()}Aa!9`
  await page.getByLabel('New password', { exact: true }).fill(password)
  await page.getByLabel('Confirm new password').fill(password)
  await page.getByRole('button', { name: 'Set a password' }).click()
  await expect(page.getByText('Password set. You can now also sign in with your email.')).toBeVisible()
  await expect(page.getByLabel('Current password')).toBeVisible()
  await signedIn({ ...patient, password })
})

test('a cancelled Google page returns to sign-in without an error', async ({ page }) => {
  await stubGoogle(page, '?error=access_denied&error_code=access_denied&error_description=The+user+denied+the+request')
  await page.goto('/sign-in')
  await page.getByRole('button', { name: 'Continue with Google' }).click()
  await expect(page).toHaveURL(/\/sign-in\?google=cancelled/)
  await expect(page.getByText('Google sign-in was cancelled. Choose a way to sign in.')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByLabel('Email')).toBeVisible()
})

test('an error from Google or Auth is named in plain words, with a way back', async ({ page }) => {
  await stubGoogle(page, '#error=server_error&error_code=unexpected_failure&error_description=Unable+to+exchange+external+code%3A+4%2F0Ab')
  await page.goto('/sign-in')
  await page.getByRole('button', { name: 'Continue with Google' }).click()
  await expect(page.getByRole('alert')).toContainText('Google could not confirm this account.')
  await expect(page.getByText('Unable to exchange')).toHaveCount(0)
  await page.getByRole('link', { name: 'Back to sign in' }).click()
  await expect(page).toHaveURL(/\/sign-in$/)
})

test('a code Auth will not exchange asks the person to start again', async ({ page }) => {
  await stubGoogle(page, '?code=stub-code', { status: 404, body: { code: 'flow_state_not_found', message: 'invalid flow state, no valid flow state found' } })
  await page.goto('/sign-in')
  await page.getByRole('button', { name: 'Continue with Google' }).click()
  await expect(page.getByRole('alert')).toContainText('Start again from this page.')
  await page.goto('/')
  await expect(page.getByRole('link', { name: /Sign in/ }).first()).toBeVisible()
})
