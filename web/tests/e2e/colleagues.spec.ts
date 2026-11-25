import { randomUUID } from 'node:crypto'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { publishPrescription } from '../../src/data/therapist'
import { createUser, ingestSession, link, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

/** #173: two therapists link as colleagues and follow each other's patients who opted in, read-only, on the real local backend. */
test.describe.configure({ mode: 'serial' })

const tag = randomUUID().slice(0, 6)
const ELBOW = '21000000-0000-0000-0000-000000000001'
const timing = { focus: 'ELBOW' as const, minimumCycleMs: 600, maximumCycleMs: 30000, peakHoldMs: 100, maxTrunkLean: 20, confidence: 0.7 }
let dana: TestUser
let omar: TestUser
let rosa: TestUser
let admin: TestUser
let danaPage: Page
let omarPage: Page

async function signIn(browser: Browser, who: TestUser, home: RegExp) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage()
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(who.email)
  await page.getByLabel('Password', { exact: true }).fill(who.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(home)
  return page
}
const removeColleagueRows = (ids: string[]) => {
  const list = ids.map((id) => `'${id}'`).join(',')
  sql(`begin; set local session_replication_role=replica;
delete from public.colleague_views where viewer_id in (${list}) or patient_id in (${list});
delete from public.therapist_colleagues where requester_id in (${list}) or invitee_id in (${list});
delete from public.audit_events where actor_id in (${list}); commit;`)
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(90_000)
  ;[dana, omar, rosa, admin] = await Promise.all([createUser(['therapist'], `Dana ${tag}`), createUser(['therapist'], `Omar ${tag}`), createUser(['patient'], `Rosa ${tag}`), createUser(['admin'], `Ada ${tag}`)])
  await link(dana, rosa)
  const version = randomUUID()
  await publishPrescription(await signedIn(dana), { ...timing, assignmentId: randomUUID(), requestId: version, patientId: rosa.id, exerciseId: ELBOW, side: 'left', low: 20, high: 90, repetitions: 8 })
  await ingestSession(rosa, version, { kind: 'ELBOW_FLEXION', side: 'LEFT', low: 20, high: 90, target: 8, focusJoint: 'ELBOW', min: 22, max: 88, completed: 8 })
  danaPage = await signIn(browser, dana, /\/therapist$/)
  omarPage = await signIn(browser, omar, /\/therapist$/)
})

test.afterAll(async () => {
  await danaPage.close()
  await omarPage.close()
  removeColleagueRows([dana.id, omar.id, rosa.id, admin.id])
  removeUsers([dana, omar, rosa, admin])
})

test('a therapist invites a colleague by email, and the colleague accepts in the app', async () => {
  await danaPage.goto('/therapist/patients')
  const colleagues = danaPage.getByRole('region', { name: 'Colleagues' }).or(danaPage.locator('section', { hasText: 'Colleagues' })).first()
  await danaPage.getByRole('button', { name: 'Invite a colleague' }).click()
  const dialog = danaPage.getByRole('dialog', { name: 'Invite a colleague' })
  await dialog.getByLabel('Their Motivance email').fill('nobody@example.test')
  await dialog.getByRole('button', { name: 'Send invitation' }).click()
  await expect(danaPage.getByText('No therapist has that email.')).toBeVisible()
  await dialog.getByLabel('Their Motivance email').fill(omar.email)
  await dialog.getByRole('button', { name: 'Send invitation' }).click()
  await expect(danaPage.getByText('Invitation sent.')).toBeVisible()
  await expect(danaPage.getByRole('list', { name: 'Colleagues' })).toContainText(`Omar ${tag}`)
  await expect(danaPage.getByRole('list', { name: 'Colleagues' })).toContainText('Waiting for an answer')
  void colleagues

  await omarPage.goto('/therapist/patients')
  const incoming = omarPage.getByRole('list', { name: 'Colleagues' }).getByRole('listitem').filter({ hasText: `Dana ${tag}` })
  await expect(incoming).toContainText('Invited you')
  await incoming.getByRole('button', { name: 'Accept' }).click()
  await expect(omarPage.getByText('You are now linked.')).toBeVisible()
  await expect(incoming).toContainText('Linked')
})

test('a patient who has not opted in is not shown to the colleague', async () => {
  await omarPage.goto('/therapist/patients')
  await expect(omarPage.getByText('None yet. A colleague’s patient appears here once they choose to share their progress.').or(omarPage.getByText("None yet. A colleague's patient appears here once they choose to share their progress."))).toBeVisible()
  // Nor can it be opened by address.
  await omarPage.goto(`/therapist/colleague-patients/${rosa.id}`)
  await expect(omarPage.getByRole('heading', { name: 'This patient cannot be shown' })).toBeVisible()
})

test('the patient turns on sharing with colleagues in Profile', async ({ browser }) => {
  const page = await signIn(browser, rosa, /\/patient$/)
  await page.goto('/patient/profile')
  const sharing = page.getByRole('switch', { name: 'Let my therapist\'s colleagues see my progress' })
  await expect(sharing).not.toBeChecked()
  await sharing.check()
  await expect(page.getByText('Your therapist’s colleagues can now see your progress.').or(page.getByText("Your therapist's colleagues can now see your progress."))).toBeVisible()
  await expect(sharing).toBeChecked()
  await page.context().close()
})

test('the colleague sees the patient apart, read-only, and opening them is recorded', async () => {
  await omarPage.goto('/therapist/patients')
  const listed = omarPage.getByRole('list', { name: 'Colleagues\' patients' }).getByRole('link', { name: new RegExp(`Rosa ${tag}`) })
  await expect(listed).toContainText(`Patient of Dana ${tag}`)
  await expect(listed).toContainText('Read-only')
  // The colleague's own patient list stays their own.
  await expect(omarPage.getByRole('link', { name: `Open Rosa ${tag}` })).toHaveCount(0)
  await listed.click()
  await expect(omarPage.getByRole('heading', { name: `Rosa ${tag}`, level: 1 })).toBeVisible()
  await expect(omarPage.getByText('Colleague\'s patient', { exact: true }).filter({ visible: true }).first()).toBeVisible()
  await expect(omarPage.getByRole('heading', { name: 'Current plan' })).toBeVisible()
  await expect(omarPage.getByText(/Elbow flexion/).first()).toBeVisible()
  // Read-only: nothing to prescribe, schedule, message or contact from here.
  const content = omarPage.getByRole('main')
  for (const name of [/Assign/, /Message/, /Publish/, /schedule/i, /Send in chat/, /Ask to record/]) await expect(content.getByRole('button', { name }).or(content.getByRole('link', { name }))).toHaveCount(0)
  expect(sql(`select count(*) from public.audit_events where actor_id='${omar.id}' and action='colleague_viewed' and target_id='${rosa.id}'`)).toBe('1')
})

test('the patient\'s own therapist sees who can see the progress, and when they looked', async () => {
  await danaPage.goto(`/therapist/patients/${rosa.id}`)
  const access = danaPage.getByRole('region', { name: 'Colleagues who can see progress' })
  await expect(access).toContainText(`Omar ${tag}`)
  await expect(access).toContainText('Last looked')
})

test('the screens read in Filipino', async () => {
  await omarPage.evaluate(() => localStorage.setItem('motivance.language', 'fil'))
  await omarPage.goto('/therapist/patients')
  await expect(omarPage.getByRole('list', { name: 'Mga pasyente ng kasamahan' })).toContainText(`Pasyente ni Dana ${tag}`)
  await expect(omarPage.getByRole('list', { name: 'Mga kasamahan' })).toContainText('Kaugnay')
  await omarPage.evaluate(() => localStorage.removeItem('motivance.language'))
})

test('either therapist ends the link, and the colleague then sees nothing', async () => {
  await danaPage.goto('/therapist/patients')
  await danaPage.getByRole('list', { name: 'Colleagues' }).getByRole('listitem').filter({ hasText: `Omar ${tag}` }).getByRole('button', { name: 'End link' }).click()
  await danaPage.getByRole('alertdialog').or(danaPage.getByRole('dialog')).getByRole('button', { name: 'End link' }).click()
  await expect(danaPage.getByText('Link ended.')).toBeVisible()
  await omarPage.goto(`/therapist/colleague-patients/${rosa.id}`)
  await expect(omarPage.getByRole('heading', { name: 'This patient cannot be shown' })).toBeVisible()
  expect(sql(`select count(*) from public.colleague_views v where v.viewer_id='${omar.id}'`)).toBe('1')
})

test('an administrator links two therapists and ends the link', async ({ browser }) => {
  const page = await signIn(browser, admin, /\/admin$/)
  await page.goto('/admin/links')
  const panel = page.getByRole('region', { name: 'Colleague links' }).or(page.locator('section', { hasText: 'Colleague links' })).first()
  await page.getByRole('combobox', { name: 'First colleague' }).fill(dana.id)
  await page.getByRole('combobox', { name: 'Second colleague' }).fill(omar.id)
  await panel.getByRole('button', { name: 'Link colleagues' }).click()
  await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: 'Link colleagues' }).click()
  await expect(page.getByRole('list', { name: 'Colleague links' })).toContainText(`Omar ${tag}`)
  expect(sql(`select state from public.therapist_colleagues where state='active' and '${dana.id}' in (requester_id,invitee_id) and '${omar.id}' in (requester_id,invitee_id)`)).toBe('active')
  await page.getByRole('list', { name: 'Colleague links' }).getByRole('button', { name: 'End link' }).click()
  await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: 'End link' }).click()
  await expect(page.getByText('No colleague links.')).toBeVisible()
  await page.context().close()
})
