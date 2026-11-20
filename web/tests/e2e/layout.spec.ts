import AxeBuilder from '@axe-core/playwright'
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

test('the sidebar folds to icons and back, names each icon, and stays as left after a reload (#147)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/design/therapist')
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav).toBeVisible()
  expect((await nav.boundingBox())!.width).toBe(240)
  await page.getByRole('button', { name: 'Collapse menu' }).click()
  await expect(page.getByRole('button', { name: 'Expand menu' })).toHaveAttribute('aria-expanded', 'false')
  await expect.poll(async () => (await nav.boundingBox())!.width).toBe(64)
  // The needle still points at the current page.
  await expect.poll(() => page.evaluate(() => {
    const link = document.querySelector('[aria-label="Main"] a[aria-current="page"]')!.getBoundingClientRect()
    const needle = document.querySelector('[aria-label="Main"] a[aria-current="page"] span.absolute')!.getBoundingClientRect()
    return Math.abs((needle.top + needle.bottom) / 2 - (link.top + link.bottom) / 2) < 4
  })).toBe(true)
  // Folded, every item keeps its name, and shows it on hover and on keyboard focus.
  const patients = nav.getByRole('link', { name: 'Patients' })
  await patients.hover()
  await expect(page.getByRole('tooltip', { name: 'Patients' })).toBeVisible()
  await page.keyboard.press('Escape')
  await nav.getByRole('link', { name: 'Exercises' }).focus()
  await expect(page.getByRole('tooltip', { name: 'Exercises' })).toBeVisible()
  const results = await new AxeBuilder({ page }).include('nav[aria-label="Main"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(results.violations.map((v) => v.id)).toEqual([])
  // The content takes the room the sidebar gave up, still centred.
  const content = await gaps(page, '#main > div')
  expect(Math.abs(content.left - content.right)).toBeLessThanOrEqual(1)

  await page.reload()
  await expect.poll(async () => (await page.getByRole('navigation', { name: 'Main' }).boundingBox())!.width).toBe(64)
  // The keyboard opens it again.
  await page.getByRole('button', { name: 'Expand menu' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Collapse menu' })).toHaveAttribute('aria-expanded', 'true')
  await expect.poll(async () => (await page.getByRole('navigation', { name: 'Main' }).boundingBox())!.width).toBe(240)
})

test('a narrow window folds the sidebar by itself, without the button', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 })
  await page.goto('/design/therapist')
  await expect.poll(async () => (await page.getByRole('navigation', { name: 'Main' }).boundingBox())!.width).toBe(64)
  await expect(page.getByRole('button', { name: /Collapse menu|Expand menu/ })).toHaveCount(0)
})

test('a phone header shows the whole page title, and the language moves into the account menu (#148)', async ({ page }) => {
  // Patient pages: the staff workspaces start at tablet width (WEB-DESIGN.md).
  await page.setViewportSize({ width: 390, height: 844 })
  for (const [path, title] of [['/design/patient', 'Home'], ['/design/patient/exercises', 'Exercises'], ['/design/patient/book', 'Book'], ['/design/patient/bookings', 'My bookings'], ['/design/patient/camera-check', 'Camera check'], ['/design/patient/progress', 'Progress']] as const) {
    await page.goto(path)
    const heading = page.getByRole('navigation', { name: 'You are here' }).locator('p[aria-current="page"]')
    await expect(heading, path).toHaveText(title)
    // Shown in full, not cut short.
    expect(await heading.evaluate((element) => element.scrollWidth <= element.clientWidth), path).toBe(true)
  }
  await expect(page.getByRole('group', { name: 'Language' })).toBeHidden()
  await page.getByRole('button', { name: /^Account:/ }).click()
  await page.getByRole('menuitemradio', { name: 'Filipino' }).click()
  await expect(page.getByRole('menuitemradio', { name: 'Filipino' })).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')
  await expect(page.locator('html')).toHaveAttribute('lang', 'fil')
  await expect(page.locator('p[aria-current="page"]')).toHaveText('Pag-unlad')
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(results.violations.map((v) => v.id)).toEqual([])
  await page.getByRole('button', { name: /:/ }).first().click()
  await page.getByRole('menuitemradio', { name: 'English' }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
})

test('a tablet or wider keeps the breadcrumb and the language switch in the header', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1000 })
  await page.goto('/design/therapist/patients/p1')
  const trail = page.getByRole('navigation', { name: 'You are here' })
  await expect(trail.getByRole('link', { name: 'Patients' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Language' })).toBeVisible()
})
