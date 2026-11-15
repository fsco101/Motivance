import { execFileSync } from 'node:child_process'
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
const panelTitled = (page: Page, title: string) => page.locator('section', { has: page.getByRole('heading', { name: title, exact: true, level: 2 }) })
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
  // Removing the accounts queued their photos and videos; this takes them out of Storage too.
  execFileSync('python', ['../scripts/cleanup_chat_media.py', '--target', 'local', '--apply'], { encoding: 'utf8' })
})

test('a therapist finds a conversation for each patient, and a patient with one therapist lands in theirs', async () => {
  await staff.getByRole('link', { name: 'Messages', exact: true }).first().click()
  const list = staff.getByRole('navigation', { name: 'Conversations' })
  await expect(list.getByRole('link')).toHaveCount(2)
  await expect(list).toContainText('Ana Dela Cruz')
  // Nobody has turned messages on yet, so there is nothing to write in.
  await expect(list).toContainText('Has not turned on messages yet')
  await list.getByRole('link', { name: /Ana Dela Cruz/ }).click()
  await expect(staff.getByText('Ana Dela Cruz has not turned on messages yet. You can write once they do.')).toBeVisible()
  await expect(staff.getByRole('textbox', { name: /^Message to / })).toHaveCount(0)

  await person.getByRole('link', { name: 'Messages', exact: true }).first().click()
  await expect(person).toHaveURL(/\/patient\/messages\/[0-9a-f-]{36}$/)
  await expect(person.getByRole('heading', { name: 'Dana Reyes' })).toBeVisible()
  await expect(person.getByText('If something is urgent, call your local emergency number', { exact: false })).toBeVisible()
  // The agreement comes first, with the same four points as Android.
  const agreement = panelTitled(person, 'Messages with your therapist')
  await expect(agreement).toContainText('Administrators and schedulers cannot read them.')
  await expect(person.getByText('Turn on messages above to write to Dana Reyes.')).toBeVisible()
  await noViolations(person)
  await agreement.getByRole('button', { name: 'Turn on messages' }).click()
  await expect(panelTitled(person, 'Messages with your therapist')).toHaveCount(0)
  await expect(person.getByRole('textbox', { name: 'Message to Dana Reyes' })).toBeVisible()
  await staff.reload()
  await expect(staff.getByRole('textbox', { name: 'Message to Ana Dela Cruz' })).toBeVisible()
})

test('a message appears for the other person without a refresh, and is marked seen', async () => {
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

/** A large, detailed photo made in the browser, so no picture is committed: noise does not compress, so it starts well over 1 MB. */
const bigPhoto = (page: Page) => page.evaluate(async () => {
  const canvas = Object.assign(document.createElement('canvas'), { width: 3000, height: 2000 })
  const context = canvas.getContext('2d')!
  const pixels = context.createImageData(3000, 2000)
  for (let index = 0; index < pixels.data.length; index += 1) pixels.data[index] = index % 4 === 3 ? 255 : Math.random() * 255
  context.putImageData(pixels, 0, 0)
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((made) => resolve(made!), 'image/jpeg', 0.95))
  return Array.from(new Uint8Array(await blob.arrayBuffer()))
})

/** A short 720p clip recorded in the browser, larger than what is sent. */
const clip = (page: Page) => page.evaluate(async () => {
  const canvas = Object.assign(document.createElement('canvas'), { width: 1280, height: 720 })
  const context = canvas.getContext('2d')!
  const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/webm', videoBitsPerSecond: 4_000_000 })
  const parts: Blob[] = []
  recorder.ondataavailable = (event) => parts.push(event.data)
  const done = new Promise((resolve) => { recorder.onstop = resolve })
  recorder.start(250)
  const started = performance.now()
  while (performance.now() - started < 2500) {
    context.fillStyle = `hsl(${(performance.now() / 10) % 360} 70% 50%)`
    context.fillRect(0, 0, 1280, 720)
    context.fillStyle = '#fff'
    context.fillRect(((performance.now() - started) / 2500) * 1180, 300, 100, 100)
    await new Promise((resolve) => requestAnimationFrame(resolve))
  }
  recorder.stop()
  await done
  return Array.from(new Uint8Array(await new Blob(parts).arrayBuffer()))
})

test('a photo and a video are made smaller, sent, and open for the other person', async () => {
  test.setTimeout(90_000)
  const original = Buffer.from(await bigPhoto(staff))
  expect(original.byteLength).toBeGreaterThan(1_048_576)
  await staff.locator('input[type=file]').setInputFiles({ name: 'exercise.jpg', mimeType: 'image/jpeg', buffer: original })
  const sentPhoto = log(staff).getByRole('button', { name: 'Open Photo' })
  await expect(sentPhoto).toBeVisible({ timeout: 20_000 })
  await expect(log(staff).getByText('Sending…')).toHaveCount(0, { timeout: 20_000 })
  await expect(log(person).getByRole('button', { name: 'Open Photo' })).toBeVisible({ timeout: 10_000 })
  // What was stored is the shrunk photo, inside every limit.
  const photo = sql(`select width||'x'||height||' '||bytes||' '||mime from public.chat_attachments a join public.conversations c on c.id=a.conversation_id
    where c.patient_id='${patient.id}' and a.kind='image' and a.sent_at is not null order by a.sent_at desc limit 1`)
  const [size, bytes, mime] = photo.split(' ')
  expect(size).toBe('1600x1066')
  expect(Number(bytes)).toBeLessThanOrEqual(1_048_576)
  expect(mime).toBe('image/jpeg')
  await log(person).getByRole('button', { name: 'Open Photo' }).click()
  const opened = person.getByRole('dialog').getByRole('img', { name: 'Photo sent in the conversation' })
  await expect(opened).toBeVisible()
  await expect.poll(() => opened.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1600)
  await person.keyboard.press('Escape')

  await person.locator('input[type=file]').setInputFiles({ name: 'clip.webm', mimeType: 'video/webm', buffer: Buffer.from(await clip(person)) })
  await expect(person.getByText(/Preparing video/)).toBeVisible()
  await expect(log(staff).getByRole('button', { name: /^Open Video/ })).toBeVisible({ timeout: 30_000 })
  const video = sql(`select width||'x'||height||' '||bytes||' '||duration_ms||' '||mime from public.chat_attachments a join public.conversations c on c.id=a.conversation_id
    where c.patient_id='${patient.id}' and a.kind='video' and a.sent_at is not null order by a.sent_at desc limit 1`).split(' ')
  expect(video[0]).toBe('852x480')
  expect(Number(video[1])).toBeLessThanOrEqual(6_291_456)
  expect(Number(video[2])).toBeGreaterThan(1_000)
  expect(Number(video[2])).toBeLessThanOrEqual(30_500)
  await log(staff).getByRole('button', { name: /^Open Video/ }).click()
  const player = staff.getByRole('dialog').locator('video')
  await expect.poll(() => player.evaluate((element: HTMLVideoElement) => element.readyState), { timeout: 10_000 }).toBeGreaterThanOrEqual(2)
  expect(await player.evaluate((element: HTMLVideoElement) => element.videoWidth)).toBe(852)
  await staff.keyboard.press('Escape')
  await noViolations(staff)
})

test('a photo past its 15 days says so instead of showing', async () => {
  sql(`update public.chat_messages set data=jsonb_set(data,'{expires_at}',to_jsonb(now()-interval '1 second')) where kind='attachment' and data->>'attachment_kind'='image'
    and conversation_id=(select id from public.conversations where patient_id='${patient.id}')`)
  sql(`update public.chat_attachments set expires_at=now()-interval '1 second' where kind='image' and conversation_id=(select id from public.conversations where patient_id='${patient.id}')`)
  await person.reload()
  await expect(log(person).getByText('Photo expired after 15 days')).toBeVisible()
  await expect(log(person).getByRole('button', { name: 'Open Photo' })).toHaveCount(0)
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

test('a patient can turn messages off and on again from Profile, and the therapist sees it', async () => {
  await person.goto('/patient/profile')
  const panel = panelTitled(person, 'Messages')
  await expect(panel.getByText('On', { exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'Turn off messages' }).click()
  await person.getByRole('alertdialog').getByRole('button', { name: 'Turn off messages' }).click()
  await expect(panel.getByText('Off', { exact: true })).toBeVisible()
  await staff.reload()
  await expect(staff.getByText('Ana Dela Cruz has not turned on messages yet. You can write once they do.')).toBeVisible()
  await expect(log(staff)).toContainText('Better, thank you.')
  await panel.getByRole('button', { name: 'Turn on messages' }).click()
  await expect(panel.getByText('On', { exact: true })).toBeVisible()
  await staff.reload()
  await expect(staff.getByRole('textbox', { name: 'Message to Ana Dela Cruz' })).toBeVisible()
  await person.goto('/patient/messages')
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
  await expect(staff.getByText('Ben Santos has not turned on messages yet. You can write once they do.')).toBeVisible()

  await person.setViewportSize({ width: 360, height: 760 })
  await person.reload()
  await expect(log(person)).toContainText('Better, thank you.')
  expect(await person.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
  await noViolations(person)
})
