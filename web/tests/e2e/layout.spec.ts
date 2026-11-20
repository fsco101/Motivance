import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

/**
 * The workspace frame on wide screens (#146): the content is centred beside the sidebar, so the margins on either side are equal at
 * any width. A narrow page centring its header and content together is checked on the camera check's last screen
 * (camera-check.spec.ts). Runs on the design gallery, which needs no account.
 */
const WIDE = ['/design/patient', '/design/patient/exercises', '/design/patient/progress', '/design/patient/camera-check', '/design/therapist', '/design/therapist/patients/p1', '/design/scheduler', '/design/admin/accounts']

/**
 * The gaps between the content and the space it sits in: the page area beside the sidebar, inside its scrollbar on a wide
 * window, or the window itself on a phone.
 */
async function gaps(page: Page, selector: string) {
  return page.evaluate((selector) => {
    const box = document.querySelector(selector)!.getBoundingClientRect()
    const area = document.querySelector('[data-scroll="page"]') as HTMLElement
    const start = area.getBoundingClientRect().left
    const end = start + area.clientWidth
    return { left: Math.round(box.left - start), right: Math.round(end - box.right), width: Math.round(box.width) }
  }, selector)
}

for (const width of [1440, 1920, 2560]) {
  test(`content has the same margin on both sides at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    for (const path of WIDE) {
      await page.goto(path)
      await expect(page.locator('#main h1').first()).toBeVisible()
      const content = await gaps(page, '#main > div')
      expect(Math.abs(content.left - content.right), `${path}: ${JSON.stringify(content)}`).toBeLessThanOrEqual(1)
      // The header and footer line up with the content.
      const header = await page.locator('div.h-14', { has: page.getByRole('navigation', { name: 'You are here' }) }).boundingBox()
      expect(Math.round(header!.x), path).toBe(Math.round((await page.locator('#main > div').boundingBox())!.x))
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

test('patient Exercises is a card grid, each card showing its own movement and range (#150)', async ({ page }) => {
  for (const [width, columns] of [[390, 1], [820, 2], [1600, 3]] as const) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/design/patient/exercises')
    await expect(page.getByRole('img', { name: 'Animated guide: Elbow flexion, moving between 20° and 120°.' })).toBeVisible()
    await expect(page.getByRole('img', { name: 'Animated guide: Shoulder abduction, moving between 15° and 90°.' })).toBeVisible()
    const grid = await page.locator('#main .grid').filter({ has: page.getByRole('button', { name: 'Start exercise' }) }).last()
      .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)
    expect(grid, `${width} px`).toBe(columns)
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    expect(results.violations.map((v) => v.id), `${width} px`).toEqual([])
  }
  // With reduced motion the figures hold still, with nothing to pause.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.getByRole('img', { name: /Animated guide: Elbow flexion/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /the guide$/ })).toHaveCount(0)
})

test('a patient record keeps each plan row to one line of actions, with the rest in a menu (#151)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/design/therapist/patients/p1')
  const row = page.getByRole('row', { name: /Elbow flexion/ }).first()
  await expect(row.getByRole('link', { name: 'Edit plan' })).toBeVisible()
  await expect(row.getByRole('button', { name: 'Send in chat' })).toHaveCount(0)
  // One row of buttons: the Edit plan link and the menu button sit side by side.
  const edit = (await row.getByRole('link', { name: 'Edit plan' }).boundingBox())!
  const more = (await row.getByRole('button', { name: 'Actions for Elbow flexion' }).boundingBox())!
  expect(Math.abs(edit.y + edit.height / 2 - (more.y + more.height / 2))).toBeLessThan(4)

  // By keyboard: open the menu, choose Remove, and the confirmation opens; cancelling returns to the menu button.
  await row.getByRole('button', { name: 'Actions for Elbow flexion' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menuitem', { name: 'Send in chat' })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Remove' }).focus()
  await page.keyboard.press('Enter')
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await expect(row.getByRole('button', { name: 'Actions for Elbow flexion' })).toBeFocused()
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(results.violations.map((v) => v.id)).toEqual([])
})

test('the Latest movement arc keeps a set size, with the patients beside it (#152)', async ({ page }) => {
  for (const width of [820, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/design/therapist')
    const panel = page.getByRole('region', { name: 'Latest movement' })
    await expect(panel).toBeVisible()
    const arc = (await panel.locator('svg').first().boundingBox())!
    const list = (await panel.getByRole('list').boundingBox())!
    const box = (await panel.boundingBox())!
    expect(arc.width, `${width} px`).toBeLessThanOrEqual(24 * 16 + 1)
    // The list sits beside the arc, not under it, and the panel stays a strip rather than a screen.
    expect(list.x, `${width} px`).toBeGreaterThan(arc.x + arc.width - 1)
    expect(box.height, `${width} px`).toBeLessThan(420)
  }
})

test('a long page scrolls beside the sidebar, which stays the full height of the window', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 })
  await page.goto('/design/therapist/patients/p1')
  await expect(page.locator('#main h1').first()).toBeVisible()
  const area = page.locator('[data-scroll="page"]')
  // The window stays still; the page area has its own scrollbar.
  expect(await area.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  await area.hover()
  await page.mouse.wheel(0, 2000)
  await expect.poll(() => area.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  const sidebar = (await page.getByRole('navigation', { name: 'Main' }).boundingBox())!
  expect(sidebar.y).toBe(0)
  expect(sidebar.height).toBe(800)
  // The header stays at the top while the page scrolls under it.
  expect((await page.getByRole('navigation', { name: 'You are here' }).boundingBox())!.y).toBeLessThan(56)
  // A new page opens at its top.
  await page.getByRole('navigation', { name: 'You are here' }).getByRole('link', { name: 'Patients' }).click()
  await expect.poll(() => area.evaluate((element) => element.scrollTop)).toBe(0)
})

test('only the page area scrolls: nothing stretches the window below the page (Progress had a hidden caption that did)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 })
  for (const path of ['/design/patient/progress', '/design/therapist/progress', '/design/therapist/patients/p1', '/design/admin/activity']) {
    await page.goto(path)
    await expect(page.locator('#main h1').first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollHeight), path).toBeLessThanOrEqual(800)
  }
})

test('on a phone the whole window scrolls, as phones expect', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 })
  await page.goto('/design/patient/progress')
  await expect(page.locator('#main h1').first()).toBeVisible()
  await page.mouse.wheel(0, 1500)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
})
