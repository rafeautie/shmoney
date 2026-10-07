import type { Locator, Page } from '@playwright/test'
import { expect, test, type App } from '../fixtures'

const ROUTE = '/accounts?tab=transactions'
const SYNCED_TITLE = 'Synced from your bank'

const dataRows = (page: Page): Locator =>
  page.locator('tbody tr').filter({ has: page.locator('td') })
const rowFor = (page: Page, description: string): Locator =>
  page.getByRole('row').filter({ hasText: description })
const selectBoxes = (page: Page): Locator => page.getByRole('checkbox', { name: 'Select row' })
const selectionBar = (page: Page): Locator => page.getByText(/^\d+ selected$/).locator('..')
const toast = (page: Page): Locator => page.locator('[data-sonner-toast]')

async function openTransactions(app: App, route = ROUTE): Promise<void> {
  await app.open({ route })
  await expect(app.page.getByRole('row').filter({ hasText: 'Pending' }).first()).toBeVisible()
}

// the manual row is dated today, so it sorts ahead of every synced row; handing
// back its position (not a text match) keeps the locator valid while it is edited
async function addManual(app: App, description: string, amount: string): Promise<Locator> {
  const { page } = app
  await page.getByRole('button', { name: 'New Transaction' }).click()
  await page.getByPlaceholder('Add transaction').fill(description)
  await page.getByPlaceholder('-0.00').fill(amount)
  await page.getByPlaceholder('-0.00').press('Enter')
  await expect(rowFor(page, description)).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByPlaceholder('Add transaction')).toBeHidden()
  const row = dataRows(page).first()
  await expect(row).toContainText(description)
  return row
}

interface StoredTransaction {
  id: number
  description: string
  amount: number
  category_id: number | null
  deleted_at: number | null
  posted: number
}

async function storedTransaction(app: App, description: string): Promise<StoredTransaction> {
  const rows = await app.sql<StoredTransaction>(
    `SELECT id, description, amount, category_id, deleted_at, posted FROM transactions WHERE description = '${description}'`
  )
  return rows[0]
}

test.describe('table', () => {
  test('lists newest first and sorts from the column headers', async ({ app }) => {
    const { page } = app
    await openTransactions(app)

    const dates = async (): Promise<number[]> =>
      (await page.locator('tbody tr td:nth-child(2)').allTextContents())
        .filter((text) => text.trim() !== '')
        .map((text) => new Date(text).getTime())
    const newestFirst = await dates()
    expect(newestFirst.length).toBeGreaterThan(40)
    expect(newestFirst).toEqual([...newestFirst].sort((a, b) => b - a))

    // newest first is the default, so a smallest-first amount sort can't pass by accident
    await page.getByRole('button', { name: 'Amount', exact: true }).click()
    // the biggest outflow in the household is the monthly rent
    await expect(dataRows(page).first()).toContainText('-$2,450.00')
    await expect(dataRows(page).first()).not.toContainText('2026')

    await page.getByRole('button', { name: 'Description', exact: true }).click()
    await expect(dataRows(page).first()).toContainText('ACH DEPOSIT EVERGREEN BANK')

    await page.getByRole('button', { name: 'Date', exact: true }).click()
    await expect
      .poll(async () => (await dates())[0])
      .toBeLessThan(newestFirst[newestFirst.length - 1])
    const oldestFirst = await dates()
    expect(oldestFirst).toEqual([...oldestFirst].sort((a, b) => a - b))
  })

  test('clicking the active sort header again flips its direction', async ({ app }) => {
    const { page } = app
    await openTransactions(app)
    const amount = page.getByRole('button', { name: 'Amount', exact: true })

    await amount.click()
    await expect(dataRows(page).first()).toContainText('-$2,450.00')
    await amount.click()
    await expect(dataRows(page).first()).not.toContainText('-$')
    await amount.click()
    await expect(dataRows(page).first()).toContainText('-$2,450.00')
  })

  test('loads more rows as the table scrolls', async ({ app }) => {
    const { page } = app
    await openTransactions(app)
    await expect(dataRows(page)).toHaveCount(50)

    await dataRows(page).last().scrollIntoViewIfNeeded()
    await expect.poll(() => dataRows(page).count()).toBeGreaterThan(50)

    const loaded = await dataRows(page).count()
    await dataRows(page).last().scrollIntoViewIfNeeded()
    await expect.poll(() => dataRows(page).count()).toBeGreaterThan(loaded)
  })

  test('marks transfers and pending rows', async ({ app }) => {
    const { page } = app
    await openTransactions(app)

    const transfer = rowFor(page, 'RWRDS VISA AUTOPAY').first()
    await expect(transfer.getByTitle('Transfer', { exact: true })).toBeVisible()
    await expect(transfer).toContainText('Transfers')
    await expect(
      rowFor(page, 'CHIPOTLE 2291').first().getByTitle('Transfer', { exact: true })
    ).toHaveCount(0)

    const pending = page.getByRole('row').filter({ hasText: 'Pending' })
    await expect(pending).toHaveCount(2)
    for (const row of await pending.all()) {
      await expect(row.getByRole('checkbox')).toHaveCount(0)
      await expect(row.getByRole('button')).toHaveCount(0)
      await expect(
        row.getByTitle('Pending transactions can be categorized once they post')
      ).toHaveText('—')
    }
  })

  test('synced rows are read-only except for the category', async ({ app }) => {
    const { page } = app
    await openTransactions(app)
    const row = dataRows(page).nth(2)

    await expect(row.getByTitle(SYNCED_TITLE)).toHaveCount(3)
    // the category picker is the only control on the row besides its checkbox
    await expect(row.getByRole('button')).toHaveCount(1)
    await row.getByText(/^\$?-?\$[\d,.]+$/).click({ force: true })
    await expect(row.getByRole('textbox')).toHaveCount(0)
  })

  test('picks a category from the searchable cell popover', async ({ app }) => {
    const { page } = app
    await openTransactions(app)
    const row = dataRows(page).nth(2)
    const description = (await row.locator('td').nth(3).innerText()).trim()
    const [{ id }] = await app.sql<{ id: number }>(
      `SELECT id FROM transactions WHERE pending = 0 AND deleted_at IS NULL ORDER BY effective_date DESC, id DESC LIMIT 1`
    )

    await row.getByRole('button', { name: 'Uncategorized' }).click()
    await page.getByPlaceholder('Search categories...').fill('dining')
    await expect(page.getByRole('option')).toHaveCount(1)
    await page.getByRole('option', { name: /Dining Out/ }).click()

    await expect(row.getByRole('button', { name: /Dining Out/ })).toBeVisible()
    await expect(page.getByPlaceholder('Search categories...')).toBeHidden()
    await expect(row).toContainText(description)
    await expect
      .poll(async () => {
        const [stored] = await app.sql<{ name: string }>(
          `SELECT c.name FROM transactions t JOIN categories c ON c.id = t.category_id WHERE t.id = ${id}`
        )
        return stored?.name
      })
      .toContain('Dining Out')

    await row.getByRole('button', { name: /Dining Out/ }).click()
    await page.getByRole('option', { name: 'Uncategorized' }).click()
    await expect(row.getByRole('button', { name: 'Uncategorized' })).toBeVisible()
    await expect
      .poll(
        async () =>
          (
            await app.sql<{ c: number | null }>(
              `SELECT category_id c FROM transactions WHERE id = ${id}`
            )
          )[0].c
      )
      .toBeNull()
  })

  test('shows an empty state when the search matches nothing', async ({ app }) => {
    await app.open({ route: `${ROUTE}&q=zzzzqqqq` })
    await expect(app.page.getByText('No transactions match the current filters.')).toBeVisible()
  })
})

test.describe('inline editing', () => {
  test('description: Enter commits, Escape cancels, empty is ignored', async ({ app }) => {
    const { page } = app
    await openTransactions(app)
    const row = await addManual(app, 'ZZ Original', '-12.50')

    await row.getByRole('button', { name: 'ZZ Original' }).click()
    const input = row.getByRole('textbox')
    await expect(input).toBeFocused()
    await input.fill('ZZ Renamed')
    await input.press('Enter')
    await expect(row.getByRole('button', { name: 'ZZ Renamed' })).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: 'ZZ Original' })).toHaveCount(0)
    await expect.poll(() => storedTransaction(app, 'ZZ Renamed')).toBeTruthy()

    await row.getByRole('button', { name: 'ZZ Renamed' }).click()
    await input.fill('ZZ Abandoned')
    await input.press('Escape')
    await expect(input).toHaveCount(0)
    await expect(row.getByRole('button', { name: 'ZZ Renamed' })).toBeVisible()
    expect(await storedTransaction(app, 'ZZ Abandoned')).toBeUndefined()

    await row.getByRole('button', { name: 'ZZ Renamed' }).click()
    await input.fill('   ')
    await input.press('Enter')
    await expect(row.getByRole('button', { name: 'ZZ Renamed' })).toBeVisible()
    expect((await storedTransaction(app, 'ZZ Renamed')).description).toBe('ZZ Renamed')
  })

  test('amount: a literal minus sign is an expense, Escape cancels', async ({ app }) => {
    await openTransactions(app)
    const row = await addManual(app, 'ZZ Amount', '-12.50')
    await expect(row).toContainText('-$12.50')

    await row.getByRole('button', { name: '-$12.50' }).click()
    const input = row.getByRole('textbox')
    await expect(input).toHaveValue('-12.5')
    await input.fill('-20.75')
    await input.press('Enter')
    await expect(row).toContainText('-$20.75')
    await expect.poll(async () => (await storedTransaction(app, 'ZZ Amount')).amount).toBe(-20750)

    await row.getByRole('button', { name: '-$20.75' }).click()
    await row.getByRole('textbox').fill('-1')
    await row.getByRole('textbox').press('Escape')
    await expect(row).toContainText('-$20.75')
    expect((await storedTransaction(app, 'ZZ Amount')).amount).toBe(-20750)

    await row.getByRole('button', { name: '-$20.75' }).click()
    await row.getByRole('textbox').fill('15')
    await row.getByRole('textbox').press('Enter')
    await expect(row).toContainText('$15.00')
    await expect(row).not.toContainText('-$15.00')
    await expect.poll(async () => (await storedTransaction(app, 'ZZ Amount')).amount).toBe(15000)
  })

  test('date: picking a day in the calendar commits it', async ({ app }) => {
    const { page } = app
    await openTransactions(app)
    const row = await addManual(app, 'ZZ Dated', '-5')
    await expect(row).toContainText('Sep 24, 2026')

    await row.getByRole('button', { name: 'Sep 24, 2026' }).click()
    await page.getByRole('button', { name: /September 20th, 2026/ }).click()

    await expect(rowFor(page, 'ZZ Dated')).toContainText('Sep 20, 2026')
    await expect(page.getByRole('grid')).toBeHidden()
    const stored = await storedTransaction(app, 'ZZ Dated')
    expect(new Date(stored.posted * 1000).getDate()).toBe(20)
  })
})

test.describe('create row', () => {
  test('toggles open from the header button and needs a description and an amount', async ({
    app
  }) => {
    const { page } = app
    await openTransactions(app)
    const toggle = page.getByRole('button', { name: 'New Transaction' })
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await toggle.click()

    const description = page.getByPlaceholder('Add transaction')
    const amount = page.getByPlaceholder('-0.00')
    await expect(description).toBeFocused()
    await expect(page.getByRole('button', { name: 'Cancel' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    await description.fill('ZZ Coffee')
    await description.press('Enter')
    await amount.fill('-4.25')
    await description.fill('')
    await amount.press('Enter')
    await expect(toast(page)).toHaveCount(0)
    expect(await storedTransaction(app, '')).toBeUndefined()

    await description.fill('ZZ Coffee')
    await amount.press('Enter')
    await expect(toast(page).filter({ hasText: 'Transaction created' })).toBeVisible()
    const row = rowFor(page, 'ZZ Coffee')
    await expect(row).toContainText('-$4.25')
    await expect(row).toContainText('Everyday Checking')
    await expect(row).toContainText('Sep 24, 2026')

    // the entry row clears for the next entry and keeps focus on the description
    await expect(description).toHaveValue('')
    await expect(amount).toHaveValue('')
    await expect(description).toBeFocused()

    const stored = await storedTransaction(app, 'ZZ Coffee')
    expect(stored.amount).toBe(-4250)
    expect(stored.category_id).toBeNull()

    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(description).toBeHidden()
    await expect(page.getByRole('button', { name: 'New Transaction' })).toBeVisible()
  })

  test('keeps the chosen category for rapid entry and Escape clears the drafts', async ({
    app
  }) => {
    const { page } = app
    await openTransactions(app)
    await page.getByRole('button', { name: 'New Transaction' }).click()
    const description = page.getByPlaceholder('Add transaction')
    const amount = page.getByPlaceholder('-0.00')

    await description.fill('ZZ Draft')
    await amount.fill('-9')
    await description.press('Escape')
    await expect(description).toHaveValue('')
    await expect(amount).toHaveValue('')

    const entryRow = page.getByRole('row').filter({ has: description })
    await entryRow.getByRole('button', { name: 'Uncategorized' }).click()
    await page.getByRole('option', { name: /Groceries/ }).click()
    await expect(entryRow.getByRole('button', { name: /Groceries/ })).toBeVisible()

    await description.fill('ZZ Groceries')
    await amount.fill('-31.2')
    await amount.press('Enter')
    await expect(rowFor(page, 'ZZ Groceries').filter({ hasText: '-$31.20' })).toBeVisible()
    const stored = await storedTransaction(app, 'ZZ Groceries')
    expect(stored.category_id).not.toBeNull()
    // the category is spent with the entry
    await expect(entryRow.getByRole('button', { name: 'Uncategorized' })).toBeVisible()
  })

  test('the palette intent opens the create row and is cleaned from the URL', async ({ app }) => {
    const { page } = app
    await openTransactions(app, `${ROUTE}&create=true`)
    await expect(page.getByPlaceholder('Add transaction')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await expect(page).not.toHaveURL(/create/)
    await expect(page).toHaveURL(/tab=transactions/)
  })
})

test.describe('selection and bulk actions', () => {
  test('checkbox, shift-click range and the header checkbox drive the selection', async ({
    app
  }) => {
    const { page } = app
    await openTransactions(app)
    const boxes = selectBoxes(page)

    await boxes.nth(0).click()
    await expect(page.getByText('1 selected')).toBeVisible()
    await expect(dataRows(page).nth(2)).toHaveAttribute('data-state', 'selected')

    await boxes.nth(4).click({ modifiers: ['Shift'] })
    await expect(page.getByText('5 selected')).toBeVisible()
    await expect(page.locator('tbody tr[data-state="selected"]')).toHaveCount(5)

    // shift again from the same anchor shrinks nothing it did not select; a plain click toggles one off
    await boxes.nth(2).click()
    await expect(page.getByText('4 selected')).toBeVisible()

    await page.getByRole('button', { name: 'Clear selection' }).click()
    await expect(page.getByText(/ selected$/)).toHaveCount(0)

    await page.getByRole('checkbox', { name: 'Select all' }).click()
    // every loaded row but the two pending ones
    await expect(page.getByText('48 selected')).toBeVisible()
    await page.getByRole('checkbox', { name: 'Select all' }).click()
    await expect(page.getByText(/ selected$/)).toHaveCount(0)
  })

  test('sets a category for the selection from the bar button', async ({ app }) => {
    const { page } = app
    await openTransactions(app)
    const ids = await app.sql<{ id: number }>(
      `SELECT id FROM transactions WHERE pending = 0 AND deleted_at IS NULL ORDER BY effective_date DESC, id DESC LIMIT 3`
    )

    await selectBoxes(page).nth(0).click()
    await selectBoxes(page)
      .nth(2)
      .click({ modifiers: ['Shift'] })
    await expect(page.getByText('3 selected')).toBeVisible()
    await selectionBar(page).getByRole('button', { name: 'Set category' }).click()
    await page.getByPlaceholder('Search categories...').fill('subscriptions')
    await page.getByRole('option', { name: /Subscriptions/ }).click()

    await expect(page.getByPlaceholder('Search categories...')).toBeHidden()
    for (const row of await dataRows(page)
      .filter({ has: page.getByRole('checkbox', { name: 'Select row' }) })
      .all()
      .then((all) => all.slice(0, 3))) {
      await expect(row).toContainText('Subscriptions')
    }
    // the selection stays so another action can follow
    await expect(page.getByText('3 selected')).toBeVisible()
    await expect
      .poll(async () => {
        const stored = await app.sql<{ name: string }>(
          `SELECT c.name FROM transactions t JOIN categories c ON c.id = t.category_id WHERE t.id IN (${ids.map((i) => i.id).join(',')})`
        )
        return stored.filter((s) => s.name.includes('Subscriptions')).length
      })
      .toBe(3)
  })

  test('the c shortcut opens the category picker', async ({ app }) => {
    const { page } = app
    await openTransactions(app)
    await selectBoxes(page).nth(0).click()
    await selectBoxes(page).nth(0).blur()
    await page.locator('body').press('c')

    const search = page.getByPlaceholder('Search categories...')
    await expect(search).toBeVisible()
    // the shortcut letter must not be typed into the search it just opened
    await expect(search).toHaveValue('')
    await search.fill('groceries')
    await page.getByRole('option', { name: /Groceries/ }).click()
    await expect(dataRows(page).nth(2)).toContainText('Groceries')
  })

  test('deletes with a confirm dialog that counts the rows', async ({ app }) => {
    const { page } = app
    await openTransactions(app)
    const [{ n: before }] = await app.sql<{ n: number }>(
      'SELECT count(*) n FROM transactions WHERE deleted_at IS NULL'
    )

    await selectBoxes(page).nth(0).click()
    await selectionBar(page).getByRole('button', { name: 'Delete' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Delete this transaction?')).toBeVisible()
    await dialog.getByRole('button', { name: /^Cancel/ }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText('1 selected')).toBeVisible()

    await selectBoxes(page)
      .nth(2)
      .click({ modifiers: ['Shift'] })
    await expect(page.getByText('3 selected')).toBeVisible()
    await selectionBar(page).getByRole('button', { name: 'Delete' }).click()
    await expect(dialog.getByText('Delete 3 transactions?')).toBeVisible()
    await dialog.getByRole('button', { name: 'Delete' }).click()

    await expect(dialog).toBeHidden()
    await expect
      .poll(
        async () =>
          (
            await app.sql<{ n: number }>(
              'SELECT count(*) n FROM transactions WHERE deleted_at IS NULL'
            )
          )[0].n
      )
      .toBe(before - 3)
  })

  test('the d shortcut asks before deleting, and Escape backs out', async ({ app }) => {
    const { page } = app
    await openTransactions(app)
    await selectBoxes(page).nth(0).click()
    await selectBoxes(page).nth(0).blur()
    await page.locator('body').press('d')

    await expect(page.getByRole('dialog').getByText('Delete this transaction?')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()
    const [{ n }] = await app.sql<{ n: number }>(
      'SELECT count(*) n FROM transactions WHERE deleted_at IS NOT NULL'
    )
    expect(n).toBe(0)
  })

  test('shortcut letters are ignored while typing in an input', async ({ app }) => {
    const { page } = app
    await openTransactions(app)
    await selectBoxes(page).nth(0).click()
    await page.getByRole('button', { name: 'New Transaction' }).click()
    const description = page.getByPlaceholder('Add transaction')
    await description.pressSequentially('dcd')

    await expect(description).toHaveValue('dcd')
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByPlaceholder('Search categories...')).toBeHidden()
    await expect(page.getByText('1 selected')).toBeVisible()
  })

  test('Ctrl+Z restores bulk-deleted rows and Ctrl+Y deletes them again', async ({ app }) => {
    const { page } = app
    await openTransactions(app)
    const first = (await dataRows(page).nth(2).locator('td').nth(3).innerText()).trim()
    const [{ n: before }] = await app.sql<{ n: number }>(
      'SELECT count(*) n FROM transactions WHERE deleted_at IS NULL'
    )
    const live = async (): Promise<number> =>
      (
        await app.sql<{ n: number }>('SELECT count(*) n FROM transactions WHERE deleted_at IS NULL')
      )[0].n

    await selectBoxes(page).nth(0).click()
    await selectBoxes(page).nth(1).click()
    await page.locator('body').press('d')
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    await expect.poll(live).toBe(before - 2)
    await expect(page.getByRole('dialog')).toBeHidden()

    await page.locator('body').press(`${app.mod}+z`)
    await expect.poll(live).toBe(before)
    await expect(toast(page).getByRole('button', { name: 'Redo' })).toBeVisible()
    await expect(rowFor(page, first).first()).toBeVisible()
    // the delete cleared the selection, so the restored rows come back unselected
    await expect(selectBoxes(page).nth(0)).not.toBeChecked()
    await expect(selectBoxes(page).nth(1)).not.toBeChecked()

    await page.locator('body').press(`${app.mod}+y`)
    await expect.poll(live).toBe(before - 2)
    await expect(toast(page).getByRole('button', { name: 'Undo' })).toBeVisible()
  })
})

test.describe('auto-categorize in the bulk bar', () => {
  test('is disabled until a model is downloaded', async ({ app }) => {
    const { page } = app
    await openTransactions(app)
    await selectBoxes(page).nth(0).click()
    const button = selectionBar(page).getByRole('button', { name: 'Auto-categorize' })
    await expect(button).toBeDisabled()
    await expect(button).toHaveAttribute('title', 'Download a model in Settings to use this')

    await app.bridge((b) => b.llm.ready())
    await expect(button).toBeEnabled()
    await expect(button).toHaveAttribute('title', 'Auto-categorize (a)')
  })
})
