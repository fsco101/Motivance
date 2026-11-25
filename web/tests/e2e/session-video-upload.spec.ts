import { randomUUID } from 'node:crypto'
import { chromium, expect, test, type Browser, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/data/database.types'
import { publishPrescription } from '../../src/data/therapist'
import { createUser, ingestSession, link, removeUsers, signedIn, sql, stack, type TestUser } from '../support/stack'

/**
 * #175: asking to record, the message after a recorded session, and uploads that wait for a connection. The network is switched
 * off by Playwright; nothing goes outside the local stack. The queue is filled through the app's own module, as the finish screen
 * fills it once the smaller copy is made, because making that copy needs a real recording.
 */
test.describe.configure({ mode: 'serial' })

const ELBOW = '21000000-0000-0000-0000-000000000001'
const timing = { focus: 'ELBOW' as const, minimumCycleMs: 600, maximumCycleMs: 30000, peakHoldMs: 100, maxTrunkLean: 20, confidence: 0.7 }
const CAMERA = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']

let therapist: TestUser
let patient: TestUser
let sessionId: string

async function signIn(page: Page, who: TestUser) {
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(who.email)
  await page.getByLabel('Password', { exact: true }).fill(who.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/patient$/)
}
const language = (page: Page, value: 'en' | 'fil') => page.evaluate((next) => localStorage.setItem('motivance.language', next), value)

/** Puts a video in the queue the way the finish screen does, with small stand-in files, and starts the uploads. */
const enqueue = (page: Page, owner: string, session: string) => page.evaluate(async ({ owner, session }) => {
  const queue = await import('/src/features/exercise/video/useVideoQueue.ts' as string) as typeof import('../../src/features/exercise/video/useVideoQueue')
  await queue.videoQueue.enqueue(owner, session, { file: new Blob([new Uint8Array(2048)], { type: 'video/mp4' }), preview: new Blob([new Uint8Array(256)], { type: 'image/jpeg' }), width: 480, height: 270, durationMs: 30_000 })
  void queue.runQueue(owner)
}, { owner, session })
/**
 * No connection to the backend: every request to the local stack fails as it does without a network. The page itself stays
 * served, because the dev server's own connection is not part of what is tested.
 */
const BACKEND = /^http:\/\/(127\.0\.0\.1|localhost):54321\//
const cut = (route: import('@playwright/test').Route) => route.abort('internetdisconnected')
const offline = async (page: Page) => { await page.route(BACKEND, cut) }
const online = async (page: Page, announce = true) => { await page.unroute(BACKEND, cut); if (announce) await page.evaluate(() => window.dispatchEvent(new Event('online'))) }
const shared = () => sql(`select count(*) from public.session_videos where patient_id='${patient.id}' and shared_at is not null`)

test.beforeAll(async () => {
  test.setTimeout(90_000)
  ;[therapist, patient] = await Promise.all([createUser(['therapist'], 'Dana Reyes'), createUser(['patient'], 'Rosa Lim')])
  await link(therapist, patient)
  const version = randomUUID()
  await publishPrescription(await signedIn(therapist), { ...timing, assignmentId: randomUUID(), requestId: version, patientId: patient.id, exerciseId: ELBOW, side: 'left', low: 20, high: 90, repetitions: 8 })
  await ingestSession(patient, version, { kind: 'ELBOW_FLEXION', side: 'LEFT', low: 20, high: 90, target: 8, focusJoint: 'ELBOW', min: 22, max: 88, completed: 8 })
  sessionId = sql(`select id from public.sessions where patient_id='${patient.id}' limit 1`)
  // A second exercise still due today, so the start screen can be opened.
  await publishPrescription(await signedIn(therapist), { ...timing, assignmentId: randomUUID(), requestId: randomUUID(), patientId: patient.id, exerciseId: ELBOW, side: 'right', low: 20, high: 90, repetitions: 8 })
})

test.afterAll(async () => {
  const paths = sql(`select name from storage.objects where bucket_id='session-videos' and split_part(name,'/',1)='${patient.id}'`).split(/\r?\n/).filter(Boolean)
  const { API_URL, SERVICE_ROLE_KEY } = stack()
  if (paths.length) await createClient<Database>(API_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } }).storage.from('session-videos').remove(paths)
  removeUsers([therapist, patient])
})

test.describe('asking to record on the start screen', () => {
  let browser: Browser
  test.beforeAll(async () => { browser = await chromium.launch({ args: CAMERA }) })
  test.afterAll(async () => { await browser.close() })

  const openSession = async (page: Page) => {
    await page.goto('/patient/exercises')
    await page.getByRole('button', { name: /Start exercise|Simulan/ }).first().click()
    await page.getByRole('button', { name: /^(Open camera|Buksan ang camera)$/ }).click()
    // Chromium's fake camera may already be allowed, and then the page goes straight on.
    const allow = page.getByRole('button', { name: /Allow camera access|Payagan/ })
    await allow.waitFor({ timeout: 8_000 }).then(() => allow.click(), () => undefined)
  }

  test('leads with the benefit, Not now leaves recording off with a short line, and agreeing starts every session recorded', async ({ baseURL }) => {
    test.setTimeout(120_000)
    const page = await (await browser.newContext({ baseURL, permissions: ['camera'] })).newPage()
    await signIn(page, patient)
    await openSession(page)
    const ask = page.getByRole('dialog', { name: 'Record your sessions?' })
    await expect(ask).toBeVisible({ timeout: 30_000 })
    await expect(ask).toContainText('Your therapist can watch how you move and correct your form, which helps you recover faster.')
    await expect(ask).toContainText('Once you agree, each prescribed session starts with recording on.')
    await expect(ask.getByRole('button', { name: 'Don’t ask again' })).toHaveCount(0)
    await ask.getByRole('button', { name: 'Not now' }).click()
    await expect(page.getByTestId('record-off-note')).toHaveText('Recording lets your therapist review your form.')
    await expect(page.getByRole('switch', { name: 'Record this session' }).or(page.getByRole('button', { name: 'Record this session' })).first()).toBeVisible()
    // Not asked again straight away: three sessions without recording come first.
    await openSession(page)
    await expect(page.getByTestId('record-off-note')).toBeVisible({ timeout: 30_000 })
    await expect(ask).toBeHidden()
    // The patient's own switch asks for the agreement; agreeing turns recording on, now and next time.
    await page.getByRole('switch', { name: 'Record this session' }).or(page.getByRole('button', { name: 'Record this session' })).first().click()
    await ask.getByRole('button', { name: 'Record sessions' }).click()
    await expect(page.getByTestId('record-off-note')).toHaveCount(0)
    await openSession(page)
    await expect(page.getByTestId('record-off-note')).toHaveCount(0)
    await expect(ask).toBeHidden()
    await page.context().close()
  })

  test('the question reads in Filipino', async ({ baseURL }) => {
    test.setTimeout(120_000)
    const page = await (await browser.newContext({ baseURL, permissions: ['camera'] })).newPage()
    await signIn(page, patient)
    await page.evaluate((owner) => localStorage.removeItem(`motivance.video.prompt:${owner}`), patient.id)
    await language(page, 'fil')
    await openSession(page)
    const ask = page.getByRole('dialog', { name: 'I-record ang mga sesyon mo?' })
    await expect(ask).toContainText('Mapapanood ng therapist mo kung paano ka gumagalaw', { timeout: 30_000 })
    await ask.getByRole('button', { name: 'Hindi muna' }).click()
    await expect(page.getByTestId('record-off-note')).toHaveText('Sa pag-record, masusuri ng therapist mo ang iyong porma.')
    await page.context().close()
  })
})

test('after a recorded session, the finish screen asks to upload, and Not now keeps the Upload button', async ({ page }) => {
  await page.goto('/design/patient/session-video')
  const ask = page.getByRole('region', { name: 'Upload this video so your therapist can review how you did' })
  await expect(ask).toContainText('A smaller copy goes only to your therapist, is kept for 15 days, and you can stop sharing at any time.')
  await expect(ask.getByRole('button', { name: 'Upload video' })).toBeVisible()
  await ask.getByRole('button', { name: 'Not now' }).click()
  await expect(ask).toBeHidden()
  await expect(page.getByRole('button', { name: 'Let my therapist see it' })).toBeVisible()
  await language(page, 'fil')
  await page.reload()
  await expect(page.getByRole('region', { name: 'I-upload ang video na ito para masuri ng therapist mo ang ginawa mo' })).toBeVisible()
  await page.evaluate(() => localStorage.removeItem('motivance.language'))
})

test.describe('uploads that wait for a connection', () => {
  let page: Page
  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
    await signIn(page, patient)
  })
  test.afterAll(async () => { await page.context().close() })

  test('offline, the video waits; a reload keeps it; back online, it goes up by itself', async () => {
    await page.goto('/patient/exercises')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await offline(page)
    await enqueue(page, patient.id, sessionId)
    const waiting = page.getByTestId('waiting-video')
    await expect(waiting).toContainText('Waiting to upload')
    expect(shared()).toBe('0')
    // The page itself needs the backend to open, so the reload has it back, while the upload's first step still cannot get through.
    await online(page, false)
    const blocked = (route: import('@playwright/test').Route) => route.abort('internetdisconnected')
    await page.route('**/rpc/start_session_video', blocked)
    await page.reload()
    await expect(waiting).toContainText('Waiting to upload')
    expect(shared()).toBe('0')
    await page.unroute('**/rpc/start_session_video', blocked)
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect(waiting).toHaveCount(0, { timeout: 20_000 })
    expect(shared()).toBe('1')
  })

  test('a refusal stops the upload and says why, in English and Filipino', async () => {
    sql(`update public.session_videos set removed_at=now() where patient_id='${patient.id}'`)
    await page.route('**/rpc/start_session_video', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'P0001', message: 'video_rate_limited', details: null, hint: null }) }))
    await page.goto('/patient/progress')
    await enqueue(page, patient.id, randomUUID())
    const waiting = page.getByTestId('waiting-video')
    await expect(waiting).toContainText('Couldn’t upload: You have shared several videos in the last hour. Try again later.')
    await expect(waiting.getByRole('button', { name: 'Try again' })).toBeVisible()
    await language(page, 'fil')
    await page.reload()
    await expect(waiting).toContainText('Hindi ma-upload:')
    await expect(waiting.getByRole('button', { name: 'Subukan muli' })).toBeVisible()
    await waiting.getByRole('button', { name: 'Alisin' }).click()
    await expect(waiting).toHaveCount(0)
    await page.evaluate(() => localStorage.removeItem('motivance.language'))
    await page.unroute('**/rpc/start_session_video')
  })

  test('signing out with a video waiting says so first, and removes it from the browser', async () => {
    await page.goto('/patient/exercises')
    await page.route('**/rpc/start_session_video', (route) => route.abort('internetdisconnected'))
    await enqueue(page, patient.id, sessionId)
    await expect(page.getByTestId('waiting-video')).toBeVisible()
    await page.getByRole('button', { name: /account|Rosa/i }).first().click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'A video is still waiting to upload' }).or(page.getByRole('dialog', { name: 'A video is still waiting to upload' }))
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Sign out and remove it' }).click()
    await expect(page).toHaveURL(/sign-in|\/$/)
    const left = await page.evaluate(async (owner) => {
      const queue = await import('/src/features/exercise/video/useVideoQueue.ts' as string) as typeof import('../../src/features/exercise/video/useVideoQueue')
      return (await queue.videoQueue.list(owner)).length
    }, patient.id)
    expect(left).toBe(0)
    await page.unroute('**/rpc/start_session_video')
  })
})
