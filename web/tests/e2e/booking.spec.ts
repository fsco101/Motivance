import { randomUUID } from 'node:crypto'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { todayAt } from '../../src/data/booking'
import { createUser, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

/** Booking from the patient's side, against the real local backend. The center's settings are put back after each change. */
test.describe.configure({ mode: 'serial' })

let patient: TestUser
let rival: TestUser
let therapist: TestUser
let scheduler: TestUser
let page: Page

/** A plain working day comfortably past the minimum notice, and clear of holidays. */
function workingDay(after: number) {
  return sql(`select d::date from generate_series(current_date+${after},current_date+50,interval '1 day') d
 where extract(isodow from d)<6 and not exists(select 1 from public.center_holidays h where d::date between h.starts_on and h.ends_on) order by d limit 1`)
}
const manila = (date: string, hour: number) => `${date}T${String(hour).padStart(2, '0')}:00:00+08:00`
const book = async (person: TestUser, start: string) => {
  const { data, error } = await (await signedIn(person)).rpc('request_booking', { p_request: randomUUID(), p_starts: start })
  if (error) throw error
  return data as { id: string; reference_no: string }
}

async function signIn(person: TestUser, target = page) {
  await target.goto('/sign-in')
  await target.getByLabel('Email').fill(person.email)
  await target.getByLabel('Password', { exact: true }).fill(person.password)
  await target.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(target).toHaveURL(/\/patient$/)
}

/** Moves the calendar to a date's month, then opens that date. */
async function openDate(date: string, target = page) {
  await target.goto('/patient/book')
  const now = todayAt('Asia/Manila').slice(0, 7)
  if (date.slice(0, 7) !== now) await target.getByRole('button', { name: 'Next month' }).click()
  await target.locator(`[data-date="${date}"]`).click()
}

const noViolations = () => expect.poll(async () => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).slice(0, 3).join(' | ')}`)
}, { timeout: 8_000 }).toEqual([])

test.beforeAll(async ({ browser }) => {
  test.setTimeout(60_000)
  ;[patient, rival, therapist, scheduler] = await Promise.all([
    createUser(['patient'], 'Ana Dela Cruz'), createUser(['patient'], 'Ben Santos'), createUser(['therapist'], 'Dana Reyes'), createUser(['scheduler'], 'Sol Rivera'),
  ])
  sql(`update public.center_settings set location='12 Mabini Street, Quezon City'`)
  page = await (await browser.newContext()).newPage()
  await signIn(patient)
})

test.afterAll(async () => {
  sql(`update public.center_settings set location='',slot_capacity=3,cancel_cutoff_hours=24`)
  await page.close()
  removeUsers([patient, rival, therapist, scheduler])
})

test('the calendar offers working days and says why others are closed', async () => {
  await page.goto('/patient/book')
  await expect(page.getByRole('heading', { name: 'Book a session', level: 1 })).toBeVisible()
  const day = workingDay(3)
  await openDate(day)
  const times = page.getByRole('region', { name: 'Choose a time' })
  await expect(times.getByRole('button')).toHaveCount(8)
  await expect(times.getByRole('button').first()).toContainText('9:00')
  await expect(times.getByRole('button').first()).toContainText('10:00')
  await expect(times.getByRole('button').first()).toContainText('3 places left')
  const saturday = sql(`select d::date from generate_series(current_date+3,current_date+12,interval '1 day') d where extract(isodow from d)=6 order by d limit 1`)
  const closed = page.locator(`[data-date="${saturday}"]`)
  if (await closed.count()) {
    await expect(closed).toHaveAttribute('aria-disabled', 'true')
    await expect(closed).toHaveAttribute('aria-label', /closed/i)
  }
  await noViolations()
})

test('a patient requests a specific time and follows it on My bookings', async () => {
  const day = workingDay(3)
  await openDate(day)
  await page.getByRole('region', { name: 'Choose a time' }).getByRole('button').first().click()
  await expect(page.getByText('Your choice')).toBeVisible()
  await page.getByRole('button', { name: 'Request this time' }).click()
  await expect(page).toHaveURL(/\/patient\/bookings$/)
  await expect(page.getByText('Request sent. A Scheduler will confirm it.')).toBeVisible()
  const card = page.getByRole('region', { name: 'Upcoming' }).getByRole('listitem')
  await expect(card).toContainText('Pending')
  await expect(card).toContainText('9:00')
  await expect(card).toContainText('To be assigned')
  await expect(card).toContainText('12 Mabini Street, Quezon City')
  await expect(card).toContainText(/BK-\d{4}-\d{6}/)
  await noViolations()
})

test('the slot now says the patient already holds it', async () => {
  await openDate(workingDay(3))
  const slot = page.getByRole('region', { name: 'Choose a time' }).getByRole('button').first()
  await expect(slot).toBeDisabled()
  await expect(slot).toContainText('You have a booking at this time')
})

test('home shows the next session', async () => {
  await page.goto('/patient')
  const panel = page.getByRole('region', { name: 'Your next session' })
  await expect(panel).toContainText('9:00')
  await expect(panel).toContainText('Pending')
})

test('a full slot offers the waitlist, and never a request', async () => {
  const day = workingDay(8)
  sql(`update public.center_settings set slot_capacity=1`)
  try {
    await book(rival, manila(day, 10))
    await openDate(day)
    const slot = page.getByRole('region', { name: 'Choose a time' }).getByRole('button').nth(1)
    await expect(slot).toContainText('Full')
    await slot.click()
    await expect(page.getByRole('button', { name: 'Join the waitlist' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Request this time' })).toBeHidden()
  } finally {
    sql(`update public.center_settings set slot_capacity=3`)
  }
})

test('a time taken by someone else while choosing is refused in plain words', async () => {
  const day = workingDay(10)
  sql(`update public.center_settings set slot_capacity=1`)
  try {
    await openDate(day)
    await page.getByRole('region', { name: 'Choose a time' }).getByRole('button').first().click()
    await book(rival, manila(day, 9))
    await page.getByRole('button', { name: 'Request this time' }).click()
    await expect(page.getByText('That time has just filled up. Choose another.')).toBeVisible()
    await expect(page).toHaveURL(/\/patient\/book$/)
    await expect(page.getByRole('region', { name: 'Choose a time' }).getByRole('button').first()).toContainText('Full')
  } finally {
    sql(`update public.center_settings set slot_capacity=3`)
  }
})

test('a confirmed booking shows the therapist, and a rejected one its reason', async () => {
  const staff = await signedIn(scheduler)
  const bookings = await (await signedIn(patient)).rpc('my_bookings')
  const [first] = bookings.data as Array<{ id: string }>
  expect((await staff.rpc('scheduler_confirm', { p_booking: first!.id, p_therapist: therapist.id })).error).toBeNull()
  const refused = await book(patient, manila(workingDay(12), 11))
  expect((await staff.rpc('scheduler_reject', { p_booking: refused.id, p_reason: 'No therapist that week' })).error).toBeNull()
  await page.goto('/patient/bookings')
  const upcoming = page.getByRole('region', { name: 'Upcoming' }).getByRole('listitem')
  await expect(upcoming).toContainText('Confirmed')
  await expect(upcoming).toContainText('Dana Reyes')
  const earlier = page.getByRole('region', { name: 'Earlier' }).getByRole('listitem').filter({ hasText: 'Rejected' })
  await expect(earlier).toContainText('No therapist that week')
  await expect(earlier.getByRole('button', { name: 'Cancel booking' })).toHaveCount(0)
})

test('a booking can be cancelled before the cut-off, and the action closes after it', async () => {
  await page.goto('/patient/bookings')
  const upcoming = page.getByRole('region', { name: 'Upcoming' }).getByRole('listitem').first()
  await expect(upcoming).toContainText('You can cancel until')
  sql(`update public.center_settings set cancel_cutoff_hours=336`)
  try {
    await page.reload()
    await expect(upcoming).toContainText('can no longer be cancelled online')
    await expect(upcoming.getByRole('button', { name: 'Cancel booking' })).toHaveCount(0)
  } finally {
    sql(`update public.center_settings set cancel_cutoff_hours=24`)
  }
  await page.reload()
  await upcoming.getByRole('button', { name: 'Cancel booking' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('9:00')
  await expect(dialog.getByRole('button', { name: 'Keep booking' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel booking' }).click()
  await expect(page.getByText('Booking cancelled.')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Upcoming' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Earlier' }).getByRole('listitem').filter({ hasText: 'Cancelled' })).toBeVisible()
})

test('times stay in Manila when the browser is set elsewhere', async ({ browser }) => {
  const day = workingDay(14)
  const context = await browser.newContext({ timezoneId: 'America/New_York' })
  const away = await context.newPage()
  await signIn(rival, away)
  await openDate(day, away)
  await expect(away.getByRole('region', { name: 'Choose a time' }).getByRole('button').first()).toContainText('9:00')
  await expect(away.getByRole('region', { name: 'Choose a time' }).getByRole('button').first()).toContainText('AM')
  await context.close()
})

test('booking fits a phone, with nothing past the edge', async () => {
  await page.setViewportSize({ width: 360, height: 760 })
  for (const path of ['/patient/book', '/patient/bookings']) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    const cut = await page.evaluate(() => [...document.querySelectorAll('main *')].filter((element) => {
      const box = element.getBoundingClientRect()
      return box.width > 0 && box.right > window.innerWidth + 1
    }).map((element) => element.tagName).slice(0, 5))
    expect(cut, path).toEqual([])
    await noViolations()
  }
  await page.setViewportSize({ width: 1280, height: 800 })
})

test('on a phone, choosing a time brings the next step into view', async () => {
  await page.setViewportSize({ width: 360, height: 640 })
  await openDate(workingDay(16))
  await page.getByRole('region', { name: 'Choose a time' }).getByRole('button').first().click()
  await expect(page.getByRole('button', { name: 'Request this time' })).toBeInViewport()
  await page.setViewportSize({ width: 1280, height: 800 })
})

test('the calendar works by keyboard', async () => {
  await page.goto('/patient/book')
  const grid = page.getByRole('grid', { name: 'Choose a date' })
  await grid.locator('[tabindex="0"]').focus()
  const start = await grid.locator('[tabindex="0"]').getAttribute('data-date')
  await page.keyboard.press('ArrowRight')
  const moved = await page.evaluate(() => document.activeElement?.getAttribute('data-date'))
  expect(moved).not.toBe(start)
  await page.keyboard.press('ArrowLeft')
  expect(await page.evaluate(() => document.activeElement?.getAttribute('data-date'))).toBe(start)
})
