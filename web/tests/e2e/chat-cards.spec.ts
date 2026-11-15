import { randomUUID } from 'node:crypto'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { setChatConsent } from '../../src/data/chat'
import { publishPrescription } from '../../src/data/therapist'
import { createUser, ingestSession, link, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

/** Progress and exercise cards, quiet lines and scheduled messages, between two signed-in browsers and the real backend. */
test.describe.configure({ mode: 'serial', timeout: 60_000 })

const ELBOW = '21000000-0000-0000-0000-000000000001'
const timing = { focus: 'ELBOW' as const, minimumCycleMs: 600, maximumCycleMs: 30000, peakHoldMs: 100, maxTrunkLean: 20, confidence: 0.7 }

let therapist: TestUser
let patient: TestUser
let staff: Page
let person: Page

async function signIn(page: Page, user: TestUser, home: RegExp) {
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill(user.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(home)
}

const noViolations = (page: Page) => expect.poll(async () => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).slice(0, 3).join(' | ')}`)
}, { timeout: 8_000 }).toEqual([])
const log = (page: Page) => page.getByRole('log')

test.beforeAll(async ({ browser }) => {
  test.setTimeout(90_000)
  ;[therapist, patient] = await Promise.all([createUser(['therapist'], 'Dana Reyes'), createUser(['patient'], 'Ana Dela Cruz')])
  await link(therapist, patient)
  await setChatConsent(await signedIn(patient), true)
  const version = randomUUID()
  await publishPrescription(await signedIn(therapist), { ...timing, assignmentId: randomUUID(), requestId: version, patientId: patient.id, exerciseId: ELBOW, side: 'left', low: 20, high: 90, repetitions: 8 })
  await ingestSession(patient, version, { kind: 'ELBOW_FLEXION', side: 'LEFT', low: 20, high: 90, target: 8, focusJoint: 'ELBOW', min: 22, max: 88, completed: 7 })
  staff = await (await browser.newContext()).newPage()
  person = await (await browser.newContext()).newPage()
  await signIn(staff, therapist, /\/therapist$/)
  await signIn(person, patient, /\/patient$/)
})

test.afterAll(async () => {
  await staff.close()
  await person.close()
  removeUsers([therapist, patient])
})

test('a finished session shows as a quiet line in the therapist’s conversation', async () => {
  await staff.goto('/therapist/messages')
  await staff.getByRole('navigation', { name: 'Conversations' }).getByRole('link', { name: /Ana Dela Cruz/ }).click()
  await expect(log(staff).getByText('Session finished: 7 of 8 repetitions')).toBeVisible()
  // A quiet line is not a message to answer, so it is not unread and not the line shown in the list.
  // The page slides in, so the old list is still there for a moment.
  await expect(staff.getByRole('navigation', { name: 'Conversations' })).toHaveCount(1)
  await expect(staff.getByRole('navigation', { name: 'Conversations' })).not.toContainText('Session finished')
})

test('a patient shares their progress from the Progress page, and the therapist sees the same numbers', async () => {
  await person.goto('/patient/progress')
  const plan = person.locator('section', { has: person.getByRole('heading', { name: 'Elbow flexion', level: 2 }) })
  const latest = await plan.locator('dl dd').first().innerText()
  await plan.getByRole('button', { name: 'Share in chat' }).click()
  const dialog = person.getByRole('dialog', { name: 'Share in chat' })
  await dialog.getByLabel('Add a note (optional)').fill('My elbow this week')
  await dialog.getByRole('button', { name: 'Share' }).click()
  await expect(person.getByText('Shared in the conversation.')).toBeVisible()
  const card = log(staff).getByRole('listitem').filter({ hasText: 'My elbow this week' })
  await expect(card).toContainText('Elbow flexion', { timeout: 10_000 })
  await expect(card).toContainText(latest.trim())
  await expect(card.getByRole('link', { name: 'Open progress' })).toHaveAttribute('href', `/therapist/progress?patient=${patient.id}`)
  await noViolations(staff)
})

test('a therapist sends a plan from the patient’s record, and it opens the patient’s exercises', async () => {
  await staff.goto(`/therapist/patients/${patient.id}`)
  await staff.getByRole('row', { name: /Elbow flexion/ }).getByRole('button', { name: 'Send in chat' }).click()
  await expect(staff.getByText('Exercise sent in the conversation.')).toBeVisible()
  await person.goto('/patient/messages')
  const card = log(person).getByRole('listitem').filter({ hasText: 'Open exercises' })
  await expect(card).toContainText('Left side, 20° to 90°, 8 repetitions')
  await card.getByRole('link', { name: 'Open exercises' }).click()
  await expect(person).toHaveURL(/\/patient\/exercises$/)
})

test('a therapist schedules a message that only they see waiting, can remove one, and the other arrives on time', async () => {
  await staff.goto('/therapist/messages')
  await staff.getByRole('navigation', { name: 'Conversations' }).getByRole('link', { name: /Ana Dela Cruz/ }).click()
  const waiting = staff.getByRole('region', { name: 'Scheduled' })
  for (const [index, words] of ['See you tomorrow at 9.', 'Never mind this one.'].entries()) {
    await staff.getByRole('textbox', { name: 'Message to Ana Dela Cruz' }).fill(words)
    await staff.getByRole('button', { name: 'Schedule', exact: true }).click()
    await staff.getByRole('button', { name: 'Schedule message' }).click()
    await expect(waiting.getByRole('listitem')).toHaveCount(index + 1)
  }
  await expect(waiting.getByRole('listitem')).toHaveCount(2)
  await waiting.getByRole('listitem').filter({ hasText: 'Never mind' }).getByRole('button', { name: 'Remove' }).click()
  await expect(waiting.getByRole('listitem')).toHaveCount(1)
  await person.goto('/patient/messages')
  await expect(log(person)).not.toContainText('See you tomorrow at 9.')
  // The job that runs every minute, run now as if the time had come.
  sql(`select public.send_scheduled_messages(now()+interval '2 days')`)
  await expect(log(person)).toContainText('See you tomorrow at 9.', { timeout: 10_000 })
  await expect(log(person)).not.toContainText('Never mind this one.')
  await staff.reload()
  await expect(staff.getByRole('region', { name: 'Scheduled' })).toHaveCount(0)
})

test('a patient sees no scheduling, and the daily reminder line reads in their language', async () => {
  await expect(person.getByRole('button', { name: 'Schedule', exact: true })).toHaveCount(0)
  sql(`select public.notify_person('${patient.id}','practice_reminder',null,'{"date":"2026-11-15"}'::jsonb,'e2e-2026-11-15',null)`)
  await person.getByRole('button', { name: 'Filipino' }).first().click()
  await person.reload()
  await expect(log(person).getByText('Paalala sa araw-araw na ehersisyo')).toBeVisible({ timeout: 10_000 })
  await person.getByRole('button', { name: 'English' }).first().click()
  await expect(log(person).getByText('Daily practice reminder')).toBeVisible()
  await noViolations(person)
})
