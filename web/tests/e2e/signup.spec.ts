import { randomUUID } from 'node:crypto'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { createUser, removeUsers, signupLink, sql, type TestUser } from '../support/stack'

/** A patient signing up in the real app, against the real local backend. */
test.describe.configure({ mode: 'serial' })

const tag = randomUUID().slice(0, 8)
const email = `motivance-web-signup-${tag}@example.test`
const password = `Signup-${tag}-Aa9`
const username = `web_${tag}`
const users: TestUser[] = []
let page: Page

const noViolations = () => expect.poll(async () => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).slice(0, 3).join(' | ')}`)
}, { timeout: 8_000 }).toEqual([])

/**
 * Local Auth sends through a real mail account, so no test may let it send. Only the send is replaced: what the browser posted makes the
 * account through Auth and the same database trigger, and the code it hands back is the real one the email would have carried.
 */
let emailedCode = ''
async function holdBackTheEmail(target: Page) {
  const headers = { 'access-control-allow-origin': '*' }
  await target.route('**/auth/v1/resend*', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers, body: '{}' }))
  await target.route('**/auth/v1/signup*', async (route) => {
    const sent = route.request().postDataJSON() as { email: string; password: string; data: Record<string, unknown> }
    const result = await signupLink(sent.email, sent.password, sent.data)
    if (result.status === 200) emailedCode = String(result.body.email_otp)
    await route.fulfill({ status: result.status, contentType: 'application/json', headers, body: JSON.stringify(result.body) })
  })
}

const proceed = () => page.getByRole('button', { name: 'Continue' }).click()
const stepTitle = (name: string) => expect(page.getByRole('heading', { name, level: 1 })).toBeVisible()

async function fillAccount(address = email) {
  await page.getByLabel('Email').fill(address)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Confirm password').fill(password)
}
async function fillPersonal() {
  await page.getByLabel('First name').fill('Ana')
  await page.getByLabel('Last name').fill('Dela Cruz')
  await page.getByLabel('Birthdate').fill('1990-02-14')
  await page.getByRole('radio', { name: 'Female' }).check()
}
async function fillContact(name = username) {
  await page.getByLabel('Address').fill('12 Mabini Street, Quezon City')
  await page.getByLabel('Contact number').fill('+63 912 345 6789')
  await page.getByLabel('Username').fill(name)
}

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage()
  await holdBackTheEmail(page)
})

test.afterAll(async () => {
  await page.close()
  const id = sql(`select id from auth.users where email='${email}'`)
  if (id) users.push({ id, email, password })
  removeUsers(users)
})

test('each step refuses to go on until it is right, and shows nothing wrong before that', async () => {
  await page.goto('/sign-up')
  await stepTitle('Sign-in details')
  await expect(page.getByText('Enter a valid email address.')).toBeHidden()
  await noViolations()
  await proceed()
  await expect(page.getByText('Check the highlighted fields to continue.')).toBeVisible()
  await expect(page.getByText('Enter a valid email address.')).toBeVisible()
  await expect(page.getByText('Use at least 8 characters.')).toBeVisible()
  await fillAccount()
  await page.getByLabel('Confirm password').fill('something else')
  await proceed()
  await expect(page.getByText('Passwords must match.')).toBeVisible()
  await page.getByLabel('Confirm password').fill(password)
  await proceed()

  await stepTitle('Personal details')
  await noViolations()
  await page.getByLabel('First name').fill('Ana2')
  await page.getByLabel('Birthdate').fill('2999-01-01')
  await proceed()
  await expect(page.getByText('Enter 1 to 60 letters, with spaces, apostrophes, periods or hyphens.').first()).toBeVisible()
  await expect(page.getByText('Choose your birthdate.')).toBeVisible()
  await expect(page.getByText('Choose one option.')).toBeVisible()
  await fillPersonal()
  await proceed()

  await stepTitle('Contact and username')
  await noViolations()
  await page.getByLabel('Contact number').fill('123')
  await page.getByLabel('Username').fill('t4ng4')
  await proceed()
  await expect(page.getByText('Enter 7 to 15 digits. Use + only at the beginning.')).toBeVisible()
  await expect(page.getByText('Please choose a respectful username without offensive words.')).toBeVisible()
  await fillContact()
  await proceed()
  await stepTitle('Review and agree')
})

test('review shows every detail, edits keep the rest, and the agreement is required', async () => {
  await expect(page.getByText(email)).toBeVisible()
  await expect(page.getByText('1990-02-14')).toBeVisible()
  await expect(page.getByText(username)).toBeVisible()
  await noViolations()
  await page.getByRole('button', { name: 'Edit Personal details' }).click()
  await stepTitle('Personal details')
  await expect(page.getByLabel('Last name')).toHaveValue('Dela Cruz')
  await proceed()
  await proceed()
  await expect(page.getByRole('button', { name: 'Create account' })).toBeDisabled()
  await expect(page.getByText('Accept the privacy agreement to create your account.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Read the full agreement' }).click()
  await expect(page.getByText('Privacy agreement version: system-purpose-v1.')).toBeVisible()
  await page.getByRole('checkbox', { name: /consent to the use of my data/ }).check()
  await expect(page.getByRole('button', { name: 'Create account' })).toBeEnabled()
})

test('a username already in use sends the person back to change it, with nothing lost', async () => {
  const taken = await createUser(['patient'], `Taken ${tag}`)
  users.push(taken)
  sql(`insert into public.patient_profiles(user_id,username,full_name,first_name,last_name,gender,birthdate,address,contact) values('${taken.id}','taken_${tag}','Taken One','Taken','One','female','1990-01-01','12 Mabini Street','+63 912 345 6789')`)
  await page.getByRole('button', { name: 'Edit Contact and username' }).click()
  await page.getByLabel('Username').fill(`taken_${tag}`)
  await proceed()
  await page.getByRole('button', { name: 'Create account' }).click()
  await stepTitle('Contact and username')
  await expect(page.getByText('The username may already be in use')).toBeVisible()
  await expect(page.getByLabel('Address')).toHaveValue('12 Mabini Street, Quezon City')
  await page.getByLabel('Username').fill(username)
  await proceed()
  await expect(page.getByRole('checkbox', { name: /consent to the use of my data/ })).toBeChecked()
})

test('a wrong code is refused and saves nothing, and the emailed one signs the patient in as a patient', async () => {
  await page.getByRole('button', { name: 'Create account' }).click()
  await stepTitle('Check your email')
  await noViolations()
  const code = emailedCode
  expect(code).toMatch(/^\d{6}$/)
  await page.getByRole('button', { name: 'Send a new code' }).click()
  await page.getByLabel('Email code').fill(code === '000000' ? '111111' : '000000')
  await page.getByRole('button', { name: 'Verify email' }).click()
  await expect(page.getByText('This code is wrong or has expired.', { exact: false })).toBeVisible()
  expect(sql(`select count(*) from public.profiles p join auth.users u on u.id=p.id where u.email='${email}'`)).toBe('0')
  await page.getByLabel('Email code').fill(code)
  await page.getByRole('button', { name: 'Verify email' }).click()
  await expect(page).toHaveURL(/\/patient$/)
  expect(sql(`select r.role||','||p.username||','||p.first_name||','||p.last_name||','||p.gender||','||(p.consented_at is not null) from public.patient_profiles p join public.user_roles r on r.user_id=p.user_id join auth.users u on u.id=p.user_id where u.email='${email}'`))
    .toBe(`patient,${username},Ana,Dela Cruz,female,true`)
})

test('the new patient can book a session straight away', async () => {
  const day = sql(`select d::date from generate_series(current_date+3,current_date+40,interval '1 day') d
 where extract(isodow from d)<6 and not exists(select 1 from public.center_holidays h where d::date between h.starts_on and h.ends_on) order by d limit 1`)
  await page.goto('/patient/book')
  await expect(page.getByRole('heading', { name: 'Book a session', level: 1 })).toBeVisible()
  const [year, month] = sql(`select to_char(now() at time zone 'Asia/Manila','YYYY-MM')`).split('-').map(Number)
  const [toYear, toMonth] = day.split('-').map(Number)
  for (let turn = 0; turn < (toYear! - year!) * 12 + toMonth! - month!; turn += 1) await page.getByRole('button', { name: 'Next month' }).click()
  await page.locator(`[data-date="${day}"]`).click()
  await page.getByRole('region', { name: 'Choose a time' }).getByRole('button', { name: /^10:00/ }).click()
  await page.getByRole('button', { name: 'Request this time' }).click()
  await expect(page).toHaveURL(/\/patient\/bookings$/)
  await expect(page.getByRole('region', { name: 'Upcoming' }).getByRole('listitem')).toContainText('Pending')
  expect(sql(`select b.status from public.bookings b join auth.users u on u.id=b.patient_id where u.email='${email}'`)).toBe('pending')
})

test('someone who came to book, and already has an account, goes straight there', async ({ browser }) => {
  const person = await createUser(['patient'], `Book ${tag}`)
  users.push(person)
  const visitor = await (await browser.newContext()).newPage()
  await visitor.goto('/')
  await visitor.getByRole('link', { name: 'Book a session' }).first().click()
  await expect(visitor).toHaveURL(/\/sign-up\?next=book$/)
  await visitor.getByRole('link', { name: 'Sign in' }).click()
  await expect(visitor).toHaveURL(/\/sign-in\?next=book$/)
  await visitor.getByLabel('Email').fill(person.email)
  await visitor.getByLabel('Password', { exact: true }).fill(person.password)
  await visitor.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(visitor).toHaveURL(/\/patient\/book$/)
  await visitor.close()
})

test('staff who follow the same link go to their own workspace, not to booking', async ({ browser }) => {
  const person = await createUser(['therapist'], `Staff ${tag}`)
  users.push(person)
  const visitor = await (await browser.newContext()).newPage()
  await visitor.goto('/sign-in?next=book')
  await visitor.getByLabel('Email').fill(person.email)
  await visitor.getByLabel('Password', { exact: true }).fill(person.password)
  await visitor.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(visitor).toHaveURL(/\/therapist$/)
  await visitor.close()
})
