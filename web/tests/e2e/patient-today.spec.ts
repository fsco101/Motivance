import { randomUUID } from 'node:crypto'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { addDays } from '../../src/data/booking'
import { publishScheduledPrescription, saveSchedule, weekdayOf, type ScheduleDraft } from '../../src/data/exerciseSchedule'
import { createUser, ingestSession, link, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

/** A patient's day under an exercise schedule (#127), on the web against the local backend. */
test.describe.configure({ mode: 'serial' })

const ELBOW = '21000000-0000-0000-0000-000000000001'
const timing = { focus: 'ELBOW' as const, minimumCycleMs: 600, maximumCycleMs: 30000, peakHoldMs: 100, maxTrunkLean: 20, confidence: 0.7 }
const dayLabel = (date: string) => new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))

let therapist: TestUser
let patient: TestUser
let later: TestUser
let page: Page
let today = ''
let schedule: ScheduleDraft
const versions: string[] = []

async function signIn(browser: Browser, person: TestUser) {
  const opened = await (await browser.newContext()).newPage()
  await opened.goto('/sign-in')
  await opened.getByLabel('Email').fill(person.email)
  await opened.getByLabel('Password', { exact: true }).fill(person.password)
  await opened.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(opened).toHaveURL(/\/patient$/)
  return opened
}
const assign = async (person: TestUser, scheduleId: string, repetitions: number) => {
  const requestId = randomUUID()
  await publishScheduledPrescription(await signedIn(therapist), scheduleId, { ...timing, assignmentId: randomUUID(), requestId, patientId: person.id, exerciseId: ELBOW, side: 'left', low: 20, high: 90, repetitions })
  return requestId
}
const finish = (version: string, target: number) => ingestSession(patient, version, { kind: 'ELBOW_FLEXION', side: 'LEFT', low: 20, high: 90, target, focusJoint: 'ELBOW', min: 22, max: 88, completed: target })

test.beforeAll(async ({ browser }) => {
  test.setTimeout(90_000)
  ;[therapist, patient, later] = await Promise.all([createUser(['therapist'], 'Dana Reyes'), createUser(['patient'], 'Rosa Lim'), createUser(['patient'], 'Noel Ramos')])
  await Promise.all([link(therapist, patient), link(therapist, later)])
  today = sql('select public.center_date()')
  schedule = { id: randomUUID(), patientId: patient.id, startsOn: today, endsOn: addDays(today, 6), restWeekdays: [], restDates: [] }
  await saveSchedule(await signedIn(therapist), schedule)
  versions.push(await assign(patient, schedule.id, 8), await assign(patient, schedule.id, 12))
  page = await signIn(browser, patient)
})
test.afterAll(async () => {
  await page.close()
  removeUsers([therapist, patient, later])
})

test('today lists the exercises due, and how many are done', async () => {
  await page.goto('/patient/exercises')
  await expect(page.getByText('Done today: 0 of 2')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start exercise' })).toHaveCount(2)
})

test('an exercise finished on the phone leaves the list at the next load', async () => {
  await finish(versions[0]!, 8)
  await page.reload()
  await expect(page.getByText('Done today: 1 of 2')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start exercise' })).toHaveCount(1)
  await expect(page.getByRole('main').getByText('12 reps')).toBeVisible()
  await expect(page.getByRole('main').getByText('8 reps')).toHaveCount(0)
})

test('once every exercise is done, the page says so and names the next day', async () => {
  await finish(versions[1]!, 12)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'All done for today' })).toBeVisible()
  await expect(page.getByText(`Well done. Your next exercises are on ${dayLabel(addDays(today, 1))}.`)).toBeVisible()
  await page.goto('/patient')
  await expect(page.getByRole('heading', { name: 'All done for today' })).toBeVisible()
})

test('a rest day says so instead of listing anything', async () => {
  await saveSchedule(await signedIn(therapist), { ...schedule, restWeekdays: [weekdayOf(today)] })
  await page.goto('/patient/exercises')
  await expect(page.getByRole('heading', { name: 'Rest day' })).toBeVisible()
  await expect(page.getByText(`No exercises today. Your next ones are on ${dayLabel(addDays(today, 1))}.`)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start exercise' })).toHaveCount(0)
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(results.violations.map((violation) => violation.id)).toEqual([])
})

test('a schedule that has not started says when it starts', async ({ browser }) => {
  const upcoming = { id: randomUUID(), patientId: later.id, startsOn: addDays(today, 3), endsOn: addDays(today, 10), restWeekdays: [], restDates: [] }
  await saveSchedule(await signedIn(therapist), upcoming)
  await assign(later, upcoming.id, 8)
  const theirs = await signIn(browser, later)
  await theirs.goto('/patient/exercises')
  await expect(theirs.getByRole('heading', { name: 'Your schedule has not started' })).toBeVisible()
  await expect(theirs.getByText(`Your exercises start on ${dayLabel(addDays(today, 3))}.`)).toBeVisible()
  await theirs.close()
})
