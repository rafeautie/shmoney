import type { Locator, Page } from '@playwright/test'
import { expect, test, type App } from '../fixtures'

const ROUTE = '/accounts?tab=transactions'

// table columns: 1 select, 2 date, 3 account, 4 description, 5 category, 6 amount
const column = (page: Page, nth: number): Locator => page.locator(`tbody tr td:nth-child(${nth})`)
const rowCheckboxes = (page: Page): Locator => page.getByRole('checkbox', { name: 'Select row' })
const resetButton = (page: Page): Locator => page.getByRole('button', { name: 'Reset' })
const filteredTotal = (page: Page): Locator => page.getByText('Filtered total')
const moreButton = (page: Page): Locator => page.getByRole('button', { name: /^More/ })
const preset = (page: Page, name: string): Locator =>
  page.getByRole('button', { name, exact: true })
const savedButton = (page: Page): Locator =>
  page.getByRole('button', { name: 'Saved', exact: true })
const searchBox = (page: Page): Locator => page.getByPlaceholder('Search transactions...')
const selectBox = (page: Page, text: string): Locator =>
  page.getByRole('combobox').filter({ hasText: text })
const dateRange = (page: Page): Locator =>
  page.getByRole('combobox').filter({ hasText: /time|month|year|Custom/ })

async function openTransactions(app: App, route = ROUTE, dataset?: 'starter'): Promise<void> {
  await app.open({ route, dataset })
  await expect(rowCheckboxes(app.page).first()).toBeVisible()
}

// polls until every loaded row satisfies `test`; an empty or still-loading table fails
async function expectEveryRow(
  page: Page,
  nth: number,
  test: (text: string) => boolean
): Promise<void> {
  await expect
    .poll(async () => {
      const cells = (await column(page, nth).allTextContents()).map((text) => text.trim())
      return cells.length > 0 && cells.every(test)
    })
    .toBe(true)
}

const money = (text: string): number => Number(text.replace(/[^0-9.-]/g, ''))

async function pickOption(page: Page, trigger: Locator, option: string | RegExp): Promise<void> {
  await trigger.click()
  await page.getByRole('option', { name: option }).click()
}

test.describe('search', () => {
  test('filters rows after a debounce and restores them when cleared', async ({ app }) => {
    const { page } = app
    await openTransactions(app)
    await expect(resetButton(page)).toHaveCount(0)

    await searchBox(page).fill('chipotle')
    await expectEveryRow(page, 4, (text) => text.includes('CHIPOTLE'))
    await expect(resetButton(page)).toBeVisible()

    await searchBox(page).fill('')
    await expect
      .poll(async () =>
        (await column(page, 4).allTextContents()).some((t) => !t.includes('CHIPOTLE'))
      )
      .toBe(true)
    await expect(resetButton(page)).toHaveCount(0)
  })

  test('waits for typing to pause before it queries', async ({ app }) => {
    const { page } = app
    await openTransactions(app)
    await page.clock.pauseAt(new Date('2026-09-24T12:30:00-04:00'))

    await searchBox(page).fill('chipotle')
    await expect(searchBox(page)).toHaveValue('chipotle')
    // nothing fires while the debounce timer is held
    await expect(resetButton(page)).toHaveCount(0)
    expect((await column(page, 4).allTextContents()).some((t) => !t.includes('CHIPOTLE'))).toBe(
      true
    )

    await page.clock.runFor(400)
    await page.clock.resume()
    await expectEveryRow(page, 4, (text) => text.includes('CHIPOTLE'))
  })

  test('matches account and category names as well as descriptions', async ({ app }) => {
    const { page } = app
    await openTransactions(app)

    await searchBox(page).fill('brokerage')
    await expectEveryRow(page, 3, (text) => text === 'Individual Brokerage')

    await searchBox(page).fill('subscriptions')
    await expectEveryRow(page, 5, (text) => text.includes('Subscriptions'))
  })

  test('shows an empty state when nothing matches', async ({ app }) => {
    const { page } = app
    await openTransactions(app)
    await searchBox(page).fill('zzzzqqqq')
    await expect(page.getByText('No transactions match the current filters.')).toBeVisible()
    await expect(rowCheckboxes(page)).toHaveCount(0)
  })

  test('the palette intent seeds the search and is cleaned from the URL', async ({ app }) => {
    const { page } = app
    await app.open({ route: `${ROUTE}&q=coffee` })
    await expect(searchBox(page)).toHaveValue('coffee')
    await expect(resetButton(page)).toBeVisible()
    await expect(page).not.toHaveURL(/q=coffee/)
    await expect(page).toHaveURL(/tab=transactions/)
    await expectEveryRow(page, 4, (text) => /coffee/i.test(text))
  })
})

test.describe('date range', () => {
  test('presets narrow the rows to their window', async ({ app }) => {
    const { page } = app
    await openTransactions(app)
    await expect(dateRange(page)).toHaveText('All time')

    await pickOption(page, dateRange(page), 'Last year')
    await expect(dateRange(page)).toHaveText('Last year')
    await expectEveryRow(page, 2, (text) => text.endsWith('2025'))

    await pickOption(page, dateRange(page), 'This month')
    await expectEveryRow(page, 2, (text) => /^Sep \d+, 2026$/.test(text))

    await pickOption(page, dateRange(page), 'All time')
    await expect(resetButton(page)).toHaveCount(0)
    await expect
      .poll(async () =>
        (await column(page, 2).allTextContents()).some(
          (t) => t.includes('2026') && !t.startsWith('Sep')
        )
      )
      .toBe(true)
  })

  test('a custom range starts at the last 30 days and edits through the calendar', async ({
    app
  }) => {
    const { page } = app
    await openTransactions(app)
    await pickOption(page, dateRange(page), 'Custom range')
    await expect(dateRange(page)).toHaveText('Custom range')

    const range = page.getByRole('button', { name: 'Aug 25, 2026 – Sep 24, 2026' })
    await expect(range).toBeVisible()
    await expectEveryRow(page, 2, (text) => {
      const day = new Date(text).getTime()
      return day >= new Date('2026-08-25').getTime() && day <= new Date('2026-09-25').getTime()
    })

    // a click inside a complete range moves its end
    await range.click()
    await page.getByRole('button', { name: /September 10th, 2026/ }).click()
    await expect(page.getByRole('button', { name: 'Aug 25, 2026 – Sep 10, 2026' })).toBeVisible()
    await page.getByRole('button', { name: /September 12th, 2026/ }).click()
    await expect(page.getByRole('button', { name: 'Aug 25, 2026 – Sep 12, 2026' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expectEveryRow(page, 2, (text) => {
      const day = new Date(text).getTime()
      return day >= new Date('2026-08-25').getTime() && day <= new Date('2026-09-13').getTime()
    })
    await expect(column(page, 2).filter({ hasText: 'Sep 12, 2026' }).first()).toBeVisible()
    await expect(column(page, 2).filter({ hasText: 'Sep 13, 2026' })).toHaveCount(0)
  })

  test('a relative range outside the presets is labelled by what it is', async ({ app }) => {
    const { page } = app
    await openTransactions(app)
    await savedButton(page).click()
    await preset(page, 'Eating out, last 90 days').click()
    await expect(selectBox(page, 'Last 90 days')).toBeVisible()
    await expect(selectBox(page, 'All time')).toHaveCount(0)
  })
})

test.describe('accounts and categories', () => {
  test('the accounts multiselect scopes the table and labels the selection', async ({ app }) => {
    const { page } = app
    await openTransactions(app)
    const control = page.getByRole('button', { name: 'All accounts' })

    await control.click()
    await page.getByRole('option', { name: 'Rewards Visa' }).click()
    await page.getByRole('option', { name: 'Individual Brokerage' }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: '2 accounts' })).toBeVisible()
    await expectEveryRow(
      page,
      3,
      (text) => text === 'Rewards Visa' || text === 'Individual Brokerage'
    )

    await page.getByRole('button', { name: '2 accounts' }).click()
    await page.getByRole('option', { name: 'Individual Brokerage' }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Rewards Visa' })).toBeVisible()
    await expectEveryRow(page, 3, (text) => text === 'Rewards Visa')

    await page.getByRole('button', { name: 'Rewards Visa' }).click()
    await page.getByRole('option', { name: 'All accounts' }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'All accounts' })).toBeVisible()
    await expect(resetButton(page)).toHaveCount(0)
  })

  test('the accounts popover searches by name', async ({ app }) => {
    const { page } = app
    await openTransactions(app)
    await page.getByRole('button', { name: 'All accounts' }).click()
    await page.getByPlaceholder('Search accounts...').fill('savings')
    await expect(page.getByRole('option')).toHaveCount(1)
    await page.getByPlaceholder('Search accounts...').fill('nothing here')
    await expect(page.getByText('No accounts found.')).toBeVisible()
  })

  test('the categories multiselect toggles Uncategorized, single categories and whole groups', async ({
    app
  }) => {
    const { page } = app
    await openTransactions(app)
    const control = page.getByRole('button', { name: 'All categories' })

    await control.click()
    await page.getByRole('option', { name: 'Uncategorized' }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: '1 category' })).toBeVisible()
    // pending rows have no category yet, so they read as uncategorized too
    await expectEveryRow(page, 5, (text) => text === 'Uncategorized' || text === '—')

    await page.getByRole('button', { name: '1 category' }).click()
    await page.getByRole('option', { name: /Dining Out/ }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: '2 categories' })).toBeVisible()
    await expectEveryRow(
      page,
      5,
      (text) => text === 'Uncategorized' || text === '—' || text.includes('Dining Out')
    )

    // untoggling Uncategorized leaves only the category
    await page.getByRole('button', { name: '2 categories' }).click()
    await page.getByRole('option', { name: 'Uncategorized' }).click()
    await page.keyboard.press('Escape')
    await expectEveryRow(page, 5, (text) => text.includes('Dining Out'))

    await page.getByRole('button', { name: '1 category' }).click()
    await page.getByRole('option', { name: /All .*Wants/ }).click()
    await page.keyboard.press('Escape')
    // Wants holds five categories, plus Dining Out already picked
    await expect(page.getByRole('button', { name: '5 categories' })).toBeVisible()
    await expectEveryRow(page, 5, (text) =>
      ['Subscriptions', 'Shopping', 'Hobbies', 'Entertainment', 'Dining Out'].some((name) =>
        text.includes(name)
      )
    )

    await page.getByRole('button', { name: '5 categories' }).click()
    await page.getByRole('option', { name: /All .*Wants/ }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'All categories' })).toBeVisible()
    await expect(resetButton(page)).toHaveCount(0)
  })

  test('the direction select keeps income or expenses', async ({ app }) => {
    const { page } = app
    await openTransactions(app)
    const direction = selectBox(page, 'All directions')

    await pickOption(page, direction, 'Income only')
    await expectEveryRow(page, 6, (text) => money(text) > 0)
    await expect(resetButton(page)).toBeVisible()

    await pickOption(page, selectBox(page, 'Income only'), 'Expenses only')
    await expectEveryRow(page, 6, (text) => money(text) < 0)
  })
})

test.describe('more filters', () => {
  test('amount range bounds the absolute amount and counts in the badge', async ({ app }) => {
    const { page } = app
    await openTransactions(app)
    await expect(moreButton(page)).toHaveAccessibleName('More')

    await moreButton(page).click()
    await page.getByPlaceholder('Min').fill('1000')
    await page.getByPlaceholder('Min').press('Enter')
    await expect(moreButton(page)).toHaveAccessibleName('More 1')
    await expectEveryRow(page, 6, (text) => Math.abs(money(text)) >= 1000)

    await page.getByPlaceholder('Max').fill('2000')
    await page.getByPlaceholder('Max').press('Enter')
    // one filter, whatever the number of bounds
    await expect(moreButton(page)).toHaveAccessibleName('More 1')
    await expectEveryRow(
      page,
      6,
      (text) => Math.abs(money(text)) >= 1000 && Math.abs(money(text)) <= 2000
    )
    await expect(resetButton(page)).toBeVisible()
  })

  test('the pending and transfers switches hide those rows', async ({ app }) => {
    const { page } = app
    await openTransactions(app)
    await expect(page.getByText('Pending', { exact: true })).toHaveCount(2)
    await expect(column(page, 5).filter({ hasText: 'Transfers' }).first()).toBeVisible()

    await moreButton(page).click()
    const pending = page.getByRole('switch', { name: 'Include pending transactions' })
    const transfers = page.getByRole('switch', { name: 'Include transfers' })
    await expect(pending).toBeChecked()
    await expect(transfers).toBeChecked()

    await pending.click()
    await expect(page.getByText('Pending', { exact: true })).toHaveCount(0)
    await expect(moreButton(page)).toHaveAccessibleName('More 1')

    await transfers.click()
    await expect(moreButton(page)).toHaveAccessibleName('More 2')
    await expect(column(page, 5).filter({ hasText: 'Transfers' })).toHaveCount(0)
    await expectEveryRow(page, 5, (text) => !text.includes('Transfers'))

    await pending.click()
    await transfers.click()
    await expect(moreButton(page)).toHaveAccessibleName('More')
    await expect(resetButton(page)).toHaveCount(0)
  })
})

test.describe('reset', () => {
  test('appears only when the filters differ from the default and restores them', async ({
    app
  }) => {
    const { page } = app
    await openTransactions(app)
    await expect(resetButton(page)).toHaveCount(0)

    await searchBox(page).fill('chipotle')
    await pickOption(page, selectBox(page, 'All directions'), 'Expenses only')
    await pickOption(page, dateRange(page), 'Last year')
    await moreButton(page).click()
    await page.getByRole('switch', { name: 'Include transfers' }).click()
    await page.keyboard.press('Escape')
    await expect(resetButton(page)).toBeVisible()

    await resetButton(page).click()
    await expect(resetButton(page)).toHaveCount(0)
    await expect(searchBox(page)).toHaveValue('')
    await expect(dateRange(page)).toHaveText('All time')
    await expect(selectBox(page, 'All directions')).toBeVisible()
    await expect(moreButton(page)).toHaveAccessibleName('More')
    await expect(filteredTotal(page)).toHaveCount(0)
    await expect
      .poll(async () =>
        (await column(page, 4).allTextContents()).some((t) => !t.includes('CHIPOTLE'))
      )
      .toBe(true)
  })
})

test.describe('filtered total', () => {
  test('shows only with non-default filters and sums every matching row', async ({ app }) => {
    const { page } = app
    await openTransactions(app)
    await expect(filteredTotal(page)).toHaveCount(0)

    await pickOption(page, selectBox(page, 'All directions'), 'Expenses only')
    await expect(filteredTotal(page)).toBeVisible()

    const [{ total }] = await app.sql<{ total: number }>(
      'SELECT sum(amount) AS total FROM transactions WHERE amount < 0 AND deleted_at IS NULL'
    )
    const expected = (total / 1000).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    await expect(filteredTotal(page).locator('..')).toContainText(expected)

    await resetButton(page).click()
    await expect(filteredTotal(page)).toHaveCount(0)
  })

  test('hides when no row matches', async ({ app }) => {
    const { page } = app
    await openTransactions(app)
    await searchBox(page).fill('zzzzqqqq')
    await expect(page.getByText('No transactions match the current filters.')).toBeVisible()
    await expect(filteredTotal(page)).toHaveCount(0)
  })

  test('keeps one total per currency', async ({ app }) => {
    const { page } = app
    await openTransactions(app)
    await app.sql(
      "UPDATE accounts SET currency = 'EUR' WHERE name = 'High-Yield Savings' RETURNING id"
    )

    await pickOption(page, selectBox(page, 'All directions'), 'Income only')
    await expect(filteredTotal(page)).toBeVisible()
    const totals = filteredTotal(page).locator('xpath=following-sibling::div[1]/*')
    await expect(totals).toHaveCount(2)
    await expect(totals.filter({ hasText: '€' })).toHaveCount(1)
    await expect(totals.filter({ hasText: '$' })).toHaveCount(1)
  })
})

test.describe('saved filters', () => {
  test('starts empty on a fresh install', async ({ app }) => {
    const { page } = app
    await openTransactions(app, ROUTE, 'starter')
    await savedButton(page).click()
    await expect(
      page.getByText('No saved filters yet. Name the current filter below to save it.')
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  })

  test('lists the household presets and loads one with a tick on the active preset', async ({
    app
  }) => {
    const { page } = app
    await openTransactions(app)
    await savedButton(page).click()
    const big = preset(page, 'Big purchases')
    await expect(preset(page, 'Eating out, last 90 days')).toBeVisible()
    await expect(big.locator('svg')).toHaveCount(0)

    await big.click()
    await expect(preset(page, 'Big purchases')).toBeHidden()
    await expect(selectBox(page, 'Expenses only')).toBeVisible()
    await expect(moreButton(page)).toHaveAccessibleName('More 2')
    await expectEveryRow(page, 6, (text) => money(text) <= -150)
    await expect(resetButton(page)).toBeVisible()

    await savedButton(page).click()
    await expect(preset(page, 'Big purchases').locator('svg')).toHaveCount(1)
    await expect(preset(page, 'Eating out, last 90 days').locator('svg')).toHaveCount(0)

    // editing the filter drops the tick
    await page.keyboard.press('Escape')
    await expect(preset(page, 'Big purchases')).toBeHidden()
    await pickOption(page, selectBox(page, 'Expenses only'), 'Income only')
    await savedButton(page).click()
    await expect(preset(page, 'Big purchases').locator('svg')).toHaveCount(0)
  })

  test('saves the current filter, loads it back and overwrites it by name', async ({ app }) => {
    const { page } = app
    await openTransactions(app, ROUTE, 'starter')
    await searchBox(page).fill('starbucks')
    await pickOption(page, selectBox(page, 'All directions'), 'Expenses only')
    await expect(resetButton(page)).toBeVisible()

    await savedButton(page).click()
    const nameInput = page.getByPlaceholder('Save current filter as...')
    await nameInput.fill('Morning coffee')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(nameInput).toHaveValue('')
    await expect(preset(page, 'Morning coffee')).toBeVisible()
    const [stored] = await app.sql<{ name: string; filters: string }>(
      'SELECT name, filters FROM saved_filters'
    )
    expect(stored.name).toBe('Morning coffee')
    expect(JSON.parse(stored.filters)).toMatchObject({ search: 'starbucks', direction: 'expense' })
    await expect(preset(page, 'Morning coffee').locator('svg')).toHaveCount(1)

    await page.keyboard.press('Escape')
    await expect(nameInput).toBeHidden()
    await resetButton(page).click()
    await expect(searchBox(page)).toHaveValue('')
    await savedButton(page).click()
    await preset(page, 'Morning coffee').click()
    await expect(searchBox(page)).toHaveValue('starbucks')
    await expect(selectBox(page, 'Expenses only')).toBeVisible()
    await expectEveryRow(page, 4, (text) => text.includes('STARBUCKS'))

    // the same name, in any case, replaces the preset instead of adding a second
    await searchBox(page).fill('kroger')
    await expectEveryRow(page, 4, (text) => text.includes('KROGER'))
    await savedButton(page).click()
    await nameInput.fill('morning COFFEE')
    await expect(page.getByRole('button', { name: 'Overwrite' })).toBeVisible()
    await page.getByRole('button', { name: 'Overwrite' }).click()
    await expect
      .poll(async () => {
        const rows = await app.sql<{ filters: string }>('SELECT filters FROM saved_filters')
        return rows.length === 1 && JSON.parse(rows[0].filters).search
      })
      .toBe('kroger')
  })

  test('deleting a preset toasts an Undo that brings it back', async ({ app }) => {
    const { page } = app
    await openTransactions(app)
    await savedButton(page).click()
    await page.getByRole('button', { name: 'Delete saved filter Big purchases' }).click()

    await expect(preset(page, 'Big purchases')).toBeHidden()
    const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Deleted “Big purchases”' })
    await expect(toast).toBeVisible()
    await expect
      .poll(
        async () => (await app.sql('SELECT id FROM saved_filters WHERE deleted_at IS NULL')).length
      )
      .toBe(1)

    await toast.getByRole('button', { name: 'Undo' }).click()
    await expect(preset(page, 'Big purchases')).toBeVisible()
    await expect
      .poll(
        async () => (await app.sql('SELECT id FROM saved_filters WHERE deleted_at IS NULL')).length
      )
      .toBe(2)
  })
})

test.describe('drill-down filters from the URL', () => {
  test('seeds the filter bar on arrival', async ({ app }) => {
    const { page } = app
    const filters = {
      dateRange: { kind: 'all' },
      categoryIds: [23],
      direction: 'expense',
      includePending: true,
      includeTransfers: true
    }
    await app.open({ route: `${ROUTE}&filters=${encodeURIComponent(JSON.stringify(filters))}` })

    await expect(page.getByRole('button', { name: '1 category' })).toBeVisible()
    await expect(selectBox(page, 'Expenses only')).toBeVisible()
    await expect(resetButton(page)).toBeVisible()
    await expectEveryRow(page, 5, (text) => text.includes('Dining Out'))
    await expect(filteredTotal(page)).toBeVisible()

    // after arriving the bar is the source of truth, so edits behave as usual
    await resetButton(page).click()
    await expect(resetButton(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'All categories' })).toBeVisible()
  })

  for (const [name, filters] of [
    ['an unknown shape', { foo: 1 }],
    ['an invalid direction', { dateRange: { kind: 'all' }, direction: 'sideways' }]
  ] as const) {
    test(`ignores ${name} and opens unfiltered`, async ({ app }) => {
      const { page } = app
      await app.open({ route: `${ROUTE}&filters=${encodeURIComponent(JSON.stringify(filters))}` })
      await expect(page.getByRole('row').nth(1)).toBeVisible()
      await expect(resetButton(page)).toHaveCount(0)
      await expect(moreButton(page)).toHaveAccessibleName('More')
    })
  }
})
