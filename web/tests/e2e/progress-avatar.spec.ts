import { randomBytes } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { createUser, link, removeUsers, sql, type TestUser } from '../support/stack'

/** #174: the therapist's Progress page shows whose results these are, with their photo or their initials. */
test.describe.configure({ mode: 'serial' })

let therapist: TestUser
let withPhoto: TestUser
let withoutPhoto: TestUser
let page: Page

// A 1×1 PNG, served for the stored path so nothing is uploaded.
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

test.beforeAll(async ({ browser }) => {
  therapist = await createUser(['therapist'], 'Dana Reyes')
  withPhoto = await createUser(['patient'], 'Ana Dela Cruz')
  withoutPhoto = await createUser(['patient'], 'Ben Santos')
  await link(therapist, withPhoto)
  await link(therapist, withoutPhoto)
  sql(`update public.profiles set photo_url='${withPhoto.id}/${randomBytes(16).toString('hex')}.webp' where id='${withPhoto.id}'`)
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.route('**/storage/v1/object/public/avatars/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }))
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(therapist.email)
  await page.getByLabel('Password', { exact: true }).fill(therapist.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/therapist$/)
})
test.afterAll(async () => {
  await page.close()
  removeUsers([therapist, withPhoto, withoutPhoto])
})

test('the chosen patient with a photo shows it beside their name, opening their record', async () => {
  await page.goto(`/therapist/progress?patient=${withPhoto.id}`)
  const header = page.getByTestId('progress-patient')
  await expect(header).toContainText('Ana Dela Cruz')
  // The face is decorative: the name is what a screen reader reads.
  const photo = header.locator('img')
  await expect(photo).toHaveAttribute('alt', '')
  await expect(photo).toBeVisible()
  await expect(page.getByRole('link', { name: /^Ana Dela Cruz/ })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Patient' }).locator('img')).toHaveAttribute('alt', '')
  await page.getByRole('link', { name: /^Ana Dela Cruz/ }).click()
  await expect(page).toHaveURL(new RegExp(`/therapist/patients/${withPhoto.id}$`))
})

test('a patient without a photo shows initials, in the choice and the header', async () => {
  await page.goto(`/therapist/progress?patient=${withPhoto.id}`)
  await page.getByRole('combobox', { name: 'Patient' }).click()
  const option = page.getByRole('option', { name: 'Ben Santos' })
  await expect(option.locator('[data-initials="BS"]')).toBeVisible()
  await expect(page.getByRole('option', { name: 'Ana Dela Cruz' }).locator('img')).toHaveAttribute('alt', '')
  await option.click()
  const header = page.getByTestId('progress-patient')
  await expect(header).toContainText('Ben Santos')
  await expect(header.locator('img')).toHaveCount(0)
  await expect(header.locator('[data-initials="BS"]')).toHaveAttribute('aria-hidden', 'true')
})

test('the header reads in Filipino too', async () => {
  await page.evaluate(() => localStorage.setItem('motivance.language', 'fil'))
  await page.goto(`/therapist/progress?patient=${withoutPhoto.id}`)
  await expect(page.getByTestId('progress-patient')).toContainText('Buksan ang record ng pasyente')
  await page.evaluate(() => localStorage.removeItem('motivance.language'))
})
