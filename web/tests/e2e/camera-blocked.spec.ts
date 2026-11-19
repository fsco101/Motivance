import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

/**
 * A patient who blocked the camera (#136). Headless Chromium has no permission prompt, so a blocked camera cannot be
 * produced for real here. The page is given the browser's documented answers instead: getUserMedia refuses with
 * NotAllowedError, and the camera permission reports "granted" when the patient allows it. After that the real fake
 * camera opens.
 */
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] }, permissions: ['camera'] })

test('explains how to allow a blocked camera, and starts by itself once it is allowed', async ({ page }) => {
  test.setTimeout(120_000)
  await page.addInitScript(() => {
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    const status = Object.assign(new EventTarget(), { state: 'denied' as PermissionState, name: 'camera', onchange: null })
    const allowed = () => status.state === 'granted'
    navigator.mediaDevices.getUserMedia = (constraints) => (allowed() ? real(constraints) : Promise.reject(new DOMException('Permission denied', 'NotAllowedError')))
    const query = navigator.permissions.query.bind(navigator.permissions)
    navigator.permissions.query = (descriptor) => (descriptor.name === ('camera' as PermissionName) ? Promise.resolve(status as unknown as PermissionStatus) : query(descriptor))
    ;(window as unknown as { allowCamera: () => void }).allowCamera = () => { status.state = 'granted'; status.dispatchEvent(new Event('change')) }
  })
  await page.goto('/design/patient/camera-check')
  await page.getByRole('button', { name: 'Open live camera' }).click()
  await page.getByRole('button', { name: 'Allow camera access' }).click()
  await expect(page.getByText('The camera is blocked for this site.')).toBeVisible()
  await expect(page.getByText(/allow the camera, then try again/)).toBeVisible()
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(results.violations.map((v) => v.id)).toEqual([])
  await page.evaluate(() => (window as unknown as { allowCamera: () => void }).allowCamera())
  await expect(page.getByText('Live camera', { exact: true })).toBeVisible({ timeout: 60_000 })
})
