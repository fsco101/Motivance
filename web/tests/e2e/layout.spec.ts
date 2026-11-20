import { expect, test, type Page } from '@playwright/test'

/**
 * The workspace frame on wide screens (#146): the content is centred beside the sidebar, so the margins on either side are equal at
 * any width, and a narrow page centres its header and content together. Runs on the design gallery, which needs no account.
 */
const WIDE = ['/design/patient', '/design/patient/exercises', '/design/patient/progress', '/design/therapist', '/design/therapist/patients/p1', '/design/scheduler', '/design/admin/accounts']
const NARROW = ['/design/patient/camera-check']

/** The gaps between the content and the space it sits in: from the sidebar's edge on the left, to the window's edge on the right. */
async function gaps(page: Page, selector: string) {
  return page.evaluate((selector) => {
    const element = document.querySelector(selector)!
    const box = element.getBoundingClientRect()
    const sidebar = document.querySelector('nav[aria-label]')?.closest('div.bg-ink')?.getBoundingClientRect()
    const start = sidebar && sidebar.width > 0 ? sidebar.right : 0
    return { left: Math.round(box.left - start), right: Math.round(document.documentElement.clientWidth - box.right), width: Math.round(box.width) }
  }, selector)
}

for (const width of [1440, 1920, 2560]) {
  test(`content has the same margin on both sides at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    for (const path of [...WIDE, ...NARROW]) {
      await page.goto(path)
      await expect(page.locator('#main h1').first()).toBeVisible()
      const content = await gaps(page, '#main > div')
      expect(Math.abs(content.left - content.right), `${path}: ${JSON.stringify(content)}`).toBeLessThanOrEqual(1)
      // The header and footer line up with the content.
      const header = await page.locator('div.h-14', { has: page.getByRole('navigation', { name: 'You are here' }) }).boundingBox()
      expect(Math.round(header!.x), path).toBe(Math.round((await page.locator('#main > div').boundingBox())!.x))
    }
    for (const path of NARROW) {
      await page.goto(path)
      await expect(page.locator('#main h1').first()).toBeVisible()
      const narrow = await gaps(page, '#main [data-width="narrow"]')
      expect(Math.abs(narrow.left - narrow.right), `${path}: ${JSON.stringify(narrow)}`).toBeLessThanOrEqual(1)
      expect(narrow.width).toBeLessThanOrEqual(768)
    }
  })
}

test('a phone keeps the full width of the window', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  for (const path of ['/design/patient', '/design/patient/exercises']) {
    await page.goto(path)
    await expect(page.locator('#main h1').first()).toBeVisible()
    const content = await gaps(page, '#main > div')
    expect(content.left, path).toBe(content.right)
    expect(content.width, path).toBeGreaterThanOrEqual(390 - 2 * 20)
  }
})
