import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../fixtures'

// the widget previews are cards too; the report cards are the ones with a menu
const reportCards = (page: Page): Locator =>
  page
    .locator('[data-slot=card]')
    .filter({ has: page.getByRole('button', { name: 'Report actions' }) })

test.describe('reports index', () => {
  test('lists the household reports with a preview of the first widget', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/reports' })
    await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible()

    const cards = reportCards(page)
    await expect(cards).toHaveCount(3)

    const overview = cards.filter({ hasText: 'Spending Overview' })
    await expect(overview).toContainText('8 widgets')
    // the preview is the first widget at half scale: the Income stat
    await expect(overview).toContainText('Income')
    await expect(overview).toContainText(/\$[\d,]+\.\d\d/)
    await expect(cards.filter({ hasText: 'Monthly Check-in' })).toContainText('4 widgets')
    await expect(cards.filter({ hasText: 'Savings Goals' })).toContainText('4 widgets')
  })

  test('shows the empty state with three create buttons on a dataset without reports', async ({
    app
  }) => {
    const { page } = app
    await app.open({ route: '/reports', dataset: 'starter' })
    await expect(page.getByText('No Reports Yet')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start with Spending Overview' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start with Savings Goals' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Blank Report' })).toBeVisible()
  })

  test('a template button on the empty state creates and opens that report', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/reports', dataset: 'starter' })
    await page.getByRole('button', { name: 'Start with Spending Overview' }).click()
    await expect(page).toHaveURL(/#\/reports\/\d+$/)
    await expect(page.getByRole('heading', { name: 'Spending Overview', level: 2 })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Monthly expenses by group' })).toBeVisible()
    expect(await app.sql('SELECT name FROM reports')).toEqual([{ name: 'Spending Overview' }])
  })

  test('New report > Blank report opens on the empty widget state', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/reports' })
    await page.getByRole('button', { name: 'New Report' }).click()
    await page.getByRole('menuitem', { name: 'Blank Report' }).click()

    await expect(page).toHaveURL(/#\/reports\/4$/)
    await expect(page.getByRole('heading', { name: 'Untitled Report', level: 2 })).toBeVisible()
    await expect(page.getByText('This Report Is Empty')).toBeVisible()
    await expect(page.getByText('Add a widget to get started.')).toBeVisible()
    // the empty state holds the only Add Widget, and there is nothing to arrange yet
    await expect(page.getByRole('button', { name: 'Add Widget' })).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Arrange' })).toHaveCount(0)
  })

  test('New report > Spending Overview template renders its widgets', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/reports' })
    await page.getByRole('button', { name: 'New Report' }).click()
    await page.getByRole('menuitem', { name: 'Spending Overview Template' }).click()

    await expect(page).toHaveURL(/#\/reports\/4$/)
    await expect(page.getByRole('heading', { name: 'Spending Overview', level: 2 })).toBeVisible()
    for (const title of [
      'Income',
      'Expenses',
      'Net',
      'Monthly expenses by group',
      'Spending by category',
      'Cumulative net',
      'Expenses by category group',
      'Transactions'
    ]) {
      await expect(page.getByRole('heading', { name: title, level: 3, exact: true })).toBeVisible()
    }
    const [{ n }] = await app.sql<{ n: number }>(
      'SELECT count(*) AS n FROM report_widgets WHERE report_id = 4'
    )
    expect(n).toBe(8)
    // a populated report opens in view mode
    await expect(page.getByRole('button', { name: 'Arrange', exact: true })).toBeVisible()
  })

  test('New report > Savings Goals template renders its widgets', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/reports' })
    await page.getByRole('button', { name: 'New Report' }).click()
    await page.getByRole('menuitem', { name: 'Savings Goals Template' }).click()

    await expect(page).toHaveURL(/#\/reports\/4$/)
    for (const title of ['Progress', 'Saved per goal', 'Saved over time', 'Goals']) {
      await expect(page.getByRole('heading', { name: title, level: 3, exact: true })).toBeVisible()
    }
    // the goal list names the household goals
    const goals = await app.sql<{ name: string }>(
      'SELECT name FROM savings_goals WHERE archived_at IS NULL'
    )
    expect(goals.length).toBeGreaterThan(0)
    await expect(page.getByText(goals[0].name).first()).toBeVisible()
  })

  test('deleting a report from the index asks first, and Cancel keeps it', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/reports' })
    const card = reportCards(page).filter({ hasText: 'Monthly Check-in' })
    await card.getByRole('button', { name: 'Report actions' }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Delete “Monthly Check-in”?')
    await expect(dialog).toContainText('permanently deletes the report and all its widgets')
    await dialog.getByRole('button', { name: /Cancel/ }).click()
    await expect(dialog).toBeHidden()
    await expect(reportCards(page)).toHaveCount(3)

    await card.getByRole('button', { name: 'Report actions' }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^Delete/ })
      .click()
    await expect(reportCards(page)).toHaveCount(2)
    await expect(page.getByText('Monthly Check-in')).toHaveCount(0)
    expect(await app.sql('SELECT id FROM reports ORDER BY id')).toEqual([{ id: 1 }, { id: 3 }])
  })

  test('opening a card navigates to the report', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/reports' })
    await reportCards(page).filter({ hasText: 'Savings Goals' }).click()
    await expect(page).toHaveURL(/#\/reports\/3$/)
    await expect(page.getByRole('heading', { name: 'Savings Goals', level: 2 })).toBeVisible()
  })
})

test.describe('report page', () => {
  test('Rename report in the menu opens a dialog and the new name persists', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/reports/2' })
    await expect(page.getByRole('heading', { name: 'Monthly Check-in', level: 2 })).toBeVisible()
    await page.getByRole('button', { name: 'Report actions' }).click()
    await page.getByRole('menuitem', { name: 'Rename' }).click()

    const dialog = page.getByRole('dialog', { name: 'Rename' })
    const name = dialog.getByLabel('Name')
    await expect(name).toHaveValue('Monthly Check-in')
    await name.fill('Quarterly review')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('heading', { name: 'Quarterly review', level: 2 })).toBeVisible()
    expect(await app.sql('SELECT name FROM reports WHERE id = 2')).toEqual([
      { name: 'Quarterly review' }
    ])

    await page.getByRole('link', { name: 'Reports', exact: true }).click()
    await expect(reportCards(page).filter({ hasText: 'Quarterly review' })).toBeVisible()
  })

  test('arrange mode keeps the title as text, and a blank name cannot be saved', async ({
    app
  }) => {
    const { page } = app
    await app.open({ route: '/reports/2' })
    await page.getByRole('button', { name: 'Arrange', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Monthly Check-in', level: 2 })).toBeVisible()
    await expect(
      page.getByRole('textbox').and(page.locator('[value="Monthly Check-in"]'))
    ).toHaveCount(0)

    await page.getByRole('button', { name: 'Report actions' }).click()
    await page.getByRole('menuitem', { name: 'Rename' }).click()
    const dialog = page.getByRole('dialog', { name: 'Rename' })
    await dialog.getByLabel('Name').fill('   ')
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(await app.sql('SELECT name FROM reports WHERE id = 2')).toEqual([
      { name: 'Monthly Check-in' }
    ])
  })

  test('the index card menu renames a report without opening it', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/reports' })
    const card = reportCards(page).filter({ hasText: 'Monthly Check-in' })
    await card.getByRole('button', { name: 'Report actions' }).click()
    await page.getByRole('menuitem', { name: 'Rename' }).click()
    const dialog = page.getByRole('dialog', { name: 'Rename' })
    await dialog.getByLabel('Name').fill('Check-in')
    await dialog.getByLabel('Name').press('Enter')
    await expect(dialog).toBeHidden()
    await expect(page).toHaveURL(/#\/reports$/)
    await expect(reportCards(page).filter({ hasText: 'Check-in' })).toBeVisible()
    expect(await app.sql('SELECT name FROM reports WHERE id = 2')).toEqual([{ name: 'Check-in' }])
  })

  test('deleting from the report menu confirms, then returns to the index', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/reports/2' })
    await page.getByRole('button', { name: 'Report actions' }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Delete “Monthly Check-in”?')
    await dialog.getByRole('button', { name: /^Delete/ }).click()

    await expect(page).toHaveURL(/#\/reports$/)
    await expect(reportCards(page)).toHaveCount(2)
    expect(await app.sql('SELECT id FROM reports ORDER BY id')).toEqual([{ id: 1 }, { id: 3 }])
  })

  test('an unknown report shows the not-found page with a way back', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/reports/999' })
    await expect(page.getByText('Report Not Found')).toBeVisible()
    await expect(page.getByText('This report may have been deleted.')).toBeVisible()
    await page.getByRole('link', { name: 'Back to Reports' }).click()
    await expect(page).toHaveURL(/#\/reports$/)
    await expect(reportCards(page)).toHaveCount(3)
  })

  test('a non-numeric report id is also not found', async ({ app }) => {
    await app.open({ route: '/reports/abc' })
    await expect(app.page.getByText('Report Not Found')).toBeVisible()
  })
})
