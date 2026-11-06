import { randomUUID } from 'node:crypto'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { createUser, link, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

/** The Scheduler's table against the real local backend. Every row carries a tag, so other tests' bookings stay out of view. */
test.describe.configure({ mode: 'serial' })

const tag = randomUUID().slice(0, 8)
let scheduler: TestUser
let linked: TestUser
let other: TestUser
let ana: TestUser
let ben: TestUser
let cara: TestUser
let page: Page

function workingDay(after: number) {
  return sql(`select d::date from generate_series(current_date+${after},current_date+55,interval '1 day') d
 where extract(isodow from d)<6 and not exists(select 1 from public.center_holidays h where d::date between h.starts_on and h.ends_on) order by d limit 1`)
}
const manila = (date: string, hour: number) => `${date}T${String(hour).padStart(2, '0')}:00:00+08:00`
const book = async (person: TestUser, start: string) => {
  const { data, error } = await (await signedIn(person)).rpc('request_booking', { p_request: randomUUID(), p_starts: start })
  if (error) throw error
  return data as { id: string; reference_no: string }
}
const status = (booking: string) => sql(`select status from public.bookings where id='${booking}'`)
const expiryJob = (active: boolean) => sql(`select cron.alter_job((select jobid from cron.job where jobname='expire-booking-requests'),active:=${active})`)

const noViolations = () => expect.poll(async () => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).slice(0, 3).join(' | ')}`)
}, { timeout: 8_000 }).toEqual([])

async function open(search = tag) {
  await page.goto('/scheduler/requests')
  await page.getByLabel('Search patient, therapist or reference').fill(search)
  await page.getByRole('button', { name: 'Search bookings' }).click()
}
const row = (name: string) => page.getByRole('table').getByRole('row').filter({ hasText: name })
const details = async (name: string) => {
  await row(name).first().getByRole('button', { name }).click()
  return page.getByRole('complementary')
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(60_000)
  ;[scheduler, linked, other, ana, ben, cara] = await Promise.all([
    createUser(['scheduler'], `Sol ${tag}`), createUser(['therapist'], `Zed ${tag}`), createUser(['therapist'], `Amy ${tag}`),
    createUser(['patient'], `Ana ${tag}`), createUser(['patient'], `Ben ${tag}`), createUser(['patient'], `Cara ${tag}`),
  ])
  await link(linked, ana)
  page = await (await browser.newContext()).newPage()
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(scheduler.email)
  await page.getByLabel('Password', { exact: true }).fill(scheduler.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/scheduler$/)
})

test.afterAll(async () => {
  expiryJob(true)
  await page.close()
  removeUsers([scheduler, linked, other, ana, ben, cara])
})

test('the table searches, filters and sorts on the server', async () => {
  const first = await book(ana, manila(workingDay(22), 9))
  await book(ben, manila(workingDay(23), 9))
  await open()
  await expect(row(`Ana ${tag}`)).toContainText('Pending')
  await expect(row(`Ben ${tag}`)).toBeVisible()
  await expect(page.getByText('1 to 2 of 2')).toBeVisible()
  await page.getByRole('button', { name: 'Patient', exact: true }).click()
  await expect(page.getByRole('table').getByRole('row').nth(1)).toContainText(`Ana ${tag}`)
  await page.getByRole('button', { name: 'Patient', exact: true }).click()
  await expect(page.getByRole('table').getByRole('row').nth(1)).toContainText(`Ben ${tag}`)
  await open(first.reference_no)
  await expect(page.getByText('1 to 1 of 1')).toBeVisible()
  await expect(row(`Ana ${tag}`)).toBeVisible()
  await open()
  await page.getByLabel('Status').click()
  await page.getByRole('option', { name: 'Confirmed' }).click()
  await expect(page.getByRole('heading', { name: 'No bookings to show' })).toBeVisible()
  await noViolations()
})

test('confirming lists the linked therapist first, and marks who is busy', async () => {
  await open()
  const panel = await details(`Ana ${tag}`)
  await panel.getByRole('button', { name: 'Confirm', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Confirm booking' })
  await expect(dialog).toContainText(`Ana ${tag}`)
  const first = dialog.getByRole('radio').first()
  await expect(first).toBeChecked()
  await expect(dialog.locator('label').first()).toContainText(`Zed ${tag}`)
  await expect(dialog.locator('label').first()).toContainText('Linked')
  await noViolations()
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.getByText('Booking confirmed.')).toBeVisible()
  await expect(row(`Ana ${tag}`)).toContainText('Confirmed')
  await expect(row(`Ana ${tag}`)).toContainText(`Zed ${tag}`)
  await expect(panel.getByRole('listitem').first()).toContainText('Confirmed')
  await expect(panel.getByRole('listitem').first()).toContainText(`Sol ${tag}`)
})

test('rejecting needs a reason, and the reason is kept', async () => {
  await open()
  const panel = await details(`Ben ${tag}`)
  await panel.getByRole('button', { name: 'Reject', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Reject' })
  await expect(dialog.getByRole('button', { name: 'Reject', exact: true })).toBeDisabled()
  await dialog.getByLabel('Reason').fill('No therapist that week')
  await dialog.getByRole('button', { name: 'Reject', exact: true }).click()
  await expect(page.getByText('Request rejected.')).toBeVisible()
  await expect(row(`Ben ${tag}`)).toContainText('Rejected')
  await expect(panel).toContainText('No therapist that week')
  await expect(panel.getByRole('button', { name: 'Reschedule' })).toHaveCount(0)
})

test('rescheduling picks a specific time and a therapist', async () => {
  await open()
  const panel = await details(`Ana ${tag}`)
  await panel.getByRole('button', { name: 'Reschedule' }).click()
  const dialog = page.getByRole('dialog', { name: 'Reschedule' })
  await expect(dialog.getByRole('button', { name: 'Reschedule', exact: true })).toBeDisabled()
  await dialog.locator('[data-date][aria-disabled="false"]').last().click()
  await dialog.getByRole('region', { name: 'Choose a time' }).getByRole('button').nth(3).click()
  await expect(dialog.getByRole('radio').first()).toBeChecked()
  await noViolations()
  await dialog.getByRole('button', { name: 'Reschedule', exact: true }).click()
  await expect(page.getByText('Booking rescheduled.')).toBeVisible()
  await expect(row(`Ana ${tag}`)).toContainText('Rescheduled')
  await expect(row(`Ana ${tag}`)).toContainText('12:00')
  await expect(panel.getByRole('listitem').first()).toContainText('Moved to')
})

test('the therapist can be changed', async () => {
  await open()
  const panel = await details(`Ana ${tag}`)
  await panel.getByRole('button', { name: 'Change therapist' }).click()
  const dialog = page.getByRole('dialog', { name: 'Change therapist' })
  await dialog.locator('label').filter({ hasText: `Amy ${tag}` }).click()
  await dialog.getByRole('button', { name: 'Save therapist' }).click()
  await expect(page.getByText('Therapist saved.')).toBeVisible()
  await expect(row(`Ana ${tag}`)).toContainText(`Amy ${tag}`)
})

test('a booking can be kept or cancelled, with a reason', async () => {
  await open()
  const panel = await details(`Ana ${tag}`)
  await panel.getByRole('button', { name: 'Cancel booking' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Keep booking' }).click()
  await expect(row(`Ana ${tag}`)).toContainText('Rescheduled')
  await panel.getByRole('button', { name: 'Cancel booking' }).click()
  const dialog = page.getByRole('dialog', { name: 'Cancel booking' })
  await dialog.getByLabel('Reason').fill('Patient asked us to')
  await dialog.getByRole('button', { name: 'Cancel booking' }).click()
  await expect(page.getByText('Booking cancelled.')).toBeVisible()
  await expect(row(`Ana ${tag}`)).toContainText('Cancelled')
})

test('a request someone else just decided is refused in plain words, and the list catches up', async () => {
  const stale = await book(cara, manila(workingDay(24), 11))
  await open()
  const panel = await details(`Cara ${tag}`)
  await panel.getByRole('button', { name: 'Confirm', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Confirm booking' })
  await expect(dialog.getByRole('radio').first()).toBeChecked()
  const colleague = await signedIn(scheduler)
  await colleague.rpc('scheduler_reject', { p_booking: stale.id, p_reason: 'Decided elsewhere' })
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.getByText('This booking has changed. Refresh and try again.')).toBeVisible()
  await expect(dialog).toBeHidden()
  await expect(row(`Cara ${tag}`)).toContainText('Rejected')
})

test('a therapist who has just become busy can be swapped without leaving the dialog', async () => {
  const day = workingDay(25)
  const taken = await book(ben, manila(day, 10))
  const waiting = await book(cara, manila(day, 10))
  await open(`Cara ${tag}`)
  await page.getByRole('table').getByRole('row').filter({ hasText: waiting.reference_no }).getByRole('button', { name: `Cara ${tag}` }).click()
  await page.getByRole('complementary').getByRole('button', { name: 'Confirm', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Confirm booking' })
  await dialog.locator('label').filter({ hasText: `Amy ${tag}` }).click()
  expect((await (await signedIn(scheduler)).rpc('scheduler_confirm', { p_booking: taken.id, p_therapist: other.id })).error).toBeNull()
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.getByText('That therapist already has a session at that time.')).toBeVisible()
  await expect(dialog).toBeVisible()
  const amy = dialog.locator('label').filter({ hasText: `Amy ${tag}` })
  await expect(amy).toContainText('Busy')
  await expect(amy.getByRole('radio')).toBeDisabled()
  await expect(dialog.getByRole('radio', { checked: true })).toHaveCount(1)
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.getByText('Booking confirmed.')).toBeVisible()
  await expect(dialog).toBeHidden()
})

test('outdated requests are found and rejected together', async () => {
  // These rows are exactly what the expiry job closes, so it waits until this suite has finished with them.
  expiryJob(false)
  const past = (days: number) => `now()-interval '${days} days'`
  const ids = [randomUUID(), randomUUID()]
  sql(`insert into public.bookings(id,reference_no,patient_id,starts_at,ends_at,status) values
 ('${ids[0]}','BK-OLD-${tag}1','${cara.id}',${past(3)},${past(3)}+interval '1 hour','pending'),('${ids[1]}','BK-OLD-${tag}2','${cara.id}',${past(5)},${past(5)}+interval '1 hour','pending')`)
  await open(`Cara ${tag}`)
  await page.getByRole('button', { name: 'Outdated' }).click()
  await expect(page.getByText('1 to 2 of 2')).toBeVisible()
  await page.getByRole('button', { name: 'Select all pending on this page' }).click()
  await expect(page.getByText('2 selected')).toBeVisible()
  await page.getByRole('button', { name: 'Reject selected' }).click()
  const dialog = page.getByRole('dialog', { name: 'Reject selected' })
  await expect(dialog).toContainText('Reject 2 pending requests')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()

  // A request decided on its own leaves the selection, so the count stays true.
  const panel = await details(`Cara ${tag}`)
  await panel.getByRole('button', { name: 'Reject', exact: true }).click()
  const single = page.getByRole('dialog', { name: 'Reject', exact: true })
  await single.getByLabel('Reason').fill('Outdated request')
  await single.getByRole('button', { name: 'Reject', exact: true }).click()
  await expect(page.getByText('1 to 1 of 1')).toBeVisible()
  await expect(page.getByText('1 selected')).toBeVisible()

  await page.getByRole('button', { name: 'Reject selected' }).click()
  await expect(dialog).toContainText('Reject 1 pending request.')
  await dialog.getByLabel('Reason').fill('Outdated request')
  await dialog.getByRole('button', { name: 'Reject 1' }).click()
  await expect(page.getByText('1 request rejected.')).toBeVisible()
  await expect.poll(() => status(ids[0]!)).toBe('rejected')
  expect(status(ids[1]!)).toBe('rejected')
})

test('the table pages through the results', async () => {
  const starts = Array.from({ length: 27 }, (_, index) => `(gen_random_uuid(),'BK-PAGE-${tag}-${index}','${ben.id}',now()+interval '${index + 40} days',now()+interval '${index + 40} days 1 hour','cancelled')`)
  sql(`insert into public.bookings(id,reference_no,patient_id,starts_at,ends_at,status) values ${starts.join(',')}`)
  await open(`BK-PAGE-${tag}`)
  await expect(page.getByText('1 to 25 of 27')).toBeVisible()
  await expect(page.getByText('Page 1 of 2')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Previous page' })).toBeDisabled()
  await page.getByRole('button', { name: 'Next page' }).click()
  await expect(page.getByText('26 to 27 of 27')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled()
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(3)
})

test('deciding the only row on the last page steps back to a page with rows', async () => {
  const starts = Array.from({ length: 26 }, (_, index) => `(gen_random_uuid(),'BK-LAST-${tag}-${index}','${cara.id}',now()+interval '${index + 70} days',now()+interval '${index + 70} days 1 hour','pending')`)
  sql(`insert into public.bookings(id,reference_no,patient_id,starts_at,ends_at,status) values ${starts.join(',')}`)
  await open(`BK-LAST-${tag}`)
  await page.getByLabel('Status').click()
  await page.getByRole('option', { name: 'Pending' }).click()
  await expect(page.getByText('1 to 25 of 26')).toBeVisible()
  await page.getByRole('button', { name: 'Next page' }).click()
  await expect(page.getByText('26 to 26 of 26')).toBeVisible()
  const panel = await details(`Cara ${tag}`)
  await panel.getByRole('button', { name: 'Reject', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Reject', exact: true })
  await dialog.getByLabel('Reason').fill('Too far ahead')
  await dialog.getByRole('button', { name: 'Reject', exact: true }).click()
  await expect(page.getByText('1 to 25 of 25')).toBeVisible()
  await expect(page.getByText('Page 1 of 1')).toBeVisible()
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(26)
})
