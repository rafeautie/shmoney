import type { Locator, Page } from '@playwright/test'
import { expect, test, type App, exactly } from '../fixtures'

const card = (page: Page, title: string): Locator =>
  page
    .locator('[data-slot=card]')
    .filter({ has: page.getByRole('heading', { name: title, level: 3, exact: true }) })

/** the labelled select inside the widget editor */
const field = (dialog: Locator, label: string): Locator =>
  dialog
    .locator('div.space-y-2')
    .filter({ has: dialog.page().getByText(exactly(label)) })
    .getByRole('combobox')

/** a select trigger by the value it currently shows (stable when the same control repeats) */
const combo = (page: Page, shown: string): Locator =>
  page.getByRole('combobox').filter({ hasText: shown })

async function pick(trigger: Locator, option: string): Promise<void> {
  const page = trigger.page()
  await trigger.click()
  await page.getByRole('option', { name: exactly(option) }).click()
  await expect(page.getByRole('listbox')).toHaveCount(0)
}

async function blankReport({ page }: App): Promise<void> {
  await page.getByRole('button', { name: 'New Report' }).click()
  await page.getByRole('menuitem', { name: 'Blank Report' }).click()
  await expect(page.getByText('This Report Is Empty')).toBeVisible()
}

async function openAddWidget(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Add Widget' }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Add Widget' })).toBeVisible()
  return dialog
}

interface StoredWidget {
  title: string
  type: string
  config: {
    query: Record<string, unknown>
    filters: Record<string, unknown>
    display?: Record<string, unknown>
  }
}

async function storedWidgets(app: App, reportId: number): Promise<StoredWidget[]> {
  const rows = await app.sql<{ title: string; type: string; config: string }>(
    `SELECT title, type, config FROM report_widgets WHERE report_id = ${reportId} ORDER BY id`
  )
  return rows.map((r) => ({ ...r, config: JSON.parse(r.config) }))
}

test.describe('report filter bar', () => {
  test('changes persist across navigation and Reset restores the defaults', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/reports/1' })
    await expect(page.getByRole('heading', { name: 'Spending Overview', level: 2 })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reset' })).toHaveCount(0)

    await pick(combo(page, 'All Directions'), 'Expenses Only')
    await expect(page.getByRole('button', { name: 'Reset' })).toBeVisible()
    await expect
      .poll(async () => {
        const [row] = await app.sql<{ filters: string }>('SELECT filters FROM reports WHERE id = 1')
        return JSON.parse(row.filters).direction
      })
      .toBe('expense')

    await page.getByRole('link', { name: 'Reports', exact: true }).click()
    await page
      .locator('[data-slot=card]')
      .filter({ hasText: 'Spending Overview' })
      .filter({ has: page.getByRole('button', { name: 'Report actions' }) })
      .click()
    await expect(page).toHaveURL(/#\/reports\/1$/)
    await expect(combo(page, 'Expenses Only')).toBeVisible()

    await page.getByRole('button', { name: 'Reset' }).click()
    await expect(combo(page, 'All Directions')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reset' })).toHaveCount(0)
    await expect
      .poll(async () => {
        const [row] = await app.sql<{ filters: string }>('SELECT filters FROM reports WHERE id = 1')
        return JSON.parse(row.filters).direction
      })
      .toBe('all')
  })

  test('a report filter re-queries the widgets that inherit it', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/reports/1' })
    const income = card(page, 'Income')
    const before = await income.innerText()
    await expect(income).toContainText(/\$[\d,]+\.\d\d/)

    await pick(combo(page, 'Last 12 Months'), 'This Month')
    await expect(income).not.toHaveText(before)
    await expect(income).toContainText(/\$[\d,]+\.\d\d/)
  })
})

test.describe('widget editor', () => {
  test('adds a stat card and shows a live preview that follows the draft', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/reports' })
    await blankReport(app)
    const dialog = await openAddWidget(page)

    await pick(field(dialog, 'Widget Type'), 'Stat Card')
    await dialog.getByLabel('Title').fill('Total spend')
    const preview = dialog.locator('[data-slot=card]')
    await expect(preview.getByRole('heading', { name: 'Total spend' })).toBeVisible()
    await expect(preview).toContainText(/\$[\d,]+\.\d\d/)
    const expenses = await preview.innerText()

    await pick(field(dialog, 'Measure'), 'Income')
    await expect(preview).not.toHaveText(expenses)
    await pick(field(dialog, 'Measure'), 'Transaction Count')
    await expect(preview).not.toContainText('$')

    await pick(field(dialog, 'Measure'), 'Expenses')
    await dialog.getByRole('button', { name: 'Add Widget' }).click()
    await expect(dialog).toBeHidden()

    await expect(card(page, 'Total spend')).toContainText(/\$[\d,]+\.\d\d/)
    const [widget] = await storedWidgets(app, 4)
    expect(widget).toMatchObject({ title: 'Total spend', type: 'stat' })
    expect(widget.config.query).toMatchObject({ measure: 'expense', groupBy: 'none' })
    // the report is no longer empty, so the empty state is gone
    await expect(page.getByText('This Report Is Empty')).toBeHidden()
  })

  test('a stat card ignores a group by the draft had before the type changed', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/reports' })
    await blankReport(app)
    const dialog = await openAddWidget(page)

    await pick(field(dialog, 'Group By'), 'Account')
    await pick(field(dialog, 'Widget Type'), 'Stat Card')
    await expect(field(dialog, 'Group By')).toHaveText('None')
    await dialog.getByRole('button', { name: 'Add Widget' }).click()
    await expect(dialog).toBeHidden()
    const [widget] = await storedWidgets(app, 4)
    expect(widget.config.query.groupBy).toBe('none')
  })

  test('adds a bar chart grouped by account, with the stacked option', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/reports' })
    await blankReport(app)
    const dialog = await openAddWidget(page)

    await expect(dialog.getByText('Stacked')).toHaveCount(0)
    await pick(field(dialog, 'Group By'), 'Account')
    await expect(dialog.getByText('Stacked')).toBeVisible()
    await dialog.getByRole('switch', { name: 'Stacked' }).click()
    await dialog.getByLabel('Title').fill('Spend by account')
    await dialog.getByRole('button', { name: 'Add Widget' }).click()
    await expect(dialog).toBeHidden()

    const bar = card(page, 'Spend by account')
    await expect(bar.locator('.recharts-surface')).toBeVisible()
    const [widget] = await storedWidgets(app, 4)
    expect(widget).toMatchObject({ title: 'Spend by account', type: 'bar' })
    expect(widget.config.query).toMatchObject({ groupBy: 'account', timeGrain: 'month' })
    expect(widget.config.display).toMatchObject({ stacked: true })
  })

  test('a line chart has no "No Time Axis" grain and keeps the chosen one', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/reports' })
    await blankReport(app)
    const dialog = await openAddWidget(page)

    // a bar chart can drop the time axis
    await field(dialog, 'Time Grain').click()
    await expect(page.getByRole('option', { name: 'No Time Axis' })).toBeVisible()
    await page.getByRole('option', { name: 'No Time Axis' }).click()
    await expect(page.getByRole('listbox')).toHaveCount(0)

    // switching to a line chart can't keep it: the draft normalizes to monthly
    await pick(field(dialog, 'Widget Type'), 'Line Chart')
    await expect(field(dialog, 'Time Grain')).toHaveText('Monthly')
    await field(dialog, 'Time Grain').click()
    await expect(page.getByRole('option', { name: 'Quarterly' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'No Time Axis' })).toHaveCount(0)
    await page.getByRole('option', { name: 'Quarterly', exact: true }).click()
    await expect(page.getByRole('listbox')).toHaveCount(0)

    await dialog.getByLabel('Title').fill('Quarterly spend')
    await dialog.getByRole('button', { name: 'Add Widget' }).click()
    await expect(dialog).toBeHidden()
    await expect(card(page, 'Quarterly spend').locator('.recharts-surface')).toBeVisible()
    const [widget] = await storedWidgets(app, 4)
    expect(widget).toMatchObject({ type: 'line' })
    expect(widget.config.query.timeGrain).toBe('quarter')
  })

  test('a pie chart has no time grain and defaults its group to category', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/reports' })
    await blankReport(app)
    const dialog = await openAddWidget(page)

    await expect(field(dialog, 'Time Grain')).toBeVisible()
    await expect(field(dialog, 'Group By')).toHaveText('None')
    await pick(field(dialog, 'Widget Type'), 'Pie Chart')
    await expect(dialog.getByText('Time Grain', { exact: true })).toHaveCount(0)
    await expect(field(dialog, 'Group By')).toHaveText('Category')
    await expect(dialog.getByText('Top N Groups')).toBeVisible()
    await expect(dialog.getByText('Donut')).toBeVisible()

    await dialog.getByLabel('Title').fill('Where it goes')
    await dialog.getByRole('button', { name: 'Add Widget' }).click()
    await expect(dialog).toBeHidden()
    await expect(card(page, 'Where it goes').locator('.recharts-surface')).toBeVisible()
    const [widget] = await storedWidgets(app, 4)
    expect(widget.type).toBe('pie')
    expect(widget.config.query).toMatchObject({ groupBy: 'category', timeGrain: 'none' })
  })

  test('adds a summary table limited to the top N groups', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/reports' })
    await blankReport(app)
    const dialog = await openAddWidget(page)

    await pick(field(dialog, 'Widget Type'), 'Summary Table')
    const preview = dialog.locator('[data-slot=card]')
    await expect(preview.getByRole('row').nth(3)).toBeVisible()
    const limit = dialog.getByPlaceholder('All')
    await limit.fill('3')
    await limit.blur()
    // header, three groups and the rolled-up remainder
    await expect(preview.getByRole('row')).toHaveCount(5)
    await expect(preview.getByRole('row').last()).toContainText('Other')
    await dialog.getByLabel('Title').fill('Top three')
    await dialog.getByRole('button', { name: 'Add Widget' }).click()
    await expect(dialog).toBeHidden()

    await expect(card(page, 'Top three').getByRole('row')).toHaveCount(5)
    const [widget] = await storedWidgets(app, 4)
    expect(widget.type).toBe('summaryTable')
    expect(widget.config.query).toMatchObject({ groupBy: 'category', limit: 3 })
  })

  test('adds a transactions table without the aggregate controls', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/reports' })
    await blankReport(app)
    const dialog = await openAddWidget(page)

    await pick(field(dialog, 'Widget Type'), 'Transactions Table')
    await expect(dialog.getByText('Measure', { exact: true })).toHaveCount(0)
    await expect(dialog.getByText('Group By')).toHaveCount(0)
    await dialog.getByLabel('Title').fill('Everything')
    await dialog.getByRole('button', { name: 'Add Widget' }).click()
    await expect(dialog).toBeHidden()

    const table = card(page, 'Everything')
    await expect(table.getByRole('row').nth(1)).toBeVisible()
    expect((await storedWidgets(app, 4))[0].type).toBe('transactions')
  })

  test('adds a budget widget with a chosen visualization', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/reports' })
    await blankReport(app)
    const dialog = await openAddWidget(page)

    await pick(field(dialog, 'Widget Type'), 'Budget')
    await expect(dialog.getByText('Visualization')).toBeVisible()
    await expect(dialog.getByText('Measure', { exact: true })).toHaveCount(0)
    await pick(field(dialog, 'Visualization'), 'Allocation Donut')
    await expect(dialog.getByText('Legend')).toBeVisible()
    await dialog.getByLabel('Title').fill('Envelopes')
    await dialog.getByRole('button', { name: 'Add Widget' }).click()
    await expect(dialog).toBeHidden()

    await expect(card(page, 'Envelopes').locator('.recharts-surface').first()).toBeVisible()
    const [widget] = await storedWidgets(app, 4)
    expect(widget.type).toBe('budget')
    expect(widget.config.display).toMatchObject({ budgetView: 'donut' })
    expect(widget.config.query).toMatchObject({ groupBy: 'none', timeGrain: 'none' })
  })

  test('adds a goals widget; the report filters do not apply to it', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/reports' })
    await blankReport(app)
    const dialog = await openAddWidget(page)

    await pick(field(dialog, 'Widget Type'), 'Savings goals')
    await expect(dialog.getByText('Goal View')).toBeVisible()
    await expect(dialog.getByText(/report filter bar doesn't apply here/)).toBeVisible()
    await expect(dialog.getByText('Date Range')).toHaveCount(0)
    await dialog.getByLabel('Title').fill('My goals')
    await dialog.getByRole('button', { name: 'Add Widget' }).click()
    await expect(dialog).toBeHidden()

    const goals = await app.sql<{ name: string }>(
      'SELECT name FROM savings_goals WHERE archived_at IS NULL'
    )
    await expect(card(page, 'My goals')).toContainText(goals[0].name)
    expect((await storedWidgets(app, 4))[0].type).toBe('goals')
  })

  test('a goal source hides the measure and group by controls', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/reports' })
    await blankReport(app)
    const dialog = await openAddWidget(page)

    await expect(dialog.getByText('Measure', { exact: true })).toBeVisible()
    await pick(field(dialog, 'Source'), 'Savings goals')
    await expect(dialog.getByText('Measure', { exact: true })).toHaveCount(0)
    await expect(dialog.getByText('Group By')).toHaveCount(0)
    await expect(dialog.getByText('Goals', { exact: true })).toBeVisible()
    await expect(dialog.getByText('Accounts')).toHaveCount(0)

    // a type that can't read goals pins itself back to transactions
    await pick(field(dialog, 'Widget Type'), 'Radar Chart')
    await expect(dialog.getByText('Source', { exact: true })).toHaveCount(0)
    await expect(dialog.getByText('Measure', { exact: true })).toBeVisible()
  })

  test('a blank title saves as "Untitled widget"', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/reports' })
    await blankReport(app)
    const dialog = await openAddWidget(page)

    await dialog.getByLabel('Title').fill('   ')
    await dialog.getByRole('button', { name: 'Add Widget' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('heading', { name: 'Untitled widget', level: 3 })).toBeVisible()
    expect((await storedWidgets(app, 4))[0].title).toBe('Untitled widget')
  })

  test('Cancel discards the draft', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/reports' })
    await blankReport(app)
    const dialog = await openAddWidget(page)

    await dialog.getByLabel('Title').fill('Never saved')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText('This Report Is Empty')).toBeVisible()
    expect(await storedWidgets(app, 4)).toEqual([])
  })

  test('edits an existing widget in place', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/reports/2' })
    await card(page, 'Top categories').getByRole('button', { name: 'Widget actions' }).click()
    await page.getByRole('menuitem', { name: 'Edit' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Edit Widget' })).toBeVisible()
    await expect(dialog.getByLabel('Title')).toHaveValue('Top categories')
    await expect(field(dialog, 'Widget Type')).toHaveText('Summary Table')
    await dialog.getByLabel('Title').fill('Biggest categories')
    await pick(field(dialog, 'Measure'), 'Transaction Count')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dialog).toBeHidden()

    await expect(card(page, 'Biggest categories')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Top categories' })).toHaveCount(0)
    const widgets = await storedWidgets(app, 2)
    expect(widgets).toHaveLength(4)
    const edited = widgets.find((w) => w.title === 'Biggest categories')!
    expect(edited.type).toBe('summaryTable')
    expect(edited.config.query).toMatchObject({ measure: 'count', limit: 8 })
  })

  test('deleting a widget asks first, and Cancel keeps it', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/reports/2' })
    const target = card(page, 'Net by month')
    const dialog = page.getByRole('dialog')

    await target.getByRole('button', { name: 'Widget actions' }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await expect(dialog).toContainText('Delete “Net by month”?')
    await dialog.getByRole('button', { name: /Cancel/ }).click()
    await expect(target).toBeVisible()
    expect(await storedWidgets(app, 2)).toHaveLength(4)

    await target.getByRole('button', { name: 'Widget actions' }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await dialog.getByRole('button', { name: /^Delete/ }).click()
    await expect(page.getByRole('heading', { name: 'Net by month' })).toHaveCount(0)
    const titles = (await storedWidgets(app, 2)).map((w) => w.title)
    expect(titles).not.toContain('Net by month')
    expect(titles).toHaveLength(3)
  })

  test('the widget menu works without entering arrange mode', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/reports/2' })
    const target = card(page, 'Net by month')
    await expect(page.getByRole('button', { name: 'Arrange', exact: true })).toBeVisible()
    await target.getByRole('button', { name: 'Widget actions' }).click()
    await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Arrange', exact: true }).click()
    await expect(target.getByRole('button', { name: 'Widget actions' })).toBeVisible()
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(page.getByRole('button', { name: 'Arrange', exact: true })).toBeVisible()
  })
})

test.describe('widget states', () => {
  test('a widget whose filters match nothing says so', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/reports' })
    await blankReport(app)
    const dialog = await openAddWidget(page)

    await pick(field(dialog, 'Widget Type'), 'Summary Table')
    await dialog.getByRole('checkbox', { name: 'Description contains any of' }).click()
    await dialog.getByPlaceholder('add a phrase').fill('zzz no such merchant')
    await dialog.getByPlaceholder('add a phrase').press('Enter')
    await expect(dialog.locator('[data-slot=card]')).toContainText(
      'No transactions match these filters.'
    )
    await dialog.getByLabel('Title').fill('Nothing here')
    await dialog.getByRole('button', { name: 'Add Widget' }).click()
    await expect(dialog).toBeHidden()
    await expect(card(page, 'Nothing here')).toContainText('No transactions match these filters.')
  })

  test('a stored config that no longer parses shows the incompatible-version note', async ({
    app
  }) => {
    const { page } = app
    await app.open({ route: '/accounts' })
    // the API validates configs on write, so the stale one goes in underneath it
    await app.sql(`UPDATE report_widgets SET config = '{"legacy":true}' WHERE id = 1`)
    await page.evaluate(() => {
      window.location.hash = '#/reports/1'
    })
    await expect(
      card(page, 'Income').getByText(/configuration is from an incompatible version/)
    ).toBeVisible()
    // the rest of the report still renders
    await expect(card(page, 'Expenses')).toContainText(/\$[\d,]+\.\d\d/)

    // editing it offers a fresh config
    await card(page, 'Income').getByRole('button', { name: 'Widget actions' }).click()
    await page.getByRole('menuitem', { name: 'Edit' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(card(page, 'Income')).not.toContainText('incompatible version')
  })

  test('the widget error card offers a retry', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts' })
    await page.evaluate(() => {
      const reports = window.api.reports
      const real = reports.runQuery
      ;(window as unknown as { restore: () => void }).restore = () => {
        reports.runQuery = real
      }
      reports.runQuery = () => Promise.reject(new Error('query exploded'))
    })
    await page.evaluate(() => {
      window.location.hash = '#/reports/2'
    })
    const target = card(page, 'Top categories')
    // queries retry with backoff before giving up; skip the waits
    await expect(async () => {
      await page.clock.fastForward(5000)
      await expect(target.getByText('This Widget Could Not Load')).toBeVisible({ timeout: 500 })
    }).toPass()
    await expect(target.getByText(/query exploded/)).toBeVisible()

    await page.evaluate(() => (window as unknown as { restore: () => void }).restore())
    await target.getByRole('button', { name: 'Try Again' }).click()
    await expect(target.getByRole('row').nth(1)).toBeVisible()
  })

  test('a failing widget query shows its error in the card only, with no toast', async ({
    app
  }) => {
    const { page } = app
    await app.open({ route: '/accounts' })
    await page.evaluate(() => {
      window.api.reports.runQuery = () => Promise.reject(new Error('query exploded'))
    })
    await page.evaluate(() => {
      window.location.hash = '#/reports/2'
    })
    const target = card(page, 'Top categories')
    await expect(async () => {
      await page.clock.fastForward(5000)
      await expect(target.getByText('This Widget Could Not Load')).toBeVisible({ timeout: 500 })
    }).toPass()
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
  })
})

test.describe('drill down', () => {
  async function topCategories(app: App): Promise<Locator> {
    const { page } = app
    await app.open({ route: '/reports/2' })
    const table = card(page, 'Top categories')
    await expect(table.getByRole('row').nth(1)).toBeVisible()
    return table
  }

  // the first transaction row, past the day header (which has no checkbox)
  const firstTransaction = (page: Page): Locator =>
    page
      .locator('tbody tr')
      .filter({ has: page.getByRole('checkbox') })
      .first()

  function drilledFilters(page: Page): Record<string, unknown> {
    const url = new URL(page.url().replace('#', ''), 'http://x')
    return JSON.parse(url.searchParams.get('filters')!)
  }

  test('clicking a summary row opens the transactions filtered to it', async ({ app }) => {
    const { page } = app
    const table = await topCategories(app)
    await table.getByRole('row', { name: /Groceries/ }).click()

    await expect(page).toHaveURL(/#\/accounts\?tab=transactions/)
    const filters = drilledFilters(page)
    const [{ id }] = await app.sql<{ id: number }>(
      `SELECT id FROM categories WHERE name LIKE '%Groceries'`
    )
    expect(filters).toMatchObject({ categoryIds: [id], direction: 'expense' })
    await expect(page.getByRole('button', { name: '1 category' })).toBeVisible()
    await expect(combo(page, 'Expenses Only')).toBeVisible()
    await expect(firstTransaction(page)).toContainText('Groceries')
    await expect(page.getByRole('button', { name: 'Reset' })).toBeVisible()
  })

  test('Enter on a focused row drills too', async ({ app }) => {
    const { page } = app
    const table = await topCategories(app)
    const row = table.getByRole('row', { name: /Housing/ })
    await row.focus()
    await expect(row).toBeFocused()
    await page.keyboard.press('Enter')

    await expect(page).toHaveURL(/#\/accounts\?tab=transactions/)
    await expect(firstTransaction(page)).toContainText('Housing')
  })

  test('the report filters carry into the drill', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/reports/2' })
    const table = card(page, 'Top categories')
    await expect(table.getByRole('row').nth(1)).toBeVisible()
    await table.getByRole('row', { name: /Housing/ }).click()
    await expect(page).toHaveURL(/tab=transactions/)
    // Monthly Check-in is scoped to the last 6 months, pending included, no transfers
    expect(drilledFilters(page)).toMatchObject({
      dateRange: { kind: 'relative', unit: 'month', count: 6, includeCurrent: true },
      includePending: true,
      includeTransfers: false
    })
    await expect(combo(page, 'Last 6 Months')).toBeVisible()
  })

  test('rows do not drill while editing', async ({ app }) => {
    const { page } = app
    const table = await topCategories(app)
    await page.getByRole('button', { name: 'Arrange', exact: true }).click()
    const row = table.getByRole('row', { name: /Groceries/ })
    await expect(row).not.toHaveAttribute('tabindex', /.*/)
    await row.click()
    await row.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/#\/reports\/2$/)

    await page.getByRole('button', { name: 'Done' }).click()
    await expect(row).toHaveAttribute('tabindex', '0')
  })

  test('clicking the ungrouped row of a category-group table drills to it', async ({ app }) => {
    const { page } = app
    // regroup the table before the report page first reads it
    await app.open({ route: '/accounts' })
    await app.sql(
      `UPDATE report_widgets SET config = json_set(config, '$.query.groupBy', 'categoryGroup')
       WHERE title = 'Top categories'`
    )
    await page.evaluate(() => (location.hash = '/reports/2'))
    const table = card(page, 'Top categories')
    await table.getByRole('row', { name: /Uncategorized/ }).click()

    await expect(page).toHaveURL(/#\/accounts\?tab=transactions/)
    const filters = drilledFilters(page)
    expect(filters).toMatchObject({ includeUncategorized: true, direction: 'expense' })
    expect(filters.categoryGroupIds).toBeUndefined()
    await expect(page.getByRole('row').nth(1)).toBeVisible()
  })
})

test.describe('layout', () => {
  test('resizing a widget in edit mode persists', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/reports/2' })
    const item = page
      .locator('.react-grid-item')
      .filter({ has: page.getByRole('heading', { name: 'Net by month' }) })
    const handle = item.locator('.react-resizable-handle-se')

    await page.getByRole('button', { name: 'Arrange', exact: true }).click()
    await expect(handle).toBeVisible()
    const box = (await handle.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x - 150, box.y, { steps: 10 })
    await page.mouse.up()

    const width = async (): Promise<number> =>
      (await app.sql<{ w: number }>(`SELECT w FROM report_widgets WHERE title = 'Net by month'`))[0]
        .w
    // saves are debounced
    await expect.poll(width).toBeLessThan(6)
    expect(await width()).toBeGreaterThanOrEqual(4)

    await page.getByRole('link', { name: 'Reports', exact: true }).click()
    await page.getByText('Monthly Check-in').click()
    await expect(page).toHaveURL(/#\/reports\/2$/)
    await expect(page.getByRole('heading', { name: 'Net by month' })).toBeVisible()
    const stored = await width()
    const [{ x }] = await app.sql<{ x: number }>(
      `SELECT x FROM report_widgets WHERE title = 'Envelopes'`
    )
    expect(x).toBe(6)
    expect(stored).toBeLessThan(6)
  })
})
