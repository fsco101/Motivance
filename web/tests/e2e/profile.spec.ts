import { createHash, randomUUID } from 'node:crypto'
import { expect, test, type Page, type Route } from '@playwright/test'
import { createUser, removeUsers, sql, stack, type TestUser } from '../support/stack'

/**
 * Photos run through the real database functions, which sign and verify with these throwaway Vault secrets. Only
 * Cloudinary's own endpoint is stood in for, and it answers with a correctly signed response.
 */
test.describe.configure({ mode: 'serial' })

const tag = randomUUID().slice(0, 8)
const CLOUD = 'motivance-test'
const SECRET = `secret-${randomUUID()}`
const AVATAR = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

let staff: TestUser
let other: TestUser
let admin: TestUser
let page: Page
let secrets: string[] = []
let posted: Buffer | null = null
let wide: Buffer

const details = () => ({ first: 'Dana', last: 'Reyes', username: `dana_${tag}`, birthdate: '1988-07-02', contact: '+63 917 555 0133', address: 'Quezon City' })
const signIn = async (user: TestUser, password = user.password) => {
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}
const signOut = async () => {
  await page.getByRole('button', { name: 'Account' }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/(sign-in)?$/)
}

test.beforeAll(async ({ browser }) => {
  staff = await createUser(['therapist'], 'New Staff')
  other = await createUser(['therapist'], 'Other Staff')
  admin = await createUser(['admin'], 'Mara Cruz')
  sql(`insert into public.patient_profiles(user_id,username,full_name,first_name,last_name,gender,birthdate,address,contact) values('${other.id}','taken_${tag}','Other Staff','Other','Staff','male','1990-01-01','Quezon City','0917 555 0142')`)
  secrets = ['cloud_name', 'api_key', 'api_secret'].map((name, index) => sql(`select vault.create_secret('${[CLOUD, 'key-123', SECRET][index]}','cloudinary_${name}')`))
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/New_York' })
  await page.route('https://res.cloudinary.com/**', (route) => route.fulfill({ contentType: 'image/png', body: AVATAR }))
  await page.route(`https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`, async (route: Route) => {
    posted = route.request().postDataBuffer()
    const publicId = /name="public_id"\r\n\r\n([^\r]+)/.exec(posted!.toString('latin1'))![1]!
    const version = 1762300000
    await route.fulfill({ json: { public_id: publicId, version, signature: createHash('sha1').update(`public_id=${publicId}&version=${version}${SECRET}`).digest('hex') } })
  })
  await signIn(staff)
  await expect(page).toHaveURL(/\/therapist$/)
  await page.goto('/therapist/profile')
  // A real image, wider than it is tall, so the crop has work to do.
  wide = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 800
    canvas.height = 400
    const context = canvas.getContext('2d')!
    context.fillStyle = '#0e7c86'
    context.fillRect(0, 0, 800, 400)
    return canvas.toDataURL('image/png').split(',')[1]!
  }), 'base64')
})
test.afterAll(async () => {
  await page.close()
  sql(`delete from vault.secrets where id in (${secrets.map((id) => `'${id}'`).join(',')}); delete from public.profile_photo_uploads where user_id='${staff.id}';`)
  removeUsers([staff, other, admin])
})

const save = () => page.getByRole('button', { name: 'Save profile' }).click()
const fill = async (extra: Partial<ReturnType<typeof details>> = {}) => {
  const value = { ...details(), ...extra }
  await page.getByLabel('First name').fill(value.first)
  await page.getByLabel('Last name').fill(value.last)
  await page.getByLabel('Birthdate').fill(value.birthdate)
  await page.getByLabel('Username').fill(value.username)
  await page.getByLabel('Contact number').fill(value.contact)
  await page.getByLabel('Address').fill(value.address)
}

test('a new staff account is asked for its details and the privacy agreement', async () => {
  await expect(page.getByText('Add your details to finish setting up this account.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Data privacy agreement' })).toBeVisible()
  await expect(page.getByLabel('First name')).toHaveValue('New')
  await save()
  await expect(page.getByText('Choose your birthdate.')).toBeVisible()
  await expect(page.getByText('Choose one option.')).toBeVisible()
  await expect(page.getByText('Accept the agreement to save your details.')).toBeVisible()
  expect(sql(`select count(*) from public.patient_profiles where user_id='${staff.id}'`)).toBe('0')
})

test('each field explains its own rule, as on Android', async () => {
  await fill({ first: 'Dana1', contact: '123', address: 'abc', username: 'x' })
  await expect(page.getByText('Enter 1 to 60 letters, with spaces, apostrophes, periods or hyphens.').first()).toBeVisible()
  await expect(page.getByText('Enter 7 to 15 digits. Use + only at the beginning.')).toBeVisible()
  await expect(page.getByText('Enter your address using 5 to 500 characters.')).toBeVisible()
  await expect(page.getByText('Use 3 to 30 letters, numbers or underscores.', { exact: true })).toBeVisible()
  await page.getByLabel('Username').fill('t4ng4_99')
  await expect(page.getByText('Please choose a respectful username without offensive words.')).toBeVisible()
})

test('saving updates the name across the app', async () => {
  await fill()
  await expect(page.getByText(/^Age: \d+$/)).toBeVisible()
  await page.getByLabel('Gender').click()
  await page.getByRole('option', { name: 'Female' }).click()
  await page.getByLabel(/I have read this agreement/).check()
  await save()
  await expect(page.getByText('Profile updated.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Dana Reyes' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Account' }).locator('[data-initials="DR"]')).toBeAttached()
  await expect(page.getByText('Jul 2, 1988')).toBeVisible()
  expect(sql(`select display_name from public.profiles where id='${staff.id}'`)).toBe('Dana Reyes')
})

test('editing starts from the saved details and does not ask for the agreement again', async () => {
  await page.getByRole('button', { name: 'Edit profile' }).click()
  await expect(page.getByLabel('Username')).toHaveValue(`dana_${tag}`)
  await expect(page.getByRole('heading', { name: 'Data privacy agreement' })).toHaveCount(0)
  await page.getByLabel('Address').fill('Makati City')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText('Quezon City')).toBeVisible()
  await expect(page.getByText('Makati City')).toHaveCount(0)
})

test('a username in use gets its own message', async () => {
  await page.getByRole('button', { name: 'Edit profile' }).click()
  await page.getByLabel('Username').fill(`taken_${tag}`)
  await save()
  await expect(page.getByText('That username is already in use. Choose another.')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
})

test('the password needs the current one, and a different, matching new one', async () => {
  const button = page.getByRole('button', { name: 'Change password' })
  const current = page.getByLabel('Current password')
  const next = page.getByLabel('New password', { exact: true })
  const confirm = page.getByLabel('Confirm new password')
  await expect(button).toBeDisabled()
  await current.fill(staff.password)
  await next.fill('short')
  await expect(page.getByText('at least 8', { exact: false }).first()).toBeVisible()
  await next.fill(staff.password)
  await confirm.fill(staff.password)
  await expect(page.getByText('Use a password different from your current one.')).toBeVisible()
  await expect(button).toBeDisabled()
  await next.fill('a-new-password-7')
  await confirm.fill('something-else')
  await expect(page.getByText('Passwords must match.')).toBeVisible()
  await expect(button).toBeDisabled()

  await current.fill('not-my-password')
  await confirm.fill('a-new-password-7')
  await button.click()
  await expect(page.getByText('That is not your current password.')).toBeVisible()

  await current.fill(staff.password)
  await button.click()
  await expect(page.getByText('Password changed.')).toBeVisible()
  await expect(current).toHaveValue('')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Dana Reyes' })).toBeVisible()
})

test('the session keeps working after a password change, because it can still refresh', async () => {
  const stored = await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.endsWith('-auth-token'))?.[1])
  const { refresh_token: token } = JSON.parse(stored!) as { refresh_token: string }
  const { API_URL, ANON_KEY } = stack()
  const refreshed = await fetch(`${API_URL}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: token }) })
  expect(refreshed.status).toBe(200)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Dana Reyes' })).toBeVisible()
})

test('the new password works, and the old one no longer does', async () => {
  await signOut()
  await signIn(staff)
  await expect(page.getByRole('alert')).toContainText('That email and password do not match.')
  await signIn(staff, 'a-new-password-7')
  await expect(page).toHaveURL(/\/therapist$/)
  await page.goto('/therapist/profile')
})

test('a photo is prepared as a square JPEG, signed by the server and shown across the app', async () => {
  await page.getByLabel('Profile photo').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: wide })
  await expect(page.getByText('Profile photo updated.')).toBeVisible()
  const sent = posted!.toString('latin1')
  expect(sent).toContain('Content-Type: image/jpeg')
  expect(sent).toContain('name="signature"')
  const start = posted!.indexOf(Buffer.from([0xff, 0xd8, 0xff]))
  const jpeg = posted!.subarray(start, posted!.indexOf(Buffer.from([0xff, 0xd9]), start) + 2).toString('base64')
  expect(await page.evaluate(async (data) => {
    const image = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${data}`)).blob())
    return [image.width, image.height]
  }, jpeg)).toEqual([512, 512])
  expect(sent).not.toContain(SECRET)
  expect(sql(`select photo_url from public.profiles where id='${staff.id}'`)).toMatch(new RegExp(`^https://res\\.cloudinary\\.com/${CLOUD}/image/upload/v1762300000/motivance/avatars/${staff.id}/[0-9a-f]{32}$`))
  await expect(page.getByRole('button', { name: 'Account' }).locator('img[src*="res.cloudinary.com"]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Change photo' })).toBeVisible()
})

test('a photo can be removed after a confirmation, and the initials return', async () => {
  await page.getByRole('button', { name: 'Remove photo' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove photo' }).click()
  await expect(page.getByText('Profile photo removed.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Account' }).locator('img[src*="res.cloudinary.com"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Upload a photo' })).toBeVisible()
  expect(sql(`select coalesce(photo_url,'none') from public.profiles where id='${staff.id}'`)).toBe('none')
})

test('a file that is not an image says so', async () => {
  await page.getByLabel('Profile photo').setInputFiles({ name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from('this is not an image') })
  await expect(page.getByText('That image could not be read. Choose a JPEG, PNG or WebP photo.')).toBeVisible()
})

test('photo problems name their cause', async () => {
  for (const [status, message] of [[503, 'Photo uploads are not available yet.'], [429, 'Too many uploads in the last hour.']] as const) {
    await page.route('**/rpc/profile_photo_upload', (route) => route.fulfill({ status, json: { message: 'stopped' } }))
    await page.getByLabel('Profile photo').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: wide })
    await expect(page.getByText(message)).toBeVisible()
    await page.unroute('**/rpc/profile_photo_upload')
  }
})

test('administrators have the same profile page', async () => {
  await signOut()
  await signIn(admin)
  await expect(page).toHaveURL(/\/admin$/)
  await page.getByRole('button', { name: 'Account' }).click()
  await page.getByRole('menuitem', { name: 'Profile' }).click()
  await expect(page).toHaveURL(/\/admin\/profile$/)
  await expect(page.getByRole('heading', { name: 'Your details' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Change password' })).toBeVisible()
})
