import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import { createUser, removeUsers, sql, type TestUser } from '../support/stack'

/** Marking who came, against the real local backend. Sessions that have started are written directly, because no booking can be made in the past. */
test.describe.configure({ mode: 'serial' })

const tag = randomUUID().slice(0, 8)
let scheduler: TestUser
let therapist: TestUser
let ana: TestUser
let ben: TestUser
let cai: TestUser
const pages: Page[] = []

const noViolations = (page: Page) => expect.poll(async () => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).slice(0, 3).join(' | ')}`)
}, { timeout: 8_000 }).toEqual([])

function insert(suffix: string, patient: TestUser, hours: number) {
  sql(`insert into public.bookings(id,reference_no,patient_id,therapist_id,starts_at,ends_at,status) values(gen_random_uuid(),'BK-MARK-${tag}-${suffix}','${patient.id}','${therapist.id}',
 date_trunc('hour',now())+interval '${hours} hours',date_trunc('hour',now())+interval '${hours} hours'+interval '1 hour','confirmed')`)
  return sql(`select (starts_at at time zone 'Asia/Manila')::date from public.bookings where reference_no='BK-MARK-${tag}-${suffix}'`)
}

async function signIn(browser: Browser, person: TestUser, home: RegExp) {
  const page = await (await browser.newContext({ acceptDownloads: true })).newPage()
  pages.push(page)
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(person.email)
  await page.getByLabel('Password', { exact: true }).fill(person.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(home)
  return page
}

/** Turns the calendar to a date, which may sit in another month from today. */
async function openDate(page: Page, date: string) {
  const [year, month] = sql(`select to_char(now() at time zone 'Asia/Manila','YYYY-MM')`).split('-').map(Number)
  const [toYear, toMonth] = date.split('-').map(Number)
  const months = (toYear! - year!) * 12 + toMonth! - month!
  for (let turn = 0; turn < Math.abs(months); turn += 1) await page.getByRole('button', { name: months > 0 ? 'Next month' : 'Previous month' }).click()
  await page.locator(`[data-date="${date}"]`).click()
}

async function searchSchedule(page: Page) {
  await page.goto('/scheduler/schedule')
  await page.getByLabel('Search patient, therapist or reference').fill(`BK-MARK-${tag}`)
  await page.getByRole('button', { name: 'Search bookings' }).click()
}

test.beforeAll(async () => {
  test.setTimeout(60_000)
  ;[scheduler, therapist, ana, ben, cai] = await Promise.all([createUser(['scheduler'], `Sol ${tag}`), createUser(['therapist'], `Zed ${tag}`), createUser(['patient'], `Ana ${tag}`), createUser(['patient'], `Ben ${tag}`), createUser(['patient'], `Cai ${tag}`)])
})

test.afterAll(async () => {
  for (const page of pages) await page.close()
  removeUsers([scheduler, therapist, ana, ben, cai])
})

test('a therapist marks who came from My Schedule, and can correct it', async ({ browser }) => {
  const date = insert('ANA', ana, -30)
  const coming = insert('CAI', cai, 190)
  const page = await signIn(browser, therapist, /\/therapist$/)
  await page.goto('/therapist/schedule')
  await openDate(page, date)
  const marks = page.getByRole('group', { name: `Attendance for Ana ${tag}` })
  await expect(marks.getByRole('button', { name: 'Attended' })).toHaveAttribute('aria-pressed', 'false')
  await noViolations(page)
  await marks.getByRole('button', { name: 'Attended' }).click()
  await expect(page.getByText('Attendance saved.').first()).toBeVisible()
  await expect(marks.getByRole('button', { name: 'Attended' })).toHaveAttribute('aria-pressed', 'true')
  await marks.getByRole('button', { name: 'No-show' }).click()
  await expect(marks.getByRole('button', { name: 'No-show' })).toHaveAttribute('aria-pressed', 'true')
  await expect(marks.getByRole('button', { name: 'Attended' })).toHaveAttribute('aria-pressed', 'false')
  expect(sql(`select attendance from public.bookings where reference_no='BK-MARK-${tag}-ANA'`)).toBe('no_show')

  await page.goto('/therapist/schedule')
  await openDate(page, coming)
  await expect(page.getByText(`Cai ${tag}`)).toBeVisible()
  await expect(page.getByRole('group', { name: `Attendance for Cai ${tag}` })).toBeHidden()
})

test('a patient reads My Schedule with nothing to mark', async ({ browser }) => {
  const date = insert('BEN', ben, -27)
  const page = await signIn(browser, ben, /\/patient$/)
  await page.goto('/patient/schedule')
  await openDate(page, date)
  await expect(page.getByText(`BK-MARK-${tag}-BEN`)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Attended' })).toBeHidden()
})

test('a Scheduler sees attendance in the schedule, filters by it and corrects it', async ({ browser }) => {
  const page = await signIn(browser, scheduler, /\/scheduler$/)
  await searchSchedule(page)
  await expect(page.getByText('1 to 3 of 3')).toBeVisible()
  await expect(page.getByRole('row', { name: new RegExp(`Cai ${tag}`) })).toContainText('Not started')
  await noViolations(page)

  await page.getByLabel('Attendance', { exact: true }).click()
  await page.getByRole('option', { name: 'No-show' }).click()
  await expect(page.getByText('1 to 1 of 1')).toBeVisible()
  await expect(page.getByRole('table')).toContainText(`Ana ${tag}`)

  await page.getByLabel('Attendance', { exact: true }).click()
  await page.getByRole('option', { name: 'Not marked' }).click()
  await expect(page.getByText('1 to 1 of 1')).toBeVisible()
  await expect(page.getByRole('table')).toContainText(`Ben ${tag}`)
  await page.getByRole('group', { name: `Attendance for Ben ${tag}` }).getByRole('button', { name: 'Attended' }).click()
  await expect(page.getByText('Attendance saved.').first()).toBeVisible()
  await expect(page.getByRole('group', { name: `Attendance for Ben ${tag}` })).toBeHidden()
  expect(sql(`select attendance||','||(attendance_by='${scheduler.id}') from public.bookings where reference_no='BK-MARK-${tag}-BEN'`)).toBe('attended,true')
})

test('an export says who came', async ({ browser }) => {
  const page = await signIn(browser, scheduler, /\/scheduler$/)
  await searchSchedule(page)
  await expect(page.getByText('1 to 3 of 3')).toBeVisible()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export XLSX' }).click()])
  const files = unzipSync(readFileSync(await download.path()))
  const text = Object.entries(files).filter(([name]) => name.endsWith('.xml')).map(([, data]) => strFromU8(data)).join('\n')
  expect(text).toContain('Attendance')
  expect(text).toContain('No-show')
  expect(text).toContain('Attended')
})

test('the booking history records each change and what it was', async ({ browser }) => {
  const page = await signIn(browser, scheduler, /\/scheduler$/)
  await page.goto('/scheduler/requests')
  await page.getByLabel('Search patient, therapist or reference').fill(`BK-MARK-${tag}-ANA`)
  await page.getByRole('button', { name: 'Search bookings' }).click()
  await page.getByRole('button', { name: `Ana ${tag}` }).click()
  const details = page.getByRole('complementary', { name: new RegExp(`BK-MARK-${tag}-ANA`) })
  await expect(details.getByText('Attendance recorded')).toHaveCount(2)
  await expect(details.getByText('No-show')).toBeVisible()
})
