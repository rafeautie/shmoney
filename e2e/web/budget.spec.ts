import { expect, test } from '../fixtures'
import type { Locator } from '@playwright/test'
import type { App } from '../fixtures'

// household budgets start 2025-10; "today" is September 2026
const HOBBIES_FILL = `
  SELECT b.amount AS amount FROM budgets b
  JOIN categories c ON c.id = b.category_id
  WHERE c.name LIKE '%Hobbies' AND b.month = '2026-09'`

async function openTable(app: App): Promise<void> {
  await app.open({ route: '/budget' })
  await expect(app.page.getByRole('row', { name: /Hobbies/ })).toBeVisible()
}

async function openCards(app: App): Promise<void> {
  await app.open({ route: '/budget' })
  await app.page.getByRole('tab', { name: 'Card view' }).click()
  await expect(envelopeCard(app, 'Hobbies')).toBeVisible()
}

function envelopeCard(app: App, name: string): Locator {
  return app.page.locator('[data-slot="card"]').filter({ hasText: name })
}

function statCard(app: App, label: string): Locator {
  return app.page.locator('[data-slot="card"]').filter({ hasText: new RegExp(`^${label}`) })
}

const hobbiesRow = (app: App): Locator => app.page.getByRole('row', { name: /Hobbies/ })

test.describe('envelopes and stat cards', () => {
  test('the household budget lists envelopes by group with a subtotal row each', async ({
    app
  }) => {
    await openTable(app)
    const { page } = app
    await expect(page.getByRole('heading', { name: 'Budget' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Monthly fill' })).toBeVisible()
    for (const name of ['Wants', 'Needs', 'Dining Out', 'Housing', 'Groceries', 'Insurance']) {
      await expect(page.getByRole('row', { name: new RegExp(name) })).toBeVisible()
    }
    // 11 envelopes plus 2 group rows, an unbudgeted row and the header
    await expect(page.getByRole('row')).toHaveCount(11 + 2 + 1 + 1)
    await expect(page.getByRole('row', { name: /Unbudgeted spending/ })).toBeVisible()
  })

  test('stat cards show Budgeted, Spent, Available and the current month Saved card', async ({
    app
  }) => {
    await openTable(app)
    await expect(statCard(app, 'Budgeted')).toContainText('$4,810.00')
    await expect(statCard(app, 'Spent')).toContainText('$')
    await expect(statCard(app, 'Available')).toContainText('$')
    const saved = statCard(app, 'Saved')
    await expect(saved).toBeVisible()
    await expect(saved).toContainText('planned')
  })

  test('the Saved card is for months that have happened, the planned half for months to come', async ({
    app
  }) => {
    await openTable(app)
    const { page } = app
    await page.getByRole('button', { name: 'Previous month' }).click()
    await expect(page.getByText('August 2026')).toBeVisible()
    await expect(statCard(app, 'Saved')).toBeVisible()
    await expect(statCard(app, 'Saved')).not.toContainText('planned')

    await page.getByRole('button', { name: 'Today' }).click()
    await page.getByRole('button', { name: 'Next month' }).click()
    await expect(page.getByText('October 2026')).toBeVisible()
    await expect(statCard(app, 'Budgeted')).toBeVisible()
    await expect(statCard(app, 'Saved')).toHaveCount(0)
  })

  test('card view groups envelopes under headers with their own totals', async ({ app }) => {
    await openCards(app)
    const { page } = app
    await expect(page.getByRole('heading', { name: 'Needs' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Wants' })).toBeVisible()
    await expect(envelopeCard(app, 'Housing')).toContainText('$2,450.00')
    await expect(envelopeCard(app, 'Housing')).toContainText('left of')
    await expect(page.getByText(/^Unbudgeted spending/)).toBeVisible()
  })

  test('an over-budget envelope reads over a fill of, in the destructive tone', async ({ app }) => {
    await openCards(app)
    const groceries = envelopeCard(app, 'Groceries')
    await expect(groceries).toContainText('a fill of')
    await expect(groceries.locator('.text-destructive').filter({ hasText: /over$/ })).toBeVisible()
    await expect(envelopeCard(app, 'Housing')).not.toContainText('over')
  })

  test('shrinking a fill below the spend flips the card to over', async ({ app }) => {
    await openCards(app)
    const card = envelopeCard(app, 'Dining Out')
    await expect(card).toContainText('left of')
    await card.getByRole('button', { name: '$280.00' }).click()
    await card.getByRole('textbox').fill('1')
    await card.getByRole('textbox').press('Enter')
    await expect(card.locator('.text-destructive').filter({ hasText: /over$/ })).toBeVisible()
    await expect(card).toContainText('a fill of')
  })
})

test.describe('empty state', () => {
  test('a fresh install shows No envelopes yet and locks month navigation', async ({ app }) => {
    await app.open({ route: '/budget', dataset: 'starter' })
    const { page } = app
    await expect(page.getByText('No envelopes yet')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add your first envelope' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Previous month' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Next month' })).toBeDisabled()
    await expect(page.getByText('Budgeted', { exact: true })).toHaveCount(0)
  })

  test('the empty state button creates the first envelope', async ({ app }) => {
    await app.open({ route: '/budget', dataset: 'starter' })
    const { page } = app
    await page.getByRole('button', { name: 'Add your first envelope' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add envelope' })
    await dialog.getByRole('button', { name: 'Pick a category...' }).click()
    await page.getByRole('option').first().click()
    await dialog.getByLabel('Monthly fill').fill('120')
    await dialog.getByRole('button', { name: 'Add envelope' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText('No envelopes yet')).toBeHidden()
    await expect(statCard(app, 'Budgeted')).toContainText('$120.00')
    const rows = await app.sql<{ amount: number }>('SELECT amount FROM budgets')
    expect(rows).toEqual([{ amount: 120_000 }])
  })
})

test.describe('month navigation', () => {
  test('Previous and Next step the month and Today appears only off the current month', async ({
    app
  }) => {
    await openTable(app)
    const { page } = app
    const today = page.getByRole('button', { name: 'Today' })
    await expect(page.getByText('September 2026')).toBeVisible()
    await expect(today).toHaveCount(0)

    await page.getByRole('button', { name: 'Previous month' }).click()
    await expect(page.getByText('August 2026')).toBeVisible()
    await expect(today).toBeVisible()

    await page.getByRole('button', { name: 'Next month' }).click()
    await expect(page.getByText('September 2026')).toBeVisible()
    await expect(today).toHaveCount(0)

    await page.getByRole('button', { name: 'Next month' }).click()
    await expect(page.getByText('October 2026')).toBeVisible()
    await today.click()
    await expect(page.getByText('September 2026')).toBeVisible()
  })

  test('Next stops 12 months ahead', async ({ app }) => {
    await openTable(app)
    const { page } = app
    const next = page.getByRole('button', { name: 'Next month' })
    for (let i = 0; i < 12; i++) await next.click()
    await expect(page.getByText('September 2027')).toBeVisible()
    await expect(next).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Previous month' })).toBeEnabled()
  })

  test('Previous stops at the first month with an envelope', async ({ app }) => {
    await openTable(app)
    const { page } = app
    const previous = page.getByRole('button', { name: 'Previous month' })
    for (let i = 0; i < 11; i++) await previous.click()
    await expect(page.getByText('October 2025')).toBeVisible()
    await expect(previous).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Next month' })).toBeEnabled()
  })

  test('a fill edit applies from the viewed month forward and leaves earlier months alone', async ({
    app
  }) => {
    await openTable(app)
    const { page } = app
    await page.getByRole('button', { name: 'Next month' }).click()
    await expect(page.getByText('October 2026')).toBeVisible()
    await hobbiesRow(app).getByRole('button', { name: '$75.00' }).click()
    await hobbiesRow(app).getByRole('textbox').fill('90')
    await hobbiesRow(app).getByRole('textbox').press('Enter')
    await expect(hobbiesRow(app).getByRole('button', { name: '$90.00' })).toBeVisible()

    await page.getByRole('button', { name: 'Today' }).click()
    await expect(page.getByText('September 2026')).toBeVisible()
    await expect(hobbiesRow(app).getByRole('button', { name: '$75.00' })).toBeVisible()
  })
})

test.describe('cards and table view', () => {
  test('the toggle swaps the layout and is stored in settings', async ({ app }) => {
    await openTable(app)
    const { page } = app
    await expect(page.getByRole('tab', { name: 'Table view' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await page.getByRole('tab', { name: 'Card view' }).click()
    await expect(page.getByRole('columnheader', { name: 'Monthly fill' })).toHaveCount(0)
    await expect(envelopeCard(app, 'Housing')).toBeVisible()
    await expect
      .poll(() => app.sql("SELECT value FROM settings WHERE key = 'budgetView'"))
      .toEqual([{ value: '"cards"' }])

    await page.getByRole('tab', { name: 'Table view' }).click()
    await expect(page.getByRole('columnheader', { name: 'Monthly fill' })).toBeVisible()
    await expect
      .poll(() => app.sql("SELECT value FROM settings WHERE key = 'budgetView'"))
      .toEqual([{ value: '"table"' }])
  })

  test('the choice survives navigating away and back', async ({ app }) => {
    await openCards(app)
    const { page } = app
    await page.getByRole('link', { name: 'Goals', exact: true }).click()
    await expect(page).toHaveURL(/#\/goals/)
    await page.getByRole('link', { name: 'Budget', exact: true }).click()
    await expect(page.getByRole('tab', { name: 'Card view' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(envelopeCard(app, 'Housing')).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Monthly fill' })).toHaveCount(0)
  })
})

test.describe('inline fill editing', () => {
  test('Enter commits the new fill and it persists', async ({ app }) => {
    await openTable(app)
    const row = hobbiesRow(app)
    await row.getByRole('button', { name: '$75.00' }).click()
    const input = row.getByRole('textbox')
    await expect(input).toBeFocused()
    await input.fill('82.5')
    await input.press('Enter')
    await expect(row.getByRole('button', { name: '$82.50' })).toBeVisible()
    await expect(row.getByRole('textbox')).toHaveCount(0)
    await expect.poll(() => app.sql(HOBBIES_FILL)).toEqual([{ amount: 82_500 }])
    await expect(statCard(app, 'Budgeted')).toContainText('$4,817.50')
  })

  test('Escape cancels without saving', async ({ app }) => {
    await openTable(app)
    const row = hobbiesRow(app)
    await row.getByRole('button', { name: '$75.00' }).click()
    await row.getByRole('textbox').fill('99')
    await row.getByRole('textbox').press('Escape')
    await expect(row.getByRole('textbox')).toHaveCount(0)
    await expect(row.getByRole('button', { name: '$75.00' })).toBeVisible()
    await expect(statCard(app, 'Budgeted')).toContainText('$4,810.00')
    expect(await app.sql(HOBBIES_FILL)).toEqual([])
  })

  test('an unchanged value does not write a new fill', async ({ app }) => {
    await openTable(app)
    const row = hobbiesRow(app)
    await row.getByRole('button', { name: '$75.00' }).click()
    await row.getByRole('textbox').press('Enter')
    await expect(row.getByRole('button', { name: '$75.00' })).toBeVisible()
    expect(await app.sql(HOBBIES_FILL)).toEqual([])
  })

  test('clicking away commits like Enter', async ({ app }) => {
    await openTable(app)
    const row = hobbiesRow(app)
    await row.getByRole('button', { name: '$75.00' }).click()
    await row.getByRole('textbox').fill('60')
    await app.page.getByRole('heading', { name: 'Budget' }).click()
    await expect(row.getByRole('button', { name: '$60.00' })).toBeVisible()
    await expect.poll(() => app.sql(HOBBIES_FILL)).toEqual([{ amount: 60_000 }])
  })

  test('the card view edits the fill the same way', async ({ app }) => {
    await openCards(app)
    const card = envelopeCard(app, 'Hobbies')
    await card.getByRole('button', { name: '$75.00' }).click()
    await card.getByRole('textbox').fill('50')
    await card.getByRole('textbox').press('Enter')
    await expect(card.getByRole('button', { name: '$50.00' })).toBeVisible()
    await expect.poll(() => app.sql(HOBBIES_FILL)).toEqual([{ amount: 50_000 }])
  })

  // src/renderer/src/components/budget/envelope-fields.tsx:50 commits whatever
  // parseDollars returns, and parseDollars('') is 0, so clearing the field to
  // retype it sets the fill to $0 instead of leaving it alone
  test.fixme('TRIAGE: clearing the fill input and pressing Enter sets the fill to $0', async () => {})

  test('Ctrl+Z reverts a fill change and offers Redo', async ({ app }) => {
    await openTable(app)
    const { page } = app
    const row = hobbiesRow(app)
    await row.getByRole('button', { name: '$75.00' }).click()
    await row.getByRole('textbox').fill('90')
    await row.getByRole('textbox').press('Enter')
    await expect(row.getByRole('button', { name: '$90.00' })).toBeVisible()

    await page.keyboard.press(`${app.mod}+z`)
    await expect(row.getByRole('button', { name: '$75.00' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Redo' })).toBeVisible()

    await page.keyboard.press(`${app.mod}+Shift+z`)
    await expect(row.getByRole('button', { name: '$90.00' })).toBeVisible()
  })
})

test.describe('add envelope dialog', () => {
  async function openDialog(app: App): Promise<Locator> {
    await openTable(app)
    await app.page.getByRole('button', { name: 'Add envelope' }).click()
    return app.page.getByRole('dialog', { name: 'Add envelope' })
  }

  test('the category list leaves out system and already budgeted categories', async ({ app }) => {
    const dialog = await openDialog(app)
    const { page } = app
    await dialog.getByRole('button', { name: 'Pick a category...' }).click()
    const options = page.getByRole('option')
    for (const name of ['Retirement', 'Investments', 'Emergency Fund', 'Debt Payments']) {
      await expect(options.filter({ hasText: name })).toHaveCount(1)
    }
    await expect(options).toHaveCount(4)
    for (const name of ['Income', 'Transfers', 'Starting balance', 'Groceries', 'Housing']) {
      await expect(options.filter({ hasText: name })).toHaveCount(0)
    }
  })

  test('submit needs a category and an amount above zero', async ({ app }) => {
    const dialog = await openDialog(app)
    const { page } = app
    const submit = dialog.getByRole('button', { name: 'Add envelope' })
    await expect(submit).toBeDisabled()

    await dialog.getByLabel('Monthly fill').fill('100')
    await expect(submit).toBeDisabled()

    await dialog.getByRole('button', { name: 'Pick a category...' }).click()
    await page.getByRole('option', { name: /Retirement/ }).click()
    await expect(dialog.getByRole('button', { name: /Retirement/ })).toBeVisible()
    await expect(submit).toBeEnabled()

    await dialog.getByLabel('Monthly fill').fill('0')
    await expect(submit).toBeDisabled()
    await dialog.getByLabel('Monthly fill').fill('')
    await expect(submit).toBeDisabled()
    await dialog.getByLabel('Monthly fill').fill('100')
    await expect(submit).toBeEnabled()
  })

  test('a new envelope appears under its group and is stored for the viewed month', async ({
    app
  }) => {
    const dialog = await openDialog(app)
    const { page } = app
    await dialog.getByRole('button', { name: 'Pick a category...' }).click()
    await page.getByRole('option', { name: /Emergency Fund/ }).click()
    await dialog.getByLabel('Monthly fill').fill('200')
    await dialog.getByRole('button', { name: 'Add envelope' }).click()
    await expect(dialog).toBeHidden()

    const row = page.getByRole('row', { name: /Emergency Fund/ })
    await expect(row.getByRole('button', { name: '$200.00' })).toBeVisible()
    await expect(page.getByRole('row', { name: /Savings & Debt/ })).toBeVisible()
    await expect(statCard(app, 'Budgeted')).toContainText('$5,010.00')
    await expect
      .poll(() =>
        app.sql(
          `SELECT b.month, b.amount FROM budgets b JOIN categories c ON c.id = b.category_id
           WHERE c.name LIKE '%Emergency Fund'`
        )
      )
      .toEqual([{ month: '2026-09', amount: 200_000 }])
  })

  test('Enter in the amount field submits and the budgeted category drops out of the list', async ({
    app
  }) => {
    const dialog = await openDialog(app)
    const { page } = app
    await dialog.getByRole('button', { name: 'Pick a category...' }).click()
    await page.getByRole('option', { name: /Retirement/ }).click()
    await dialog.getByLabel('Monthly fill').fill('75')
    await dialog.getByLabel('Monthly fill').press('Enter')
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('row', { name: /Retirement/ })).toBeVisible()

    await page.getByRole('button', { name: 'Add envelope' }).click()
    const reopened = page.getByRole('dialog', { name: 'Add envelope' })
    await expect(reopened.getByRole('button', { name: 'Pick a category...' })).toBeVisible()
    await reopened.getByRole('button', { name: 'Pick a category...' }).click()
    await expect(page.getByRole('option', { name: /Retirement/ })).toHaveCount(0)
  })

  test('Cancel closes without adding', async ({ app }) => {
    const dialog = await openDialog(app)
    await dialog.getByLabel('Monthly fill').fill('10')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    await expect(app.page.getByRole('row')).toHaveCount(15)
  })
})

test.describe('removing envelopes', () => {
  test('the actions menu removes an envelope and the toast Undo restores it', async ({ app }) => {
    await openTable(app)
    const { page } = app
    await expect(statCard(app, 'Budgeted')).toContainText('$4,810.00')
    await hobbiesRow(app).getByRole('button', { name: 'Envelope actions' }).click()
    await page.getByRole('menuitem', { name: 'Remove envelope' }).click()

    await expect(hobbiesRow(app)).toHaveCount(0)
    await expect(statCard(app, 'Budgeted')).toContainText('$4,735.00')
    await expect(page.getByText('Removed the 🎨 Hobbies envelope')).toBeVisible()

    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(hobbiesRow(app).getByRole('button', { name: '$75.00' })).toBeVisible()
    await expect(statCard(app, 'Budgeted')).toContainText('$4,810.00')
  })

  test('the card view has the same menu', async ({ app }) => {
    await openCards(app)
    const { page } = app
    await envelopeCard(app, 'Hobbies').getByRole('button', { name: 'Envelope actions' }).click()
    await page.getByRole('menuitem', { name: 'Remove envelope' }).click()
    await expect(envelopeCard(app, 'Hobbies')).toHaveCount(0)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(envelopeCard(app, 'Hobbies')).toBeVisible()
  })

  test('removing the last envelope shows the empty state, and Undo brings it back', async ({
    app
  }) => {
    await app.open({ route: '/budget', dataset: 'starter' })
    const { page } = app
    await page.getByRole('button', { name: 'Add your first envelope' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add envelope' })
    await dialog.getByRole('button', { name: 'Pick a category...' }).click()
    await page.getByRole('option').first().click()
    await dialog.getByLabel('Monthly fill').fill('40')
    await dialog.getByRole('button', { name: 'Add envelope' }).click()
    await expect(dialog).toBeHidden()

    await page.getByRole('button', { name: 'Envelope actions' }).click()
    await page.getByRole('menuitem', { name: 'Remove envelope' }).click()
    await expect(page.getByText('No envelopes yet')).toBeVisible()

    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByText('No envelopes yet')).toBeHidden()
    await expect(statCard(app, 'Budgeted')).toContainText('$40.00')
  })
})
