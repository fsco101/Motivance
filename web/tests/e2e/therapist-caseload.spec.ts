import { randomUUID } from 'node:crypto'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { archiveCustomExercise, createCustomExercise, publishPrescription, type PrescriptionRequest } from '../../src/data/therapist'
import { loadCatalogue } from '../../src/data/workspace'
import { createUser, ingestSession, link, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

/** What a full caseload brings: several patients, one shared with a colleague, and the ways a page can fail. */
test.describe.configure({ mode: 'serial' })

const ADDRESS = '12 Mabini Street, Quezon City'
const timing = { focus: null, minimumCycleMs: 600, maximumCycleMs: 30000, peakHoldMs: 100, maxTrunkLean: 20, confidence: 0.7 }

let therapist: TestUser
let colleague: TestUser
let ana: TestUser
let ben: TestUser
let carla: TestUser
let dee: TestUser
let eli: TestUser
let page: Page

const plan = (patient: TestUser, exerciseId: string, side: 'left' | 'right', low: number, high: number): PrescriptionRequest => (
  { ...timing, assignmentId: randomUUID(), requestId: randomUUID(), patientId: patient.id, exerciseId, side, low, high, repetitions: 5 }
)

test.beforeAll(async ({ browser }) => {
  test.setTimeout(60_000)
  ;[therapist, colleague] = await Promise.all([createUser(['therapist'], 'Dana Reyes'), createUser(['therapist'], 'Omar Lim')])
  ;[ana, ben, carla, dee, eli] = await Promise.all([
    createUser(['patient'], 'Ana Dela Cruz'), createUser(['patient'], 'Ben Santos'), createUser(['patient'], 'Carla Uy'), createUser(['patient'], 'Dee Tan'), createUser(['patient'], 'Eli Ramos'),
  ])
  await link(therapist, ana)
  await link(therapist, ben)
  await link(therapist, eli)
  await link(colleague, ana)
  await link(colleague, carla)
  sql(`insert into public.patient_profiles(user_id,username,full_name,gender,birthdate,address,contact,avatar) values('${ana.id}','ana_${randomUUID().slice(0, 8)}','Ana Dela Cruz','female','1971-03-14','${ADDRESS}','0917 555 0142','person')`)

  const mine = await signedIn(therapist)
  const theirs = await signedIn(colleague)
  const catalogue = await loadCatalogue(mine, therapist.id)
  const elbow = catalogue.find((item) => item.algorithm === 'elbow-flexion-v1' && item.selectable)!.id
  const shoulder = catalogue.find((item) => item.algorithm === 'shoulder-abduction-v1' && item.selectable)!.id

  const anaElbow = plan(ana, elbow, 'left', 20, 100)
  const anaShoulder = plan(ana, shoulder, 'right', 30, 120)
  await publishPrescription(mine, anaElbow)
  await publishPrescription(theirs, anaShoulder)
  const elbowRules = { kind: 'ELBOW_FLEXION', side: 'LEFT', low: 20, high: 100, target: 5, focusJoint: 'ELBOW' }
  await ingestSession(ana, anaElbow.requestId, { ...elbowRules, min: 22, max: 80, completed: 5 })
  await ingestSession(ana, anaElbow.requestId, { ...elbowRules, min: 21, max: 85, completed: 5 })
  await ingestSession(ana, anaShoulder.requestId, { kind: 'SHOULDER_ABDUCTION', side: 'RIGHT', low: 30, high: 120, target: 5, focusJoint: 'SHOULDER', min: 31, max: 101, completed: 5 })

  const knee = randomUUID()
  const kneeVersion = await createCustomExercise(mine, { id: knee, name: 'Seated knee extension', joint: 'KNEE', english: 'Sit tall and straighten the knee.', filipino: '' })
  await publishPrescription(mine, plan(ben, kneeVersion, 'left', 15, 80))
  await archiveCustomExercise(mine, knee)

  // A browser west of Greenwich is where a calendar day read as UTC shows a day early.
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/New_York', permissions: ['clipboard-read', 'clipboard-write'] })
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(therapist.email)
  await page.getByLabel('Password', { exact: true }).fill(therapist.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/therapist$/)
})
test.afterAll(async () => {
  await page.close()
  removeUsers([therapist, colleague, ana, ben, carla, dee, eli])
})

const card = (name: string) => page.getByRole('link', { name: `Open ${name}` })
const cards = () => page.getByRole('link', { name: /^Open / })
const publishButton = () => page.getByRole('button', { name: 'Publish to patient' })
const slow = (pattern: string, ms: number) => page.route(pattern, async (route) => { await new Promise((done) => setTimeout(done, ms)); await route.continue() })
const pressTabUntil = async (target: Locator) => {
  for (let presses = 0; presses < 40; presses += 1) {
    await page.keyboard.press('Tab')
    if (await target.evaluate((element) => element === document.activeElement)) return
  }
  throw new Error('Keyboard focus never reached the control')
}

test('home counts come from the server, open their pages and invent no score', async () => {
  await page.goto('/therapist')
  const readout = (name: string) => page.getByRole('main').getByRole('link', { name })
  await expect(readout('Patients: 3')).toBeVisible()
  await expect(readout('Active plans: 3')).toBeVisible()
  await expect(readout('Recent sessions: 3')).toBeVisible()
  await expect(readout('Without a plan: 1')).toBeVisible()
  await expect(page.getByText(/adherence|risk score|compliance/i)).toHaveCount(0)
  await readout('Recent sessions: 3').click()
  await expect(page).toHaveURL(/\/therapist\/progress/)
  await page.goBack()
  await readout('Active plans: 3').click()
  await expect(page).toHaveURL(/\/therapist\/patients$/)
})

test('the list shows linked patients only, and can be searched and sorted', async () => {
  await page.goto('/therapist/patients')
  await expect(cards()).toHaveCount(3)
  await expect(card('Carla Uy')).toHaveCount(0)
  await page.getByLabel('Search').fill('ben')
  await expect(cards()).toHaveCount(1)
  await expect(card('Ben Santos')).toBeVisible()
  await page.getByLabel('Search').fill('nobody')
  await expect(page.getByText('No patient matches')).toBeVisible()
  await page.getByLabel('Search').fill('')
  await expect(cards().first()).toHaveAccessibleName('Open Ana Dela Cruz')
  const sortBy = (name: string) => page.getByRole('button', { name, exact: true }).click()
  await sortBy('Patient')
  await expect(cards().first()).toHaveAccessibleName('Open Eli Ramos')
  await expect(page.getByRole('columnheader', { name: 'Patient' })).toHaveAttribute('aria-sort', 'descending')
  await sortBy('Last session')
  await sortBy('Last session')
  await expect(cards().first()).toHaveAccessibleName('Open Ana Dela Cruz')
  await sortBy('Plans')
  await sortBy('Plans')
  await expect(cards().first()).toHaveAccessibleName('Open Ana Dela Cruz')
  await expect(cards().nth(1)).toHaveAccessibleName('Open Ben Santos')
  await expect(cards().nth(2)).toHaveAccessibleName('Open Eli Ramos')
})

test('an invitation code copies, and the button says so in place', async () => {
  await page.goto('/therapist/patients')
  await page.getByRole('button', { name: 'Invite patient' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Email').fill(dee.email)
  await dialog.getByRole('button', { name: 'Create invitation' }).click()
  const code = await dialog.locator('code').textContent()
  await dialog.getByRole('button', { name: 'Copy' }).click()
  await expect(dialog.getByRole('button', { name: 'Copied' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code)
  await page.keyboard.press('Escape')
})

test('the whole page works by keyboard, and a refresh keeps the list on screen', async () => {
  await page.goto('/therapist/patients')
  await expect(cards()).toHaveCount(3)
  const invite = page.getByRole('button', { name: 'Invite patient' }).first()
  await pressTabUntil(invite)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(invite).toBeFocused()

  await pressTabUntil(page.getByLabel('Search'))
  await page.keyboard.type('eli')
  await expect(cards()).toHaveCount(1)
  await pressTabUntil(card('Eli Ramos'))
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Eli Ramos', level: 1 })).toBeVisible()
  await page.goBack()

  await expect(card('Eli Ramos')).toBeVisible()
  await page.getByLabel('Search').fill('')
  await expect(cards()).toHaveCount(3)
  await pressTabUntil(page.getByRole('button', { name: 'Actions for Eli Ramos' }))
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menuitem', { name: 'Revoke access' })).toBeFocused()
  await page.keyboard.press('Enter')
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText('Eli Ramos')
  await page.keyboard.press('Escape')
  await expect(confirm).toHaveCount(0)
  const actions = page.getByRole('button', { name: 'Actions for Eli Ramos' })
  await expect(actions).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menuitem', { name: 'Revoke access' })).toBeFocused()
  await page.keyboard.press('Enter')
  await pressTabUntil(confirm.getByRole('button', { name: 'Revoke access' }))

  await slow('**/rest/v1/patients*', 900)
  const refresh = page.waitForRequest('**/rest/v1/patients*')
  await page.keyboard.press('Enter')
  await refresh
  await expect(card('Ben Santos')).toBeVisible()
  await expect(card('Eli Ramos')).toHaveCount(0)
  await page.unroute('**/rest/v1/patients*')
})

test('the record puts everything side by side on wide screens and stacks it on narrow ones', async () => {
  await page.goto(`/therapist/patients/${ana.id}`)
  const birthdate = page.getByText('Birthdate')
  const plans = page.getByRole('heading', { name: 'Exercise plan' })
  const progress = page.getByRole('heading', { name: 'Progress', exact: true })
  await expect(page.getByText('Mar 14, 1971')).toBeVisible()
  const wide = { profile: (await birthdate.boundingBox())!, plans: (await plans.boundingBox())!, progress: (await progress.boundingBox())! }
  expect(wide.plans.x).toBeGreaterThan(wide.profile.x + wide.profile.width)
  expect(wide.plans.y).toBeLessThan(wide.profile.y)

  await page.setViewportSize({ width: 700, height: 1000 })
  const narrow = { profile: (await birthdate.boundingBox())!, plans: (await plans.boundingBox())! }
  expect(narrow.plans.y).toBeGreaterThan(narrow.profile.y)
  expect(Math.abs(narrow.plans.x - narrow.profile.x)).toBeLessThan(40)
  await page.setViewportSize({ width: 1440, height: 1000 })
})

test('opening another patient never shows the previous one, even for a moment', async () => {
  await page.goto(`/therapist/patients/${ana.id}`)
  await expect(page.getByText(ADDRESS)).toBeVisible()
  await slow('**/rest/v1/patient_profiles*', 1500)
  // The same page with a new ID, which is the case where old data could linger.
  await page.evaluate((url) => { history.pushState(null, '', url); dispatchEvent(new PopStateEvent('popstate')) }, `/therapist/patients/${ben.id}`)
  await expect(page.getByText(ADDRESS)).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Ana Dela Cruz', level: 1 })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Ben Santos', level: 1 })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Ben Santos', level: 1 })).toBeVisible()
  await page.unroute('**/rest/v1/patient_profiles*')
})

test('each plan card shows its details, and only the therapist who assigned it can edit', async () => {
  await page.goto(`/therapist/patients/${ana.id}`)
  await expect(page.getByText('Version 1').first()).toBeVisible()
  await expect(page.getByText('Left side, 20° to 100°, 5 repetitions')).toBeVisible()
  await expect(page.getByRole('row', { name: /Shoulder abduction/ }).getByText('Assigned by another therapist, so only they can edit it.')).toBeVisible()
  await expect(page.getByRole('row', { name: /Shoulder abduction/ }).getByRole('link', { name: 'Edit plan' })).toHaveCount(0)
  await expect(page.getByRole('row', { name: /Elbow flexion/ }).getByRole('link', { name: 'Edit plan' })).toHaveCount(1)
  await expect(page.getByRole('row', { name: /Elbow flexion/ }).getByText('Exercise joint (automatic)')).toBeVisible()
})

test('the record chart names one series and never mixes exercises on a line', async () => {
  await page.goto(`/therapist/patients/${ana.id}`)
  await expect(page.getByRole('heading', { name: 'Shoulder abduction', level: 3 }).last()).toBeVisible()
  await expect(page.getByText('Right side, version 1, prescribed 30° to 120°')).toBeVisible()
  await expect(page.getByRole('img', { name: /chart with 1 sessions/ })).toBeVisible()
})

test('a record that cannot load offers a retry instead of loading for ever', async () => {
  await page.route('**/rest/v1/exercise_versions*', (route) => route.fulfill({ status: 403, json: { code: '42501', message: 'denied' } }))
  await page.goto(`/therapist/patients/${ana.id}`)
  const retry = page.getByRole('button', { name: 'Try again' })
  await expect(retry).toBeVisible({ timeout: 15_000 })
  await page.unroute('**/rest/v1/exercise_versions*')
  await retry.click()
  await expect(page.getByRole('heading', { name: 'Ana Dela Cruz', level: 1 })).toBeVisible()
})

test('typing a date keeps focus in the filter, and filters narrow the sessions', async () => {
  await page.goto(`/therapist/progress?patient=${ana.id}`)
  await expect(page.getByRole('cell', { name: '70°' })).toBeVisible()
  const from = page.getByLabel('From')
  await from.focus()
  await page.keyboard.type('01012099')
  await expect(from).toBeFocused()
  await expect(from).toHaveValue('2099-01-01')
  await expect(page.getByText('No sessions match these filters.')).toBeVisible()
  await from.fill('')
  await expect(page.getByRole('cell', { name: '70°' })).toBeVisible()

  await page.getByLabel('Exercise').click()
  await page.getByRole('option', { name: 'Elbow flexion' }).click()
  await expect(page.getByRole('cell', { name: '70°' })).toHaveCount(0)
  await expect(page.getByRole('cell', { name: '64°' })).toBeVisible()
})

test('filters belong to one patient: another starts clean, and going back finds them as they were', async () => {
  await page.getByLabel('Patient').click()
  await page.getByRole('option', { name: 'Ben Santos' }).click()
  await expect(page).toHaveURL(new RegExp(`patient=${ben.id}`))
  await expect(page.getByLabel('Exercise')).toContainText('All exercises')
  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`patient=${ana.id}`))
  await expect(page.getByLabel('Exercise')).toContainText('Elbow flexion')
  await expect(page.getByRole('cell', { name: '64°' })).toBeVisible()
  await expect(page.getByRole('cell', { name: '70°' })).toHaveCount(0)
})

test('a patient who is not linked cannot be reached through the address bar', async () => {
  await page.goto(`/therapist/progress?patient=${carla.id}`)
  await expect(page.getByLabel('Patient')).not.toContainText('Carla Uy')
  await page.goto(`/therapist/patients/${carla.id}`)
  await expect(page.getByRole('heading', { name: 'This patient is not linked to you' })).toBeVisible()
})

test('a failed page of older sessions keeps what is on screen, and can be tried again', async () => {
  await page.route('**/rest/v1/sessions*', async (route) => {
    const url = route.request().url()
    if (!url.includes(`patient_id=eq.${ana.id}`)) return route.continue()
    if (url.includes('or=')) return route.abort()
    // The app asks for one row more than a page to learn whether another page exists.
    const response = await route.fetch()
    const rows = await response.json() as Array<Record<string, unknown>>
    return route.fulfill({ response, json: Array.from({ length: 51 }, (_, index) => ({ ...rows[index % rows.length], id: randomUUID() })) })
  })
  await page.goto(`/therapist/progress?patient=${ana.id}`)
  const older = page.getByRole('button', { name: 'Load older sessions' })
  await older.click()
  await expect(page.getByRole('alert')).toContainText('Could not reach Motivance.', { timeout: 15_000 })
  await expect(page.getByRole('cell', { name: '70°' }).first()).toBeVisible()
  await expect(older).toBeEnabled()
  await page.unroute('**/rest/v1/sessions*')
  await older.click()
  await expect(older).toHaveCount(0)
})

test('a plan on a removed exercise says why it cannot be published, until another is chosen', async () => {
  await page.goto(`/therapist/patients/${ben.id}`)
  await page.getByRole('link', { name: 'Edit plan' }).click()
  await expect(page.getByRole('heading', { name: 'Editing version 1' })).toBeVisible()
  await expect(page.getByText('Publishing creates version 2.')).toBeVisible()
  await expect(page.getByText('Removed', { exact: true })).toBeVisible()
  await expect(page.getByText('This exercise was removed from your list')).toBeVisible()
  await expect(publishButton()).toBeDisabled()
  await page.getByRole('radio', { name: /^Elbow flexion/ }).click()
  await expect(publishButton()).toBeEnabled()
  await publishButton().click()
  await expect(page.getByRole('heading', { name: 'Ben Santos', level: 1 })).toBeVisible()
  expect(sql(`select count(*),max(version) from public.prescription_versions where patient_id='${ben.id}'`)).toBe('2|2')
})

test('blank or impossible timing stops publishing, and says so with the panel closed', async () => {
  await page.goto(`/therapist/patients/${ana.id}/assign`)
  await page.getByRole('radio', { name: /^Elbow flexion/ }).click()
  await expect(publishButton()).toBeEnabled()
  await page.getByRole('button', { name: 'Adjust timing' }).click()
  await page.getByLabel('Hold at target (ms)').fill('')
  await expect(publishButton()).toBeDisabled()
  await expect(page.getByText('Check the timing values against their limits.')).toBeVisible()
  await page.getByRole('button', { name: 'Hide timing' }).click()
  await expect(page.getByLabel('Hold at target (ms)')).toHaveCount(0)
  await expect(page.getByText('Check the timing values against their limits.')).toBeVisible()
  await page.getByRole('button', { name: 'Adjust timing' }).click()
  await page.getByLabel('Hold at target (ms)').fill('100')
  await page.getByLabel('Minimum repetition time (ms)').fill('600.5')
  await expect(publishButton()).toBeDisabled()
  await page.getByLabel('Minimum repetition time (ms)').fill('600')
  await expect(publishButton()).toBeEnabled()
})

test('a range the server would refuse stops publishing', async () => {
  await page.getByRole('spinbutton', { name: 'Start angle' }).fill('80')
  await page.getByRole('spinbutton', { name: 'Target angle' }).fill('90')
  await expect(page.getByText('Use 0° to 180°, with the target more than 10° above the start.')).toBeVisible()
  await expect(publishButton()).toBeDisabled()
})
