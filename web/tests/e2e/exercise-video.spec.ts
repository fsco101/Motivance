import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { loadSessionVideos } from '../../src/data/sessionVideos'
import { publishPrescription } from '../../src/data/therapist'
import { loadCatalogue } from '../../src/data/workspace'
import { fakeBodyAndVoice } from '../support/camera'
import { createUser, link, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

/**
 * Recording a session video on the web and sharing it with the therapist (#139), against the local backend. The browser records
 * the canvas the patient sees; the video stays in the tab until it is downloaded or shared, and sharing sends a 480p MP4 through
 * the same server functions as the phone. The body and the voice are scripted (tests/support/camera.ts).
 */
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] }, permissions: ['camera'] })
test.describe.configure({ mode: 'serial' })

let therapist: TestUser
let patient: TestUser
let page: Page

async function signIn(browser: Browser, person: TestUser) {
  const opened = await (await browser.newContext({ acceptDownloads: true })).newPage()
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
  await publishPrescription(staff, { assignmentId: randomUUID(), requestId: randomUUID(), patientId: patient.id, exerciseId: elbow.id, side: 'left', focus: null, low: 20, high: 90, repetitions: 2, minimumCycleMs: 600, maximumCycleMs: 30000, peakHoldMs: 100, maxTrunkLean: 20, confidence: 0.7 })
  page = await signIn(browser, patient)
})

test.afterAll(() => removeUsers([therapist, patient]))

const diagnostics = async () => {
  const text = await page.getByText(/ FPS · p95 /).textContent()
  return Number(/([\d.]+) FPS/.exec(text ?? '')?.[1] ?? NaN)
}

test('a recorded session becomes one playable MP4 in the tab, and a 480p copy can be shared and unshared', async () => {
  test.setTimeout(180_000)
  await page.goto('/patient/exercises')
  await page.getByRole('button', { name: 'Start exercise' }).first().click()
  await page.getByRole('button', { name: 'Open camera' }).click()
  await page.getByRole('button', { name: 'Allow camera access' }).click()
  await expect(page.getByText('Tracking ready. Use a controlled movement.')).toBeVisible({ timeout: 30_000 })

  // Recording has its own agreement, asked the first time it is turned on.
  const record = page.getByRole('switch', { name: /Record this session/ })
  await expect(record).toHaveAttribute('aria-checked', 'false')
  await record.click()
  await expect(page.getByRole('dialog', { name: 'Record your sessions?' })).toBeVisible()
  await expect(page.getByText('It stays in this browser tab only.', { exact: false })).toBeVisible()
  const consent = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(consent.violations.map((v) => v.id)).toEqual([])
  await page.getByRole('button', { name: 'Record sessions' }).click()
  await expect(record).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText('Recording', { exact: true })).toHaveCount(0)

  await page.waitForTimeout(3000)
  const before = await diagnostics()
  await page.getByLabel(/I consent to saving movement summaries/).check()
  await page.getByRole('button', { name: 'Start measurement' }).click()
  await expect(page.getByText('Recording', { exact: true })).toBeVisible()
  await expect(page.getByText('2 / 2')).toBeVisible({ timeout: 30_000 })
  const during = await diagnostics()
  // Recording must not slow tracking: the slow-camera warning never shows, and the frame rate holds.
  await expect(page.getByText(/Tracking is slow/)).toHaveCount(0)
  console.log(`FPS before recording ${before}, while recording ${during}`)
  expect(during).toBeGreaterThanOrEqual(before * 0.7)
  await page.getByRole('button', { name: 'Finish and save' }).click()
  await page.getByRole('button', { name: 'See your results' }).click()

  // One playable MP4 with the skeleton and the caption on it.
  await expect(page.getByRole('heading', { name: 'Session video' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/only in this tab/)).toBeVisible()
  const picture = await page.evaluate(async () => {
    const video = document.querySelector('video[aria-label="Session video"]') as HTMLVideoElement
    if (video.readyState < 2) await new Promise((resolve) => video.addEventListener('loadeddata', resolve, { once: true }))
    video.currentTime = 4
    await new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }))
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth; canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(video, 0, 0)
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let mint = 0
    for (let i = 0; i < data.length; i += 4) if (Math.abs(data[i]! - 0x6f) < 40 && Math.abs(data[i + 1]! - 0xe0) < 40 && Math.abs(data[i + 2]! - 0x8f) < 40) mint++
    const band = ctx.getImageData(2, canvas.height - 3, 1, 1).data
    return { width: video.videoWidth, height: video.videoHeight, mint, band: [band[0], band[1], band[2]] }
  })
  expect(picture).toMatchObject({ width: 640, height: 480 })
  // The focus arm is drawn in the focus colour, and the caption band is dark.
  expect(picture.mint).toBeGreaterThan(200)
  expect(Math.max(...(picture.band as number[]))).toBeLessThan(90)

  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
  }

  // Leaving with the video neither downloaded nor shared asks first.
  await page.getByRole('link', { name: 'Back to exercises' }).click()
  await expect(page.getByRole('alertdialog', { name: 'Leave without your video?' })).toBeVisible()
  await page.getByRole('button', { name: 'Stay' }).click()
  await expect(page).toHaveURL(/\/session$/)

  // Nothing has been uploaded yet.
  expect(sql(`select count(*) from public.session_videos where patient_id='${patient.id}'`)).toBe('0')

  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Download video' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^Motivance-session-\d{8}-\d{6}\.mp4$/)
  const bytes = readFileSync((await file.path())!)
  expect(bytes.subarray(4, 8).toString('latin1')).toBe('ftyp')

  await page.getByRole('button', { name: 'Let my therapist see it' }).click()
  await page.getByRole('button', { name: 'Share with my therapist' }).click()
  await expect(page.getByText(/Your therapist can watch this until/)).toBeVisible({ timeout: 60_000 })
  const row = sql(`select v.width||'x'||v.height||','||v.bytes||','||(o.metadata->>'mimetype')||','||(v.duration_ms<=300000) from public.session_videos v join storage.objects o on o.bucket_id='session-videos' and o.name=v.media_path where v.patient_id='${patient.id}' and v.shared_at is not null`)
  const [size, stored, mime, short] = row.split(',')
  expect(size).toBe('640x480')
  expect(Number(stored)).toBeGreaterThan(1000)
  expect(Number(stored)).toBeLessThanOrEqual(20_971_520)
  expect([mime, short]).toEqual(['video/mp4', 'true'])
  // Shared with the session that was measured first, and the therapist can see it.
  expect(sql(`select count(*) from public.session_videos v join public.sessions s on s.id=v.session_id where v.patient_id='${patient.id}' and s.client='web'`)).toBe('1')
  const staff = await signedIn(therapist)
  expect(await loadSessionVideos(staff, patient.id)).toHaveLength(1)

  await page.getByRole('button', { name: 'Stop sharing' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Stop sharing' }).click()
  await expect(page.getByText('No longer shared with your therapist.')).toBeVisible()
  expect(await loadSessionVideos(staff, patient.id)).toHaveLength(0)
})

test('a recording longer than five minutes is shared as its first five minutes, at 480p', async () => {
  test.setTimeout(180_000)
  const result = await page.evaluate(async () => {
    // The dev server serves the app's own modules and its prebundled copy of Mediabunny.
    const mb = await import('/node_modules/.vite/deps/mediabunny.js' as string)
    const { prepareForSharing } = await import('/src/features/exercise/video/prepare.ts' as string)
    // A 380-second, 1280×720 recording at one frame a second, made in the browser.
    const canvas = document.createElement('canvas')
    canvas.width = 1280; canvas.height = 720
    const ctx = canvas.getContext('2d')!
    const target = new mb.BufferTarget()
    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target })
    const source = new mb.CanvasSource(canvas, { codec: 'avc', bitrate: 300_000, keyFrameInterval: 5 })
    output.addVideoTrack(source, { frameRate: 1 })
    await output.start()
    for (let second = 0; second < 380; second++) {
      ctx.fillStyle = `hsl(${second % 360} 60% 40%)`; ctx.fillRect(0, 0, 1280, 720)
      await source.add(second, 1)
    }
    await output.finalize()
    const blob = new Blob([target.buffer], { type: 'video/mp4' })
    const preview = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.5))
    const steps: number[] = []
    const draft = await prepareForSharing({ blob, url: '', width: 1280, height: 720, durationMs: 380_000, sessions: ['s'], preview, at: 0 }, (share: number) => steps.push(share))
    const check = new mb.Input({ source: new mb.BlobSource(draft.file), formats: mb.ALL_FORMATS })
    const track = await check.getPrimaryVideoTrack()
    return { width: draft.width, height: draft.height, durationMs: draft.durationMs, seconds: await check.computeDuration(), shown: [track.displayWidth, track.displayHeight], bytes: draft.file.size, type: draft.file.type, rising: steps.every((v, i) => i === 0 || v >= steps[i - 1]!), last: steps.at(-1) }
  })
  expect(result).toMatchObject({ width: 852, height: 480, durationMs: 300_000, shown: [852, 480], type: 'video/mp4', rising: true, last: 1 })
  expect(result.seconds).toBeGreaterThan(299)
  expect(result.seconds).toBeLessThanOrEqual(300.5)
  expect(result.bytes).toBeLessThanOrEqual(20_971_520)
})
