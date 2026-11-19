import { expect, test } from '@playwright/test'

// Chrome's fake camera: a moving test pattern, granted without a prompt.
test.use({
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  permissions: ['camera'],
})

type Pose = typeof import('../../src/features/exercise/pose/index')
type Assessment = typeof import('../../src/features/exercise/assessment/index')
// The dev server serves source modules, so the page imports them directly.
const MODULES = { pose: '/src/features/exercise/pose/index.ts', assessment: '/src/features/exercise/assessment/index.ts' }

interface Run { delegate: string; frames: number; people: number[]; p95: number; fps: number; dropped: number; size: string; refused: string[] }

test('MediaPipe tracks camera frames in the browser and nothing leaves this machine', async ({ page }) => {
  test.setTimeout(120_000)
  const outside: string[] = []
  page.on('request', (request) => {
    const host = new URL(request.url()).hostname
    if (!['localhost', '127.0.0.1'].includes(host) && !request.url().startsWith('data:') && !request.url().startsWith('blob:')) outside.push(request.url())
  })
  await page.goto('/design/components')

  const run = await page.evaluate(async (modules): Promise<Run> => {
    const pose = (await import(/* @vite-ignore */ modules.pose)) as Pose
    const { CameraDiagnostics } = (await import(/* @vite-ignore */ modules.assessment)) as Assessment
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
    const video = Object.assign(document.createElement('video'), { muted: true, playsInline: true, srcObject: stream })
    document.body.append(video)
    await video.play()
    const host = await pose.preparePoseTracking()
    const seen: number[] = []
    let last = { samples: 0, fps: 0, p95LatencyMs: 0 }, size = ''
    const loop = new pose.FrameLoop({
      video, detector: host, diagnostics: new CameraDiagnostics(),
      onFrame: (frame) => { seen.push(frame.people.length); last = frame.diagnostics; size = `${frame.width}x${frame.height}`; frame.image.close() },
      onPause: () => undefined,
    })
    loop.start()
    await new Promise<void>((resolve) => { const check = () => (seen.length >= 30 ? resolve() : setTimeout(check, 50)); check() })
    loop.stop()
    stream.getTracks().forEach((track) => track.stop())
    const refused = await pose.releasePoseTracking()
    return { delegate: `${host.thread} ${host.delegate}`, frames: seen.length, people: seen, p95: last.p95LatencyMs, fps: last.fps, dropped: loop.dropped, size, refused }
  }, MODULES)

  console.log(`pose tracking: ${run.delegate}, ${run.frames} frames at ${run.size}, ${run.fps.toFixed(1)} FPS, p95 ${run.p95} ms, ${run.dropped} dropped, refused ${run.refused.join(', ') || 'nothing'}`)
  expect(run.frames).toBeGreaterThanOrEqual(30)
  expect(run.size).toBe('640x480')
  // The fake camera shows a test pattern, not a person.
  expect(run.people.every((count) => count === 0)).toBe(true)
  // Chromium can use the graphics chip inside a worker, so detection must stay off the page's thread there.
  expect(run.delegate).toBe('worker GPU')
  // MediaPipe sends usage statistics now and then, often when it closes. The guard refuses them; whether one was
  // attempted during this short run varies, so only the result is checked: nothing reached another address.
  expect(outside).toEqual([])
})
