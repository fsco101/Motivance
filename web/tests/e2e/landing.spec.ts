import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

/** The public page as a visitor sees it. */
const noViolations = (page: Page) => expect.poll(async () => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).slice(0, 3).join(' | ')}`)
}, { timeout: 8_000 }).toEqual([])

test('it says what Motivance is, how booking works, and where to go next', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Book your therapy session, and keep moving between visits.', level: 1 })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Book a session' }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'Create account' }).first()).toBeVisible()
  const steps = page.locator('#how ol > li')
  await expect(steps).toHaveCount(3)
  await expect(steps.nth(0)).toContainText('Create your account')
  await expect(steps.nth(1)).toContainText('Choose a date and time')
  await expect(steps.nth(2)).toContainText('A Scheduler confirms it')
  await expect(page.getByRole('heading', { name: 'Your exercises, on your phone' })).toBeVisible()
})

test('with no app address it says so, and offers no dead link', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('The app is not in a store yet. Ask your center how to install it.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Get the Android app' })).toBeHidden()
})

test('it reads in Filipino', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Filipino' }).first().click()
  await expect(page.getByRole('heading', { name: /^Mag-book ng therapy session/, level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Ang mga ehersisyo mo, nasa telepono mo' })).toBeVisible()
  await noViolations(page)
  await page.getByRole('button', { name: 'English' }).first().click()
})

for (const width of [360, 768, 1024, 1440]) {
  test(`it fits and passes axe at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
    await noViolations(page)
  })
}

test('everything works by keyboard, with visible focus', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  const reached: string[] = []
  for (let press = 0; press < 12; press += 1) {
    await page.keyboard.press('Tab')
    const focus = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement
      const style = getComputedStyle(element)
      return { text: element.textContent?.trim() ?? '', shown: style.outlineStyle !== 'none' && style.outlineWidth !== '0px' }
    })
    if (['Sign in', 'Create account', 'Book a session'].includes(focus.text)) {
      reached.push(focus.text)
      expect(focus.shown, focus.text).toBe(true)
    }
    if (focus.text === 'Book a session') break
  }
  expect(reached).toEqual(['Sign in', 'Create account', 'Book a session'])
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/sign-up\?next=book$/)
})
