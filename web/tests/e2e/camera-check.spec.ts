import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

/** The web camera check (#136), in the design gallery, which renders the real page without a backend. */
// Chrome's fake camera, with its permission prompt answered yes. camera-blocked.spec.ts covers a blocked camera.
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } })
const PAGE = '/design/patient/camera-check'

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
}

test.describe('with the camera allowed', () => {
  test.use({ permissions: ['camera'] })

  test('opens from Exercises, shows the live camera with tracking, and finishes without saving', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/design/patient/exercises')
    await page.getByRole('button', { name: 'Camera positioning check' }).click()
    await expect(page).toHaveURL(/\/design\/patient\/camera-check$/)
    await expect(page.getByRole('heading', { name: 'Camera positioning check' })).toBeVisible()
    await expect(page.getByText('Keep your body and the required joints in view.')).toBeVisible()
    for (const width of [390, 1280]) { await page.setViewportSize({ width, height: 900 }); await axe(page) }

    await page.getByRole('button', { name: 'Open live camera' }).click()
    await page.getByRole('button', { name: 'Allow camera access' }).click()
    await expect(page.getByText('Live camera', { exact: true })).toBeVisible({ timeout: 60_000 })
    // Chrome's fake camera shows a test pattern, so nobody is found.
    await expect(page.getByText('No person detected. Position your body in view.')).toBeVisible()
    await expect(page.getByText(/FPS · p95 \d+ ms · (graphics chip|processor)/)).toBeVisible()
    await expect(page.getByRole('img', { name: /Elbow angle gauge/ })).toBeVisible()
    await expect(page.getByText('Demo thresholds · not a therapist prescription')).toBeVisible()
    for (const width of [390, 1280]) { await page.setViewportSize({ width, height: 900 }); await axe(page) }

    await page.getByRole('button', { name: 'Finish camera check' }).click()
    await expect(page.getByRole('heading', { name: 'Camera check finished' })).toBeVisible()
    await expect(page.getByText('Camera preview only. No exercise measurements are recorded.')).toBeVisible()
  })

  test('draws the skeleton and protractor on the measured joints, mirrored or not', async ({ page }) => {
    await page.goto(PAGE)
    const result = await page.evaluate(async (modules) => {
      const stage = (await import(/* @vite-ignore */ modules.stage)) as typeof import('../../src/features/exercise/camera/stage')
      const engine = (await import(/* @vite-ignore */ modules.assessment)) as typeof import('../../src/features/exercise/assessment/index')
      const rules = engine.createRules()
      // An elbow at 60°, with the trunk upright, in a 640×480 frame.
      const points = Array.from({ length: 33 }, () => engine.landmark(0.5, 0.5, 0))
      const set = (i: number, x: number, y: number) => { points[i] = engine.landmark(x, y, 1) }
      set(11, 0.3, 0.2); set(23, 0.3, 0.85); set(13, 0.3, 0.5); set(15, 0.3 + Math.sin(Math.PI / 3) * 0.25, 0.5 + Math.cos(Math.PI / 3) * 0.25)
      const blank = Object.assign(document.createElement('canvas'), { width: 640, height: 480 })
      const snapshot = { ...new engine.MovementAssessment(rules).snapshot, quality: 'READY' as const, angleDegrees: 60 }
      const sample = (mirrored: boolean) => {
        const canvas = Object.assign(document.createElement('canvas'), { width: 400, height: 500 })
        const ctx = canvas.getContext('2d')!
        const drawn = stage.drawStage(ctx, { frame: { image: blank, width: 640, height: 480, people: [points] }, rules, snapshot, mirrored, width: 400, height: 500, font: 'sans-serif' })
        const map = engine.previewMapping(640, 480, 400, 500, mirrored)
        const pixel = (p: { x: number; y: number }) => { const [x, y] = map.map(engine.landmark(p.x, p.y, 1)); return Array.from(ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3)) }
        // Along the forearm, past the protractor, the bone is drawn in the focus colour.
        const forearm = { x: points[13]!.x + (points[15]!.x - points[13]!.x) * 0.9, y: points[13]!.y + (points[15]!.y - points[13]!.y) * 0.9 }
        return { shoulder: pixel(points[11]!), forearm: pixel(forearm), wrist: pixel(points[15]!), otherSide: pixel({ x: 1 - forearm.x, y: forearm.y }), protractor: drawn !== null }
      }
      return { plain: sample(false), mirrored: sample(true) }
    }, { stage: '/src/features/exercise/camera/stage.ts', assessment: '/src/features/exercise/assessment/index.ts' })
    const mint = [0x6f, 0xe0, 0x8f]
    for (const view of [result.plain, result.mirrored]) {
      expect(view.protractor).toBe(true)
      // The focus chain (shoulder, elbow, wrist) is drawn in the focus colour; the protractor sits on the elbow itself.
      expect(view.shoulder).toEqual(mint)
      expect(view.forearm).toEqual(mint)
      expect(view.wrist).toEqual(mint)
      // Nothing is drawn where the limb would be on the wrong side of the picture.
      expect(view.otherSide).not.toEqual(mint)
    }
  })
})
