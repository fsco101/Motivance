import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { chromium, expect, test } from '@playwright/test'
import { publishPrescription } from '../../src/data/therapist'
import { loadCatalogue } from '../../src/data/workspace'
import { framePath, makeExerciseVideo, TOTAL_FRAMES, VIDEO, videoDir } from '../support/exerciseVideo'
import { createUser, link, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

/**
 * The web camera regression (#141). Chromium's fake camera plays a recorded exercise (tests/support/exerciseVideo.ts),
 * and the real app tracks it with real MediaPipe: camera check, a both-sides session, counting, the countdown between
 * sides, finish, save and the result in progress. The same frames are then measured offline, frame by frame, so the
 * numbers can be compared with Android's run of the same frames (RecordedExerciseTest on the phone).
 */
test.describe.configure({ mode: 'serial' })

const DIR = resolve(videoDir(process.cwd()))
const Y4M = join(DIR, 'exercise.y4m')
/**
 * Headless Chromium draws in software by default, where MediaPipe manages about one frame a second; the engine then sees
 * every gap as lost tracking. These flags let it use the computer's graphics chip, as a patient's browser does.
 */
const GPU = ['--ignore-gpu-blocklist', '--enable-gpu', ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : [])]
const CAMERA = [...GPU, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${Y4M}`]
let therapist: TestUser
let patient: TestUser

test.beforeAll(async () => {
  therapist = await createUser(['therapist'])
  patient = await createUser(['patient'])
  await link(therapist, patient)
  const staff = await signedIn(therapist)
  const elbow = (await loadCatalogue(staff, therapist.id)).find((item) => item.algorithm === 'elbow-flexion-v1' && item.selectable)!
  await publishPrescription(staff, { assignmentId: randomUUID(), requestId: randomUUID(), patientId: patient.id, exerciseId: elbow.id, side: 'bilateral', focus: null, low: 20, high: 90, repetitions: 2, minimumCycleMs: 600, maximumCycleMs: 30000, peakHoldMs: 100, maxTrunkLean: 20, confidence: 0.7 })
})
test.afterAll(() => removeUsers([therapist, patient]))

test('the recorded exercise is drawn, frame for frame the same each time, as JPEG frames and a y4m camera feed', async ({ page }) => {
  test.setTimeout(300_000)
  await page.goto('/design/components')
  expect(await makeExerciseVideo(page, DIR)).toBe(Y4M)
  expect(readFileSync(framePath(DIR, 0)).subarray(0, 2).toString('hex')).toBe('ffd8')
})

test('the browser runs a both-sides session on the recording with real MediaPipe, and it is saved', async ({ baseURL }) => {
  test.setTimeout(240_000)
  const browser = await chromium.launch({ args: CAMERA })
  try {
    const context = await browser.newContext({ baseURL, permissions: ['camera'] })
    const page = await context.newPage()
    await page.goto('/sign-in')
    await page.getByLabel('Email').fill(patient.email)
    await page.getByLabel('Password', { exact: true }).fill(patient.password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page).toHaveURL(/\/patient$/)

    // The camera check finds the person and draws them.
    await page.goto('/patient/exercises')
    await page.getByRole('button', { name: 'Camera positioning check' }).click()
    await page.getByRole('button', { name: 'Open live camera' }).click()
    await page.getByRole('button', { name: 'Allow camera access' }).click()
    await expect(page.getByText('Tracking ready. Use a controlled movement.')).toBeVisible({ timeout: 60_000 })
    const check = await page.getByText(/ FPS · p95 /).textContent()
    await page.getByRole('button', { name: 'Finish camera check' }).click()
    await expect(page.getByRole('heading', { name: 'Camera check finished' })).toBeVisible()

    await page.goto('/patient/exercises')
    await page.getByRole('button', { name: 'Start exercise' }).first().click()
    await page.getByRole('button', { name: 'Open camera' }).click()
    await page.getByRole('button', { name: 'Allow camera access' }).click()
    await expect(page.getByText('Tracking ready. Use a controlled movement.')).toBeVisible({ timeout: 60_000 })
    await page.getByLabel(/I consent to saving movement summaries/).check()
    // Start counts only while the left arm is tracked; the recording turns to the right arm half the time, so a refused
    // Start waits for tracking to be ready again, as a patient would.
    const recording = page.getByText('Recording · repetition checking is active')
    for (let attempt = 0; attempt < 4 && !(await recording.isVisible()); attempt++) {
      await expect(page.getByText('Tracking ready. Use a controlled movement.')).toBeVisible({ timeout: 60_000 })
      await page.getByRole('button', { name: 'Start measurement' }).click()
      await page.waitForTimeout(500)
    }
    await expect(recording).toBeVisible()

    // The left side ends at its target, the countdown runs, and the right side starts once its arm is tracked.
    await expect(page.getByRole('heading', { name: 'Next: Right side' })).toBeVisible({ timeout: 90_000 })
    const left = await page.getByText(/^Counted! \d of 2$/).count()
    await expect(page.getByText('Recording · repetition checking is active')).toBeVisible({ timeout: 90_000 })
    await expect(page.getByText('2 / 2')).toBeVisible({ timeout: 90_000 })
    const session = await page.getByText(/ FPS · p95 /).textContent()
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    expect(results.violations.map((v) => v.id)).toEqual([])
    await page.getByRole('button', { name: 'Finish and save' }).click()
    await page.getByRole('button', { name: 'See your results' }).click()
    await expect(page.getByText('Saved to your account. Your therapist can see it in your progress.')).toBeVisible({ timeout: 30_000 })

    const saved = sql(`select string_agg(m.side||':'||m.completed_repetitions||':'||round(m.rom_degrees::numeric,1)||':'||s.client, ',' order by s.started_at) from public.sessions s join public.session_measurements m on m.session_id=s.id where s.patient_id='${patient.id}'`)
    console.log(`camera check ${check}; session ${session}; saved ${saved}; left counted lines ${left}`)
    const sides = saved.split(',').map((row) => row.split(':'))
    expect(sides.map(([side]) => side)).toEqual(['left', 'right'])
    sides.forEach(([, done, , client]) => { expect(Number(done)).toBeGreaterThanOrEqual(2); expect(client).toBe('web') })

    // The result is in the patient's progress.
    await page.goto('/patient/progress')
    await expect(page.getByText(/Elbow flexion/).first()).toBeVisible({ timeout: 30_000 })
    await context.close()
  } finally {
    await browser.close()
  }
})

test('performance spot check: the recording tracked live on the computer\'s graphics chip', async ({ baseURL }) => {
  test.setTimeout(120_000)
  const browser = await chromium.launch({ args: CAMERA })
  try {
    const page = await (await browser.newContext({ baseURL, permissions: ['camera'] })).newPage()
    await page.goto('/design/components')
    const run = await page.evaluate(async () => {
      const gl = document.createElement('canvas').getContext('webgl2')!
      const info = gl.getExtension('WEBGL_debug_renderer_info')
      const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown'
      const pose = await import('/src/features/exercise/pose/index.ts' as string)
      const { CameraDiagnostics } = await import('/src/features/exercise/assessment/index.ts' as string)
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
      const video = Object.assign(document.createElement('video'), { muted: true, playsInline: true, srcObject: stream })
      document.body.append(video)
      await video.play()
      const host = await pose.preparePoseTracking()
      const latencies: number[] = []
      let diagnostics = { fps: 0, p95LatencyMs: 0 }
      const loop = new pose.FrameLoop({ video, detector: host, diagnostics: new CameraDiagnostics(), onFrame: (frame: { latencyMs: number; diagnostics: typeof diagnostics; image: ImageBitmap }) => { latencies.push(frame.latencyMs); diagnostics = frame.diagnostics; frame.image.close() }, onPause: () => undefined })
      loop.start()
      await new Promise((resolve) => setTimeout(resolve, 30_000))
      loop.stop()
      stream.getTracks().forEach((track) => track.stop())
      await pose.releasePoseTracking()
      const sorted = [...latencies].sort((a, b) => a - b)
      const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1)]!
      return { renderer, where: `${host.thread} ${host.delegate}`, frames: latencies.length, fps: diagnostics.fps, median: at(0.5), p95: at(0.95), dropped: loop.dropped }
    })
    console.log(`performance: ${run.renderer}; ${run.where}; ${run.frames} frames in 30 s; ${run.fps.toFixed(1)} FPS; median ${run.median} ms; p95 ${run.p95} ms; ${run.dropped} dropped`)
    // The provisional gate from the issue: median at most 150 ms and p95 at most 250 ms.
    expect(run.median).toBeLessThanOrEqual(150)
    expect(run.p95).toBeLessThanOrEqual(250)
  } finally {
    await browser.close()
  }
})

/** One frame's reading on one side: the elbow angle the engine used, or null when tracking was not ready. */
type Reading = number | null
interface SideRun { side: 'LEFT' | 'RIGHT'; completed: number; incomplete: number; romDegrees: number | null; readings: Reading[]; started: number }

test('the same frames, measured offline, give the numbers to compare with Android', async ({ baseURL }) => {
  test.setTimeout(300_000)
  const browser = await chromium.launch({ args: GPU })
  const page = await (await browser.newContext({ baseURL })).newPage()
  await page.route('**/__recorded/*.jpg', (route) => route.fulfill({ contentType: 'image/jpeg', body: readFileSync(framePath(DIR, Number(/(\d+)\.jpg$/.exec(route.request().url())![1]))) }))
  await page.goto('/design/components')
  const run = await page.evaluate(async ({ total, fps }) => {
    const pose = await import('/src/features/exercise/pose/index.ts' as string)
    const assessment = await import('/src/features/exercise/assessment/index.ts' as string)
    const host = await pose.preparePoseTracking()
    const sides = (['LEFT', 'RIGHT'] as const).map((side) => {
      const rules = assessment.createRules({ kind: 'ELBOW_FLEXION', side, lowDegrees: 20, highDegrees: 90, targetRepetitions: 3, minimumCycleMs: 600, maximumCycleMs: 30000, peakHoldMs: 100, maxTrunkLeanDegrees: 20, confidence: 0.7 })
      return { side, engine: new assessment.MovementAssessment(rules), readings: [] as (number | null)[], started: -1 }
    })
    const people: number[] = []
    for (let i = 0; i < total; i++) {
      const image = new Image()
      image.src = `/__recorded/${i}.jpg`
      await image.decode()
      const bitmap = await createImageBitmap(image)
      // After the warm-up frame, which MediaPipe has already seen at time 0. Android uses the same times.
      const time = 1000 + Math.round((i * 1000) / fps)
      const found = await host.detect(bitmap, time)
      found.image?.close?.()
      people.push(found.people.length)
      for (const s of sides) {
        if (s.started < 0) { s.engine.process(found.people, found.width, found.height, time); if (s.engine.start(time)) s.started = i; s.readings.push(null); continue }
        const snap = s.engine.process(found.people, found.width, found.height, time)
        s.readings.push(snap.quality === 'READY' ? snap.angleDegrees : null)
      }
    }
    await pose.releasePoseTracking()
    return {
      delegate: `${host.thread} ${host.delegate}`, people,
      sides: sides.map((s) => ({ side: s.side, completed: s.engine.snapshot.completed, incomplete: s.engine.snapshot.incomplete, romDegrees: assessment.romDegrees(s.engine.snapshot), readings: s.readings, started: s.started })),
    }
  }, { total: TOTAL_FRAMES, fps: VIDEO.fps }).finally(() => browser.close())
  writeFileSync(join(DIR, 'web.json'), JSON.stringify(run))
  const summary = run.sides.map((s: SideRun) => `${s.side}: ${s.completed} counted, ${s.incomplete} not counted, range ${s.romDegrees?.toFixed(1)}°, ready on ${s.readings.filter((r) => r !== null).length} of ${TOTAL_FRAMES} frames`)
  console.log(`offline web run (${run.delegate}): ${summary.join('; ')}`)
  // Each arm does three repetitions while it faces the camera.
  for (const s of run.sides as SideRun[]) expect(s.completed).toBe(3)
})
