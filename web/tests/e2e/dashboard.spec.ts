import { randomUUID } from 'node:crypto'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { createUser, removeUsers, sql, type TestUser } from '../support/stack'

/** The Scheduler's opening page against the real local backend. Other suites share the data, so the figures are compared with what the server says now. */
test.describe.configure({ mode: 'serial' })

const tag = randomUUID().slice(0, 8)
let scheduler: TestUser
let zed: TestUser
let ana: TestUser
let page: Page

const count = (where: string) => sql(`select count(*) from public.bookings where ${where}`)
const noViolations = () => expect.poll(async () => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).slice(0, 3).join(' | ')}`)
}, { timeout: 8_000 }).toEqual([])

test.beforeAll(async ({ browser }) => {
  test.setTimeout(60_000)
  ;[scheduler, zed, ana] = await Promise.all([createUser(['scheduler'], `Sol ${tag}`), createUser(['therapist'], `Zed ${tag}`), createUser(['patient'], `Ana ${tag}`)])
  sql(`insert into public.bookings(id,reference_no,patient_id,starts_at,ends_at,status) values(gen_random_uuid(),'BK-DSH-${tag}-P','${ana.id}',now()+interval '300 days',now()+interval '300 days 1 hour','pending');
insert into public.bookings(id,reference_no,patient_id,therapist_id,starts_at,ends_at,status) values(gen_random_uuid(),'BK-DSH-${tag}-T','${ana.id}','${zed.id}',date_trunc('day',now() at time zone 'Asia/Manila') at time zone 'Asia/Manila'+interval '1 hour',date_trunc('day',now() at time zone 'Asia/Manila') at time zone 'Asia/Manila'+interval '2 hours','confirmed')`)
  page = await (await browser.newContext()).newPage()
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(scheduler.email)
  await page.getByLabel('Password', { exact: true }).fill(scheduler.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/scheduler$/)
})

test.afterAll(async () => {
  await page.close()
  removeUsers([scheduler, zed, ana])
})

test('the workspace opens on the figures from the server, and says what utilization means', async () => {
  const pending = count(`status='pending'`)
  await expect(page.getByRole('link', { name: `Pending requests: ${pending}` })).toBeVisible()
  await expect(page.getByRole('link', { name: /^Today's sessions: [1-9]/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /^Utilization this week: / })).toBeVisible()
  await expect(page.getByText(/^Utilization is booked sessions as a share of available places in open slots, from /)).toBeVisible()
  await noViolations()
})

test('pending requests opens the requests, already filtered', async () => {
  await page.goto('/scheduler')
  await page.getByRole('link', { name: /^Pending requests: / }).click()
  await expect(page).toHaveURL(/\/scheduler\/requests\?status=pending$/)
  await expect(page.getByLabel('Status')).toContainText('Pending')
  await expect(page.getByRole('table')).toContainText('Pending')
  await expect(page.getByRole('table')).not.toContainText('Cancelled')
})

test('today opens the schedule on today, and lists the session it counted', async () => {
  await page.goto('/scheduler')
  await page.getByRole('link', { name: /^Today's sessions: / }).click()
  await expect(page).toHaveURL(/\/scheduler\/schedule\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/)
  const today = sql(`select (now() at time zone 'Asia/Manila')::date`)
  await expect(page.getByLabel('From')).toHaveValue(today)
  await expect(page.getByLabel('Through')).toHaveValue(today)
  await expect(page.getByRole('table')).toContainText(`Ana ${tag}`)
})

test('utilization opens the schedule on the whole week', async () => {
  await page.goto('/scheduler')
  await page.getByRole('link', { name: /^Utilization this week: / }).click()
  const monday = sql(`select date_trunc('week',now() at time zone 'Asia/Manila')::date`)
  await expect(page.getByLabel('From')).toHaveValue(monday)
  await expect(page.getByLabel('Through')).toHaveValue(sql(`select ('${monday}'::date+6)`))
})
