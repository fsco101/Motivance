import { randomUUID } from 'node:crypto'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/data/database.types'
import { shareSessionVideo, startSessionVideo, uploadVideoFile } from '../../src/data/sessionVideos'
import { publishPrescription } from '../../src/data/therapist'
import { createUser, ingestSession, link, removeUsers, signedIn, sql, stack, type TestUser } from '../support/stack'

/** A shared session video on the web (#129): the therapist watches it from progress, and the patient can stop sharing it. */
test.describe.configure({ mode: 'serial' })

const ELBOW = '21000000-0000-0000-0000-000000000001'
const timing = { focus: 'ELBOW' as const, minimumCycleMs: 600, maximumCycleMs: 30000, peakHoldMs: 100, maxTrunkLean: 20, confidence: 0.7 }

let therapist: TestUser
let patient: TestUser
let staff: Page
let person: Page

async function signIn(browser: Browser, who: TestUser, home: RegExp) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage()
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(who.email)
  await page.getByLabel('Password', { exact: true }).fill(who.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(home)
  return page
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(90_000)
  ;[therapist, patient] = await Promise.all([createUser(['therapist'], 'Dana Reyes'), createUser(['patient'], 'Rosa Lim')])
  await link(therapist, patient)
  const version = randomUUID()
  await publishPrescription(await signedIn(therapist), { ...timing, assignmentId: randomUUID(), requestId: version, patientId: patient.id, exerciseId: ELBOW, side: 'left', low: 20, high: 90, repetitions: 8 })
  await ingestSession(patient, version, { kind: 'ELBOW_FLEXION', side: 'LEFT', low: 20, high: 90, target: 8, focusJoint: 'ELBOW', min: 22, max: 88, completed: 8 })
  const sessionId = sql(`select id from public.sessions where patient_id='${patient.id}' limit 1`)
  const db = await signedIn(patient)
  const id = randomUUID()
  const places = await startSessionVideo(db, id, sessionId, 480, 270, 30_000)
  await uploadVideoFile(db, places.mediaPath, new Blob([new Uint8Array(2048)], { type: 'video/mp4' }), 'video/mp4')
  await uploadVideoFile(db, places.previewPath, new Blob([new Uint8Array(512)], { type: 'image/jpeg' }), 'image/jpeg')
  await shareSessionVideo(db, id)
  staff = await signIn(browser, therapist, /\/therapist$/)
  person = await signIn(browser, patient, /\/patient$/)
})

test.afterAll(async () => {
  await staff.close()
  await person.close()
  const paths = sql(`select name from storage.objects where bucket_id='session-videos' and split_part(name,'/',1)='${patient.id}'`).split(/\r?\n/).filter(Boolean)
  const { API_URL, SERVICE_ROLE_KEY } = stack()
  if (paths.length) await createClient<Database>(API_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } }).storage.from('session-videos').remove(paths)
  removeUsers([therapist, patient])
})

test('the therapist watches a shared video from the session in progress', async () => {
  await staff.goto(`/therapist/progress?patient=${patient.id}`)
  await staff.getByRole('button', { name: 'Watch video' }).click()
  const dialog = staff.getByRole('dialog', { name: 'Session video' })
  await expect(dialog.locator('video')).toHaveAttribute('src', /session-videos/)
  await expect(dialog.getByText(/^Shared by the patient\. It is deleted from the server on /)).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Stop sharing' })).toHaveCount(0)
  const results = await new AxeBuilder({ page: staff }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(results.violations.map((violation) => violation.id)).toEqual([])
})

test('the patient sees it in their history and can stop sharing it', async () => {
  await person.goto('/patient/progress')
  await person.getByRole('button', { name: 'Watch video' }).click()
  const dialog = person.getByRole('dialog', { name: 'Session video' })
  await expect(dialog.getByText(/^Your therapist can watch this until /)).toBeVisible()
  await dialog.getByRole('button', { name: 'Stop sharing' }).click()
  const confirm = person.getByRole('alertdialog', { name: 'Stop sharing this video?' })
  await confirm.getByRole('button', { name: 'Stop sharing' }).click()
  await expect(person.getByText('Video no longer shared')).toBeVisible()
  await expect(person.getByRole('button', { name: 'Watch video' })).toHaveCount(0)
  expect(sql(`select removed_at is not null from public.session_videos where patient_id='${patient.id}'`)).toBe('t')
})

test('once it is no longer shared, the therapist has nothing to open', async () => {
  await staff.reload()
  await expect(staff.getByRole('heading', { name: 'Elbow flexion', level: 2 })).toBeVisible()
  await expect(staff.getByRole('button', { name: 'Watch video' })).toHaveCount(0)
})
