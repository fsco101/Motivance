import { randomUUID } from 'node:crypto'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { sendMessage } from '../../src/data/chat'
import { createUser, link, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

/** Two people in two browsers, talking through the real local backend and its live connection. */
test.describe.configure({ mode: 'serial' })

let therapist: TestUser
let patient: TestUser
let quiet: TestUser
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
const write = async (page: Page, words: string) => {
  await page.getByRole('textbox', { name: /^Message to / }).fill(words)
  await page.getByRole('button', { name: 'Send' }).click()
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(90_000)
  ;[therapist, patient, quiet] = await Promise.all([createUser(['therapist'], 'Dana Reyes'), createUser(['patient'], 'Ana Dela Cruz'), createUser(['patient'], 'Ben Santos')])
  await link(therapist, patient)
  await link(therapist, quiet)
  staff = await (await browser.newContext()).newPage()
  person = await (await browser.newContext()).newPage()
  await signIn(staff, therapist, /\/therapist$/)
  await signIn(person, patient, /\/patient$/)
})

test.afterAll(async () => {
  await staff.close()
  await person.close()
  removeUsers([therapist, patient, quiet])
})

test('a therapist finds a conversation for each patient, and a patient with one therapist lands in theirs', async () => {
  await staff.getByRole('link', { name: 'Messages', exact: true }).first().click()
  const list = staff.getByRole('navigation', { name: 'Conversations' })
  await expect(list.getByRole('link')).toHaveCount(2)
  await expect(list).toContainText('Ana Dela Cruz')
  await expect(list).toContainText('No messages yet')

  await person.getByRole('link', { name: 'Messages', exact: true }).first().click()
  await expect(person).toHaveURL(/\/patient\/messages\/[0-9a-f-]{36}$/)
  await expect(person.getByRole('heading', { name: 'Dana Reyes' })).toBeVisible()
  await expect(person.getByText('Your therapist does not read messages around the clock.', { exact: false })).toBeVisible()
  await noViolations(person)
})

test('a message appears for the other person without a refresh, and is marked seen', async () => {
  await staff.getByRole('navigation', { name: 'Conversations' }).getByRole('link', { name: /Ana Dela Cruz/ }).click()
  await expect(staff.getByRole('heading', { name: 'Ana Dela Cruz' })).toBeVisible()
  // Live rows only flow once the server is listening, which the page shows by dropping "Reconnecting".
  await expect(staff.getByText('Reconnecting…')).toHaveCount(0, { timeout: 15_000 })
  await expect(person.getByText('Reconnecting…')).toHaveCount(0, { timeout: 15_000 })

  await write(staff, 'How is the elbow today?')
  await expect(log(staff)).toContainText('How is the elbow today?')
  await expect(log(person)).toContainText('How is the elbow today?', { timeout: 10_000 })
  await expect(log(staff).getByText('Seen')).toBeVisible({ timeout: 10_000 })

  await person.getByRole('textbox', { name: 'Message to Dana Reyes' }).fill('Better, thank you.')
  await person.keyboard.press('Enter')
  await expect(log(staff)).toContainText('Better, thank you.', { timeout: 10_000 })
  await expect(person.getByRole('textbox', { name: 'Message to Dana Reyes' })).toHaveValue('')
  await noViolations(staff)
})

test('unread messages are counted beside the bell and in the list, and clear when read', async () => {
  await staff.goto('/therapist')
  await expect(staff.getByRole('link', { name: 'Messages', exact: true }).first()).toBeVisible()
  await write(person, 'One more question.')
  await expect(staff.getByRole('link', { name: 'Messages, 1 unread' })).toBeVisible({ timeout: 10_000 })
  await staff.getByRole('link', { name: 'Messages, 1 unread' }).click()
  const row = staff.getByRole('navigation', { name: 'Conversations' }).getByRole('link', { name: /Ana Dela Cruz/ })
  await expect(row).toContainText('One more question.')
  await expect(row).toContainText('1 unread message')
  await row.click()
  await expect(log(staff)).toContainText('One more question.')
  await expect(staff.getByRole('link', { name: 'Messages', exact: true }).first()).toBeVisible({ timeout: 10_000 })
  await expect(staff.getByRole('link', { name: /Messages, \d+ unread/ })).toHaveCount(0)
})

test('a message taken back disappears for both, and leaves a mark', async () => {
  await write(staff, 'Sent by mistake')
  await expect(log(person)).toContainText('Sent by mistake', { timeout: 10_000 })
  const mine = log(staff).getByRole('listitem').filter({ hasText: 'Sent by mistake' })
  await mine.getByRole('button', { name: 'Delete' }).click()
  await expect(mine.getByText('Delete for both of you?')).toBeVisible()
  await mine.getByRole('button', { name: 'Delete' }).click()
  await expect(log(staff)).not.toContainText('Sent by mistake')
  await expect(log(person)).not.toContainText('Sent by mistake', { timeout: 10_000 })
  await expect(log(person).getByText('Message deleted')).toBeVisible()
})

test('a send that fails stays in the thread as not sent, and goes once when tried again', async () => {
  await staff.route('**/rest/v1/rpc/send_message', (route) => route.abort())
  await write(staff, 'Through a bad connection')
  const waiting = log(staff).getByRole('listitem').filter({ hasText: 'Through a bad connection' })
  await expect(waiting.getByText('Not sent')).toBeVisible({ timeout: 15_000 })
  await staff.unroute('**/rest/v1/rpc/send_message')
  await waiting.getByRole('button', { name: 'Try again' }).click()
  await expect(waiting.getByText('Not sent')).toHaveCount(0)
  await expect(log(person).getByText('Through a bad connection')).toHaveCount(1, { timeout: 10_000 })
  await expect(log(staff).getByText('Through a bad connection')).toHaveCount(1)
})

test('what was said while the connection was down arrives when it returns, once', async () => {
  test.setTimeout(60_000)
  const context = person.context()
  await context.setOffline(true)
  await expect(person.getByText('Reconnecting…')).toBeVisible()
  const conversation = sql(`select id from public.conversations where therapist_id='${therapist.id}' and patient_id='${patient.id}'`)
  await sendMessage(await signedIn(therapist), randomUUID(), conversation, 'Sent while you were away')
  await context.setOffline(false)
  await expect(person.getByText('Reconnecting…')).toHaveCount(0, { timeout: 20_000 })
  await expect(log(person).getByText('Sent while you were away')).toHaveCount(1, { timeout: 15_000 })
})

test('older messages load on request and keep their order', async () => {
  const conversation = sql(`select id from public.conversations where therapist_id='${therapist.id}' and patient_id='${patient.id}'`)
  sql(`insert into public.chat_messages(id,conversation_id,sender_id,kind,body,created_at)
    select gen_random_uuid(),'${conversation}','${therapist.id}','text','Older '||g,now()-interval '3 days'-(g||' seconds')::interval from generate_series(1,55) g;`)
  await person.reload()
  await expect(log(person)).toContainText('Sent while you were away')
  // The first page holds the newest 50, so the oldest of the 55 is not there until asked for.
  await expect(log(person)).toContainText('Older 1')
  await expect(log(person)).not.toContainText('Older 55')
  await person.getByRole('button', { name: 'Load older messages' }).click()
  await expect(log(person)).toContainText('Older 55')
  // The words are the first line of each message; the time sits on the line below.
  const order = await log(person).locator('li > p:first-child').filter({ hasText: /Older \d+$/ }).allTextContents()
  expect(order.map((text) => Number(/Older (\d+)$/.exec(text)![1]))).toEqual(Array.from({ length: 55 }, (_, index) => 55 - index))
  await expect(person.getByRole('button', { name: 'Load older messages' })).toHaveCount(0)
})

test('when the link ends the patient can still read but not write, and the therapist loses the conversation', async () => {
  sql(`update public.therapist_patients set active=false where therapist_id='${therapist.id}' and patient_id='${patient.id}';`)
  await person.reload()
  await expect(log(person)).toContainText('Better, thank you.')
  await expect(person.getByText('This conversation is closed because you are no longer linked. You can still read it.')).toBeVisible()
  await expect(person.getByRole('textbox', { name: /^Message to / })).toHaveCount(0)

  await staff.goto('/therapist/messages')
  const list = staff.getByRole('navigation', { name: 'Conversations' })
  await expect(list.getByRole('link')).toHaveCount(1)
  await expect(list).not.toContainText('Ana Dela Cruz')
})

test('the patient record leads straight to that patient’s conversation, and it works on a phone', async () => {
  await staff.goto(`/therapist/patients/${quiet.id}`)
  await staff.getByRole('link', { name: 'Message', exact: true }).click()
  await expect(staff).toHaveURL(/\/therapist\/messages\/[0-9a-f-]{36}$/)
  // The record is still fading out behind it, so the heading is looked for inside the conversation.
  await expect(staff.getByRole('region', { name: 'Conversation with Ben Santos' }).getByRole('heading', { name: 'Ben Santos' })).toBeVisible()
  await expect(staff.getByText('No messages yet. Write the first one to Ben Santos.')).toBeVisible()

  await person.setViewportSize({ width: 360, height: 760 })
  await person.reload()
  await expect(log(person)).toContainText('Better, thank you.')
  expect(await person.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
  await noViolations(person)
})
