import { expect, test, type Page } from '@playwright/test'
import { ACTIVITY_KEY, IDLE_LIMIT_MS } from '../../src/auth/idle'
import { createUser, recoveryCode, removeUsers, sql, type Role, type TestUser } from '../support/stack'

/** The real app against the real local backend, with disposable accounts. */
test.describe.configure({ mode: 'serial' })

const users: TestUser[] = []
const account = async (roles: readonly Role[], name?: string) => {
  const user = await createUser(roles, name)
  users.push(user)
  return user
}
test.afterAll(() => removeUsers(users))

async function signIn(page: Page, user: TestUser) {
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill(user.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

const signOut = async (page: Page) => {
  await page.getByRole('button', { name: 'Account' }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/sign-in/)
}

/** Local Auth sends few emails an hour. The send is not under test; the code it carries is verified for real. */
const stubRecoveryEmail = (page: Page) => page.route('**/auth/v1/recover*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))

test('a therapist lands on the therapist workspace and cannot open the administrator one', async ({ page }) => {
  await signIn(page, await account(['therapist']))
  await expect(page).toHaveURL(/\/therapist$/)
  await expect(page.getByRole('link', { name: 'Patients' })).toBeVisible()
  await page.goto('/admin/accounts')
  await expect(page).toHaveURL(/\/therapist$/)
})

test('a therapist who is also a patient lands on the staff workspace', async ({ page }) => {
  await signIn(page, await account(['patient', 'therapist']))
  await expect(page).toHaveURL(/\/therapist$/)
})

test('an administrator lands on the administrator workspace', async ({ page }) => {
  await signIn(page, await account(['patient', 'admin']))
  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Accounts' })).toBeVisible()
})

test('a Scheduler lands on scheduling, and every other role gets a 403 page there', async ({ page }) => {
  test.setTimeout(90_000)
  await signIn(page, await account(['patient', 'scheduler']))
  await expect(page).toHaveURL(/\/scheduler$/)
  await expect(page.getByRole('heading', { name: 'Scheduling', level: 1 })).toBeVisible()
  await signOut(page)
  for (const roles of [['therapist'], ['patient', 'admin'], ['patient']] as const) {
    const person = await account(roles)
    await signIn(page, person)
    await expect(page).not.toHaveURL(/sign-in/)
    await page.goto('/scheduler')
    await expect(page.getByRole('heading', { name: '403: This page is for Schedulers' })).toBeVisible()
    await page.getByRole('link', { name: 'Back to your workspace' }).click()
    await expect(page).not.toHaveURL(/scheduler/)
    await page.evaluate(() => localStorage.clear())
    await page.goto('/sign-in')
  }
})

test('someone with both staff roles can switch, and the choice ends at sign-out', async ({ page }) => {
  const both = await account(['patient', 'therapist', 'admin'])
  await signIn(page, both)
  await expect(page).toHaveURL(/\/admin$/)
  await page.getByRole('button', { name: 'Account' }).click()
  await page.getByRole('menuitem', { name: 'Open the therapist workspace' }).click()
  await expect(page).toHaveURL(/\/therapist$/)
  await signOut(page)
  await signIn(page, both)
  await expect(page).toHaveURL(/\/admin$/)
})

test('a patient lands on their own workspace and reaches no staff workspace', async ({ page }) => {
  await signIn(page, await account(['patient']))
  await expect(page).toHaveURL(/\/patient$/)
  await page.goto('/therapist')
  await expect(page).toHaveURL(/\/patient$/)
  await page.goto('/admin')
  await expect(page).toHaveURL(/\/patient$/)
})

test('a wrong password says so and stays on the page', async ({ page }) => {
  const user = await account(['therapist'])
  await signIn(page, { ...user, password: 'not-the-password' })
  await expect(page.getByRole('alert')).toContainText('do not match')
  await expect(page).toHaveURL(/sign-in/)
})

test('the page offers no sign-up', async ({ page }) => {
  await page.goto('/sign-in')
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible()
  await expect(page.getByText(/create .*account|sign up/i)).toHaveCount(0)
})

test('a disabled account cannot enter', async ({ page }) => {
  const user = await account(['therapist'])
  sql(`update public.profiles set active=false where id='${user.id}'`)
  await signIn(page, user)
  await expect(page.getByText('This account is disabled.')).toBeVisible()
  await expect(page).toHaveURL(/sign-in/)
})

test('signed-out routes redirect to sign-in', async ({ page }) => {
  await page.goto('/therapist/patients')
  await expect(page).toHaveURL(/sign-in/)
})

test('a password can be recovered with the emailed code, and a rejected one stays on the form', async ({ page }) => {
  const user = await account(['therapist'])
  await page.goto('/sign-in')
  await stubRecoveryEmail(page)
  await page.getByRole('button', { name: 'Forgot password?' }).click()
  await page.getByLabel('Email').fill(user.email)
  await page.getByRole('button', { name: 'Send reset code' }).click()
  await expect(page.getByLabel('Email code')).toBeVisible()

  await page.getByLabel('Email code').fill('000000')
  await page.getByLabel('New password', { exact: true }).fill('a-brand-new-password-1')
  await page.getByRole('button', { name: 'Save new password' }).click()
  await expect(page.getByRole('alert')).toContainText('invalid or expired')
  await expect(page).toHaveURL(/sign-in/)

  await page.getByLabel('Email code').fill(await recoveryCode(user.email))
  await page.getByRole('button', { name: 'Save new password' }).click()
  await expect(page).toHaveURL(/\/therapist$/)
})

test('after inactivity a warning appears, and staying signed in dismisses it', async ({ page }) => {
  await signIn(page, await account(['therapist']))
  await expect(page).toHaveURL(/\/therapist$/)
  await page.evaluate(([key, time]) => localStorage.setItem(key as string, String(time)), [ACTIVITY_KEY, Date.now() - IDLE_LIMIT_MS + 30_000])
  await expect(page.getByRole('dialog', { name: 'Are you still there?' })).toBeVisible()
  await page.getByRole('button', { name: 'Stay signed in' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page).toHaveURL(/\/therapist$/)
})

test('the session ends at the idle limit, even if the browser was closed', async ({ page }) => {
  await signIn(page, await account(['therapist']))
  await expect(page).toHaveURL(/\/therapist$/)
  await page.evaluate(([key, time]) => localStorage.setItem(key as string, String(time)), [ACTIVITY_KEY, Date.now() - 8 * 3_600_000])
  await page.reload()
  await expect(page).toHaveURL(/sign-in/)
  await expect(page.getByText('You were signed out after 15 minutes')).toBeVisible()
})

test('signing out in one tab ends every tab and leaves no session behind', async ({ browser }) => {
  const context = await browser.newContext()
  const first = await context.newPage()
  await signIn(first, await account(['therapist']))
  await expect(first).toHaveURL(/\/therapist$/)
  const second = await context.newPage()
  await second.goto('/therapist/patients')
  await expect(second.getByRole('link', { name: 'Patients' })).toBeVisible()
  await signOut(first)
  await expect(second).toHaveURL(/sign-in/)
  const keys = await first.evaluate(() => Object.keys(localStorage))
  expect(keys.filter((key) => !key.startsWith('motivance.language'))).toEqual([])
  await context.close()
})

test('a failed role lookup offers a retry and keeps the session', async ({ page }) => {
  const user = await account(['therapist'])
  await signIn(page, user)
  await expect(page).toHaveURL(/\/therapist$/)
  await page.route('**/rest/v1/user_roles*', (route) => route.abort())
  await page.reload()
  // The client retries with backoff first, so a brief blip recovers without anyone seeing this.
  await expect(page.getByRole('alert')).toContainText('could not load', { timeout: 20_000 })
  await page.unroute('**/rest/v1/user_roles*')
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page).toHaveURL(/\/therapist$/)
  await expect(page.getByRole('link', { name: 'Patients' })).toBeVisible()
})

test('a token refresh during start-up does not leave the app loading', async ({ page }) => {
  const user = await account(['therapist'])
  await signIn(page, user)
  await expect(page).toHaveURL(/\/therapist$/)
  // Make the stored access token look expired, so start-up refreshes it while roles load.
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((name) => name.endsWith('-auth-token'))!
    const session = JSON.parse(localStorage.getItem(key)!) as { expires_at: number }
    localStorage.setItem(key, JSON.stringify({ ...session, expires_at: Math.floor(Date.now() / 1000) - 60 }))
  })
  await page.reload()
  await expect(page.getByRole('link', { name: 'Patients' })).toBeVisible({ timeout: 10_000 })
})

test('a rejected new password can be corrected without a new code', async ({ page }) => {
  const user = await account(['therapist'])
  await page.goto('/sign-in')
  await stubRecoveryEmail(page)
  await page.getByRole('button', { name: 'Forgot password?' }).click()
  await page.getByLabel('Email').fill(user.email)
  await page.getByRole('button', { name: 'Send reset code' }).click()
  await page.getByLabel('Email code').fill(await recoveryCode(user.email))
  await page.getByLabel('New password', { exact: true }).fill(user.password)
  await page.getByRole('button', { name: 'Save new password' }).click()
  await expect(page.getByRole('alert')).toContainText('different password')
  await page.getByLabel('New password', { exact: true }).fill('a-different-password-2')
  await page.getByRole('button', { name: 'Save new password' }).click()
  await expect(page).toHaveURL(/\/therapist$/)
})

test('a saved new password is not saved twice when only the sign-in failed', async ({ page }) => {
  const user = await account(['therapist'])
  await page.goto('/sign-in')
  await stubRecoveryEmail(page)
  await page.getByRole('button', { name: 'Forgot password?' }).click()
  await page.getByLabel('Email').fill(user.email)
  await page.getByRole('button', { name: 'Send reset code' }).click()
  await page.getByLabel('Email code').fill(await recoveryCode(user.email))
  await page.getByLabel('New password', { exact: true }).fill('a-new-password-3')
  let saves = 0
  page.on('request', (request) => { if (request.method() === 'PUT' && request.url().includes('/auth/v1/user')) saves += 1 })
  let dropped = false
  await page.route('**/auth/v1/token?grant_type=password', (route) => {
    if (dropped) return route.continue()
    dropped = true
    return route.abort()
  })
  await page.getByRole('button', { name: 'Save new password' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await page.getByRole('button', { name: 'Save new password' }).click()
  await expect(page).toHaveURL(/\/therapist$/)
  expect(saves).toBe(1)
})

test('returning to a tab on a bad connection leaves the workspace in place', async ({ page }) => {
  await signIn(page, await account(['therapist']))
  await expect(page).toHaveURL(/\/therapist$/)
  await page.route('**/rest/v1/user_roles*', (route) => route.abort())
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await page.waitForTimeout(2500)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Patients' })).toBeVisible()
})

test('a visitor gets the landing page and can reach sign-in', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'See how far every patient moves.' })).toBeVisible()
  await page.getByRole('link', { name: 'Sign in as staff' }).click()
  await expect(page).toHaveURL(/sign-in/)
  await page.getByRole('link', { name: 'Back to home' }).click()
  await expect(page).toHaveURL(/\/$/)
})

test('a signed-in account skips the landing page', async ({ page }) => {
  await signIn(page, await account(['therapist']))
  await expect(page).toHaveURL(/\/therapist$/)
  await page.goto('/')
  await expect(page).toHaveURL(/\/therapist$/)
})
