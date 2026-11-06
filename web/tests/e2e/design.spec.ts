import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

/** Runs against the design gallery, which uses the same components and views as the app. */
const SCREENS = [
  '/design/patient/notifications', '/design/scheduler/schedule', '/design/scheduler/requests', '/design/scheduler/calendar', '/design/scheduler/calendar?tab=holidays', '/design/scheduler/calendar?tab=closures', '/design/scheduler/calendar?tab=timeoff', '/design/scheduler/calendar?outside', '/design/therapist/schedule', '/design/patient/schedule', '/design/patient', '/design/patient/book', '/design/patient/bookings', '/design/patient/exercises', '/design/patient/progress', '/design/patient/profile', '/design/components', '/design/landing', '/design/sign-in', '/design/therapist', '/design/therapist/patients', '/design/therapist/patients/p1', '/design/therapist/patients/p1/assign',
  '/design/therapist/exercises', '/design/therapist/progress', '/design/therapist/profile', '/design/admin/profile', '/design/admin', '/design/admin/accounts', '/design/admin/links', '/design/admin/catalogue', '/design/admin/activity',
]

for (const path of SCREENS) {
  test(`no accessibility violations on ${path}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([])
  })
}

for (const width of [768, 1024, 1440, 1920]) {
  test(`no sideways page scroll at ${width}`, async ({ page }) => {
    // One test walks every screen, which takes longer on a shared CI machine.
    test.setTimeout(180_000)
    await page.setViewportSize({ width, height: 900 })
    for (const path of SCREENS) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow, path).toBeLessThanOrEqual(0)
    }
  })
}

// A panel hides what overflows it, so the page itself can fit while a table is cut off. This checks each element instead.
test('nothing on a patient page runs past a phone\'s edge', async ({ page }) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 360, height: 760 })
  for (const path of ['/design/patient', '/design/patient/book', '/design/patient/bookings', '/design/patient/exercises', '/design/patient/progress', '/design/patient/profile']) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    const cut = await page.evaluate(() => [...document.querySelectorAll('main *')].filter((element) => {
      const box = element.getBoundingClientRect()
      return box.width > 0 && box.right > window.innerWidth + 1
    }).map((element) => element.tagName).slice(0, 5))
    expect(cut, path).toEqual([])
  }
})

test('on a phone, each session shows its range of motion and result', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 760 })
  await page.goto('/design/patient/progress')
  const sessions = page.getByRole('list', { name: 'Sessions' })
  await expect(sessions.getByRole('listitem').first()).toContainText('Range of motion')
  await expect(sessions.getByRole('listitem').first()).toContainText('Completed')
  await expect(page.getByRole('table', { name: 'Sessions' })).toBeHidden()
})

for (const [path, empty] of [
  ['/design/therapist', 'Invite your first patient'], ['/design/therapist/patients', 'No patients yet'], ['/design/therapist/patients/p1', 'No exercise assigned yet'], ['/design/therapist/progress', 'No sessions yet'],
]) {
  test(`${path} tells loading, failure and an empty list apart`, async ({ page }) => {
    const retry = page.getByRole('button', { name: 'Try again' })
    const nothing = page.getByRole('heading', { name: empty })
    await page.goto(`${path}?state=loading`)
    await expect(page.getByRole('status', { name: /^Loading/ }).first()).toBeVisible()
    await expect(retry).toHaveCount(0)
    await expect(nothing).toHaveCount(0)
    await page.goto(`${path}?state=error`)
    await expect(retry).toBeVisible()
    await expect(page.getByRole('status', { name: /^Loading/ })).toHaveCount(0)
    await expect(nothing).toHaveCount(0)
    await page.goto(`${path}?state=empty`)
    await expect(nothing).toBeVisible()
    await expect(retry).toHaveCount(0)
    await expect(page.getByRole('status', { name: /^Loading/ })).toHaveCount(0)
  })
}

test('a toast appears at the top right, below the top bar', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/design/admin/activity')
  await page.getByRole('button', { name: 'Load older activity' }).click()
  const toast = page.getByRole('status').filter({ hasText: 'Loaded older activity' })
  await expect(toast).toBeVisible()
  await page.waitForTimeout(400)
  const box = (await toast.boundingBox())!
  expect(box.x + box.width).toBeGreaterThan(1440 - 40)
  expect(box.x + box.width).toBeLessThanOrEqual(1440)
  expect(box.y).toBeGreaterThanOrEqual(56)
  expect(box.y).toBeLessThan(100)
})

test('the model person raises an arm as the sign-in form is completed', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/design/sign-in')
  const arm = page.locator('aside svg g[transform^="rotate"]').nth(2)
  const angle = async () => Math.abs(Number(/rotate\((-?[\d.]+)\)/.exec((await arm.getAttribute('transform'))!)![1]))
  await expect.poll(angle).toBeLessThan(25)
  await page.getByLabel('Email').fill('dana@example.test')
  await expect.poll(angle).toBeGreaterThan(55)
  await page.getByLabel('Password', { exact: true }).fill('a-password')
  await expect.poll(angle).toBeGreaterThan(105)
  await page.getByLabel('Password', { exact: true }).fill('')
  await expect.poll(angle).toBeLessThan(80)
})

test('with reduced motion the figure goes straight to its position', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/design/sign-in')
  await page.getByLabel('Email').fill('dana@example.test')
  await page.getByLabel('Password', { exact: true }).fill('a-password')
  await expect(page.locator('aside svg g[transform^="rotate"]').nth(2)).toHaveAttribute('transform', 'rotate(-116)')
})

test('a swipe that starts on the movement demo still scrolls the page', async ({ page }) => {
  await page.goto('/design/landing')
  await expect(page.getByRole('group', { name: 'A sample skeleton measuring elbow flexion' })).toHaveCSS('touch-action', 'pan-y')
})

test('charts answer the keyboard and the pointer, and offer a table', async ({ page }) => {
  await page.goto('/design/therapist/progress')
  const chart = page.getByRole('img', { name: /Range of motion chart/ }).first()
  const figure = page.locator('figure', { has: chart })
  const reading = figure.locator('figcaption [aria-live="polite"]')
  await chart.focus()
  await page.keyboard.press('ArrowRight')
  await expect(reading).toHaveText(/^.+: .+$/)
  const first = await reading.textContent()
  await page.keyboard.press('ArrowRight')
  await expect(reading).not.toHaveText(first!)
  await page.keyboard.press('Tab')
  await expect(reading).toHaveText('')
  const box = (await chart.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await expect(reading).toHaveText(/^.+: .+$/)
  await figure.getByText('Show as a table').click()
  await expect(figure.getByRole('table')).toBeVisible()
  await expect(figure.getByRole('row')).not.toHaveCount(1)
})

for (const [reducedMotion, drawn] of [['reduce', false], ['no-preference', true]] as const) {
  test(`a chart line ${drawn ? 'draws in' : 'appears at once'} with reduced motion set to ${reducedMotion}`, async ({ page }) => {
    // Every length the line ever has, from the first paint, so a short animation cannot slip past.
    await page.addInitScript(() => {
      const seen = new Set<string>()
      Object.assign(window, { lineLengths: seen })
      new MutationObserver((changes) => { for (const change of changes) if (change.attributeName === 'stroke-dasharray') seen.add((change.target as Element).getAttribute('stroke-dasharray') ?? '') })
        .observe(document, { subtree: true, attributes: true, attributeFilter: ['stroke-dasharray'] })
    })
    await page.emulateMedia({ reducedMotion })
    // A page opened directly appears complete. The line draws when arriving from another page.
    await page.goto('/design/therapist')
    await page.getByRole('link', { name: 'Progress' }).first().click()
    await expect(page.getByRole('img', { name: /Range of motion chart/ }).first()).toBeVisible()
    await page.waitForTimeout(1200)
    const lengths = await page.evaluate(() => [...(window as unknown as { lineLengths: Set<string> }).lineLengths].filter((value) => value !== '3 4'))
    expect(lengths.some((value) => value !== '1 1')).toBe(drawn)
  })
}

test('each patient row is one link and one menu in the tab order, with no empty stops', async ({ page }) => {
  await page.goto('/design/therapist/patients')
  await page.getByRole('link', { name: 'Open Ana Dela Cruz' }).focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Actions for Ana Dela Cruz' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Open Grace Aquino' })).toBeFocused()
})

test.describe('the patient actions menu', () => {
  for (const key of ['Enter', 'Space', 'ArrowDown']) {
    test(`opens with ${key} and stays open`, async ({ page }) => {
      await page.goto('/design/therapist/patients')
      await page.getByRole('button', { name: 'Actions for Ana Dela Cruz' }).focus()
      await page.keyboard.press(key)
      await expect(page.getByRole('menuitem', { name: 'Revoke access' })).toBeFocused()
    })
  }
})

test('a dialog says what it is for, and returns focus when it closes', async ({ page }) => {
  await page.goto('/design/therapist/patients')
  const invite = page.getByRole('button', { name: 'Invite patient' }).first()
  await invite.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toHaveAccessibleDescription(/.+/)
  await page.keyboard.press('Escape')
  await expect(invite).toBeFocused()
})

test('a keyboard user gets the same card emphasis as a pointer user', async ({ page }) => {
  await page.goto('/design/therapist')
  const card = page.getByRole('link', { name: 'Patients: 18' })
  await card.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expect(page.locator('[data-active]').first()).toBeVisible()
})

test('the range arc works by keyboard, with the same limits as dragging', async ({ page }) => {
  await page.goto('/design/therapist/patients/p1/assign')
  const target = page.getByRole('slider', { name: 'Target angle' })
  await target.focus()
  await page.keyboard.press('ArrowRight')
  await expect(target).toHaveAttribute('aria-valuenow', '95')
  await page.keyboard.press('Home')
  await expect(target).toHaveAttribute('aria-valuenow', '35')
  await page.keyboard.press('End')
  await expect(target).toHaveAttribute('aria-valuenow', '180')
})

test('dragging the range arc snaps to 5 degrees', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/design/therapist/patients/p1/assign')
  const target = page.getByRole('slider', { name: 'Target angle' })
  await target.scrollIntoViewIfNeeded()
  const box = (await target.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 40, { steps: 6 })
  await page.mouse.up()
  const value = Number(await target.getAttribute('aria-valuenow'))
  expect(value).toBeGreaterThan(90)
  expect(value % 5).toBe(0)
})

test('reduced motion keeps cards still and shows final values at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/design/therapist/patients')
  const card = page.locator('a[aria-label="Open Ana Dela Cruz"]')
  await card.hover()
  await page.waitForTimeout(400)
  const moved = await card.evaluate((element) => getComputedStyle(element.parentElement!).transform)
  expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(moved)
})

test('switching languages updates the page and is remembered', async ({ page }) => {
  await page.goto('/design/therapist/patients')
  await page.getByRole('button', { name: 'Filipino' }).click()
  await expect(page.getByRole('heading', { name: 'Mga pasyente' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'fil')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Mga pasyente' })).toBeVisible()
})

test('a toast lasts five seconds and can be closed', async ({ page }) => {
  await page.goto('/design/components')
  await page.getByRole('button', { name: 'Success toast' }).click()
  const toast = page.getByRole('status').filter({ hasText: 'Prescription published' })
  await expect(toast).toBeVisible()
  await page.waitForTimeout(4400)
  await expect(toast).toBeVisible()
  await expect(toast).toHaveCount(0, { timeout: 1500 })
  await page.getByRole('button', { name: 'Success toast' }).click()
  await page.getByRole('status').filter({ hasText: 'Prescription published' }).getByRole('button', { name: 'Close' }).click()
  await expect(page.getByText('Prescription published')).toHaveCount(0)
})

test('opening a record carries the avatar across as a shared transition', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/design/therapist/patients')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(500)
  // Sample the avatar every frame while the page changes.
  await page.evaluate(() => {
    const samples: Array<{ x: number; size: number }> = []
    Object.assign(window, { samples })
    const tick = () => {
      const avatar = document.querySelector<HTMLElement>('[data-initials="AD"]')?.parentElement
      const box = avatar?.getBoundingClientRect()
      if (box) samples.push({ x: Math.round(box.x), size: Math.round(box.width) })
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await page.getByRole('link', { name: 'Open Ana Dela Cruz' }).click()
  await expect(page.getByRole('heading', { name: 'Ana Dela Cruz', level: 1 })).toBeVisible()
  await expect(page).toHaveURL(/patients\/p1$/)
  await page.waitForTimeout(900)
  const sizes = await page.evaluate(() => (window as unknown as { samples: Array<{ size: number }> }).samples.map((sample) => sample.size))
  const start = sizes[0]!
  const end = sizes.at(-1)!
  expect([start, end]).toEqual([32, 72])
  // Sizes strictly between the two ends can only come from a shared animation, not from swapping pages.
  expect(sizes.filter((size) => size > start + 2 && size < end - 2).length).toBeGreaterThan(3)
})

test('cards stay smooth on a 50-card page', async ({ page }) => {
  test.skip(!process.env.MEASURE_MOTION, 'Machine dependent, so measured on demand rather than in CI')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/design/therapist/patients?many=1')
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => {
    const frames: number[] = []
    let last = performance.now()
    const tick = (now: number) => { frames.push(now - last); last = now; requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    Object.assign(window, { frames })
  })
  for (let pass = 0; pass < 6; pass += 1) {
    for (let x = 130; x < 1400; x += 40) {
      await page.mouse.move(x, 300 + pass * 80)
      await page.waitForTimeout(12)
    }
  }
  const frames = await page.evaluate(() => (window as unknown as { frames: number[] }).frames.slice(2).sort((a, b) => a - b))
  const at = (share: number) => frames[Math.floor(frames.length * share)] ?? 0
  const average = frames.reduce((sum, value) => sum + value, 0) / frames.length
  console.log(`cards=${await page.locator('[data-active], a[aria-label^="Open"]').count()} frames=${frames.length} fps=${(1000 / average).toFixed(1)} p95=${at(0.95).toFixed(1)}ms p99=${at(0.99).toFixed(1)}ms`)
  expect(1000 / average).toBeGreaterThan(55)
})

test('an account opens by keyboard alone', async ({ page }) => {
  await page.goto('/design/admin/accounts')
  await page.getByRole('main').getByRole('button', { name: /Dana Reyes/ }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('complementary', { name: 'Details for Dana Reyes' })).toBeVisible()
})

test.describe('public pages', () => {
  test('the landing page and sign-in fit a phone', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 })
    for (const path of ['/design/landing', '/design/sign-in']) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow, path).toBeLessThanOrEqual(0)
    }
  })

  test('the demo plays by itself and counts a repetition', async ({ page }) => {
    await page.goto('/design/landing')
    await expect(page.getByText(/^[1-9] of 10$/)).toBeVisible({ timeout: 12_000 })
  })

  test('the demo stops playing once someone takes the arm', async ({ page }) => {
    await page.goto('/design/landing')
    const arm = page.getByRole('slider', { name: 'Forearm angle' })
    await arm.focus()
    await page.keyboard.press('ArrowUp')
    const held = await arm.getAttribute('aria-valuenow')
    await page.waitForTimeout(800)
    await expect(arm).toHaveAttribute('aria-valuenow', held!)
    await expect(page.getByText('Sample movement, not patient data.')).toBeVisible()
  })

  test('the demo works by keyboard', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/design/landing')
    const arm = page.getByRole('slider', { name: 'Forearm angle' })
    await arm.focus()
    await page.keyboard.press('ArrowUp')
    await expect(arm).toHaveAttribute('aria-valuenow', '95')
    await page.keyboard.press('ArrowDown')
    await expect(arm).toHaveAttribute('aria-valuenow', '90')
  })

  test('reduced motion keeps the demo still until someone moves it', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/design/landing')
    await expect(page.getByText('90°', { exact: true })).toBeVisible()
    await page.waitForTimeout(600)
    await expect(page.getByText('90°', { exact: true })).toBeVisible()
  })

  test('sign-in warns about Caps Lock', async ({ page }) => {
    await page.goto('/design/sign-in')
    await page.getByLabel('Password', { exact: true }).focus()
    await page.evaluate(() => {
      const event = new KeyboardEvent('keydown', { key: 'A', bubbles: true, modifierCapsLock: true })
      document.activeElement?.dispatchEvent(event)
    })
    await expect(page.getByText('Caps Lock is on.')).toBeVisible()
  })
})
