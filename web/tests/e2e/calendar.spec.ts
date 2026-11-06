import { randomUUID } from 'node:crypto'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { createUser, removeUsers, sql, type TestUser } from '../support/stack'

/**
 * The Calendar page against the real local backend. Closures and holidays sit past the booking window, so they touch no date
 * another suite is using. Hours and rules are shared by every suite, so those saves are intercepted here: the live API test
 * in scripts/test_booking.py runs them for real, one at a time.
 */
test.describe.configure({ mode: 'serial' })

const tag = randomUUID().slice(0, 8)
const farDay = (after: number) => sql(`select d::date from generate_series(current_date+${after},current_date+${after + 14},interval '1 day') d
 where extract(isodow from d)<6 and not exists(select 1 from public.center_holidays h where d::date between h.starts_on and h.ends_on) order by d limit 1`)
const manila = (date: string, hour: number) => `${date}T${String(hour).padStart(2, '0')}:00:00+08:00`
const status = (booking: string) => sql(`select status from public.bookings where id='${booking}'`)

let scheduler: TestUser
let therapist: TestUser
let cover: TestUser
let ana: TestUser
let ben: TestUser
let cara: TestUser
let page: Page

function book(patient: TestUser, date: string, hour: number, therapistId?: string) {
  const id = randomUUID()
  sql(`insert into public.bookings(id,reference_no,patient_id,therapist_id,starts_at,ends_at,status) values('${id}','BK-CAL-${id.slice(0, 8)}','${patient.id}',${therapistId ? `'${therapistId}'` : 'null'},'${manila(date, hour)}','${manila(date, hour + 1)}','${therapistId ? 'confirmed' : 'pending'}')`)
  return id
}

const noViolations = () => expect.poll(async () => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).slice(0, 3).join(' | ')}`)
}, { timeout: 8_000 }).toEqual([])

async function openTab(name: string) {
  await page.goto('/scheduler/calendar')
  await page.getByRole('button', { name, exact: true }).click()
}

async function startClosure(date: string, reason: string) {
  await openTab('Closures')
  await page.getByRole('button', { name: 'Add closure' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add closure' })
  await dialog.getByLabel('Date').fill(date)
  await dialog.getByLabel('Reason').fill(reason)
  return dialog
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(60_000)
  ;[scheduler, therapist, cover, ana, ben, cara] = await Promise.all([
    createUser(['scheduler'], `Sol ${tag}`), createUser(['therapist'], `Zed ${tag}`), createUser(['therapist'], `Amy ${tag}`), createUser(['patient'], `Ana ${tag}`), createUser(['patient'], `Ben ${tag}`), createUser(['patient'], `Cara ${tag}`),
  ])
  page = await (await browser.newContext()).newPage()
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(scheduler.email)
  await page.getByLabel('Password', { exact: true }).fill(scheduler.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/scheduler$/)
})

test.afterAll(async () => {
  await page.close()
  removeUsers([scheduler, therapist, cover, ana, ben, cara])
})

test('a closure lists what it would strand, and saves only once each has a decision', async () => {
  const date = farDay(120)
  const pending = book(ana, date, 9)
  const confirmed = book(ben, date, 10, therapist.id)
  const dialog = await startClosure(date, `Outage ${tag}`)
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()

  await expect(dialog).toContainText('2 active bookings fall in this time')
  await expect(dialog.getByRole('listitem')).toHaveCount(2)
  const save = dialog.getByRole('button', { name: 'Save and apply' })
  await expect(save).toBeDisabled()
  await noViolations()

  const first = dialog.getByRole('listitem', { name: `Ana ${tag}` })
  await first.getByRole('button', { name: 'Cancel booking' }).click()
  await expect(first).toContainText('Will be cancelled')
  await expect(dialog).toContainText('1 of 2 decided')
  await expect(save).toBeDisabled()

  const second = dialog.getByRole('listitem', { name: `Ben ${tag}` })
  await second.getByRole('button', { name: 'Reschedule' }).click()
  await expect(dialog.getByRole('button', { name: 'Use this time' })).toBeDisabled()
  await dialog.locator('[data-date][aria-disabled="false"]').last().click()
  await dialog.getByRole('region', { name: 'Choose a time' }).getByRole('button').nth(3).click()
  await expect(dialog.getByRole('radio', { checked: true })).toHaveCount(1)
  await noViolations()
  await dialog.getByRole('button', { name: 'Use this time' }).click()
  await expect(second).toContainText('Moves to')
  await expect(dialog).toContainText('2 of 2 decided')

  await save.click()
  await expect(page.getByText('Closure saved.')).toBeVisible()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('table').getByRole('row').filter({ hasText: `Outage ${tag}` })).toBeVisible()
  expect(status(pending)).toBe('cancelled')
  expect(status(confirmed)).toBe('rescheduled')
  expect(sql(`select status_reason from public.bookings where id='${pending}'`)).toBe(`Outage ${tag}`)
})

test('a booking made while deciding is caught, and joins the list', async () => {
  const date = farDay(140)
  const first = book(ana, date, 9)
  const dialog = await startClosure(date, `Race ${tag}`)
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).toContainText('1 active booking falls in this time')
  await dialog.getByRole('button', { name: 'Cancel booking' }).click()

  const late = book(cara, date, 11)
  await dialog.getByRole('button', { name: 'Save and apply' }).click()
  await expect(page.getByText('New bookings fall in this time. Review them and try again.')).toBeVisible()
  await expect(dialog).toContainText('2 active bookings fall in this time')
  await expect(dialog.getByRole('button', { name: 'Save and apply' })).toBeDisabled()
  expect(status(first)).toBe('pending')
  expect(sql(`select count(*) from public.center_closures where reason='Race ${tag}'`)).toBe('0')

  await dialog.getByRole('listitem', { name: `Ana ${tag}` }).getByRole('button', { name: 'Cancel booking' }).click()
  await dialog.getByRole('listitem', { name: `Cara ${tag}` }).getByRole('button', { name: 'Cancel booking' }).click()
  await dialog.getByRole('button', { name: 'Save and apply' }).click()
  await expect(page.getByText('Closure saved.')).toBeVisible()
  expect(status(late)).toBe('cancelled')
})

test('a closure can cover part of a day, be edited and be deleted', async () => {
  const date = farDay(160)
  const dialog = await startClosure(date, `Training ${tag}`)
  await dialog.getByLabel('Closed all day').uncheck()
  await dialog.getByLabel('Closed from').fill('13:00')
  await dialog.getByLabel('Closed until').fill('12:00')
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  await dialog.getByLabel('Closed until').fill('15:00')
  await noViolations()
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Closure saved.')).toBeVisible()
  const row = page.getByRole('table').getByRole('row').filter({ hasText: `Training ${tag}` })
  await expect(row).toContainText('1:00 PM – 3:00 PM')

  await row.getByRole('button', { name: /^Edit/ }).click()
  const edit = page.getByRole('dialog', { name: 'Edit closure' })
  await expect(edit.getByLabel('Closed from')).toHaveValue('13:00')
  await edit.getByLabel('Closed until').fill('16:00')
  await edit.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(row).toContainText('1:00 PM – 4:00 PM')

  await row.getByRole('button', { name: /^Delete/ }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText('Closure deleted.')).toBeVisible()
  await expect(row).toHaveCount(0)
})

test('a closure needs a reason', async () => {
  await openTab('Closures')
  await page.getByRole('button', { name: 'Add closure' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add closure' })
  await dialog.getByLabel('Date').fill(farDay(170))
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  await dialog.getByLabel('Reason').fill('ab')
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
})

test('a holiday can run several days, be edited and be deleted', async () => {
  const from = farDay(180)
  const through = sql(`select '${from}'::date+2`)
  const name = `Break ${tag}`
  await openTab('Holidays')
  await page.getByRole('button', { name: 'Add holiday' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add holiday' })
  await dialog.getByLabel('Name').fill(name)
  await dialog.getByLabel('From').fill(from)
  await dialog.getByLabel('Through').fill(through)
  await noViolations()
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Holiday saved.')).toBeVisible()
  const row = page.getByRole('table').getByRole('row').filter({ hasText: name })
  await expect(row).toContainText('Seasonal')
  await expect(row).toContainText('–')

  await row.getByRole('button', { name: `Edit ${name}` }).click()
  const edit = page.getByRole('dialog', { name: 'Edit holiday' })
  await edit.getByLabel('Name').fill(`${name} renamed`)
  await edit.getByRole('button', { name: 'Save', exact: true }).click()
  const renamed = page.getByRole('table').getByRole('row').filter({ hasText: `${name} renamed` })
  await expect(renamed).toBeVisible()
  await noViolations()

  await renamed.getByRole('button', { name: `Delete ${name} renamed` }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText('Holiday deleted.')).toBeVisible()
  await expect(renamed).toHaveCount(0)
})

test('a holiday over a booking needs a decision too', async () => {
  const date = farDay(200)
  const held = book(ana, date, 9)
  await openTab('Holidays')
  await page.getByRole('button', { name: 'Add holiday' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add holiday' })
  await dialog.getByLabel('Name').fill(`Feast ${tag}`)
  await dialog.getByLabel('From').fill(date)
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).toContainText('1 active booking falls in this time')
  await dialog.getByRole('button', { name: 'Cancel booking' }).click()
  await dialog.getByRole('button', { name: 'Save and apply' }).click()
  await expect(page.getByText('Holiday saved.')).toBeVisible()
  expect(sql(`select status_reason from public.bookings where id='${held}'`)).toBe(`Center closed: Feast ${tag}`)
})

test('time off passes a session on, and keeps its reason from the patient', async () => {
  const date = farDay(215)
  const passed = book(ana, date, 9, therapist.id)
  const cancelled = book(ben, date, 10, therapist.id)
  const reason = `Surgery ${tag}`
  await openTab('Therapist time off')
  await page.getByRole('button', { name: 'Add time off' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add time off' })
  await dialog.getByLabel('Therapist').click()
  await page.getByRole('option', { name: `Zed ${tag}` }).click()
  await dialog.getByLabel('Away from').fill(`${date}T08:00`)
  await dialog.getByLabel('Back at').fill(`${date}T17:00`)
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  await dialog.getByLabel('Reason').fill(reason)
  await noViolations()
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()

  await expect(dialog).toContainText('2 active bookings fall in this time')
  const first = dialog.getByRole('listitem', { name: `Ana ${tag}` })
  await first.getByRole('button', { name: 'Change therapist' }).click()
  await expect(dialog).toContainText(`Ana ${tag}, `)
  await expect(dialog.locator('label').filter({ hasText: `Amy ${tag}` })).toBeVisible()
  await expect(dialog.locator('label').filter({ hasText: `Zed ${tag}` })).toHaveCount(0)
  await dialog.locator('label').filter({ hasText: `Amy ${tag}` }).click()
  await dialog.getByRole('button', { name: 'Use this therapist' }).click()
  await expect(first).toContainText(`Passes to Amy ${tag}`)
  await dialog.getByRole('listitem', { name: `Ben ${tag}` }).getByRole('button', { name: 'Cancel booking' }).click()
  await noViolations()
  await dialog.getByRole('button', { name: 'Save and apply' }).click()
  await expect(page.getByText('Time off saved.')).toBeVisible()

  expect(sql(`select therapist_id from public.bookings where id='${passed}'`)).toBe(cover.id)
  expect(status(passed)).toBe('confirmed')
  expect(status(cancelled)).toBe('cancelled')
  expect(sql(`select status_reason from public.bookings where id='${cancelled}'`)).toBe('Your therapist is away at this time.')

  const row = page.getByRole('table').getByRole('row').filter({ hasText: reason })
  await expect(row).toContainText(`Zed ${tag}`)
  await noViolations()
  await row.getByRole('button', { name: /^Edit/ }).click()
  const edit = page.getByRole('dialog', { name: 'Edit time off' })
  await expect(edit.getByLabel('Away from')).toHaveValue(`${date}T08:00`)
  await edit.getByLabel('Back at').fill(`${date}T12:00`)
  await edit.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(row).toContainText('8:00 AM – 12:00 PM')
  await row.getByRole('button', { name: /^Delete/ }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText('Time off deleted.')).toBeVisible()
  await expect(row).toHaveCount(0)
})

test('the therapist picker marks who is on leave, and will not offer them', async () => {
  const date = farDay(230)
  const waiting = book(cara, date, 11)
  sql(`insert into public.therapist_time_off(therapist_id,starts_at,ends_at,reason) values('${cover.id}','${manila(date, 9)}','${manila(date, 13)}','Booking test')`)
  await page.goto('/scheduler/requests')
  await page.getByLabel('Search patient, therapist or reference').fill(`BK-CAL-${waiting.slice(0, 8)}`)
  await page.getByRole('button', { name: 'Search bookings' }).click()
  await page.getByRole('table').getByRole('button', { name: `Cara ${tag}` }).click()
  await page.getByRole('complementary').getByRole('button', { name: 'Confirm', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Confirm booking' })
  const away = dialog.locator('label').filter({ hasText: `Amy ${tag}` })
  await expect(away).toContainText('On leave')
  await expect(away.getByRole('radio')).toBeDisabled()
  await expect(dialog.locator('label').filter({ hasText: `Zed ${tag}` }).getByRole('radio')).toBeEnabled()
  await noViolations()
  await page.keyboard.press('Escape')
})

test('opening hours save every day, and warn about sessions left outside them', async () => {
  let sent: { p_hours: Array<{ weekday: number; is_open: boolean; opens_at: string; closes_at: string }> } | undefined
  await page.route('**/rpc/scheduler_save_hours', async (route) => {
    sent = route.request().postDataJSON() as typeof sent
    await route.fulfill({ json: { outside_hours: 2 } })
  })
  await openTab('Hours and rules')
  const monday = page.getByRole('group', { name: 'Mon' })
  await monday.getByLabel('Closes').fill('08:00')
  await expect(page.getByText('A day has to open before it closes.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save hours' })).toBeDisabled()
  await monday.getByLabel('Closes').fill('15:00')
  await page.getByRole('group', { name: 'Sat' }).getByRole('checkbox').check()
  await noViolations()
  await page.getByRole('button', { name: 'Save hours' }).click()
  await expect(page.getByText('Hours saved.')).toBeVisible()
  await expect(page.getByText('2 booked sessions now fall outside the hours. Reschedule them from Requests.')).toBeVisible()
  expect(sent?.p_hours).toHaveLength(7)
  expect(sent?.p_hours[0]).toMatchObject({ weekday: 1, is_open: true, opens_at: '09:00', closes_at: '15:00' })
  expect(sent?.p_hours[5]).toMatchObject({ weekday: 6, is_open: true })
  await page.unroute('**/rpc/scheduler_save_hours')
})

test('the rules save, and a blank name cannot', async () => {
  let sent: Record<string, unknown> | undefined
  await page.route('**/rpc/scheduler_save_settings', async (route) => {
    sent = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({ json: {} })
  })
  await openTab('Hours and rules')
  await page.getByLabel('Center name').fill('   ')
  await expect(page.getByRole('button', { name: 'Save rules' })).toBeDisabled()
  await page.getByLabel('Center name').fill('Motivance Quezon City')
  await page.getByLabel('Location').fill('12 Mabini Street')
  await page.getByLabel('Patients per time slot').fill('4')
  await page.getByLabel('Session length').click()
  await page.getByRole('option', { name: '30 minutes' }).click()
  await page.getByRole('button', { name: 'Save rules' }).click()
  await expect(page.getByText('Rules saved.')).toBeVisible()
  expect(sent).toMatchObject({ p_center_name: 'Motivance Quezon City', p_location: '12 Mabini Street', p_slot_capacity: 4, p_slot_minutes: 30 })
  await page.unroute('**/rpc/scheduler_save_settings')
})
