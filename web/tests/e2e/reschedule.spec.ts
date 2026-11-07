import { randomUUID } from 'node:crypto'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { todayAt } from '../../src/data/booking'
import { createUser, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

/** A patient moving their own session, against the real local backend. */
test.describe.configure({ mode: 'serial' })

let patient: TestUser
let therapist: TestUser
let scheduler: TestUser
let holders: TestUser[]
let page: Page
let day: string
let booking: string

const manila = (date: string, hour: number) => `${date}T${String(hour).padStart(2, '0')}:00:00+08:00`
const times = () => page.getByRole('region', { name: 'Choose a time' })
const noViolations = () => expect.poll(async () => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).slice(0, 3).join(' | ')}`)
}, { timeout: 8_000 }).toEqual([])

async function openDate() {
  await page.goto(`/patient/bookings/${booking}/move`)
  await expect(page.getByRole('heading', { name: 'Move your session', level: 1 })).toBeVisible()
  const now = todayAt('Asia/Manila').slice(0, 7)
  for (let month = now; month < day.slice(0, 7); month = month === `${month.slice(0, 4)}-12` ? `${Number(month.slice(0, 4)) + 1}-01` : `${month.slice(0, 5)}${String(Number(month.slice(5)) + 1).padStart(2, '0')}`) {
    await page.getByRole('button', { name: 'Next month' }).click()
  }
  await page.locator(`[data-date="${day}"]`).click()
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(60_000)
  const tag = randomUUID().slice(0, 8)
  ;[patient, therapist, scheduler, ...holders] = await Promise.all([
    createUser(['patient'], `Ana ${tag}`), createUser(['therapist'], `Zed ${tag}`), createUser(['scheduler'], `Sol ${tag}`), ...[1, 2, 3].map((index) => createUser(['patient'], `Holder ${index} ${tag}`)),
  ])
  day = sql(`select d::date from generate_series(current_date+33,current_date+50,interval '1 day') d
 where extract(isodow from d)<6 and not exists(select 1 from public.center_holidays h where d::date between h.starts_on and h.ends_on) order by d limit 1`)
  for (const holder of holders) {
    const { error } = await (await signedIn(holder)).rpc('request_booking', { p_request: randomUUID(), p_starts: manila(day, 14) })
    if (error) throw error
  }
  const { data, error } = await (await signedIn(patient)).rpc('request_booking', { p_request: randomUUID(), p_starts: manila(day, 9) })
  if (error) throw error
  booking = (data as { id: string }).id
  const confirmed = await (await signedIn(scheduler)).rpc('scheduler_confirm', { p_booking: booking, p_therapist: therapist.id })
  if (confirmed.error) throw confirmed.error
  page = await (await browser.newContext()).newPage()
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(patient.email)
  await page.getByLabel('Password', { exact: true }).fill(patient.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/patient$/)
})

test.afterAll(async () => {
  await page.close()
  removeUsers([patient, therapist, scheduler, ...holders])
})

test('My bookings says a session can be moved, how often and until when', async () => {
  await page.goto('/patient/bookings')
  await expect(page.getByText(/^Moves left: 2\. You can move it until /)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Move session' })).toBeVisible()
  await noViolations()
})

test('a held or full time cannot be chosen, and there is no waitlist here', async () => {
  await openDate()
  await expect(page.getByText('Your session now')).toBeVisible()
  await expect(times().getByRole('button', { name: /^9:00.*You have a booking at this time$/ })).toBeDisabled()
  await expect(times().getByRole('button', { name: /^2:00.*Full$/ })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Join the waitlist' })).toBeHidden()
  await noViolations()
})

test('moving a confirmed session sends it back to Pending at the new time', async () => {
  await openDate()
  await times().getByRole('button', { name: /^11:00/ }).click()
  await expect(page.getByText('New time')).toBeVisible()
  await noViolations()
  await page.getByRole('button', { name: 'Move to this time' }).click()
  await expect(page.getByText('Session moved. A Scheduler will confirm it.')).toBeVisible()
  await expect(page).toHaveURL(/\/patient\/bookings$/)
  const card = page.getByRole('region', { name: 'Upcoming' }).getByRole('listitem')
  await expect(card).toContainText('Pending')
  await expect(card).toContainText('11:00')
  await expect(card).toContainText(`Zed`)
  await expect(page.getByText(/^Moves left: 1\./)).toBeVisible()
})

test('a time taken while choosing is refused in plain words, and the page recovers', async () => {
  await openDate()
  await times().getByRole('button', { name: /^3:00/ }).click()
  for (const holder of holders) {
    const { error } = await (await signedIn(holder)).rpc('request_booking', { p_request: randomUUID(), p_starts: manila(day, 15) })
    expect(error).toBeNull()
  }
  await page.getByRole('button', { name: 'Move to this time' }).click()
  await expect(page.getByText('That time has just filled up. Choose another.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Move to this time' })).toBeHidden()
  await expect(times().getByRole('button', { name: /^3:00.*Full$/ })).toBeDisabled()
})

test('with no moves left, the app says so and an old link does too', async () => {
  await openDate()
  await times().getByRole('button', { name: /^10:00/ }).click()
  await page.getByRole('button', { name: 'Move to this time' }).click()
  await expect(page).toHaveURL(/\/patient\/bookings$/)
  await expect(page.getByText('This can no longer be moved online. Contact the center.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Move session' })).toBeHidden()
  await page.goto(`/patient/bookings/${booking}/move`)
  await expect(page.getByRole('heading', { name: 'This session cannot be moved' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'My bookings' }).first()).toBeVisible()
  await noViolations()
})
