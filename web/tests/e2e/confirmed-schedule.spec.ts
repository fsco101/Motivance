import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Download, type Page, type Request } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import { createUser, removeUsers, sql, type TestUser } from '../support/stack'

/** The confirmed schedule against the real local backend, with the exported files opened and read. Sessions sit past the booking window. */
test.describe.configure({ mode: 'serial' })

const tag = randomUUID().slice(0, 8)
const COUNT = 30

let scheduler: TestUser
let zed: TestUser
let amy: TestUser
let ana: TestUser
let ben: TestUser
let page: Page
const references: string[] = []

function insert(reference: string, patient: TestUser, therapist: TestUser | null, days: number, status: string) {
  sql(`insert into public.bookings(id,reference_no,patient_id,therapist_id,starts_at,ends_at,status) values(gen_random_uuid(),'${reference}','${patient.id}',${therapist ? `'${therapist.id}'` : 'null'},now()+interval '${days} days',now()+interval '${days} days 1 hour','${status}')`)
}

const noViolations = () => expect.poll(async () => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).slice(0, 3).join(' | ')}`)
}, { timeout: 8_000 }).toEqual([])

async function open() {
  await page.goto('/scheduler/schedule')
  await page.getByLabel('Search patient, therapist or reference').fill(`BK-EXP-${tag}`)
  await page.getByRole('button', { name: 'Search bookings' }).click()
}

async function save(button: string) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: button }).click()])
  return download as Download
}

/** All the text in a spreadsheet, read from inside the file. */
async function spreadsheet(download: Download) {
  const files = unzipSync(readFileSync(await download.path()))
  return Object.entries(files).filter(([name]) => name.endsWith('.xml')).map(([, data]) => strFromU8(data)).join('\n')
}

const pdf = async (download: Download) => readFileSync(await download.path()).toString('latin1')
const audit = () => sql(`select target_id from public.audit_events where actor_id='${scheduler.id}' and action='export' order by id`).split('\n').filter(Boolean)

test.beforeAll(async ({ browser }) => {
  test.setTimeout(60_000)
  ;[scheduler, zed, amy, ana, ben] = await Promise.all([
    createUser(['scheduler'], `Sol ${tag}`), createUser(['therapist'], `Zed ${tag}`), createUser(['therapist'], `Amy ${tag}`), createUser(['patient'], `Ana ${tag}`), createUser(['patient'], `Ben ${tag}`),
  ])
  for (let index = 0; index < COUNT; index += 1) {
    const reference = `BK-EXP-${tag}-${String(index).padStart(2, '0')}`
    references.push(reference)
    insert(reference, index % 2 ? ben : ana, index < 20 ? zed : amy, 100 + index * 2, index % 5 === 0 ? 'rescheduled' : 'confirmed')
  }
  insert(`BK-EXP-${tag}-WAITING`, ana, null, 300, 'pending')
  insert(`BK-EXP-${tag}-CANCELLED`, ben, null, 301, 'cancelled')
  page = await (await browser.newContext({ acceptDownloads: true })).newPage()
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(scheduler.email)
  await page.getByLabel('Password', { exact: true }).fill(scheduler.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/scheduler$/)
})

test.afterAll(async () => {
  await page.close()
  removeUsers([scheduler, zed, amy, ana, ben])
})

test('the schedule shows confirmed sessions only, and pages on the server', async () => {
  await open()
  await expect(page.getByText(`1 to 25 of ${COUNT}`)).toBeVisible()
  await expect(page.getByRole('table')).not.toContainText('WAITING')
  await expect(page.getByRole('table')).not.toContainText('CANCELLED')
  await noViolations()
  await page.getByRole('button', { name: 'Next page' }).click()
  await expect(page.getByText(`26 to ${COUNT} of ${COUNT}`)).toBeVisible()
})

test('it filters by status, therapist, patient and date', async () => {
  await open()
  await page.getByLabel('Status').click()
  await page.getByRole('option', { name: 'Rescheduled' }).click()
  await expect(page.getByText('1 to 6 of 6')).toBeVisible()
  await page.getByRole('button', { name: 'Clear' }).click()
  await open()
  await page.getByLabel('Therapist', { exact: true }).click()
  await page.getByRole('option', { name: `Amy ${tag}` }).click()
  await expect(page.getByText('1 to 10 of 10')).toBeVisible()
  await page.getByLabel('Patient', { exact: true }).click()
  await page.getByRole('option', { name: `Ben ${tag}` }).click()
  await expect(page.getByText('1 to 5 of 5')).toBeVisible()
  const first = sql(`select (starts_at at time zone 'Asia/Manila')::date from public.bookings where reference_no='${references[29]}'`)
  await page.getByLabel('From').fill(first)
  await expect(page.getByText('1 to 1 of 1')).toBeVisible()
})

test('the export code loads only when asked for', async () => {
  const loaded: string[] = []
  const watch = (request: Request) => { if (/jspdf|write-excel-file|exportSchedule/.test(request.url())) loaded.push(request.url()) }
  page.on('request', watch)
  await open()
  await expect(page.getByText(`1 to 25 of ${COUNT}`)).toBeVisible()
  expect(loaded).toEqual([])
  await save('Export XLSX')
  expect(loaded.length).toBeGreaterThan(0)
  page.off('request', watch)
})

test('an XLSX export holds the whole filtered result, not only this page', async () => {
  await open()
  await expect(page.getByText(`1 to 25 of ${COUNT}`)).toBeVisible()
  const download = await save('Export XLSX')
  expect(download.suggestedFilename()).toMatch(/^motivance-schedule-\d{4}-\d{2}-\d{2}\.xlsx$/)
  const text = await spreadsheet(download)
  for (const reference of references) expect(text).toContain(reference)
  expect(text).not.toContain('WAITING')
  expect(text).not.toContain('CANCELLED')
  expect(text).toContain('Reference')
  expect(text).toContain(`Zed ${tag}`)
  expect(text).toContain(`Ben ${tag}`)
  await expect(page.getByText(`${COUNT} sessions exported.`)).toBeVisible()
  expect(audit().at(-1)).toBe(`xlsx:${COUNT}`)
})

test('a PDF export has the center, the logo, the range, the time it was made and every session', async () => {
  const center = sql(`select center_name from public.center_settings`)
  await open()
  await expect(page.getByText(`1 to 25 of ${COUNT}`)).toBeVisible()
  const download = await save('Export PDF')
  expect(download.suggestedFilename()).toMatch(/^motivance-schedule-\d{4}-\d{2}-\d{2}\.pdf$/)
  const text = await pdf(download)
  expect(text.startsWith('%PDF-')).toBe(true)
  expect(text).toContain(center)
  expect(text).toContain('/Subtype /Image')
  expect(text).toContain('All dates')
  expect(text).toContain('Generated')
  for (const reference of references) expect(text).toContain(reference)
  expect(text).not.toContain('WAITING')
  expect(audit().at(-1)).toBe(`pdf:${COUNT}`)
})

test('an export follows the filters', async () => {
  await open()
  await page.getByLabel('Therapist', { exact: true }).click()
  await page.getByRole('option', { name: `Amy ${tag}` }).click()
  await expect(page.getByText('1 to 10 of 10')).toBeVisible()
  const text = await spreadsheet(await save('Export XLSX'))
  expect(text).toContain(references[29])
  expect(text).not.toContain(references[0])
  expect(audit().at(-1)).toBe('xlsx:10')
})

test('an administrator reads the export in Activity, in words', async ({ browser }) => {
  const admin = await createUser(['admin'], `Ada ${tag}`)
  const context = await browser.newContext()
  const feed = await context.newPage()
  try {
    await feed.goto('/sign-in')
    await feed.getByLabel('Email').fill(admin.email)
    await feed.getByLabel('Password', { exact: true }).fill(admin.password)
    await feed.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(feed).toHaveURL(/\/admin$/)
    await feed.goto('/admin/activity')
    await expect(feed.getByText('Schedule exported').first()).toBeVisible()
    await expect(feed.getByText('XLSX, 10 rows').first()).toBeVisible()
  } finally {
    await context.close()
    removeUsers([admin])
  }
})

test('no record means no file', async () => {
  await open()
  await expect(page.getByText(`1 to 25 of ${COUNT}`)).toBeVisible()
  const recorded = audit().length
  const files: Download[] = []
  const watch = (download: Download) => { files.push(download) }
  await page.route('**/rest/v1/rpc/scheduler_log_export', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"unavailable"}' }))
  page.on('download', watch)
  await page.getByRole('button', { name: 'Export XLSX' }).click()
  await expect(page.getByText('The export could not be made. Try again.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export XLSX' })).toBeEnabled()
  page.off('download', watch)
  await page.unroute('**/rest/v1/rpc/scheduler_log_export')
  expect(files).toEqual([])
  expect(audit()).toHaveLength(recorded)
})

test('with nothing to export, the buttons say so by being off', async () => {
  await page.goto('/scheduler/schedule')
  await page.getByLabel('Search patient, therapist or reference').fill(`nothing-${tag}`)
  await page.getByRole('button', { name: 'Search bookings' }).click()
  await expect(page.getByRole('heading', { name: 'No confirmed sessions' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export XLSX' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Export PDF' })).toBeDisabled()
})
