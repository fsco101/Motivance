import { randomUUID } from 'node:crypto'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { publishPrescription } from '../../src/data/therapist'
import { loadCatalogue } from '../../src/data/workspace'
import { createUser, link, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

/**
 * A full exercise session on the web (#137) against the local backend: Start from Exercises, consent, measure, finish,
 * save, and the exercise is gone from today's list.
 *
 * Chrome's fake camera shows a test pattern, not a person, so the MediaPipe host module is replaced with one that
 * reports a left elbow bending from 10° to 100° and back every three seconds, after a second and a half at rest.
 * Everything else is the real app: the camera, the frame loop, the shared engine, the drawing, the controller and the save.
 */
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] }, permissions: ['camera'] })
test.describe.configure({ mode: 'serial' })

const SCRIPTED_HOST = `
let first = null
const host = {
  thread: 'worker', delegate: 'GPU',
  async init() { return 'GPU' },
  async detect(source, timestampMs) {
    const image = await createImageBitmap(source)
    first ??= timestampMs
    const t = (timestampMs - first) / 1000
    const angle = t < 1.5 ? 10 : 55 - 45 * Math.cos((2 * Math.PI * (t - 1.5)) / 3)
    const r = (angle * Math.PI) / 180
    const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }))
    points[11] = { x: 0.5, y: 0.3, visibility: 1 }; points[23] = { x: 0.5, y: 0.8, visibility: 1 }
    points[13] = { x: 0.5, y: 0.5, visibility: 1 }; points[15] = { x: 0.5 + Math.sin(r) * 0.15, y: 0.5 + Math.cos(r) * 0.15, visibility: 1 }
    return { people: [points], image, width: image.width, height: image.height, timestampMs }
  },
  close() {},
}
export async function preparePoseTracking() { return host }
export async function releasePoseTracking() { return [] }
`

let therapist: TestUser
let patient: TestUser
let page: Page

async function signIn(browser: Browser, person: TestUser) {
  const opened = await (await browser.newContext()).newPage()
  await opened.route('**/src/features/exercise/pose/hosts.ts*', (route) => route.fulfill({ contentType: 'text/javascript', body: SCRIPTED_HOST }))
  await opened.goto('/sign-in')
  await opened.getByLabel('Email').fill(person.email)
  await opened.getByLabel('Password', { exact: true }).fill(person.password)
  await opened.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(opened).toHaveURL(/\/patient$/)
  return opened
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(90_000)
  therapist = await createUser(['therapist'])
  patient = await createUser(['patient'])
  await link(therapist, patient)
  const staff = await signedIn(therapist)
  const elbow = (await loadCatalogue(staff, therapist.id)).find((item) => item.algorithm === 'elbow-flexion-v1' && item.selectable)!
  await publishPrescription(staff, { assignmentId: randomUUID(), requestId: randomUUID(), patientId: patient.id, exerciseId: elbow.id, side: 'left', focus: null, low: 20, high: 90, repetitions: 2, minimumCycleMs: 600, maximumCycleMs: 30000, peakHoldMs: 100, maxTrunkLean: 20, confidence: 0.7 })
  page = await signIn(browser, patient)
})

test.afterAll(() => removeUsers([therapist, patient]))

test('a patient does today\'s exercise in the browser, and it is saved like a phone session', async () => {
  test.setTimeout(120_000)
  await page.goto('/patient/exercises')
  await page.getByRole('button', { name: 'Start exercise' }).first().click()
  await expect(page).toHaveURL(/\/patient\/exercises\/[0-9a-f-]+\/session$/)
  await expect(page.getByText('20° to 90° · 2 repetitions')).toBeVisible()
  await page.getByRole('button', { name: 'Open camera' }).click()
  await page.getByRole('button', { name: 'Allow camera access' }).click()
  await expect(page.getByText('Tracking ready. Use a controlled movement.')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Preview only · repetitions are not counting')).toBeVisible()
  const start = page.getByRole('button', { name: 'Start measurement' })
  await expect(start).toBeDisabled()
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
  }
  await page.getByLabel(/I consent to saving movement summaries/).check()
  await start.click()
  await expect(page.getByText('Recording · repetition checking is active')).toBeVisible()
  await expect(page.getByText('2 / 2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Finish and save' }).click()
  await expect(page.getByRole('heading', { name: 'Exercise finished' })).toBeVisible()
  await expect(page.getByText('Saved to your account. Your therapist can see it in your progress.')).toBeVisible()

  expect(sql(`select count(*)||','||min(client) from public.sessions where patient_id='${patient.id}'`)).toBe('1,web')
  expect(Number(sql(`select m.completed_repetitions from public.session_measurements m join public.sessions s on s.id=m.session_id where s.patient_id='${patient.id}'`))).toBeGreaterThanOrEqual(2)

  await page.getByRole('link', { name: 'Back to exercises' }).click()
  await expect(page.getByRole('button', { name: 'Start exercise' })).toHaveCount(0)
})

test('an exercise that is no longer assigned says so instead of measuring', async () => {
  await page.goto(`/patient/exercises/${randomUUID()}/session`)
  await expect(page.getByText(/no longer assigned to you/)).toBeVisible()
})
