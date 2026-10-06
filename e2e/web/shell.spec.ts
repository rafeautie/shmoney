import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../fixtures'

// /goals is left out: see the TRIAGE fixme in the privacy tests
const MAIN_ROUTES = [
  '/accounts',
  '/accounts?tab=transactions',
  '/budget',
  '/reports',
  '/reports/1',
  '/activity',
  '/chat?c=2'
]

test.describe('routing', () => {
  test("'/' redirects to accounts", async ({ app }) => {
    await app.open({ route: '/' })
    await expect(app.page).toHaveURL(/#\/accounts/)
    await expect(app.page.getByText('Net worth', { exact: true })).toBeVisible()
  })

  test('an unknown route shows the not-found screen with a way back', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/nowhere' })
    await expect(page.getByText('Page not found')).toBeVisible()
    await page.getByRole('button', { name: 'Go to Accounts' }).click()
    await expect(page).toHaveURL(/#\/accounts/)
    await expect(page.getByText('Page not found')).toBeHidden()
  })

  test('the sidebar marks the current page', async ({ app }) => {
    const { page } = app
    await app.open()
    const link = (name: string): Locator => page.getByRole('link', { name, exact: true })
    await expect(link('Accounts')).toHaveAttribute('aria-current', 'page')
    await expect(link('Budget')).not.toHaveAttribute('aria-current', 'page')

    await link('Budget').click()
    await expect(link('Budget')).toHaveAttribute('aria-current', 'page')
    await expect(link('Accounts')).not.toHaveAttribute('aria-current', 'page')

    // fuzzy items stay active on their detail pages
    await page.goto('/#/reports/1')
    await expect(link('Reports')).toHaveAttribute('aria-current', 'page')
    await link('Activity').click()
    await expect(link('Activity')).toHaveAttribute('aria-current', 'page')
    await expect(link('Reports')).not.toHaveAttribute('aria-current', 'page')
  })

  test('the window title follows the page', async ({ app }) => {
    const { page } = app
    await app.open()
    const titles: [string, string][] = [
      ['Accounts', 'Accounts · shmoney'],
      ['Budget', 'Budget · shmoney'],
      ['Reports', 'Reports · shmoney'],
      ['Activity', 'Activity · shmoney']
    ]
    for (const [name, title] of titles) {
      await page.getByRole('link', { name, exact: true }).click()
      await expect(page).toHaveTitle(title)
    }
    await page.goto('/#/chat')
    await expect(page).toHaveTitle('Chat · shmoney')
  })

  // app-chrome-host.tsx:9 PAGE_TITLES has no 'goals' entry, so the Goals page
  // shows the bare app name like an unknown page
  test.fixme('TRIAGE: the Goals page has no window title', async () => {})

  test('a main-process navigation push routes the page, and /settings opens Settings', async ({
    app
  }) => {
    const { page } = app
    await app.open()
    await app.bridge((b) => b.push('app:navigate', '/budget'))
    await expect(page).toHaveURL(/#\/budget/)
    await app.bridge((b) => b.push('app:navigate', '/settings'))
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page).toHaveURL(/settings=/)
  })
})

test.describe('sidebar', () => {
  const sidebarOpen = async (app: { sql: <T>(q: string) => Promise<T[]> }): Promise<boolean> => {
    const rows = await app.sql<{ value: string }>(
      "SELECT value FROM settings WHERE key = 'sidebarOpen'"
    )
    return rows.length ? JSON.parse(rows[0].value) : true
  }

  test('the toggle and Ctrl+B collapse and expand it, and the choice is stored', async ({
    app
  }) => {
    const { page } = app
    await app.open()
    const sidebar = page.locator('[data-slot="sidebar"][data-state]')
    await expect(sidebar).toHaveAttribute('data-state', 'expanded')

    await page.getByRole('button', { name: 'Toggle Sidebar' }).first().click()
    await expect(sidebar).toHaveAttribute('data-state', 'collapsed')
    await expect.poll(() => sidebarOpen(app)).toBe(false)

    await page.keyboard.press(`${app.mod}+b`)
    await expect(sidebar).toHaveAttribute('data-state', 'expanded')
    await expect.poll(() => sidebarOpen(app)).toBe(true)

    await page.keyboard.press(`${app.mod}+b`)
    await expect(sidebar).toHaveAttribute('data-state', 'collapsed')
    await expect.poll(() => sidebarOpen(app)).toBe(false)
  })
})

test.describe('command palette', () => {
  const palette = (page: Page): Locator => page.getByRole('dialog', { name: 'Command palette' })
  const searchBox = (page: Page): Locator =>
    page.getByPlaceholder('Search pages, actions, and transactions...')

  test('Ctrl+K opens and closes it', async ({ app }) => {
    const { page } = app
    await app.open()
    await page.keyboard.press(`${app.mod}+k`)
    await expect(palette(page)).toBeVisible()
    await expect(searchBox(page)).toBeFocused()
    await page.keyboard.press(`${app.mod}+k`)
    await expect(palette(page)).toBeHidden()
  })

  test('Escape closes it', async ({ app }) => {
    const { page } = app
    await app.open()
    await page.keyboard.press(`${app.mod}+k`)
    await expect(palette(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(palette(page)).toBeHidden()
  })

  test('does not open while focus is in a text input', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?tab=transactions' })
    const search = page.getByPlaceholder('Search transactions...')
    await search.click()
    await page.keyboard.press(`${app.mod}+k`)
    await expect(palette(page)).toBeHidden()
    await expect(search).toBeFocused()
  })

  test('typing filters the entries by label and keyword', async ({ app }) => {
    const { page } = app
    await app.open()
    await page.keyboard.press(`${app.mod}+k`)
    await expect(page.getByRole('option', { name: 'New transaction' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Budget' })).toBeVisible()

    // "csv" is only a keyword of Import
    await searchBox(page).fill('csv')
    await expect(page.getByRole('option', { name: 'Import' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'New transaction' })).toBeHidden()
    await expect(page.getByRole('option', { name: 'Budget' })).toBeHidden()

    await searchBox(page).fill('privacy')
    await expect(page.getByRole('option', { name: 'Hide amounts' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Import' })).toBeHidden()
  })

  test('Go to entries navigate', async ({ app }) => {
    const { page } = app
    await app.open()
    await page.keyboard.press(`${app.mod}+k`)
    await page.getByRole('option', { name: 'Budget' }).click()
    await expect(palette(page)).toBeHidden()
    await expect(page).toHaveURL(/#\/budget/)

    await page.keyboard.press(`${app.mod}+k`)
    await page.getByRole('option', { name: 'Activity' }).click()
    await expect(page).toHaveURL(/#\/activity/)

    await page.keyboard.press(`${app.mod}+k`)
    await page.getByRole('option', { name: 'All transactions' }).click()
    await expect(page).toHaveURL(/#\/accounts\?tab=transactions/)

    await page.keyboard.press(`${app.mod}+k`)
    await page.getByRole('option', { name: 'New chat' }).click()
    await expect(page).toHaveURL(/#\/chat/)
  })

  test('Enter picks the highlighted entry', async ({ app }) => {
    const { page } = app
    await app.open()
    await page.keyboard.press(`${app.mod}+k`)
    await searchBox(page).fill('reports')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/#\/reports/)
  })

  test('New transaction opens the create row', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/budget' })
    await page.keyboard.press(`${app.mod}+k`)
    await page.getByRole('option', { name: 'New transaction' }).click()
    await expect(page.getByPlaceholder('Add transaction')).toBeFocused()
  })

  test('Import opens the import dialog once the palette has closed', async ({ app }) => {
    const { page } = app
    await app.open()
    await page.keyboard.press(`${app.mod}+k`)
    await page.getByRole('option', { name: 'Import' }).click()
    await expect(page.getByRole('dialog', { name: 'Import transactions' })).toBeVisible()
    await expect(palette(page)).toBeHidden()
  })

  test('Hide amounts and Show amounts toggle privacy', async ({ app }) => {
    const { page } = app
    await app.open()
    await page.keyboard.press(`${app.mod}+k`)
    await page.getByRole('option', { name: 'Hide amounts' }).click()
    await expect(page.getByRole('button', { name: 'Show amounts' })).toBeVisible()

    await page.keyboard.press(`${app.mod}+k`)
    await page.getByRole('option', { name: 'Show amounts' }).click()
    await expect(page.getByRole('button', { name: 'Hide amounts' })).toBeVisible()
  })

  test('the theme action switches between light and dark', async ({ app }) => {
    const { page } = app
    await app.open({ theme: 'light' })
    const html = page.locator('html')
    await expect(html).not.toHaveClass(/dark/)
    await page.keyboard.press(`${app.mod}+k`)
    await page.getByRole('option', { name: 'Switch to dark theme' }).click()
    await expect(html).toHaveClass(/dark/)

    await page.keyboard.press(`${app.mod}+k`)
    await page.getByRole('option', { name: 'Switch to light theme' }).click()
    await expect(html).not.toHaveClass(/dark/)
  })

  test('searching reaches reports, accounts and settings sections', async ({ app }) => {
    const { page } = app
    await app.open()

    await page.keyboard.press(`${app.mod}+k`)
    await searchBox(page).fill('Check-in')
    await page.getByRole('option', { name: 'Monthly Check-in' }).click()
    await expect(page).toHaveURL(/#\/reports\/\d+/)

    await page.keyboard.press(`${app.mod}+k`)
    await searchBox(page).fill('Everyday')
    await page.getByRole('option', { name: 'Everyday Checking' }).click()
    await expect(page).toHaveURL(/#\/accounts\/\d+/)

    await page.keyboard.press(`${app.mod}+k`)
    await searchBox(page).fill('storage')
    await page.getByRole('option', { name: 'Storage', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
    await expect(page).toHaveURL(/settings=storage/)
  })

  test('transaction search lists matches and the show-all entry applies the search', async ({
    app
  }) => {
    const { page } = app
    await app.open({ route: '/budget' })
    await page.keyboard.press(`${app.mod}+k`)
    await searchBox(page).fill('whole foods')
    await expect(page.getByRole('option', { name: /whole foods/i }).nth(1)).toBeVisible()
    await page.getByRole('option', { name: /Show all transactions matching/ }).click()
    await expect(page).toHaveURL(/#\/accounts\?tab=transactions/)
    await expect(page.getByPlaceholder('Search transactions...')).toHaveValue('whole foods')
    await expect(page.getByRole('row', { name: /whole foods/i }).first()).toBeVisible()
  })
})
// Hidden figures keep their digits in the DOM (faded to nothing), so what a
// user can read is the text that no ancestor hides
const readableText = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const out: string[] = []
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim()
      if (!text) continue
      let hidden = false
      for (let el = node.parentElement; el && !hidden; el = el.parentElement) {
        const style = getComputedStyle(el)
        hidden =
          style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0
      }
      if (!hidden) out.push(text)
    }
    return out.join('\n')
  })

test.describe('privacy', () => {
  test('with amounts hidden no main page shows a currency figure', async ({ app }) => {
    const { page } = app
    await app.open()
    await page.getByRole('button', { name: 'Hide amounts' }).click()
    await expect(page.getByRole('button', { name: 'Show amounts' })).toBeVisible()

    for (const route of MAIN_ROUTES) {
      await page.evaluate((to) => (location.hash = to), route)
      await expect(page.locator('main main')).toBeVisible()
      await expect
        .poll(async () => (await page.locator('main main').innerText()).trim().length, {
          message: `${route} rendered`
        })
        .toBeGreaterThan(40)
      await expect
        .poll(() => readableText(page), { message: `readable text on ${route}` })
        .not.toMatch(/[$€£]\d/)
    }
  })

  // components/goals/goal-labels.ts:20,22 format the monthly pace with plain
  // formatAmount, so "Save $439.30/month" stays readable with amounts hidden
  test.fixme('TRIAGE: the Goals pace sentences ignore Hide amounts', async () => {})

  test('hidden figures render as dots and showing them restores the digits', async ({ app }) => {
    const { page } = app
    await app.open()
    await expect.poll(() => readableText(page)).toMatch(/\$\d/)
    await expect(page.locator('[data-private]').first()).not.toHaveClass(/private-hidden/)

    await page.getByRole('button', { name: 'Hide amounts' }).click()
    await expect.poll(() => readableText(page)).not.toMatch(/\$\d/)
    await expect(page.locator('[data-private]').first()).toHaveClass(/private-hidden/)

    await page.getByRole('button', { name: 'Show amounts' }).click()
    await expect.poll(() => readableText(page)).toMatch(/\$\d/)
  })
})

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('toggling Hide amounts leaves nothing animating', async ({ app }) => {
    const { page } = app
    await app.open()
    // the sidebar's scroll-fade edges are scroll-linked, so they always "run"
    const running = (): Promise<number> =>
      page.evaluate(
        () => document.getAnimations().filter((a) => a.timeline instanceof DocumentTimeline).length
      )
    await expect.poll(running).toBe(0)

    await page.getByRole('button', { name: 'Hide amounts' }).click()
    await expect(page.getByRole('button', { name: 'Show amounts' })).toBeVisible()
    await expect.poll(running, { timeout: 1000 }).toBe(0)
    await expect.poll(() => readableText(page)).not.toMatch(/\$\d/)

    await page.getByRole('button', { name: 'Show amounts' }).click()
    await expect.poll(running, { timeout: 1000 }).toBe(0)
    await expect.poll(() => readableText(page)).toMatch(/\$\d/)
  })
})
