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

/** A browser voice that records what it is asked to say and finishes each phrase after a moment, one at a time. */
const FAKE_VOICE = `
  window.__spoken = []
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; this.lang = ''; this.voice = null; this.onend = null; this.onerror = null } }
  const queue = []
  const next = () => { const u = queue[0]; if (!u) return; setTimeout(() => { if (queue[0] !== u) return; queue.shift(); window.__spoken.push(u.text); u.onend && u.onend(); next() }, 300) }
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: Object.assign(new EventTarget(), {
    getVoices: () => [{ lang: 'en-US', name: 'Test voice', localService: true, default: true }],
    speak(u) { queue.push(u); if (queue.length === 1) next() },
    cancel() { const dropped = queue.splice(0); dropped.forEach((u) => u.onerror && u.onerror()) },
  }) })
`

let therapist: TestUser
let patient: TestUser
let page: Page

async function signIn(browser: Browser, person: TestUser) {
  const opened = await (await browser.newContext()).newPage()
  await opened.route('**/src/features/exercise/pose/hosts.ts*', (route) => route.fulfill({ contentType: 'text/javascript', body: SCRIPTED_HOST }))
  await opened.addInitScript(FAKE_VOICE)
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
  // The model person shows the prescribed range, and can be paused.
  await expect(page.getByRole('img', { name: 'Animated guide: Elbow flexion, moving between 20° and 90°.' })).toBeVisible()
  await page.getByRole('button', { name: 'Pause the guide' }).click()
  await expect(page.getByRole('button', { name: 'Play the guide' })).toBeVisible()
  // With reduced motion the guide holds the target position, with nothing to pause.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.getByRole('img', { name: /Animated guide/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /the guide$/ })).toHaveCount(0)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.getByRole('button', { name: 'Open camera' }).click()
  await page.getByRole('button', { name: 'Allow camera access' }).click()
  // Voice off is remembered after the page reloads.
  await page.getByRole('switch', { name: /Voice on/ }).click()
  await page.reload()
  await page.getByRole('button', { name: 'Open camera' }).click()
  await page.getByRole('button', { name: 'Allow camera access' }).click()
  await expect(page.getByRole('switch', { name: /Voice off/ })).toHaveAttribute('aria-checked', 'false')
  await page.getByRole('switch', { name: /Voice off/ }).click()
  await expect(page.getByRole('switch', { name: /Voice on/ })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('switch', { name: /Finish sound on/ })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText('Tracking ready. Use a controlled movement.')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Not counting yet. Select Start measurement below.')).toBeVisible()
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
  await expect(page.getByText(/^Step \d of 4$/)).toBeVisible()
  // Once measuring, the patient follows their own movement rather than the guide.
  await expect(page.getByRole('img', { name: /Animated guide/ })).toHaveCount(0)
  await expect(page.getByText(/^Counted! 1 of 2$/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('2 / 2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Finish and save' }).click()
  // The finish celebrates first, and knows this was the only exercise due today.
  await expect(page.getByRole('heading', { name: 'Finished!' })).toBeVisible()
  await expect(page.getByText(/^Repetitions: \d+ of 2$/)).toBeVisible()
  await expect(page.getByText('That was today’s last exercise.')).toBeVisible({ timeout: 15_000 })
  const spoken = await page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken)
  expect(spoken.some((line) => ['Great!', 'Excellent!', 'Nice!', 'Well done!', 'Good job!'].includes(line)), spoken.join(' | ')).toBe(true)
  await expect.poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.at(-1))).toBe('Great work! Exercise finished. That was today’s last exercise.')
  await page.getByRole('button', { name: 'See your results' }).click()
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
