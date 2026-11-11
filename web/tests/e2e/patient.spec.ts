import { randomUUID } from 'node:crypto'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { publishPrescription } from '../../src/data/therapist'
import { createUser, ingestSession, link, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

/** Everything a patient can do on the web, against the real local backend. Only the camera exercise points to the phone. */
test.describe.configure({ mode: 'serial' })

const ELBOW = '21000000-0000-0000-0000-000000000001'
const timing = { focus: 'ELBOW' as const, minimumCycleMs: 600, maximumCycleMs: 30000, peakHoldMs: 100, maxTrunkLean: 20, confidence: 0.7 }

let therapist: TestUser
let patient: TestUser
let newcomer: TestUser
let page: Page

async function signIn(person: TestUser) {
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(person.email)
  await page.getByLabel('Password', { exact: true }).fill(person.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/patient$/)
}

/** Retries, because axe reads contrast from the pixels on screen, and a page or dialog may still be fading in. A real problem still fails. */
const noViolations = () => expect.poll(async () => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).slice(0, 3).join(' | ')}`)
}, { timeout: 8_000 }).toEqual([])

test.beforeAll(async ({ browser }) => {
  test.setTimeout(60_000)
  ;[therapist, patient, newcomer] = await Promise.all([createUser(['therapist'], 'Dana Reyes'), createUser(['patient'], 'Ana Dela Cruz'), createUser(['patient'], 'Noel Ramos')])
  await link(therapist, patient)
  const versionId = randomUUID()
  await publishPrescription(await signedIn(therapist), { ...timing, assignmentId: randomUUID(), requestId: versionId, patientId: patient.id, exerciseId: ELBOW, side: 'left', low: 20, high: 90, repetitions: 8 })
  await ingestSession(patient, versionId, { kind: 'ELBOW_FLEXION', side: 'LEFT', low: 20, high: 90, target: 8, focusJoint: 'ELBOW', min: 22, max: 88, completed: 7 })
  // Axe needs a page from an explicit context.
  page = await (await browser.newContext()).newPage()
  // Records any attempt to open the camera, so the test can prove there were none.
  await page.addInitScript(() => {
    const record = window as unknown as { cameraRequests: number }
    record.cameraRequests = 0
    const devices = navigator.mediaDevices as MediaDevices | undefined
    if (devices) devices.getUserMedia = () => { record.cameraRequests += 1; return Promise.reject(new Error('Camera requested')) }
  })
  await signIn(patient)
})

test.afterAll(async () => {
  await page.close()
  sql(`begin; set local session_replication_role=replica; delete from public.data_requests where patient_id='${patient.id}'; commit;`)
  removeUsers([patient, newcomer, therapist])
})

test('a patient lands on their own home, with today\'s exercise and this week', async () => {
  await page.goto('/patient')
  await expect(page.getByRole('heading', { name: 'Hello, Ana', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Elbow flexion' })).toBeVisible()
  await expect(page.getByText('Completed sessions on 1 of the 7 days this week').first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Recent sessions' })).toBeVisible()
  await noViolations()
})

test('a patient cannot open a staff workspace', async () => {
  await page.goto('/therapist')
  await expect(page).toHaveURL(/\/patient$/)
  await page.goto('/admin')
  await expect(page).toHaveURL(/\/patient$/)
})

test('the old mobile-only page is gone', async () => {
  await page.goto('/use-mobile')
  await expect(page).toHaveURL(/\/patient$/)
})

test('exercises list the prescribed targets and instructions', async () => {
  await page.goto('/patient/exercises')
  await expect(page.getByRole('heading', { name: 'Your exercises', level: 1 })).toBeVisible()
  const main = page.getByRole('main')
  await expect(main.getByText('20° to 90°')).toBeVisible()
  await expect(main.getByText('8 reps')).toBeVisible()
  await expect(main.getByText('Assigned focus: Left side, Elbow')).toBeVisible()
  await noViolations()
})

test('a both-sides exercise shows both sides and the time per side', async () => {
  const assignment = randomUUID()
  await publishPrescription(await signedIn(therapist), { ...timing, assignmentId: assignment, requestId: randomUUID(), patientId: patient.id, exerciseId: ELBOW, side: 'bilateral', sideSeconds: 120, low: 25, high: 95, repetitions: 6 })
  await page.goto('/patient/exercises')
  const main = page.getByRole('main')
  await expect(main.getByText('Time per side: 2:00')).toBeVisible()
  await expect(main.getByText('Assigned focus: Both sides, Elbow')).toBeVisible()
  // Keep the rest of this journey to its one exercise.
  sql(`update public.exercise_assignments set active=false where id='${assignment}'`)
})

test('starting an exercise suggests the phone, and it never runs here', async () => {
  await page.goto('/patient/exercises')
  await page.getByRole('button', { name: 'Start exercise' }).click()
  const dialog = page.getByRole('dialog', { name: 'Continue on your phone' })
  await expect(dialog).toContainText('uses your phone\'s camera')
  await expect(dialog).toContainText('Elbow flexion')
  await noViolations()
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(/\/patient\/exercises$/)
  await page.getByRole('button', { name: 'Camera positioning check' }).click()
  await expect(page.getByRole('dialog', { name: 'Continue on your phone' })).toContainText('The camera check uses your phone\'s camera')
  await page.keyboard.press('Escape')
  await page.goto('/patient')
  await page.getByRole('button', { name: 'Start exercise' }).click()
  await expect(page.getByRole('dialog', { name: 'Continue on your phone' })).toBeVisible()
  await page.keyboard.press('Escape')
  expect(await page.evaluate(() => (window as unknown as { cameraRequests: number }).cameraRequests)).toBe(0)
  await expect(page.locator('video')).toHaveCount(0)
})

test('progress shows the patient\'s own history without a patient picker', async () => {
  await page.goto('/patient/progress')
  await expect(page.getByRole('heading', { name: 'Progress', level: 1 })).toBeVisible()
  await expect(page.getByLabel('Patient')).toHaveCount(0)
  const main = page.getByRole('main')
  await expect(main.getByRole('heading', { name: 'Sessions' })).toBeVisible()
  const table = main.getByRole('table', { name: 'Sessions' })
  await expect(table.getByText('Elbow flexion')).toBeVisible()
  await expect(table.getByText('66°')).toBeVisible()
  await noViolations()
})

test('a patient sees only their own records, even with an administrator role', async () => {
  test.setTimeout(90_000)
  const both = await createUser(['patient', 'admin'], 'Marco Tan')
  try {
    await page.getByRole('button', { name: 'Account' }).click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await page.goto('/sign-in')
    await page.getByLabel('Email').fill(both.email)
    await page.getByLabel('Password', { exact: true }).fill(both.password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page).toHaveURL(/\/admin$/)
    await page.getByRole('button', { name: 'Account' }).click()
    await page.getByRole('menuitem', { name: 'Open your patient workspace' }).click()
    await expect(page).toHaveURL(/\/patient$/)
    await expect(page.getByRole('heading', { name: 'No exercises assigned yet' })).toBeVisible()
    await page.goto('/patient/progress')
    await expect(page.getByRole('main').getByRole('heading', { name: 'Sessions' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Account' }).click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/sign-in/)
  } finally {
    removeUsers([both])
  }
  await signIn(patient)
})

test('a patient withdraws consent, and the choice is recorded for the phone to read', async () => {
  await page.goto('/patient/profile')
  await expect(page.getByText('Movement-summary consent granted')).toBeVisible()
  await page.getByRole('button', { name: 'Withdraw movement-summary consent' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Withdraw movement-summary consent' }).click()
  await expect(page.getByText('Movement-summary consent withdrawn').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Withdraw movement-summary consent' })).toHaveCount(0)
  await expect.poll(() => sql(`select event from public.consents where patient_id='${patient.id}' order by occurred_at desc limit 1`)).toBe('withdrawn')
})

test('a patient requests an export, once, and sees where it stands', async () => {
  await page.goto('/patient/profile')
  await page.getByRole('button', { name: 'Request data export' }).click()
  await expect(page.getByRole('main').getByText('Recorded; awaiting administrator review')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Request data export' })).toBeDisabled()
  await expect.poll(() => sql(`select count(*) from public.data_requests where patient_id='${patient.id}' and kind='export'`)).toBe('1')
  await noViolations()
})

test('a patient connects to a therapist with an invitation code', async () => {
  await page.getByRole('button', { name: 'Account' }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/sign-in/)
  await signIn(newcomer)
  await page.goto('/patient/exercises')
  await expect(page.getByRole('heading', { name: 'No exercises assigned yet' })).toBeVisible()
  await page.getByRole('link', { name: 'Have an invitation code? Connect to your therapist' }).click()
  await expect(page).toHaveURL(/\/patient\/profile$/)
  await page.getByLabel('Invitation code').fill('not-a-code')
  await page.getByRole('button', { name: 'Accept invitation' }).click()
  await expect(page.getByText('Check the code. It has 48 letters and numbers.')).toBeVisible()
  const staff = await signedIn(therapist)
  const invited = await staff.rpc('invite_patient', { p_email: newcomer.email })
  await page.getByLabel('Invitation code').fill((invited.data as { code: string }).code)
  await page.getByRole('button', { name: 'Accept invitation' }).click()
  await expect(page.getByText('You are now connected to your therapist.')).toBeVisible()
  await expect.poll(() => sql(`select count(*) from public.therapist_patients where patient_id='${newcomer.id}' and active`)).toBe('1')
})

test('every page fits a phone with no sideways scrolling', async () => {
  await page.setViewportSize({ width: 360, height: 760 })
  for (const path of ['/patient', '/patient/exercises', '/patient/progress', '/patient/profile']) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, path).toBeLessThanOrEqual(0)
  }
  const bar = page.getByRole('navigation', { name: 'Main' })
  await expect(bar.getByRole('link', { name: 'Exercises' })).toBeVisible()
  await bar.getByRole('link', { name: 'Exercises' }).click()
  await expect(page).toHaveURL(/\/patient\/exercises$/)
  await expect(page.getByRole('heading', { name: 'Your exercises', level: 1 })).toBeVisible()
  await noViolations()
  await page.setViewportSize({ width: 1280, height: 800 })
})
