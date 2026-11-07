import { randomUUID } from 'node:crypto'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { createUser, removeUsers, sql, type TestUser } from '../support/stack'

/** A Scheduler booking a weekly course, against the real local backend. */
test.describe.configure({ mode: 'serial' })

const tag = randomUUID().slice(0, 8)
let scheduler: TestUser
let zed: TestUser
let ana: TestUser
let ben: TestUser
let page: Page
let first: string

const noViolations = () => expect.poll(async () => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).slice(0, 3).join(' | ')}`)
}, { timeout: 8_000 }).toEqual([])

const dialog = () => page.getByRole('dialog')

/** Fills in the course, with the calendar turned to its first date. */
async function chooseCourse() {
  await page.goto('/scheduler/schedule')
  await page.getByRole('button', { name: 'Book weekly sessions' }).click()
  await dialog().getByLabel('Find a patient').fill(`Ana ${tag}`)
  await dialog().getByRole('radio', { name: `Ana ${tag}` }).check()
  await dialog().getByLabel('Therapist').click()
  await page.getByRole('option', { name: `Zed ${tag}` }).click()
  await dialog().getByLabel('Number of weeks').fill('3')
  const [year, month] = sql(`select to_char(now() at time zone 'Asia/Manila','YYYY-MM')`).split('-').map(Number)
  const [toYear, toMonth] = first.split('-').map(Number)
  for (let turn = 0; turn < (toYear! - year!) * 12 + toMonth! - month!; turn += 1) await dialog().getByRole('button', { name: 'Next month' }).click()
  await dialog().locator(`[data-date="${first}"]`).click()
  await dialog().getByRole('region', { name: 'Choose a time' }).getByRole('button', { name: /^9:00/ }).click()
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(60_000)
  ;[scheduler, zed, ana, ben] = await Promise.all([createUser(['scheduler'], `Sol ${tag}`), createUser(['therapist'], `Zed ${tag}`), createUser(['patient'], `Ana ${tag}`), createUser(['patient'], `Ben ${tag}`)])
  first = sql(`select d::date from generate_series(current_date+70,current_date+120,interval '1 day') d where extract(isodow from d)<6
 and not exists(select 1 from public.center_holidays h,generate_series(0,2) n where (d+make_interval(weeks=>n))::date between h.starts_on and h.ends_on) order by d limit 1`)
  const second = sql(`select ('${first}'::date+7)`)
  sql(`insert into public.bookings(id,reference_no,patient_id,therapist_id,starts_at,ends_at,status) values(gen_random_uuid(),'BK-WK-${tag}','${ben.id}','${zed.id}','${second}T09:00:00+08:00','${second}T10:00:00+08:00','confirmed')`)
  page = await (await browser.newContext()).newPage()
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(scheduler.email)
  await page.getByLabel('Password', { exact: true }).fill(scheduler.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/scheduler$/)
})

test.afterAll(async () => {
  await page.close()
  removeUsers([scheduler, zed, ana, ben])
})

test('nothing can be checked until the course is complete', async () => {
  await page.goto('/scheduler/schedule')
  await page.getByRole('button', { name: 'Book weekly sessions' }).click()
  await expect(dialog().getByRole('button', { name: 'Check dates' })).toBeDisabled()
  await dialog().getByLabel('Number of weeks').fill('40')
  await expect(dialog().getByText('From 2 to 26.').first()).toBeVisible()
  await noViolations()
})

test('every date is shown with any conflict before saving, and going back keeps the choices', async () => {
  await chooseCourse()
  await dialog().getByRole('button', { name: 'Check dates' }).click()
  await expect(dialog().getByRole('heading', { name: 'Check the dates' })).toBeVisible()
  await expect(dialog().getByRole('listitem')).toHaveCount(3)
  await expect(dialog().getByRole('listitem').nth(0)).toContainText('Free')
  await expect(dialog().getByRole('listitem').nth(1)).toContainText('Therapist busy')
  await expect(dialog().getByText('Dates with a problem are left out.')).toBeVisible()
  await noViolations()
  expect(sql(`select count(*) from public.booking_series where patient_id='${ana.id}'`)).toBe('0')
  await dialog().getByRole('button', { name: 'Change the details' }).click()
  await expect(dialog().getByRole('radio', { name: `Ana ${tag}` })).toBeChecked()
  await expect(dialog().getByLabel('Number of weeks')).toHaveValue('3')
})

test('saving confirms only the dates that pass', async () => {
  await chooseCourse()
  await dialog().getByRole('button', { name: 'Check dates' }).click()
  await dialog().getByRole('button', { name: 'Book 2 sessions' }).click()
  await expect(page.getByText('2 of 3 weekly sessions booked.')).toBeVisible()
  await expect(dialog()).toBeHidden()
  await page.getByLabel('Search patient, therapist or reference').fill(`Ana ${tag}`)
  await page.getByRole('button', { name: 'Search bookings' }).click()
  await expect(page.getByText('1 to 2 of 2')).toBeVisible()
  await expect(page.getByRole('table').getByText('Weekly').first()).toBeVisible()
})

test('the remaining sessions can be cancelled together, with a reason', async () => {
  await page.goto('/scheduler/requests')
  await page.getByLabel('Search patient, therapist or reference').fill(`Ana ${tag}`)
  await page.getByRole('button', { name: 'Search bookings' }).click()
  await page.getByRole('button', { name: `Ana ${tag}` }).first().click()
  const details = page.getByRole('complementary')
  await expect(details.getByText('Weekly sessions still to come')).toBeVisible()
  await details.getByRole('button', { name: 'Cancel remaining sessions' }).click()
  await expect(dialog()).toContainText(`This cancels 2 sessions for Ana ${tag}.`)
  await expect(dialog().getByRole('button', { name: 'Cancel remaining sessions' })).toBeDisabled()
  await dialog().getByLabel('Reason').fill('Course finished early')
  await noViolations()
  await dialog().getByRole('button', { name: 'Cancel remaining sessions' }).click()
  await expect(page.getByText('2 sessions cancelled.')).toBeVisible()
  await expect(details.getByRole('button', { name: 'Cancel remaining sessions' })).toBeHidden()
  expect(sql(`select string_agg(distinct status||':'||status_reason,',') from public.bookings where patient_id='${ana.id}'`)).toBe('cancelled:Course finished early')
})
