import { randomUUID } from 'node:crypto'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { todayAt } from '../../src/data/booking'
import { createUser, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

/** Waiting for a full time, from the patient's side, against the real local backend. */
test.describe.configure({ mode: 'serial' })

let patient: TestUser
let holders: TestUser[]
let page: Page
let day: string
let held: Array<{ id: string }>

const manila = (date: string, hour: number) => `${date}T${String(hour).padStart(2, '0')}:00:00+08:00`

async function openDate() {
  await page.goto('/patient/book')
  const now = todayAt('Asia/Manila').slice(0, 7)
  for (let month = now; month < day.slice(0, 7); month = month === `${month.slice(0, 4)}-12` ? `${Number(month.slice(0, 4)) + 1}-01` : `${month.slice(0, 5)}${String(Number(month.slice(5)) + 1).padStart(2, '0')}`) {
    await page.getByRole('button', { name: 'Next month' }).click()
  }
  await page.locator(`[data-date="${day}"]`).click()
}

const times = () => page.getByRole('region', { name: 'Choose a time' })
const noViolations = () => expect.poll(async () => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).slice(0, 3).join(' | ')}`)
}, { timeout: 8_000 }).toEqual([])

test.beforeAll(async ({ browser }) => {
  test.setTimeout(60_000)
  const tag = randomUUID().slice(0, 8)
  ;[patient, ...holders] = await Promise.all([createUser(['patient'], `Ana ${tag}`), ...[1, 2, 3].map((index) => createUser(['patient'], `Holder ${index} ${tag}`))])
  day = sql(`select d::date from generate_series(current_date+30,current_date+50,interval '1 day') d
 where extract(isodow from d)<6 and not exists(select 1 from public.center_holidays h where d::date between h.starts_on and h.ends_on) order by d limit 1`)
  held = []
  for (const hour of [9, 10]) {
    for (const holder of holders) {
      const { data, error } = await (await signedIn(holder)).rpc('request_booking', { p_request: randomUUID(), p_starts: manila(day, hour) })
      if (error) throw error
      held.push(data as { id: string })
    }
  }
  page = await (await browser.newContext()).newPage()
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(patient.email)
  await page.getByLabel('Password', { exact: true }).fill(patient.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/patient$/)
})

test.afterAll(async () => {
  await page.close()
  removeUsers([patient, ...holders])
})

test('a full time can be joined, and says so afterwards', async () => {
  await openDate()
  await times().getByRole('button', { name: /^9:00.*Full$/ }).click()
  await expect(page.getByText('This time is full')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Request this time' })).toBeHidden()
  await noViolations()
  await page.getByRole('button', { name: 'Join the waitlist' }).click()
  await expect(page.getByText('You are on the waitlist.')).toBeVisible()
  await expect(times().getByRole('button', { name: /^9:00.*On the waitlist$/ })).toBeVisible()
})

test('leaving from the calendar puts the time back to full', async () => {
  await openDate()
  await times().getByRole('button', { name: /^10:00.*Full$/ }).click()
  await page.getByRole('button', { name: 'Join the waitlist' }).click()
  await expect(times().getByRole('button', { name: /^10:00.*On the waitlist$/ })).toBeVisible()
  await times().getByRole('button', { name: /^10:00.*On the waitlist$/ }).click()
  await page.getByRole('button', { name: 'Leave the waitlist' }).click()
  await expect(page.getByText('You left the waitlist.')).toBeVisible()
  await expect(times().getByRole('button', { name: /^10:00.*Full$/ })).toBeVisible()
})

test('My bookings keeps the place in line, with no bookings yet', async () => {
  await page.goto('/patient/bookings')
  const list = page.getByRole('region', { name: 'Waitlist' })
  await expect(list.getByText('Waiting')).toBeVisible()
  await expect(list.getByRole('button', { name: 'Book this time' })).toBeHidden()
  await noViolations()
})

test('a place opening reaches the bell, and leads to booking it', async () => {
  const holder = await signedIn(holders[0]!)
  const { error } = await holder.rpc('cancel_my_booking', { p_booking: held[0]!.id })
  expect(error).toBeNull()
  await page.goto('/patient/notifications')
  const news = page.getByRole('button', { name: /A place has opened on .*\. The first to book gets it\./ })
  await expect(news).toBeVisible()
  await news.click()
  await expect(page).toHaveURL(/\/patient\/bookings$/)
  const list = page.getByRole('region', { name: 'Waitlist' })
  await expect(list.getByText('Place open')).toBeVisible()
  await noViolations()
  await list.getByRole('button', { name: 'Book this time' }).click()
  await expect(page.getByText('Request sent. A Scheduler will confirm it.')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Waitlist' })).toBeHidden()
  await expect(page.getByRole('region', { name: 'Upcoming' }).getByText('Pending')).toBeVisible()
})

test('a place someone else took stops being offered', async () => {
  await openDate()
  await times().getByRole('button', { name: /^10:00.*Full$/ }).click()
  await page.getByRole('button', { name: 'Join the waitlist' }).click()
  await expect(times().getByRole('button', { name: /^10:00.*On the waitlist$/ })).toBeVisible()
  const holder = await signedIn(holders[1]!)
  expect((await holder.rpc('cancel_my_booking', { p_booking: held[4]!.id })).error).toBeNull()
  await page.goto('/patient/bookings')
  const list = page.getByRole('region', { name: 'Waitlist' })
  await expect(list.getByText('Place open')).toBeVisible()
  const { error } = await (await signedIn(holders[1]!)).rpc('request_booking', { p_request: randomUUID(), p_starts: manila(day, 10) })
  expect(error).toBeNull()
  await list.getByRole('button', { name: 'Book this time' }).click()
  await expect(page.getByText('That time has just filled up. Choose another.')).toBeVisible()
  await expect(list.getByText('Waiting')).toBeVisible()
  await expect(list.getByRole('button', { name: 'Book this time' })).toBeHidden()
})
