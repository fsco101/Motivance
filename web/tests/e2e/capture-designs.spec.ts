import { mkdirSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

/**
 * Renders every design screen for review. Run on demand, not in CI:
 *   CAPTURE_DESIGNS=1 npx playwright test capture-designs
 */
test.skip(!process.env.CAPTURE_DESIGNS, 'Only when capturing designs')

const OUT = process.env.CAPTURE_DIR ?? '../docs/validation/web-design'
const WIDTHS = [1440, 1024, 768, 390]
const SCREENS: ReadonlyArray<readonly [string, string]> = [
  ['landing', '/design/landing'],
  ['sign-in', '/design/sign-in'],
  ['therapist-home', '/design/therapist'],
  ['patient-list', '/design/therapist/patients'],
  ['patient-record', '/design/therapist/patients/p1'],
  ['assignment-editor', '/design/therapist/patients/p1/assign'],
  ['exercises', '/design/therapist/exercises'],
  ['progress', '/design/therapist/progress'],
  ['admin-overview', '/design/admin'],
  ['admin-accounts', '/design/admin/accounts'],
  ['admin-links', '/design/admin/links'],
  ['admin-catalogue', '/design/admin/catalogue'],
  ['admin-activity', '/design/admin/activity'],
  ['profile', '/design/admin/profile'],
]

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(1600)
}

test.beforeAll(() => mkdirSync(OUT, { recursive: true }))

for (const width of WIDTHS) {
  // Only the two public pages are made for phones; staff workspaces start at 768 px.
  for (const [name, path] of width < 768 ? SCREENS.slice(0, 2) : SCREENS) {
    test(`${name} at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(path)
      await settle(page)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow, 'no horizontal page scroll').toBeLessThanOrEqual(0)
      await page.screenshot({ path: `${OUT}/${name}-${width}.png`, fullPage: true })
    })
  }
}

for (const state of ['loading', 'empty', 'error']) {
  for (const [name, path] of SCREENS.slice(2)) {
    test(`${name} ${state}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto(`${path}?state=${state}`)
      await settle(page)
      await page.screenshot({ path: `${OUT}/states/${name}-${state}.png` })
    })
  }
}

test('confirmation states', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/design/admin/accounts')
  await settle(page)
  await page.getByRole('cell', { name: /Dana Reyes/ }).click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUT}/states/admin-accounts-selected.png` })
  await page.getByRole('button', { name: 'Disable account' }).click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUT}/states/admin-accounts-confirm.png` })

  await page.goto('/design/therapist/patients')
  await settle(page)
  await page.getByRole('button', { name: 'Actions for Ana Dela Cruz' }).click()
  await page.getByRole('menuitem', { name: 'Revoke access' }).click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUT}/states/patient-list-confirm.png` })
})

test('card hover', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/design/therapist/patients')
  await settle(page)
  await page.getByRole('link', { name: 'Open Ana Dela Cruz' }).hover()
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${OUT}/states/patient-card-hover.png` })
})
