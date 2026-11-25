import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { todayAt } from '../../src/data/booking'
import { createUser, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

/** #172: a Scheduler rejects with a common reason or their own words, one by one and in bulk; the patient reads why and asks again. */
test.describe.configure({ mode: 'serial' })

const tag = randomUUID().slice(0, 8)
let scheduler: TestUser
let ana: TestUser
let ben: TestUser
let staff: Page
let patient: Page

function workingDay(after: number) {
  return sql(`select d::date from generate_series(current_date+${after},current_date+55,interval '1 day') d
 where extract(isodow from d)<6 and not exists(select 1 from public.center_holidays h where d::date between h.starts_on and h.ends_on) order by d limit 1`)
}
const manila = (date: string, hour: number) => `${date}T${String(hour).padStart(2, '0')}:00:00+08:00`
const book = async (person: TestUser, start: string, reason: string) => {
  const { data, error } = await (await signedIn(person)).rpc('request_booking', { p_request: randomUUID(), p_starts: start, p_reason: reason })
  if (error) throw error
  return data as { id: string; reference_no: string }
}
const stored = (booking: string) => sql(`select status||'|'||coalesce(status_reason,'')||'|'||coalesce(status_note,'') from public.bookings where id='${booking}'`)

async function signIn(page: Page, user: TestUser, landing: RegExp) {
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill(user.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(landing)
}
async function open(search: string) {
  await staff.goto('/scheduler/requests')
  await staff.getByLabel('Search patient, therapist or reference').fill(search)
  await staff.getByRole('button', { name: 'Search bookings' }).click()
}
const row = (name: string) => staff.getByRole('table').getByRole('row').filter({ hasText: name })

test.beforeAll(async ({ browser }) => {
  test.setTimeout(60_000)
  ;[scheduler, ana, ben] = await Promise.all([createUser(['scheduler'], `Sol ${tag}`), createUser(['patient'], `Ana ${tag}`), createUser(['patient'], `Ben ${tag}`)])
  staff = await (await browser.newContext()).newPage()
  patient = await (await browser.newContext()).newPage()
  await signIn(staff, scheduler, /\/scheduler$/)
  await signIn(patient, ana, /\/patient$/)
})
test.afterAll(async () => {
  await staff.close()
  await patient.close()
  removeUsers([scheduler, ana, ben])
})

test('a chosen reason with a note is stored as its code, and the request shows who gave it', async () => {
  const booking = await book(ana, manila(workingDay(20), 9), 'Knee pain after walking')
  await open(booking.reference_no)
  await row(`Ana ${tag}`).first().getByRole('button', { name: `Ana ${tag}` }).click()
  const panel = staff.getByRole('complementary')
  await panel.getByRole('button', { name: 'Reject', exact: true }).click()
  const dialog = staff.getByRole('dialog', { name: 'Reject', exact: true })
  await expect(dialog.getByRole('radio', { name: 'Time no longer available' })).toBeChecked()
  await dialog.getByRole('radio', { name: 'Therapist away' }).check()
  await dialog.getByLabel('Note for the patient (optional)').fill('Dana is back on Monday.')
  await dialog.getByRole('button', { name: 'Reject', exact: true }).click()
  await expect(staff.getByText('Request rejected.')).toBeVisible()
  await expect.poll(() => stored(booking.id)).toBe('rejected|therapist_away|Dana is back on Monday.')
  // The Scheduler reads the short name of what they chose, the note, and their own name in the history.
  await expect(panel).toContainText('Therapist away')
  await expect(panel).toContainText('Dana is back on Monday.')
  await expect(panel.getByRole('listitem').first()).toContainText(`Sol ${tag}`)
})

test('"Other" needs the Scheduler’s own words, kept as written', async () => {
  const booking = await book(ana, manila(workingDay(21), 10), 'Shoulder stiffness')
  await open(booking.reference_no)
  await row(`Ana ${tag}`).first().getByRole('button', { name: `Ana ${tag}` }).click()
  await staff.getByRole('complementary').getByRole('button', { name: 'Reject', exact: true }).click()
  const dialog = staff.getByRole('dialog', { name: 'Reject', exact: true })
  await dialog.getByRole('radio', { name: 'Other', exact: true }).check()
  await expect(dialog.getByLabel('Note for the patient (optional)')).toHaveCount(0)
  await dialog.getByLabel('Reason in your own words').fill('ok')
  await expect(dialog.getByRole('button', { name: 'Reject', exact: true })).toBeDisabled()
  await dialog.getByLabel('Reason in your own words').fill('The therapy room is being repaired.')
  await dialog.getByRole('button', { name: 'Reject', exact: true }).click()
  await expect.poll(() => stored(booking.id)).toBe('rejected|The therapy room is being repaired.|')
})

test('several requests are rejected together with one chosen reason', async () => {
  const day = workingDay(22)
  const first = await book(ben, manila(day, 9), 'Wrist pain')
  const second = await book(ben, manila(day, 11), 'Wrist pain again')
  await open(`Ben ${tag}`)
  await staff.getByRole('button', { name: 'Select all pending on this page' }).click()
  await expect(staff.getByText('2 selected')).toBeVisible()
  await staff.getByRole('button', { name: 'Reject selected' }).click()
  const dialog = staff.getByRole('dialog', { name: 'Reject selected' })
  await dialog.getByRole('radio', { name: 'Duplicate of another request' }).check()
  await dialog.getByRole('button', { name: 'Reject 2' }).click()
  await expect(staff.getByText('2 requests rejected.')).toBeVisible()
  await expect.poll(() => stored(first.id)).toBe('rejected|duplicate_request|')
  expect(stored(second.id)).toBe('rejected|duplicate_request|')
})

test('the patient reads why, with the note, and can ask for another time with their reason filled in', async () => {
  await patient.goto('/patient/bookings')
  const card = patient.getByRole('listitem').filter({ hasText: 'The therapist is away at that time.' })
  await expect(card).toContainText('Note from the center: Dana is back on Monday.')
  await expect(card).not.toContainText('therapist_away')
  await expect(patient.getByRole('listitem').filter({ hasText: 'The therapy room is being repaired.' })).toBeVisible()
  await card.getByRole('link', { name: 'Request another time' }).click()
  await expect(patient).toHaveURL(/\/patient\/book$/)
  // The reason shows once a time is chosen, already filled in. Choosing stays on this page, so the handed reason is kept.
  const date = workingDay(3)
  if (date.slice(0, 7) !== todayAt('Asia/Manila').slice(0, 7)) await patient.getByRole('button', { name: 'Next month' }).click()
  await patient.locator(`[data-date="${date}"]`).click()
  await patient.getByRole('region', { name: 'Choose a time' }).getByRole('button').first().click()
  await expect(patient.getByLabel('Reason for visit')).toHaveValue('Knee pain after walking')
  // Nothing about the visit is in the address.
  expect(patient.url()).not.toContain('Knee')
})

test('the in-app notification gives the same reason', async () => {
  await patient.goto('/patient/notifications')
  await expect(patient.getByRole('listitem').filter({ hasText: 'The therapist is away at that time.' }).first()).toContainText('Dana is back on Monday.')
})

test('the patient reads the reason in Filipino', async () => {
  await patient.evaluate(() => localStorage.setItem('motivance.language', 'fil'))
  await patient.goto('/patient/bookings')
  const card = patient.getByRole('listitem').filter({ hasText: 'Wala ang therapist sa oras na iyon.' })
  await expect(card).toContainText('Tala mula sa center: Dana is back on Monday.')
  await expect(card.getByRole('link', { name: 'Humiling ng ibang oras' })).toBeVisible()
  await patient.evaluate(() => localStorage.removeItem('motivance.language'))
})
