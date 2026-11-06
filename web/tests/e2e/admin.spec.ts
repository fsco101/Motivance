import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { createCustomExercise } from '../../src/data/therapist'
import { createUser, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

/** An administrator's work in the real app against the real local backend. Summary and activity use fixed rows, because other tests change the live numbers. */
test.describe.configure({ mode: 'serial' })

const tag = randomUUID().slice(0, 8)
const PHOTO = 'https://res.cloudinary.com/demo/image/upload/v1/motivance/avatars/00000000-0000-0000-0000-000000000000/0123456789abcdef0123456789abcdef'
const exercise = randomUUID()

let admin: TestUser
let therapist: TestUser
let patient: TestUser
let page: Page

const adminName = `Mara ${tag}`
const therapistName = `Tess ${tag}`
const patientName = `Paolo ${tag}`
const exerciseName = `Seated knee ${tag}`

test.beforeAll(async ({ browser }) => {
  admin = await createUser(['admin'], adminName)
  therapist = await createUser(['therapist'], therapistName)
  patient = await createUser(['patient'], patientName)
  await createCustomExercise(await signedIn(therapist), { id: exercise, name: exerciseName, joint: 'KNEE', english: 'Sit tall and straighten the knee.', filipino: 'Umupo nang tuwid at ituwid ang tuhod.' })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] })
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(admin.email)
  await page.getByLabel('Password', { exact: true }).fill(admin.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/admin$/)
})
test.afterAll(async () => {
  await page.close()
  sql(`begin; set local session_replication_role=replica; delete from public.audit_events where actor_id='${admin.id}'; commit;`)
  removeUsers([admin, therapist, patient])
})

const search = async (text: string) => {
  await page.getByLabel('Search accounts').fill(text)
  await page.getByRole('button', { name: 'Search directory' }).click()
}
const openAccount = async (name: string) => {
  await page.goto('/admin/accounts')
  await search(name)
  await page.getByRole('main').getByRole('button', { name: new RegExp(name) }).click()
  return page.getByRole('complementary', { name: `Details for ${name}` })
}
const confirm = async (text: string, button: string) => {
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText(text)
  await dialog.getByRole('button', { name: button, exact: true }).click()
}
const roles = (user: TestUser) => sql(`select string_agg(role,',' order by role) from public.user_roles where user_id='${user.id}'`)

test('the overview shows every count and leads to each section', async () => {
  await page.route('**/rpc/admin_summary', (route) => route.fulfill({ json: { accounts: 111, disabled: 2, patients: 88, therapists: 12, schedulers: 5, admins: 3, active_links: 44, unlinked_patients: 5, exercises: 9, active_exercises: 0, sessions_week: 77, pending_requests: 6 } }))
  await page.goto('/admin')
  const main = page.getByRole('main')
  for (const name of ['Accounts: 111', 'Patients: 88', 'Therapists: 12', 'Schedulers: 5', 'Administrators: 3', 'Active links: 44', 'Active exercises: 0']) await expect(main.getByRole('link', { name })).toBeVisible()
  await expect(main).toContainText('2 disabled')
  await expect(main).toContainText('5 without a therapist')
  await expect(main).toContainText('9 in catalogue')
  await expect(main).toContainText('77')
  await expect(main.getByRole('heading', { name: 'Recent activity' })).toBeVisible()
  await main.getByRole('link', { name: /Patients without a therapist/ }).click()
  await expect(page).toHaveURL(/\/admin\/links$/)
  await page.goBack()
  await main.getByRole('link', { name: /Disabled accounts/ }).click()
  await expect(page).toHaveURL(/\/admin\/accounts\?filter=disabled$/)
  await page.goBack()
  await main.getByRole('link', { name: /No active exercises/ }).click()
  await expect(page).toHaveURL(/\/admin\/catalogue$/)
  await page.goBack()
  await expect(main.getByText('Open privacy requests')).toBeVisible()
  await page.unroute('**/rpc/admin_summary')
})

test('the directory searches the server, and each account shows its details', async () => {
  await page.goto('/admin/accounts')
  await search(patient.id)
  await expect(page.getByRole('main').getByRole('button', { name: new RegExp(patientName) })).toBeVisible()
  await expect(page.getByRole('main').getByRole('button', { name: new RegExp(therapistName) })).toHaveCount(0)
  await page.getByRole('main').getByRole('button', { name: new RegExp(patientName) }).click()
  const details = page.getByRole('complementary', { name: `Details for ${patientName}` })
  await expect(details).toContainText(patient.email)
  await expect(details).toContainText(patient.id)
  await expect(details).toContainText('Joined')
  await expect(details).toContainText('Last sign-in')
  await expect(details).toContainText('Patient')
  await details.getByRole('button', { name: 'Copy ID' }).click()
  await expect(details.getByRole('button', { name: 'Copied' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(patient.id)
})

test('filters narrow the loaded accounts', async () => {
  await search(tag)
  await expect(page.getByRole('main').getByRole('button', { name: new RegExp(`${patientName}|${therapistName}|${adminName}`) })).toHaveCount(3)
  await page.getByRole('button', { name: /^Therapists/ }).click()
  await expect(page.getByRole('main').getByRole('button', { name: new RegExp(therapistName) })).toBeVisible()
  await expect(page.getByRole('main').getByRole('button', { name: new RegExp(patientName) })).toHaveCount(0)
  await page.getByRole('button', { name: /^Disabled/ }).click()
  await expect(page.getByRole('heading', { name: 'No matching accounts' })).toBeVisible()
})

test('a role is granted and removed after a confirmation that names the account', async () => {
  const details = await openAccount(patientName)
  await details.getByRole('listitem').filter({ hasText: 'Therapist' }).getByRole('button', { name: 'Grant' }).click()
  await confirm(patientName, 'Grant')
  await expect(page.getByText('Access updated.')).toBeVisible()
  await expect.poll(() => roles(patient)).toBe('patient,therapist')
  await details.getByRole('listitem').filter({ hasText: 'Therapist' }).getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByRole('alertdialog')).toContainText('Their patient links and active assignments are revoked')
  await confirm(patientName, 'Remove')
  await expect.poll(() => roles(patient)).toBe('patient')
})

test('the Scheduler role is granted, filtered and removed', async () => {
  const details = await openAccount(patientName)
  await details.getByRole('listitem').filter({ hasText: 'Scheduler' }).getByRole('button', { name: 'Grant' }).click()
  await confirm(patientName, 'Grant')
  await expect.poll(() => roles(patient)).toBe('patient,scheduler')
  await page.getByRole('button', { name: /^Schedulers/ }).click()
  await expect(page.getByRole('main').getByRole('button', { name: new RegExp(patientName) })).toBeVisible()
  await page.getByRole('button', { name: /^All/ }).click()
  await details.getByRole('listitem').filter({ hasText: 'Scheduler' }).getByRole('button', { name: 'Remove' }).click()
  await confirm('They will no longer be able to open scheduling.', 'Remove')
  await expect.poll(() => roles(patient)).toBe('patient')
})

test('a disabled account shows why its roles are locked, and can be enabled again', async () => {
  const details = await openAccount(patientName)
  await details.getByRole('button', { name: 'Disable account' }).click()
  await confirm(patientName, 'Disable account')
  await expect(details.getByText('Enable the account before changing its access.')).toBeVisible()
  await expect(details.getByRole('button', { name: 'Grant' }).first()).toBeDisabled()
  expect(sql(`select active from public.profiles where id='${patient.id}'`)).toBe('f')
  await details.getByRole('button', { name: 'Enable account' }).click()
  await confirm(patientName, 'Enable account')
  await expect(details.getByRole('button', { name: 'Disable account' })).toBeVisible()
  expect(sql(`select active from public.profiles where id='${patient.id}'`)).toBe('t')
})

test('another account’s photo can be removed after a confirmation', async () => {
  sql(`update public.profiles set photo_url='${PHOTO}' where id='${patient.id}'`)
  const details = await openAccount(patientName)
  await details.getByRole('button', { name: 'Remove profile photo' }).click()
  await confirm(patientName, 'Remove profile photo')
  await expect(details.getByRole('button', { name: 'Remove profile photo' })).toHaveCount(0)
  expect(sql(`select coalesce(photo_url,'none') from public.profiles where id='${patient.id}'`)).toBe('none')
})

test('an administrator cannot change their own account, and is told why', async () => {
  const details = await openAccount(adminName)
  await expect(details.getByText('This is your account. Another administrator must change your access or status.')).toBeVisible()
  await expect(details.getByRole('button', { name: 'Disable account' })).toHaveCount(0)
  await expect(details.getByRole('button', { name: 'Grant' })).toHaveCount(0)
})

test('a failed read clears the list instead of leaving old data on screen', async () => {
  await page.goto('/admin/accounts')
  await search(patientName)
  const row = page.getByRole('main').getByRole('button', { name: new RegExp(patientName) })
  await expect(row).toBeVisible()
  await page.route('**/rpc/admin_accounts', (route) => route.fulfill({ status: 403, json: { code: '42501', message: 'denied' } }))
  await search(therapistName)
  const retry = page.getByRole('button', { name: 'Try again' })
  await expect(retry).toBeVisible()
  await expect(row).toHaveCount(0)
  await page.unroute('**/rpc/admin_accounts')
  await retry.click()
  await expect(page.getByRole('main').getByRole('button', { name: new RegExp(therapistName) })).toBeVisible()
})

test('a failed change says so and changes nothing', async () => {
  const details = await openAccount(patientName)
  await page.route('**/rpc/admin_set_account', (route) => route.fulfill({ status: 500, json: { message: 'failed' } }))
  await details.getByRole('button', { name: 'Disable account' }).click()
  await confirm(patientName, 'Disable account')
  await expect(page.getByRole('alert')).toContainText('The change could not be completed.')
  await page.unroute('**/rpc/admin_set_account')
  await expect(details.getByRole('button', { name: 'Disable account' })).toBeVisible()
  expect(sql(`select active from public.profiles where id='${patient.id}'`)).toBe('t')
})

test('a second change made while the first is saving is not lost', async () => {
  sql(`update public.profiles set photo_url='${PHOTO}' where id='${patient.id}'`)
  const details = await openAccount(patientName)
  await page.route('**/rpc/admin_set_account', async (route) => { await new Promise((done) => setTimeout(done, 1200)); await route.continue() })
  await details.getByRole('button', { name: 'Disable account' }).click()
  await confirm(patientName, 'Disable account')
  await details.getByRole('button', { name: 'Remove profile photo' }).click()
  await confirm(patientName, 'Remove profile photo')
  await expect.poll(() => sql(`select active,coalesce(photo_url,'none') from public.profiles where id='${patient.id}'`)).toBe('f|none')
  await page.unroute('**/rpc/admin_set_account')
  await details.getByRole('button', { name: 'Enable account' }).click()
  await confirm(patientName, 'Enable account')
  await expect.poll(() => sql(`select active from public.profiles where id='${patient.id}'`)).toBe('t')
})

test('a link is made, revoked and restored, with the same messages as Android', async () => {
  await page.goto('/admin/links')
  await page.getByRole('combobox', { name: 'Therapist' }).fill(therapist.id)
  await page.getByRole('combobox', { name: 'Patient' }).fill(patient.id)
  await page.getByRole('button', { name: 'Activate link' }).click()
  await confirm('will be able to view', 'Activate link')
  await expect(page.getByText('Care-team link updated.')).toBeVisible()
  await expect(page.getByText('This link is already active.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Activate link' })).toBeDisabled()

  await page.getByLabel('Filter links by name or ID').fill(tag)
  const group = page.getByRole('rowgroup', { name: therapistName })
  await expect(group).toContainText(patientName)
  await group.getByRole('button', { name: 'Revoke link' }).click()
  await confirm(patientName, 'Revoke link')
  await expect(group).toHaveCount(0)
  expect(sql(`select active from public.therapist_patients where therapist_id='${therapist.id}'`)).toBe('f')

  await page.getByRole('button', { name: 'Revoked' }).click()
  await group.getByRole('button', { name: 'Restore link' }).click()
  await expect(page.getByRole('alertdialog')).toContainText('Restoring a link never reactivates earlier prescriptions.')
  await confirm(patientName, 'Restore link')
  await expect.poll(() => sql(`select active from public.therapist_patients where therapist_id='${therapist.id}'`)).toBe('t')
})

test('a picker refuses text that is not an account', async () => {
  await page.goto('/admin/links')
  await page.getByRole('combobox', { name: 'Therapist' }).fill('nobody at all')
  await page.getByRole('combobox', { name: 'Patient' }).fill(patient.id)
  await page.getByRole('button', { name: 'Activate link' }).click()
  await expect(page.getByText('Choose an account or paste a complete account ID')).toBeVisible()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
})

test('the catalogue lists therapists’ exercises, and publishing shows the next version', async () => {
  await page.goto('/admin/catalogue')
  await page.getByRole('main').getByRole('button', { name: new RegExp(exerciseName) }).click()
  await expect(page.getByText('Sit tall and straighten the knee.')).toBeVisible()
  await expect(page.getByRole('row', { name: new RegExp(exerciseName) })).toContainText('Custom')
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(page.getByText('Unsaved changes')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Review and publish' })).toBeDisabled()
  await page.getByLabel('English instructions').fill('Sit tall, then straighten the knee slowly.')
  await expect(page.getByText('Unsaved changes')).toBeVisible()
  await page.getByLabel('Filipino instructions').fill('')
  await expect(page.getByRole('button', { name: 'Review and publish' })).toBeDisabled()
  await page.getByLabel('Filipino instructions').fill('Umupo nang tuwid, saka dahan-dahang ituwid ang tuhod.')
  await page.getByRole('button', { name: 'Review and publish' }).click()
  await confirm('version 2', 'Publish version 2')
  await expect(page.getByText('New exercise version published.')).toBeVisible()
  await expect.poll(() => sql(`select max(version) from public.exercise_versions where exercise_id='${exercise}'`)).toBe('2')
  expect(sql(`select definition->>'instructions_en' from public.exercise_versions where exercise_id='${exercise}' and version=2`)).toBe('Sit tall, then straighten the knee slowly.')
  expect(sql(`select definition->>'instructions_en' from public.exercise_versions where exercise_id='${exercise}' and version=1`)).toBe('Sit tall and straighten the knee.')
})

test('a failed publish keeps the draft open', async () => {
  await page.goto('/admin/catalogue')
  await page.getByRole('main').getByRole('button', { name: new RegExp(exerciseName) }).click()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByLabel('English instructions').fill('A long draft worth keeping.')
  await page.route('**/rpc/admin_publish_exercise', (route) => route.fulfill({ status: 500, json: { message: 'failed' } }))
  await page.getByRole('button', { name: 'Review and publish' }).click()
  await confirm('version 3', 'Publish version 3')
  await expect(page.getByRole('alert')).toContainText('The change could not be completed.')
  await expect(page.getByLabel('English instructions')).toHaveValue('A long draft worth keeping.')
  await page.unroute('**/rpc/admin_publish_exercise')
  expect(sql(`select max(version) from public.exercise_versions where exercise_id='${exercise}'`)).toBe('2')
})

test('an exercise can be deactivated and stays listed so it can come back', async () => {
  await page.goto('/admin/catalogue')
  await page.getByRole('main').getByRole('button', { name: new RegExp(exerciseName) }).click()
  await page.getByRole('button', { name: 'Deactivate' }).click()
  await confirm(exerciseName, 'Deactivate')
  await expect.poll(() => sql(`select active from public.exercises where id='${exercise}'`)).toBe('f')
  await page.reload()
  await page.getByRole('main').getByRole('button', { name: new RegExp(exerciseName) }).click()
  await page.getByRole('button', { name: 'Activate' }).click()
  await confirm(exerciseName, 'Activate')
  await expect.poll(() => sql(`select active from public.exercises where id='${exercise}'`)).toBe('t')
})

test('activity uses Android’s wording, filters by category, labels system events and loads older ones', async () => {
  const row = (id: number, action: string, type: string, target: string, actor: string | null, extra: Record<string, string> = {}) => (
    { id, action, target_type: type, target_id: target, recorded_at: '2026-11-05T02:00:00Z', actor_id: actor, actor_name: actor ? adminName : '', target_name: '', related_name: '', ...extra }
  )
  const first = [
    row(100, 'insert', 'user_roles', patient.id, admin.id, { target_name: patientName }), row(99, 'update', 'therapist_patients', `${therapist.id}:${patient.id}`, admin.id, { target_name: therapistName, related_name: patientName }),
    row(98, 'publish', 'exercise_versions', exercise, admin.id), row(97, 'insert', 'sessions', 'aaaaaaaa-session', null), row(96, 'insert', 'consents', 'bbbbbbbb-consent', null),
    ...Array.from({ length: 26 }, (_, index) => row(95 - index, 'insert', 'sessions', `cccccccc-${index}`, null)),
  ]
  await page.route('**/rpc/admin_activity', async (route) => {
    const before = (route.request().postDataJSON() as { p_before?: number }).p_before
    await route.fulfill({ json: before ? [row(60, 'disable', 'profiles', patient.id, admin.id, { target_name: patientName })] : first })
  })
  await page.goto('/admin/activity')
  await expect(page.getByText('Role granted')).toBeVisible()
  await expect(page.getByText(`${therapistName} → ${patientName}`)).toBeVisible()
  await expect(page.getByText('Exercise version published')).toBeVisible()
  await expect(page.getByRole('cell', { name: 'System', exact: true }).first()).toBeVisible()
  await expect(page.getByRole('cell', { name: adminName }).first()).toBeVisible()

  await page.getByRole('button', { name: 'Links' }).click()
  await expect(page.getByText('Link updated')).toBeVisible()
  await expect(page.getByText('Role granted')).toHaveCount(0)
  await page.getByRole('button', { name: 'Privacy' }).click()
  await expect(page.getByText('Consent recorded')).toBeVisible()
  await page.getByRole('button', { name: 'All' }).click()

  await page.getByRole('button', { name: 'Load older activity' }).click()
  await expect(page.getByText('Account disabled')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Load older activity' })).toHaveCount(0)
  await page.unroute('**/rpc/admin_activity')
})

test('a real change reaches the activity page', async () => {
  await page.goto('/admin/activity')
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible()
  await expect(page.getByRole('cell', { name: adminName }).first()).toBeVisible()
})
