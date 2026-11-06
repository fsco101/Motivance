import { randomUUID } from 'node:crypto'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Browser, type BrowserContextOptions, type Page } from '@playwright/test'
import { createUser, link, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

/** My Schedule against the real local backend. New York keeps the browser a day and thirteen hours away from the center. */
test.describe.configure({ mode: 'serial' })

const tag = randomUUID().slice(0, 8)
const FAR_AWAY = { timezoneId: 'America/New_York' }
const manila = (date: string, hour: number) => `${date}T${String(hour).padStart(2, '0')}:00:00+08:00`
const workingDay = (after: number) => sql(`select d::date from generate_series(current_date+${after},current_date+55,interval '1 day') d
 where extract(isodow from d)<6 and not exists(select 1 from public.center_holidays h where d::date between h.starts_on and h.ends_on) order by d limit 1`)
const monthsTo = (date: string) => {
  const [year, month] = sql(`select to_char(now() at time zone 'Asia/Manila','YYYY-MM')`).split('-').map(Number)
  const [toYear, toMonth] = date.split('-').map(Number)
  return (toYear! - year!) * 12 + toMonth! - month!
}

let scheduler: TestUser
let therapist: TestUser
let ana: TestUser
let ben: TestUser
let date: string
let anaBooking: { id: string; reference_no: string }
let benBooking: { id: string; reference_no: string }
const pages: Page[] = []

async function book(person: TestUser, start: string) {
  const { data, error } = await (await signedIn(person)).rpc('request_booking', { p_request: randomUUID(), p_starts: start })
  if (error) throw error
  return data as { id: string; reference_no: string }
}

async function signIn(browser: Browser, person: TestUser, home: RegExp, options: BrowserContextOptions = {}) {
  const page = await (await browser.newContext(options)).newPage()
  pages.push(page)
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(person.email)
  await page.getByLabel('Password', { exact: true }).fill(person.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(home)
  return page
}

async function openDate(page: Page, path: string, target: string) {
  await page.goto(path)
  for (let turn = 0; turn < monthsTo(target); turn += 1) await page.getByRole('button', { name: 'Next month' }).click()
  await page.locator(`[data-date="${target}"]`).click()
}

const noViolations = (page: Page) => expect.poll(async () => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).slice(0, 3).join(' | ')}`)
}, { timeout: 8_000 }).toEqual([])

const hour = (page: Page, time: string) => page.getByRole('listitem').filter({ hasText: time })

test.beforeAll(async () => {
  test.setTimeout(60_000)
  ;[scheduler, therapist, ana, ben] = await Promise.all([
    createUser(['scheduler'], `Sol ${tag}`), createUser(['therapist'], `Zed ${tag}`), createUser(['patient'], `Ana ${tag}`), createUser(['patient'], `Ben ${tag}`),
  ])
  await link(therapist, ana)
  date = workingDay(20)
  anaBooking = await book(ana, manila(date, 9))
  benBooking = await book(ben, manila(date, 11))
  const db = await signedIn(scheduler)
  for (const booking of [anaBooking, benBooking]) expect((await db.rpc('scheduler_confirm', { p_booking: booking.id, p_therapist: therapist.id })).error).toBeNull()
  await book(ana, manila(date, 14))
})

test.afterAll(async () => {
  await Promise.all(pages.map((page) => page.context().close()))
  removeUsers([scheduler, therapist, ana, ben])
})

test('a patient sees a confirmed session at its Manila time, from a browser far away', async ({ browser }) => {
  const page = await signIn(browser, ana, /\/patient$/, FAR_AWAY)
  await openDate(page, '/patient/schedule', date)
  await expect(page.locator(`[data-date="${date}"]`)).toHaveAccessibleName(/1 session$/)
  const session = hour(page, '9:00 AM – 10:00 AM')
  await expect(session).toContainText('Your session')
  await expect(session).toContainText(`Zed ${tag}`)
  await expect(session).toContainText(anaBooking.reference_no)
  await expect(session).toContainText('Confirmed')
  await noViolations(page)
})

// The center's location is one shared setting that booking.spec.ts also writes, so this reads the gallery. The live API test covers the data.
test('a session names its location', async ({ page }) => {
  await page.goto('/design/patient/schedule')
  const session = hour(page, '10:00 AM – 11:00 AM')
  await expect(session).toContainText('Location')
  await expect(session).toContainText('Motivance Center, Quezon City')
})

test('a request still waiting stays off the schedule', async ({ browser }) => {
  const page = await signIn(browser, ana, /\/patient$/)
  await openDate(page, '/patient/schedule', date)
  await expect(hour(page, '2:00 PM – 3:00 PM')).toContainText('No session')
  await expect(page.getByText('Your session')).toHaveCount(1)
})

test('a patient never sees who else is booked', async ({ browser }) => {
  const page = await signIn(browser, ben, /\/patient$/)
  await openDate(page, '/patient/schedule', date)
  await expect(hour(page, '11:00 AM – 12:00 PM')).toContainText('Your session')
  await expect(hour(page, '9:00 AM – 10:00 AM')).toContainText('No session')
  await expect(page.getByText(`Ana ${tag}`)).toHaveCount(0)
})

test('a therapist sees who is booked at each time, and the record opens only through a link', async ({ browser }) => {
  const page = await signIn(browser, therapist, /\/therapist$/, FAR_AWAY)
  await openDate(page, '/therapist/schedule', date)
  await expect(page.locator(`[data-date="${date}"]`)).toHaveAccessibleName(/2 sessions$/)
  await expect(hour(page, '9:00 AM – 10:00 AM')).toContainText(anaBooking.reference_no)
  await expect(hour(page, '11:00 AM – 12:00 PM')).toContainText(benBooking.reference_no)
  await expect(hour(page, '10:00 AM – 11:00 AM')).toContainText('No session')
  await noViolations(page)

  // Booked but not linked: the name is there, and it leads nowhere.
  const unlinked = hour(page, '11:00 AM – 12:00 PM')
  await expect(unlinked).toContainText(`Ben ${tag}`)
  await expect(unlinked.getByRole('link')).toHaveCount(0)
  await expect(unlinked).toContainText('You are not linked to this patient')

  await hour(page, '9:00 AM – 10:00 AM').getByRole('link', { name: `Ana ${tag}` }).click()
  await expect(page).toHaveURL(new RegExp(`/therapist/patients/${ana.id}$`))
  await expect(page.getByRole('heading', { name: `Ana ${tag}`, level: 1 })).toBeVisible()

  await page.goto(`/therapist/patients/${ben.id}`)
  await expect(page.getByRole('heading', { name: 'This patient is not linked to you' })).toBeVisible()
  await expect(page.getByRole('heading', { name: `Ben ${tag}` })).toHaveCount(0)
})

test('a closed day says so, and a day with nothing booked lists its hours', async ({ browser }) => {
  const page = await signIn(browser, ana, /\/patient$/)
  const saturday = sql(`select d::date from generate_series(date_trunc('month','${date}'::date),date_trunc('month','${date}'::date)+interval '6 days',interval '1 day') d where extract(isodow from d)=6`)
  await openDate(page, '/patient/schedule', saturday)
  await expect(page.getByText('The center is closed on this day.')).toBeVisible()
  await expect(page.getByText('No session')).toHaveCount(0)
})

test('a month opens on the next session, and the schedule follows a cancellation', async ({ browser }) => {
  const page = await signIn(browser, ana, /\/patient$/)
  await page.goto('/patient/schedule')
  for (let turn = 0; turn < monthsTo(date); turn += 1) await page.getByRole('button', { name: 'Next month' }).click()
  await expect(hour(page, '9:00 AM – 10:00 AM')).toContainText('Your session')
  await page.getByRole('navigation', { name: 'Main' }).first().getByRole('link', { name: 'My bookings' }).click()
  await page.getByRole('article').or(page.getByRole('listitem')).filter({ hasText: anaBooking.reference_no }).getByRole('button', { name: 'Cancel booking' }).click()
  await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: 'Cancel booking' }).click()
  await expect(page.getByText('Booking cancelled.')).toBeVisible()
  await page.getByRole('navigation', { name: 'Main' }).first().getByRole('link', { name: 'My Schedule' }).click()
  await expect(page.getByRole('heading', { name: 'My bookings', level: 1 })).toHaveCount(0)
  for (let turn = 0; turn < monthsTo(date); turn += 1) await page.getByRole('button', { name: 'Next month' }).click()
  await page.locator(`[data-date="${date}"]`).click()
  await expect(hour(page, '9:00 AM – 10:00 AM')).toContainText('No session')
})

test('a therapist sees their own leave without the reason, and a patient sees none of it', async ({ browser }) => {
  sql(`insert into public.therapist_time_off(therapist_id,starts_at,ends_at,reason) values('${therapist.id}','${manila(date, 15)}','${manila(date, 17)}','Private ${tag}')`)
  const staff = await signIn(browser, therapist, /\/therapist$/)
  await openDate(staff, '/therapist/schedule', date)
  await expect(hour(staff, '3:00 PM – 4:00 PM')).toContainText('On leave')
  await expect(hour(staff, '4:00 PM – 5:00 PM')).toContainText('On leave')
  await expect(hour(staff, '2:00 PM – 3:00 PM')).toContainText('No session')
  await expect(staff.locator(`[data-date="${date}"]`)).toHaveAccessibleName(/On leave$/)
  await expect(staff.getByText(`Private ${tag}`)).toHaveCount(0)
  await noViolations(staff)
  const patient = await signIn(browser, ben, /\/patient$/)
  await openDate(patient, '/patient/schedule', date)
  await expect(hour(patient, '3:00 PM – 4:00 PM')).toContainText('No session')
})

test('on a phone the schedule fits, and booking stays one tap away', async ({ browser }) => {
  const page = await signIn(browser, ben, /\/patient$/, { viewport: { width: 360, height: 740 } })
  await openDate(page, '/patient/schedule', date)
  await expect(hour(page, '11:00 AM – 12:00 PM')).toContainText('Your session')
  // The route slides in, so this waits for it to settle. A page that really is too wide never does.
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const bar = page.getByRole('navigation', { name: 'Main' }).last()
  await expect(bar.getByRole('link')).toHaveCount(5)
  await expect(bar.getByRole('link', { name: 'Schedule' })).toBeVisible()
  await page.getByRole('link', { name: 'Book a session' }).click()
  await expect(page).toHaveURL(/\/patient\/book$/)
})
