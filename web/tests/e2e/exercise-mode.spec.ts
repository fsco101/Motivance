import { randomUUID } from 'node:crypto'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { publishPrescription } from '../../src/data/therapist'
import { loadCatalogue } from '../../src/data/workspace'
import { fakeBodyAndVoice } from '../support/camera'
import { createUser, link, removeUsers, signedIn, type TestUser } from '../support/stack'

/**
 * Exercise mode (#149): while the camera is live the exercise takes the whole window, readable from across the room, with every
 * control in view. The body and the voice are scripted (tests/support/camera.ts); everything else is the real app.
 */
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] }, permissions: ['camera'] })
test.describe.configure({ mode: 'serial' })

let therapist: TestUser
let patient: TestUser
let page: Page

async function signIn(browser: Browser, person: TestUser) {
  const opened = await (await browser.newContext()).newPage()
  await fakeBodyAndVoice(opened)
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
  await publishPrescription(staff, { assignmentId: randomUUID(), requestId: randomUUID(), patientId: patient.id, exerciseId: elbow.id, side: 'left', focus: null, low: 20, high: 90, repetitions: 20, minimumCycleMs: 600, maximumCycleMs: 30000, peakHoldMs: 100, maxTrunkLean: 20, confidence: 0.7 })
  page = await signIn(browser, patient)
})
test.afterAll(() => removeUsers([therapist, patient]))

/** Whether an element lies wholly inside the window. */
const inView = (name: string, locator: ReturnType<Page['locator']>) => locator.evaluate((element, name) => {
  const box = element.getBoundingClientRect()
  return box.width > 0 && box.top >= 0 && box.left >= 0 && box.bottom <= window.innerHeight + 0.5 && box.right <= window.innerWidth + 0.5 ? 'ok' : `${name} at ${JSON.stringify(box)}`
}, name)

test('the live session takes the whole window, and everything is in view without scrolling', async () => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/patient/exercises')
  await page.getByRole('button', { name: 'Start exercise' }).first().click()
  // Setup stays in the workspace.
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  await page.getByRole('button', { name: 'Open camera' }).click()
  // The workspace frame steps aside.
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden()
  await expect(page.getByRole('navigation', { name: 'You are here' })).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Elbow flexion', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Allow camera access' }).click()
  await expect(page.getByText('Tracking ready. Use a controlled movement.')).toBeVisible({ timeout: 30_000 })
  await page.getByLabel(/I consent to saving movement summaries/).check()
  await page.getByRole('button', { name: 'Start measurement' }).click()
  await expect(page.getByText(/^Step \d of 4$/)).toBeVisible()
  await expect(page.getByText(/^Counted! 1 of 20$/)).toBeVisible({ timeout: 30_000 })

  for (const [width, height] of [[1280, 720], [1920, 1080]] as const) {
    await page.setViewportSize({ width, height })
    await page.waitForTimeout(300)
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1), `${width}x${height} scrolls`).toBe(true)
    const parts = {
      picture: page.getByRole('img', { name: /Camera preview/ }),
      count: page.getByText('Repetitions', { exact: true }).locator('..'),
      instruction: page.locator('p[aria-live="polite"].font-display'),
      pause: page.getByRole('button', { name: 'Pause measurement' }),
      finish: page.getByRole('button', { name: 'Finish and save' }),
      voice: page.getByRole('switch', { name: /Voice on/ }),
      sound: page.getByRole('switch', { name: /Finish sound on/ }),
      howItCounts: page.getByRole('button', { name: 'How repetitions are counted' }),
      exit: page.getByRole('button', { name: 'Exit' }),
    }
    for (const [name, locator] of Object.entries(parts)) expect(await inView(name, locator.first()), `${width}x${height}`).toBe('ok')
    // Readable from across the room: at least three times the size of body text.
    const sizes = await page.evaluate(() => {
      const body = parseFloat(getComputedStyle(document.body).fontSize)
      const count = parseFloat(getComputedStyle([...document.querySelectorAll('p[aria-live="polite"]')].find((p) => /\d+\s*\/\s*\d+/.test(p.textContent ?? ''))!).fontSize)
      const instruction = parseFloat(getComputedStyle(document.querySelector('p[aria-live="polite"].font-display')!).fontSize)
      return { body, count, instruction }
    })
    expect(sizes.count, JSON.stringify(sizes)).toBeGreaterThanOrEqual(3 * sizes.body)
    expect(sizes.instruction, JSON.stringify(sizes)).toBeGreaterThanOrEqual(3 * sizes.body)
  }

  // Space pauses and resumes for someone who walks up to the laptop; the keys are named on the buttons and on screen.
  await expect(page.getByRole('button', { name: 'Pause measurement' })).toHaveAttribute('aria-keyshortcuts', 'Space')
  await expect(page.getByText('Keys: Space pauses or resumes, F switches full screen.')).toBeVisible()
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Space')
  await expect(page.getByText('Measurement paused · repetitions are not counting')).toBeVisible()
  // Resuming needs tracking to be ready, as the button does; a refused press is pressed again, as a patient would.
  const recording = page.getByText('Recording · repetition checking is active')
  for (let attempt = 0; attempt < 5 && !(await recording.isVisible()); attempt++) { await page.keyboard.press('Space'); await page.waitForTimeout(600) }
  await expect(recording).toBeVisible()

  // How repetitions are counted opens on demand.
  await page.getByRole('button', { name: 'How repetitions are counted' }).click()
  await expect(page.getByRole('img', { name: /Elbow angle gauge/ })).toBeVisible()
  await page.keyboard.press('Escape')
  // Checked once it has faded out: half-way through, its text is half transparent.
  await expect(page.getByRole('dialog')).toHaveCount(0)

  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
  }

  // On a phone the parts stack, with no workspace frame, and the controls follow the readings.
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden()
  const picture = (await page.getByRole('img', { name: /Camera preview/ }).boundingBox())!
  const count = (await page.getByText('Repetitions', { exact: true }).boundingBox())!
  const finish = (await page.getByRole('button', { name: 'Finish and save' }).boundingBox())!
  expect(picture.y).toBeLessThan(count.y)
  expect(count.y).toBeLessThan(finish.y)

  // Exit asks first while a side is being measured, and leaving returns to the workspace.
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.getByRole('button', { name: 'Exit' }).click()
  await expect(page.getByRole('alertdialog', { name: 'Leave this exercise?' })).toBeVisible()
  await page.getByRole('button', { name: 'Keep exercising' }).click()
  await expect(page.getByText('Recording · repetition checking is active')).toBeVisible()
  await page.getByRole('button', { name: 'Exit' }).click()
  await page.getByRole('button', { name: 'Leave', exact: true }).click()
  await expect(page).toHaveURL(/\/patient\/exercises$/)
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
})
