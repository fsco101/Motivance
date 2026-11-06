import { randomUUID } from 'node:crypto'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Browser, type BrowserContextOptions, type Page } from '@playwright/test'
import { createUser, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

/** The bell and list against the real local backend. New York keeps the browser far from the center's time. */
test.describe.configure({ mode: 'serial' })

const tag = randomUUID().slice(0, 8)
const manila = (date: string, hour: number) => `${date}T${String(hour).padStart(2, '0')}:00:00+08:00`
const workingDay = (after: number) => sql(`select d::date from generate_series(current_date+${after},current_date+55,interval '1 day') d
 where extract(isodow from d)<6 and not exists(select 1 from public.center_holidays h where d::date between h.starts_on and h.ends_on) order by d limit 1`)

let scheduler: TestUser
let therapist: TestUser
let ana: TestUser
let date: string
let booking: string
const pages: Page[] = []

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

const noViolations = (page: Page) => expect.poll(async () => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).slice(0, 3).join(' | ')}`)
}, { timeout: 8_000 }).toEqual([])

test.beforeAll(async () => {
  test.setTimeout(60_000)
  ;[scheduler, therapist, ana] = await Promise.all([createUser(['scheduler'], `Sol ${tag}`), createUser(['therapist'], `Zed ${tag}`), createUser(['patient'], `Ana ${tag}`)])
  date = workingDay(26)
  const { data, error } = await (await signedIn(ana)).rpc('request_booking', { p_request: randomUUID(), p_starts: manila(date, 9) })
  if (error) throw error
  booking = (data as { id: string }).id
})

test.afterAll(async () => {
  await Promise.all(pages.map((page) => page.context().close()))
  removeUsers([scheduler, therapist, ana])
})

test('a Scheduler is alerted to a new request, and it opens the requests', async ({ browser }) => {
  const page = await signIn(browser, scheduler, /\/scheduler$/, { timezoneId: 'America/New_York' })
  await page.getByRole('link', { name: /^Notifications, \d+ unread$/ }).click()
  const note = page.getByRole('button', { name: new RegExp(`Ana ${tag} requested`) })
  await expect(note).toContainText('9:00 AM – 10:00 AM')
  await noViolations(page)
  await note.click()
  await expect(page).toHaveURL(/\/scheduler\/requests$/)
})

test('a patient sees a decision on the bell, at its Manila time, and reading it clears the count', async ({ browser }) => {
  const db = await signedIn(scheduler)
  expect((await db.rpc('scheduler_confirm', { p_booking: booking, p_therapist: therapist.id })).error).toBeNull()
  const page = await signIn(browser, ana, /\/patient$/, { timezoneId: 'America/New_York' })
  await page.getByRole('link', { name: 'Notifications, 1 unread' }).click()
  await expect(page).toHaveURL(/\/patient\/notifications$/)
  const note = page.getByRole('button', { name: /is confirmed with/ })
  await expect(note).toContainText(`Zed ${tag}`)
  await expect(note).toContainText('9:00 AM – 10:00 AM')
  await expect(note).toContainText('unread')
  await noViolations(page)
  await note.click()
  await expect(page).toHaveURL(/\/patient\/bookings$/)
  await expect(page.getByRole('link', { name: 'Notifications', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Notifications', exact: true }).click()
  await expect(page.getByRole('button', { name: /is confirmed with/ })).not.toContainText('unread')
})

test('a therapist is told who is booked with them', async ({ browser }) => {
  const page = await signIn(browser, therapist, /\/therapist$/)
  await page.getByRole('link', { name: 'Notifications, 1 unread' }).click()
  const note = page.getByRole('button', { name: new RegExp(`Ana ${tag} is booked with you`) })
  await expect(note).toBeVisible()
  await note.click()
  await expect(page).toHaveURL(/\/therapist\/schedule$/)
})

test('a reason reaches the patient, everything can be marked read, and the text follows the language', async ({ browser }) => {
  const db = await signedIn(scheduler)
  expect((await db.rpc('scheduler_cancel', { p_booking: booking, p_reason: `Outage ${tag}` })).error).toBeNull()
  const page = await signIn(browser, ana, /\/patient$/)
  await page.goto('/patient/notifications')
  const note = page.getByRole('button', { name: /was cancelled/ })
  await expect(note).toContainText(`Outage ${tag}`)
  await page.getByRole('button', { name: 'Filipino' }).click()
  await expect(page.getByRole('button', { name: /kinansela/i })).toBeVisible()
  await page.getByRole('button', { name: 'English' }).click()
  await page.getByRole('button', { name: 'Mark all as read' }).click()
  await expect(page.getByRole('button', { name: 'Mark all as read' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Notifications', exact: true })).toBeVisible()
  await expect(note).toBeVisible()
})

test('a phone shows the bell and the list without sideways scrolling', async ({ browser }) => {
  const page = await signIn(browser, ana, /\/patient$/, { viewport: { width: 360, height: 740 } })
  await page.getByRole('link', { name: 'Notifications', exact: true }).click()
  await expect(page.getByRole('button', { name: /was cancelled/ })).toBeVisible()
  // The route slides in, so this waits for it to settle. A page that really is too wide never does.
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('someone with nothing new sees a plain list', async ({ browser }) => {
  const quiet = await createUser(['patient'], `Quiet ${tag}`)
  const page = await signIn(browser, quiet, /\/patient$/)
  await page.goto('/patient/notifications')
  await expect(page.getByRole('heading', { name: 'Nothing new' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mark all as read' })).toHaveCount(0)
  await page.context().close()
  pages.pop()
  removeUsers([quiet])
})
