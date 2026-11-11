import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { publishPrescription } from '../../src/data/therapist'
import { acceptInvitation, createUser, ingestSession, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

/** A therapist's whole day in the real app against the real local backend. */
test.describe.configure({ mode: 'serial' })

let therapist: TestUser
let stranger: TestUser
let patient: TestUser
let page: Page

const ELBOW = 'Elbow flexion'

test.beforeAll(async ({ browser }) => {
  therapist = await createUser(['therapist'], 'Dana Reyes')
  stranger = await createUser(['therapist'], 'Other Therapist')
  patient = await createUser(['patient'], 'Ana Dela Cruz')
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(therapist.email)
  await page.getByLabel('Password', { exact: true }).fill(therapist.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/therapist$/)
})
test.afterAll(async () => {
  await page.close()
  removeUsers([therapist, stranger, patient])
})

const rows = (statement: string) => sql(statement).split('\n').filter(Boolean)
const openPatient = async () => {
  await page.goto('/therapist/patients')
  await page.getByRole('link', { name: 'Open Ana Dela Cruz' }).click()
  await expect(page.getByRole('heading', { name: 'Ana Dela Cruz', level: 1 })).toBeVisible()
}
const chooseExercise = (name: string) => page.getByRole('radio', { name: new RegExp(`^${name}`) }).click()
const publish = async () => {
  await page.getByRole('button', { name: 'Publish to patient' }).click()
  await expect(page.getByRole('heading', { name: 'Ana Dela Cruz', level: 1 })).toBeVisible()
}

test('a new therapist is told what to do first', async () => {
  await expect(page.getByRole('heading', { name: 'Hello, Dana' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Invite your first patient' })).toBeVisible()
})

test('inviting a patient gives a code, and they appear once they accept', async () => {
  await page.goto('/therapist/patients')
  await page.getByRole('button', { name: 'Invite patient' }).first().click()
  await page.getByRole('dialog').getByLabel('Email').fill(patient.email)
  await page.getByRole('button', { name: 'Create invitation' }).click()
  const code = await page.getByRole('dialog').locator('code').textContent()
  expect(code).toMatch(/^[a-f0-9]{48}$/)
  await acceptInvitation(patient, code!)
  await page.reload()
  await expect(page.getByRole('link', { name: 'Open Ana Dela Cruz' })).toBeVisible()
  await expect(page.getByText('No exercise assigned yet.')).toBeVisible()
})

test('the record shows the patient and offers an assignment', async () => {
  await openPatient()
  await expect(page.getByRole('heading', { name: 'No exercise assigned yet' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Assign exercise' })).toBeVisible()
})

test('publishing needs an exercise, and offers each exercise once', async () => {
  await page.getByRole('link', { name: 'Assign exercise' }).click()
  await expect(page.getByRole('button', { name: 'Publish to patient' })).toBeDisabled()
  await expect(page.getByRole('radio', { name: new RegExp(`^${ELBOW}`) })).toHaveCount(1)
})

test('a published prescription lands with the chosen values', async () => {
  await chooseExercise(ELBOW)
  await page.getByRole('radio', { name: 'Right side' }).click()
  await page.getByRole('radio', { name: 'Knee', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Start angle' }).fill('25')
  await page.getByRole('spinbutton', { name: 'Target angle' }).fill('110')
  await page.getByRole('button', { name: 'More repetitions' }).click()
  // The summary sits beside the form on a wide screen and follows every change.
  const review = page.getByRole('complementary')
  await expect(review).toContainText(ELBOW)
  await expect(review).toContainText('Right side')
  await expect(review).toContainText('25° to 110°')
  const [form, summary] = [(await page.getByRole('heading', { name: 'Targets' }).boundingBox())!, (await review.boundingBox())!]
  expect(summary.x).toBeGreaterThan(form.x)
  await publish()
  expect(rows(`select side,minimum_degrees,maximum_degrees,target_repetitions,version,parameters->>'focus_joint',parameters->>'confidence' from public.prescription_versions where patient_id='${patient.id}'`))
    .toEqual(['right|25|110|6|1|KNEE|0.7'])
  await expect(page.getByText('Right side, 25° to 110°, 6 repetitions')).toBeVisible()
})

test('editing makes a new version of the same plan', async () => {
  await page.getByRole('link', { name: 'Edit plan' }).click()
  await expect(page.getByRole('spinbutton', { name: 'Target angle' })).toHaveValue('110')
  await expect(page.getByRole('radio', { name: 'Right side' })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('spinbutton', { name: 'Target angle' }).fill('120')
  await publish()
  expect(rows(`select version,maximum_degrees from public.prescription_versions where patient_id='${patient.id}' order by version`)).toEqual(['1|110', '2|120'])
  expect(rows(`select count(distinct assignment_id) from public.prescription_versions where patient_id='${patient.id}'`)).toEqual(['1'])
})

test('a plan pinned to an older exercise version can still be edited', async () => {
  // The seed's first elbow version is superseded, so it can no longer be chosen for a new plan.
  const db = await signedIn(therapist)
  const assignment = randomUUID()
  await publishPrescription(db, {
    assignmentId: assignment, requestId: randomUUID(), patientId: patient.id, exerciseId: '21000000-0000-0000-0000-000000000001', side: 'left', focus: null, low: 30, high: 100, repetitions: 4,
    minimumCycleMs: 600, maximumCycleMs: 30000, peakHoldMs: 100, maxTrunkLean: 20, confidence: 0.7,
  })
  await page.goto(`/therapist/patients/${patient.id}/assign?plan=${assignment}`)
  await expect(page.getByText('Version on this plan')).toBeVisible()
  await page.getByRole('spinbutton', { name: 'Target angle' }).fill('105')
  await publish()
  expect(rows(`select version,maximum_degrees from public.prescription_versions where assignment_id='${assignment}' order by version`)).toEqual(['1|100', '2|105'])
  // Keep the rest of this journey to the plans it created.
  sql(`update public.exercise_assignments set active=false where id='${assignment}'`)
})

test('a both-sides plan with a time per side is published', async () => {
  await page.goto(`/therapist/patients/${patient.id}/assign`)
  await chooseExercise(ELBOW)
  await page.getByRole('radio', { name: 'Both sides' }).click()
  const review = page.getByRole('complementary')
  await expect(review).toContainText('No time limit')
  await page.getByRole('switch', { name: 'Set a time' }).click()
  await expect(page.getByText('Time per side', { exact: true }).first()).toBeVisible()
  for (let step = 0; step < 4; step += 1) await page.getByRole('button', { name: 'More time' }).click()
  await expect(page.locator('output', { hasText: '2:00' })).toBeVisible()
  await expect(review).toContainText('Both sides')
  await expect(review).toContainText('2:00')
  await publish()
  expect(rows(`select side,parameters->>'side_seconds' from public.prescription_versions where patient_id='${patient.id}' and side='bilateral'`)).toEqual(['bilateral|120'])
  await expect(page.getByText('Both sides, 20° to 90°, 5 repetitions')).toBeVisible()
  await expect(page.getByText('Time per side: 2:00')).toBeVisible()
})

test('editing a both-sides plan keeps both sides and its time', async () => {
  const [assignment] = rows(`select assignment_id from public.prescription_versions where patient_id='${patient.id}' and side='bilateral'`)
  await page.goto(`/therapist/patients/${patient.id}/assign?plan=${assignment}`)
  await expect(page.getByRole('radio', { name: 'Both sides' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('switch', { name: 'Set a time' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('output', { hasText: '2:00' })).toBeVisible()
  // Turning the time off publishes a version with no limit.
  await page.getByRole('switch', { name: 'Set a time' }).click()
  await publish()
  expect(rows(`select version,parameters ? 'side_seconds' from public.prescription_versions where assignment_id='${assignment}' order by version`)).toEqual(['1|t', '2|f'])
  // Keep the rest of this journey to the plans it created.
  sql(`update public.exercise_assignments set active=false where id='${assignment}'`)
})

test('a second exercise is its own plan and never replaces the first', async () => {
  await page.getByRole('link', { name: 'Assign exercise' }).click()
  await chooseExercise('Shoulder abduction')
  await publish()
  expect(rows(`select count(*) from public.exercise_assignments where patient_id='${patient.id}' and active`)).toEqual(['2'])
})

test('a custom exercise is created in the editor, selected, and published', async () => {
  await page.getByRole('link', { name: 'Assign exercise' }).click()
  await page.getByRole('button', { name: 'Add custom exercise' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('radio')).toHaveCount(6)
  await expect(dialog.getByLabel('Exercise name')).toHaveAttribute('maxlength', '120')
  await expect(dialog.getByLabel('Instructions for the patient')).toHaveAttribute('maxlength', '4000')
  await expect(dialog.getByLabel('Filipino instructions (optional)')).toHaveAttribute('maxlength', '4000')
  await dialog.getByLabel('Exercise name').fill('Seated knee extension')
  await dialog.getByRole('radio', { name: 'Knee' }).click()
  await expect(dialog.getByText('0° is the joint held straight.')).toBeVisible()
  await expect(dialog.getByText('The camera measures in 2D.')).toBeVisible()
  await dialog.getByLabel('Instructions for the patient').fill('Sit tall and straighten the knee.')
  await dialog.getByRole('button', { name: 'Save exercise' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('radio', { name: /^Seated knee extension/ })).toHaveAttribute('aria-checked', 'true')
  await publish()
  await expect(page.getByRole('heading', { name: 'Seated knee extension' })).toBeVisible()
  await expect(page.getByText('Custom', { exact: true })).toBeVisible()
})

test('another therapist cannot see that custom exercise', async () => {
  const db = await signedIn(stranger)
  const { data } = await db.from('exercise_versions').select('id,definition').eq('algorithm_key', 'joint-angle-v1')
  expect(data).toEqual([])
})

test('a removed exercise leaves the list but stays named on the plan', async () => {
  await page.goto('/therapist/exercises')
  await expect(page.getByRole('heading', { name: 'Seated knee extension' })).toBeVisible()
  await page.getByRole('button', { name: 'Remove from my exercises' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove from my exercises' }).click()
  await expect(page.getByRole('heading', { name: 'No custom exercises yet' })).toBeVisible()
  await openPatient()
  await expect(page.getByRole('heading', { name: 'Seated knee extension' })).toBeVisible()
})

test('a measured session reaches the home fan, the card and progress', async () => {
  const plan = rows(`select v.id from public.prescription_versions v join public.exercise_assignments a on a.id=v.assignment_id where v.patient_id='${patient.id}' and v.version=2 and a.active`)[0]!
  await ingestSession(patient, plan, { min: 12, max: 104, completed: 6, kind: 'ELBOW_FLEXION', side: 'RIGHT', low: 25, high: 120, target: 6, focusJoint: 'KNEE' })
  await page.goto('/therapist')
  await expect(page.getByRole('heading', { name: 'Latest movement' })).toBeVisible()
  await expect(page.getByText('104°', { exact: true })).toBeVisible()
  await expect(page.getByText('Moved 12° to 104°').first()).toBeVisible()
  await page.goto('/therapist/progress')
  await expect(page.getByRole('cell', { name: '92°' })).toBeVisible()
  await expect(page.getByText('Completed', { exact: true })).toBeVisible()
  await expect(page.getByText('Movement estimates are not clinically validated.')).toBeVisible()
})

test('each session keeps the targets prescribed at the time, in its own series', async () => {
  const first = rows(`select v.id from public.prescription_versions v join public.exercise_assignments a on a.id=v.assignment_id where v.patient_id='${patient.id}' and v.version=1 and a.active and v.minimum_degrees=25`)[0]!
  await ingestSession(patient, first, { min: 30, max: 90, completed: 6, kind: 'ELBOW_FLEXION', side: 'RIGHT', low: 25, high: 110, target: 6, focusJoint: 'KNEE' })
  await page.reload()
  await expect(page.getByRole('cell', { name: '25° to 110°' })).toBeVisible()
  await expect(page.getByRole('cell', { name: '25° to 120°' })).toBeVisible()
  await expect(page.getByText('Right side, version 1, prescribed 25° to 110°')).toBeVisible()
  await expect(page.getByText('Right side, version 2, prescribed 25° to 120°')).toBeVisible()
})

test('a custom exercise shows the therapist’s name for it in the history', async () => {
  const plan = rows(`select v.id from public.prescription_versions v join public.exercise_versions e on e.id=v.exercise_version_id where v.patient_id='${patient.id}' and e.algorithm_key='joint-angle-v1'`)[0]!
  await ingestSession(patient, plan, { min: 20, max: 70, completed: 5, kind: 'CUSTOM', side: 'LEFT', low: 20, high: 90, target: 5, focusJoint: 'KNEE' })
  await page.reload()
  await expect(page.getByRole('cell', { name: 'Seated knee extension' })).toBeVisible()
})

test('progress filters run on the server', async () => {
  await page.getByLabel('Side').click()
  await page.getByRole('option', { name: 'Left side' }).click()
  await expect(page.getByRole('cell', { name: 'Seated knee extension' })).toBeVisible()
  await expect(page.getByRole('cell', { name: '92°' })).toHaveCount(0)
  await page.getByLabel('Side').click()
  await page.getByRole('option', { name: 'Both sides' }).click()
  await expect(page.getByRole('cell', { name: '92°' })).toBeVisible()
  await page.getByLabel('Through').fill('2020-01-01')
  await expect(page.getByText('No sessions match these filters.')).toBeVisible()
  await page.getByLabel('Through').fill('')
  await expect(page.getByRole('cell', { name: '92°' })).toBeVisible()
})

test('failed tracking never shows as a measurement', async () => {
  const plan = rows(`select v.id from public.prescription_versions v join public.exercise_assignments a on a.id=v.assignment_id where v.patient_id='${patient.id}' and v.version=2 and a.active`)[0]!
  await ingestSession(patient, plan, { min: 40, max: 170, completed: 1, valid: 1, invalid: 400, kind: 'ELBOW_FLEXION', side: 'RIGHT', low: 25, high: 120, target: 6, focusJoint: 'KNEE' })
  // Recorded measurements are immutable, so this fixture bypasses the trigger inside one admin transaction.
  sql(`begin; set local session_replication_role=replica; update public.session_measurements set quality='invalid' where maximum_degrees=170 and session_id in (select id from public.sessions where patient_id='${patient.id}'); commit;`)
  await page.goto('/therapist/progress')
  await expect(page.getByRole('cell', { name: 'Not measured' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Not usable' })).toBeVisible()
  await expect(page.getByRole('cell', { name: '130°' })).toHaveCount(0)
  await page.goto('/therapist')
  await expect(page.getByRole('heading', { name: 'Latest movement' })).toBeVisible()
  await expect(page.getByText('Moved 20° to 70°').first()).toBeVisible()
  await expect(page.getByText('170°')).toHaveCount(0)
})

test('revoking needs a confirmation that names the patient, and ends access', async () => {
  await page.goto('/therapist/patients')
  await page.getByRole('button', { name: 'Actions for Ana Dela Cruz' }).click()
  await page.getByRole('menuitem', { name: 'Revoke access' }).click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText('Ana Dela Cruz')
  await confirm.getByRole('button', { name: 'Revoke access' }).click()
  await expect(page.getByRole('heading', { name: 'No patients yet' })).toBeVisible()
  await page.goto(`/therapist/patients/${patient.id}`)
  await expect(page.getByRole('heading', { name: 'This patient is not linked to you' })).toBeVisible()
})
