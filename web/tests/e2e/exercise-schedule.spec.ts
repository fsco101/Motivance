import { randomUUID } from 'node:crypto'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { addDays } from '../../src/data/booking'
import { saveSchedule } from '../../src/data/exerciseSchedule'
import { createUser, ingestSession, link, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

/** A therapist plans exercise by the calendar (#126), in the real app against the local backend. */
test.describe.configure({ mode: 'serial' })

let therapist: TestUser
let colleague: TestUser
let patient: TestUser
let page: Page
let today = ''

const weekdayName = (date: string) => new Intl.DateTimeFormat('en-PH', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))
const dayLabel = (date: string) => new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))
const card = () => page.getByRole('region', { name: `${dayLabel(today)} to ${dayLabel(addDays(today, 13))}` })
const openRecord = async () => {
  await page.goto(`/therapist/patients/${patient.id}`)
  await expect(page.getByRole('heading', { name: 'Rosa Lim', level: 1 })).toBeVisible()
}

test.beforeAll(async ({ browser }) => {
  ;[therapist, colleague, patient] = await Promise.all([createUser(['therapist'], 'Dana Reyes'), createUser(['therapist'], 'Leo Cruz'), createUser(['patient'], 'Rosa Lim')])
  await link(therapist, patient)
  today = sql('select public.center_date()')
  page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage()
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(therapist.email)
  await page.getByLabel('Password', { exact: true }).fill(therapist.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/therapist$/)
})
test.afterAll(async () => {
  await page.close()
  removeUsers([therapist, colleague, patient])
})

test('an empty record offers a schedule first', async () => {
  await openRecord()
  await expect(page.getByRole('heading', { name: 'No exercise schedule yet' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'New schedule' })).toBeVisible()
})

test('the form says what is wrong with the dates before anything is saved', async () => {
  await page.getByRole('button', { name: 'New schedule' }).click()
  const form = page.getByRole('dialog', { name: 'New exercise schedule' })
  await form.getByLabel('End date').fill(addDays(today, -1))
  await expect(form.getByRole('status')).toHaveText('Choose an end date on or after the start date.')
  await expect(form.getByRole('button', { name: 'Save schedule' })).toBeDisabled()
  const results = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual([])
  await form.getByRole('button', { name: 'Cancel' }).click()
})

test('a schedule is saved with a rest weekday and a rest date, and counted', async () => {
  await page.getByRole('button', { name: 'New schedule' }).click()
  const form = page.getByRole('dialog', { name: 'New exercise schedule' })
  await form.getByLabel('End date').fill(addDays(today, 13))
  // Three days on is a rest weekday, so it rests twice in two weeks; five days on is a different weekday, rested once.
  await form.getByRole('button', { name: weekdayName(addDays(today, 3)) }).click()
  await expect(form.getByRole('button', { name: weekdayName(addDays(today, 3)) })).toHaveAttribute('aria-pressed', 'true')
  await form.getByLabel('Add a rest date').fill(addDays(today, 5))
  await form.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(form.getByText(dayLabel(addDays(today, 5)))).toBeVisible()
  await expect(form.getByRole('status')).toHaveText('11 exercise days and 3 rest days')
  await form.getByRole('button', { name: 'Save schedule' }).click()
  await expect(page.getByText('Schedule saved')).toBeVisible()
  await expect(card().getByText('Exercise day today')).toBeVisible()
  await expect(card().getByText('11 exercise days and 3 rest days')).toBeVisible()
  await expect(card().getByText('No exercises in this schedule yet.')).toBeVisible()
  const isoWeekday = ((new Date(`${addDays(today, 3)}T00:00:00Z`).getUTCDay() + 6) % 7) + 1
  expect(sql(`select rest_weekdays::text||' '||rest_dates::text from public.exercise_schedules where patient_id='${patient.id}'`)).toBe(`{${isoWeekday}} {${addDays(today, 5)}}`)
})

test('an exercise added from the schedule goes into it, and is to do today', async () => {
  await card().getByRole('link', { name: 'Add exercise' }).click()
  await expect(page.locator('aside').getByText(`${dayLabel(today)} to ${dayLabel(addDays(today, 13))}`)).toBeVisible()
  await page.getByRole('radio', { name: /^Elbow flexion/ }).click()
  await page.getByRole('button', { name: 'Publish to patient' }).click()
  await expect(page.getByRole('heading', { name: 'Rosa Lim', level: 1 })).toBeVisible()
  await expect(card().getByRole('row', { name: /Elbow flexion/ }).getByText('To do today')).toBeVisible()
  expect(sql(`select count(*) from public.exercise_assignments a join public.exercise_schedules s on s.id=a.schedule_id where a.patient_id='${patient.id}' and a.active`)).toBe('1')
})

test('a session finished today shows the exercise as done today', async () => {
  const version = sql(`select p.id from public.prescription_versions p join public.exercise_assignments a on a.id=p.assignment_id where a.patient_id='${patient.id}' order by p.created_at desc limit 1`)
  await ingestSession(patient, version, { kind: 'ELBOW_FLEXION', side: 'LEFT', low: 20, high: 90, target: 5, focusJoint: 'ELBOW', min: 22, max: 88, completed: 5 })
  await openRecord()
  await expect(card().getByRole('row', { name: /Elbow flexion/ }).getByText('Done today')).toBeVisible()
})

test('changing the dates of a started schedule keeps its start', async () => {
  await card().getByRole('button', { name: 'Change dates' }).click()
  const form = page.getByRole('dialog', { name: 'Change the schedule' })
  await expect(form.getByLabel('Start date')).toBeDisabled()
  await expect(form.getByText('It has started, so the start date stays.')).toBeVisible()
  await form.getByLabel('End date').fill(addDays(today, 20))
  await form.getByRole('button', { name: 'Save schedule' }).click()
  await expect(page.getByText('Schedule saved')).toBeVisible()
  await expect(page.getByRole('region', { name: `${dayLabel(today)} to ${dayLabel(addDays(today, 20))}` })).toBeVisible()
  expect(sql(`select ends_on from public.exercise_schedules where patient_id='${patient.id}'`)).toBe(addDays(today, 20))
})

test('another therapist’s schedule shows who set it, and only they can change it', async () => {
  await link(colleague, patient)
  await saveSchedule(await signedIn(colleague), { id: randomUUID(), patientId: patient.id, startsOn: addDays(today, 30), endsOn: addDays(today, 40), restWeekdays: [], restDates: [] })
  await openRecord()
  const theirs = page.getByRole('region', { name: `${dayLabel(addDays(today, 30))} to ${dayLabel(addDays(today, 40))}` })
  await expect(theirs.getByText('Set by Leo Cruz')).toBeVisible()
  await expect(theirs.getByText(`Starts ${dayLabel(addDays(today, 30))}`)).toBeVisible()
  await expect(theirs.getByRole('link', { name: 'Add exercise' })).toHaveCount(0)
  await expect(theirs.getByRole('button', { name: 'End schedule' })).toHaveCount(0)
})

test('removing an exercise asks first, naming it and the patient', async () => {
  const mine = page.getByRole('region', { name: `${dayLabel(today)} to ${dayLabel(addDays(today, 20))}` })
  await mine.getByRole('row', { name: /Elbow flexion/ }).getByRole('button', { name: 'Actions for Elbow flexion' }).click()
  await page.getByRole('menuitem', { name: 'Remove' }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Remove this exercise?' })
  await expect(confirm).toContainText('Elbow flexion leaves Rosa Lim’s plan.')
  await confirm.getByRole('button', { name: 'Remove exercise' }).click()
  await expect(page.getByText('Exercise taken off the plan')).toBeVisible()
  await expect(mine.getByText('No exercises in this schedule yet.')).toBeVisible()
  expect(sql(`select count(*) from public.exercise_assignments where patient_id='${patient.id}' and active and therapist_id='${therapist.id}'`)).toBe('0')
})

test('ending a started schedule ends it today', async () => {
  const mine = page.getByRole('region', { name: `${dayLabel(today)} to ${dayLabel(addDays(today, 20))}` })
  await mine.getByRole('button', { name: 'End schedule' }).click()
  const confirm = page.getByRole('alertdialog', { name: 'End this schedule?' })
  await expect(confirm).toContainText('From tomorrow Rosa Lim no longer sees its exercises.')
  await confirm.getByRole('button', { name: 'End schedule' }).click()
  await expect(page.getByText('Schedule ended')).toBeVisible()
  await expect(page.getByRole('region', { name: `${dayLabel(today)} to ${dayLabel(today)}` })).toBeVisible()
  expect(sql(`select ends_on from public.exercise_schedules where patient_id='${patient.id}' and therapist_id='${therapist.id}'`)).toBe(today)
})
