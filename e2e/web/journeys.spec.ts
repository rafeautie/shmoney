import type { Locator, Page } from '@playwright/test'
import { expect, test, type App } from '../fixtures'

const settingsDialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Settings' })
const toast = (page: Page): Locator => page.locator('[data-sonner-toast]')
const dataRows = (page: Page): Locator =>
  page.locator('tbody tr').filter({ has: page.locator('td') })
const rowFor = (page: Page, description: string): Locator =>
  page.getByRole('row').filter({ hasText: description })

const link = (page: Page, name: string): Locator => page.getByRole('link', { name, exact: true })

async function pick(trigger: Locator, option: string): Promise<void> {
  const page = trigger.page()
  await trigger.click()
  await page.getByRole('option', { name: option, exact: true }).click()
  await expect(page.getByRole('listbox')).toHaveCount(0)
}

/** the labelled select inside the widget editor */
const widgetField = (dialog: Locator, label: string): Locator =>
  dialog
    .locator('div.space-y-2')
    .filter({ has: dialog.page().getByText(label, { exact: true }) })
    .getByRole('combobox')

// a chip's rename/delete buttons slide in on hover or focus; focusing the
// button and pressing Enter avoids clicking it mid-animation
async function chipAction(page: Page, action: 'Rename' | 'Delete', name: string): Promise<void> {
  const button = settingsDialog(page).getByRole('button', { name: `${action} category ${name}` })
  await button.focus()
  await button.press('Enter')
}

// react-query keeps reads for 30s, so after writing behind the UI's back age the
// cache and navigate away and back
async function refetch(app: App, away: string, back: string): Promise<void> {
  await app.page.clock.fastForward(31_000)
  await link(app.page, away).click()
  await link(app.page, back).click()
}

test('a new user connects, categorizes, and turns the habit into a rule', async ({ app }) => {
  test.setTimeout(90_000)
  const { page } = app
  const MERCHANT = 'STARBUCKS STORE 08812'

  await test.step('onboard and connect the demo bank', async () => {
    await app.open({ dataset: 'none', onboarding: true })
    const dialog = page.getByRole('dialog')
    for (const title of [
      'Welcome to shmoney!',
      'What you can do',
      'Choose your AI model',
      'Budget with envelopes',
      'Connect with SimpleFIN',
      'Paste your setup token'
    ]) {
      await expect(dialog.getByText(title)).toBeVisible()
      if (title !== 'Paste your setup token')
        await dialog.getByRole('button', { name: 'Next' }).click()
    }
    await dialog.getByLabel('Setup token').fill('demo:starter')
    await dialog.getByRole('button', { name: 'Connect' }).click()
    await expect(dialog.getByText("You're all set!")).toBeVisible()
    await dialog.getByRole('button', { name: 'View accounts' }).click()
    await expect(dialog).toBeHidden()
  })

  await test.step('the accounts are listed', async () => {
    await expect(page.getByRole('row', { name: /Checking/ }).first()).toBeVisible()
    await expect(page.getByRole('row', { name: /Cash Back Card/ })).toBeVisible()
    await expect(page.getByText('No accounts yet')).toBeHidden()
  })

  await test.step('categorize three identical rows the same way', async () => {
    await page.getByRole('tab', { name: 'All transactions' }).click()
    await expect(dataRows(page).first()).toBeVisible()
    for (let i = 0; i < 3; i++) {
      const row = rowFor(page, MERCHANT).filter({ hasText: 'Uncategorized' }).first()
      await row.getByRole('button', { name: 'Uncategorized' }).click()
      await page.getByPlaceholder('Search categories...').fill('dining')
      await page.getByRole('option', { name: /Dining Out/ }).click()
      await expect(page.getByPlaceholder('Search categories...')).toBeHidden()
      await expect(rowFor(page, MERCHANT).filter({ hasText: 'Dining Out' })).toHaveCount(i + 1)
    }
  })

  await test.step('Activity offers a rule', async () => {
    await link(page, 'Activity').click()
    const section = page.locator('section').filter({ hasText: 'Needs review' })
    await expect(section).toContainText('1 rule suggestion')
    await expect(section).toContainText(MERCHANT)
    await expect(section).toContainText('🍽️ Dining Out')
    await page.getByRole('button', { name: 'Create rule' }).click()
    const editor = page.getByRole('dialog', { name: 'New rule' })
    await expect(editor.getByText(MERCHANT, { exact: true })).toBeVisible()
    await editor.getByRole('button', { name: 'Create rule' }).click()
    await expect(editor).toBeHidden()
    await expect(page.getByText('Needs review')).toBeHidden()
  })

  await test.step('the rule is listed in Settings', async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const dialog = settingsDialog(page)
    await dialog.getByRole('button', { name: 'Rules' }).click()
    await expect(dialog.getByText(`${MERCHANT} → 🍽️ Dining Out`, { exact: true })).toBeVisible()
  })

  await test.step('applying the rule sweeps up the rest of that merchant', async () => {
    const dialog = settingsDialog(page)
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(dialog.getByRole('heading', { name: 'Apply rules' })).toBeVisible()
    await expect(dialog.getByText('22 transactions')).toBeVisible()
    await dialog.getByRole('button', { name: 'Apply to 22' }).click()
    await expect(dialog.getByRole('heading', { name: 'Your rules' })).toBeVisible()

    await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(dialog.getByText('No transactions match your rules right now.')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Nothing to apply' })).toBeDisabled()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    const [{ n }] = await app.sql<{ n: number }>(
      `SELECT count(*) AS n FROM transactions WHERE description = '${MERCHANT}' AND category_id IS NULL`
    )
    expect(n).toBe(0)
  })

  await test.step('the run shows up in Activity', async () => {
    await link(page, 'Activity').click()
    await expect(
      page.getByText(/Rule "STARBUCKS STORE 08812.*" categorized 22 transactions/)
    ).toBeVisible()
  })
})

test('an imported statement flows through the budget and a report, and a delete undoes', async ({
  app
}) => {
  test.setTimeout(90_000)
  const { page } = app
  const CSV = {
    name: 'trail.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      [
        'Date,Description,Amount',
        '2026-09-10,ZZ TRAIL SUPPLY,-45.00',
        '2026-09-11,ZZ TRAIL FUEL,-30.00',
        '2026-09-12,ZZ TRAIL SNACKS,-12.50',
        ''
      ].join('\n')
    )
  }
  const liveImported = async (app: App): Promise<number> =>
    (
      await app.sql<{ n: number }>(
        "SELECT count(*) AS n FROM transactions WHERE description LIKE 'ZZ TRAIL%' AND deleted_at IS NULL"
      )
    )[0].n
  await app.open()

  await test.step('import the file into a new account', async () => {
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Import transactions' })
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Choose file…' }).click()
    await (await chooser).setFiles(CSV)
    await dialog.getByRole('tab', { name: 'New account' }).click()
    await dialog.getByLabel('Name').fill('Trail Fund')
    await dialog.getByRole('button', { name: 'Next' }).click()
    await dialog.getByRole('button', { name: 'Next' }).click()
    await dialog.getByRole('button', { name: 'Import 3 transactions' }).click()
    await expect(page.getByText('Imported 3 transactions')).toBeVisible()
    await expect(dialog).toBeHidden()
    await page.getByRole('row', { name: /Trail Fund/ }).click()
    await expect(rowFor(page, 'ZZ TRAIL SUPPLY')).toContainText('-$45.00')
  })

  await test.step('recategorize one imported row', async () => {
    const row = rowFor(page, 'ZZ TRAIL SUPPLY')
    await row.getByRole('button', { name: 'Uncategorized' }).click()
    await page.getByPlaceholder('Search categories...').fill('emergency')
    await page.getByRole('option', { name: /Emergency Fund/ }).click()
    await expect(row.getByRole('button', { name: /Emergency Fund/ })).toBeVisible()
  })

  await test.step('budget an envelope for it and see the spend', async () => {
    await link(page, 'Budget').click()
    await page.getByRole('button', { name: 'Add envelope' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add envelope' })
    await dialog.getByRole('button', { name: 'Pick a category...' }).click()
    await page.getByRole('option', { name: /Emergency Fund/ }).click()
    await dialog.getByLabel('Monthly fill').fill('100')
    await dialog.getByRole('button', { name: 'Add envelope' }).click()
    await expect(dialog).toBeHidden()
    const row = page.getByRole('row', { name: /Emergency Fund/ })
    await expect(row).toContainText('$45.00 of $100.00')
    await expect(row).toContainText('$55.00')
  })

  await test.step('chart it in a report summary table', async () => {
    await link(page, 'Reports').click()
    await page.getByRole('button', { name: 'New report' }).click()
    await page.getByRole('menuitem', { name: 'Blank report' }).click()
    await expect(page.getByText('This report is empty')).toBeVisible()
    await page.getByRole('button', { name: 'Add widget' }).first().click()
    const dialog = page.getByRole('dialog')
    await pick(widgetField(dialog, 'Widget type'), 'Summary table')
    await dialog.getByLabel('Title').fill('Where it went')
    await dialog.getByRole('button', { name: 'Add widget' }).click()
    await expect(dialog).toBeHidden()

    const table = page
      .locator('[data-slot=card]')
      .filter({ has: page.getByRole('heading', { name: 'Where it went', level: 3 }) })
    const row = table.getByRole('row', { name: /Emergency Fund/ })
    await expect(row).toContainText('$45.00')

    // rows only drill once editing is done
    await page.getByRole('button', { name: 'Done' }).click()
    await row.click()
    await expect(page).toHaveURL(/#\/accounts\?tab=transactions/)
    await expect(page.getByRole('button', { name: '1 category' })).toBeVisible()
    await expect(dataRows(page)).toHaveCount(1)
    await expect(rowFor(page, 'ZZ TRAIL SUPPLY')).toContainText('-$45.00')
    await expect(rowFor(page, 'ZZ TRAIL SUPPLY')).toContainText('Trail Fund')
  })

  await test.step('select the imported rows and delete them', async () => {
    await page.getByRole('button', { name: 'Reset' }).click()
    await page.getByPlaceholder('Search transactions...').fill('ZZ TRAIL')
    await expect(dataRows(page)).toHaveCount(3)
    await page.getByRole('checkbox', { name: 'Select all' }).click()
    await expect(page.getByText('3 selected')).toBeVisible()
    await page.getByText('3 selected').locator('..').getByRole('button', { name: 'Delete' }).click()
    const confirm = page.getByRole('dialog')
    await expect(confirm.getByText('Delete 3 transactions?')).toBeVisible()
    await confirm.getByRole('button', { name: 'Delete' }).click()
    await expect(confirm).toBeHidden()
    await expect(page.getByText('No transactions match the current filters.')).toBeVisible()
    expect(await liveImported(app)).toBe(0)
  })

  await test.step('Ctrl+Z brings them back with their category', async () => {
    await page.locator('body').press(`${app.mod}+z`)
    await expect(dataRows(page)).toHaveCount(3)
    await expect(
      rowFor(page, 'ZZ TRAIL SUPPLY').getByRole('button', { name: /Emergency Fund/ })
    ).toBeVisible()
    expect(await liveImported(app)).toBe(3)
    await expect(toast(page).getByRole('button', { name: 'Redo' })).toBeVisible()
  })
})

test('deleting a category clears its envelope, rule and labels, and undo brings them all back', async ({
  app
}) => {
  test.setTimeout(90_000)
  const { page } = app
  await app.open()

  const [target] = await app.sql<{ id: number; name: string; rule: string; sample: string }>(`
    SELECT c.id, c.name,
      (SELECT r.name FROM rules r WHERE r.action LIKE '%"categoryId":' || c.id || '}%' LIMIT 1) AS rule,
      (SELECT t.description FROM transactions t WHERE t.category_id = c.id AND t.deleted_at IS NULL
        ORDER BY t.id LIMIT 1) AS sample
    FROM categories c
    WHERE c.system_key IS NULL
      AND EXISTS (SELECT 1 FROM budgets b WHERE b.category_id = c.id)
      AND EXISTS (SELECT 1 FROM rules r WHERE r.action LIKE '%"categoryId":' || c.id || '}%')
    ORDER BY (SELECT count(*) FROM transactions t WHERE t.category_id = c.id), c.id
    LIMIT 1`)
  const { id, name } = target
  const dialog = settingsDialog(page)
  const stored = async (): Promise<{ txns: number; budgets: number; rules: number }> => {
    const [row] = await app.sql<{ txns: number; budgets: number; rules: number }>(`
      SELECT
        (SELECT count(*) FROM transactions WHERE category_id = ${id} AND deleted_at IS NULL) AS txns,
        (SELECT count(*) FROM budgets WHERE category_id = ${id}) AS budgets,
        (SELECT count(*) FROM rules WHERE action LIKE '%"categoryId":${id}}%') AS rules`)
    return row
  }
  const before = await stored()
  expect(before.txns).toBeGreaterThan(0)
  expect(before.budgets).toBeGreaterThan(0)
  expect(before.rules).toBeGreaterThan(0)

  await test.step('it has an envelope, a rule and labelled transactions', async () => {
    await link(page, 'Budget').click()
    await expect(page.getByRole('row', { name: new RegExp(name) })).toBeVisible()
    await link(page, 'Activity').click()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await dialog.getByRole('button', { name: 'Rules' }).click()
    await expect(dialog.getByText(target.rule, { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Categories' }).click()
  })

  await test.step('delete the category', async () => {
    await chipAction(page, 'Delete', name)
    await expect(dialog.getByText(name, { exact: true })).toBeHidden()
    await expect(page.getByText(`Deleted “${name}”`)).toBeVisible()
    expect(await stored()).toEqual({ txns: 0, budgets: 0, rules: 0 })
  })

  await test.step('the rule is gone from Settings', async () => {
    await dialog.getByRole('button', { name: 'Rules' }).click()
    await expect(dialog.getByRole('heading', { name: 'Your rules' })).toBeVisible()
    await expect(dialog.getByText(target.rule, { exact: true })).toBeHidden()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  await test.step('the envelope is gone from the budget', async () => {
    await refetch(app, 'Goals', 'Budget')
    await expect(page.getByRole('row', { name: /Housing/ })).toBeVisible()
    await expect(page.getByRole('row', { name: new RegExp(name) })).toHaveCount(0)
  })

  await test.step('its transactions read Uncategorized', async () => {
    await link(page, 'Accounts').click()
    await page.getByRole('tab', { name: 'All transactions' }).click()
    await page.getByPlaceholder('Search transactions...').fill(target.sample)
    const rows = rowFor(page, target.sample)
    await expect(rows.first()).toBeVisible()
    await expect(rows.first().getByRole('button', { name: 'Uncategorized' })).toBeVisible()
    await expect(rows.getByRole('button', { name })).toHaveCount(0)
  })

  await test.step('undo from Activity restores all three', async () => {
    await link(page, 'Activity').click()
    const entry = page
      .getByText('Delete category', { exact: true })
      .locator('xpath=ancestor::*[contains(@class, "group/entry")][1]')
    await expect(entry).toBeVisible()
    await entry.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(entry.getByText(/^Undone/)).toBeVisible()
    expect(await stored()).toEqual(before)
  })

  await test.step('the envelope, rule and labels are back in the UI', async () => {
    await refetch(app, 'Goals', 'Budget')
    await expect(page.getByRole('row', { name: new RegExp(name) })).toBeVisible()

    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await dialog.getByRole('button', { name: 'Rules' }).click()
    await expect(dialog.getByText(target.rule, { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')

    await link(page, 'Accounts').click()
    await page.getByRole('tab', { name: 'All transactions' }).click()
    await page.getByPlaceholder('Search transactions...').fill(target.sample)
    await expect(
      rowFor(page, target.sample)
        .first()
        .getByRole('button', { name: new RegExp(name) })
    ).toBeVisible()
  })
})
