import type { Locator, Page } from '@playwright/test'
import { expect, test, type App } from '../fixtures'

const settingsDialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Settings' })

async function storedSetting(app: App, key: string): Promise<unknown> {
  const rows = await app.sql<{ value: string }>(`SELECT value FROM settings WHERE key = '${key}'`)
  return rows.length > 0 ? JSON.parse(rows[0].value) : undefined
}

// the block a group heading belongs to (heading row, chips, add-category row)
const groupBlock = (page: Page, name: string): Locator =>
  settingsDialog(page).getByRole('heading', { name, exact: true }).locator('xpath=../..')

// chips reveal their rename/delete buttons on hover
// a chip's rename/delete buttons slide in on hover or focus; focusing the
// button and pressing Enter avoids clicking it mid-animation
async function chipAction(page: Page, action: 'Rename' | 'Delete', name: string): Promise<void> {
  const button = settingsDialog(page).getByRole('button', { name: `${action} category ${name}` })
  await button.focus()
  await button.press('Enter')
}

// the one open inline rename form
const renameInput = (dialog: Locator): Locator =>
  dialog
    .locator('form')
    .filter({ has: dialog.page().getByRole('button', { name: 'Save' }) })
    .getByRole('textbox')

test.describe('Settings > Categories', () => {
  test('lists the default groups, ungrouped and read-only system categories', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=categories' })
    const dialog = settingsDialog(page)
    for (const group of ['🎉 Wants', '📌 Needs', '💰 Savings & Debt']) {
      await expect(dialog.getByRole('heading', { name: group, exact: true })).toBeVisible()
    }
    await expect(dialog.getByRole('heading', { name: 'Ungrouped' })).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'System' })).toBeVisible()

    for (const system of ['🏦 Starting balance', '💵 Income', '🔄 Transfers']) {
      await expect(dialog.getByText(system, { exact: true })).toBeVisible()
    }
    await expect(dialog.getByRole('button', { name: /category 🔄 Transfers/ })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: /category 💵 Income/ })).toHaveCount(0)
  })

  test('adds a group, then a category inside it and one ungrouped', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=categories' })
    const dialog = settingsDialog(page)

    const addGroup = dialog.getByRole('button', { name: 'Add group' })
    await expect(addGroup).toBeDisabled()
    await dialog.getByPlaceholder('New group name').fill('Pets')
    await addGroup.click()
    await expect(dialog.getByRole('heading', { name: 'Pets', exact: true })).toBeVisible()
    await expect(dialog.getByPlaceholder('New group name')).toHaveValue('')

    const pets = groupBlock(page, 'Pets')
    await pets.getByRole('button', { name: 'Add category' }).click()
    await pets.getByPlaceholder('Category name').fill('Vet')
    await pets.getByPlaceholder('Category name').press('Enter')
    await expect(pets.getByText('Vet', { exact: true })).toBeVisible()

    const ungrouped = groupBlock(page, 'Ungrouped')
    await ungrouped.getByRole('button', { name: 'Add category' }).click()
    await ungrouped.getByPlaceholder('Category name').fill('Misc')
    await ungrouped.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(ungrouped.getByText('Misc', { exact: true })).toBeVisible()

    const rows = await app.sql<{ name: string; group_name: string | null }>(
      `SELECT c.name, g.name AS group_name FROM categories c
       LEFT JOIN category_groups g ON g.id = c.group_id WHERE c.name IN ('Vet', 'Misc')
       ORDER BY c.name`
    )
    expect(rows).toEqual([
      { name: 'Misc', group_name: null },
      { name: 'Vet', group_name: 'Pets' }
    ])
  })

  test('Escape cancels an add-category input without closing Settings', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=categories' })
    const ungrouped = groupBlock(page, 'Ungrouped')
    await ungrouped.getByRole('button', { name: 'Add category' }).click()
    await ungrouped.getByPlaceholder('Category name').fill('Draft')
    await page.keyboard.press('Escape')
    await expect(ungrouped.getByPlaceholder('Category name')).toBeHidden()
    await expect(settingsDialog(page)).toBeVisible()
    await expect(page).toHaveURL(/settings=categories/)
  })

  test('renames a category inline; Escape cancels without closing Settings', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=categories' })
    const dialog = settingsDialog(page)
    await chipAction(page, 'Rename', '🛍️ Shopping')
    const input = renameInput(dialog)
    await input.fill('🛍️ Retail')
    await page.keyboard.press('Escape')
    await expect(input).toBeHidden()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('🛍️ Shopping', { exact: true })).toBeVisible()

    await chipAction(page, 'Rename', '🛍️ Shopping')
    const again = renameInput(dialog)
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled()
    await again.fill('🛍️ Retail')
    await again.press('Enter')
    await expect(dialog.getByText('🛍️ Retail', { exact: true })).toBeVisible()
    await expect(dialog.getByText('🛍️ Shopping', { exact: true })).toBeHidden()
    expect(await app.sql(`SELECT id FROM categories WHERE name = '🛍️ Retail'`)).toHaveLength(1)
  })

  test('renames a group inline', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=categories' })
    const dialog = settingsDialog(page)
    await dialog.getByRole('button', { name: 'Rename group 🎉 Wants' }).click()
    const input = renameInput(dialog)
    await input.fill('🎉 Fun')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: '🎉 Wants', exact: true })).toBeVisible()

    await dialog.getByRole('button', { name: 'Rename group 🎉 Wants' }).click()
    await renameInput(dialog).fill('🎉 Fun')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog.getByRole('heading', { name: '🎉 Fun', exact: true })).toBeVisible()
  })

  test('deleting a category toasts with Undo, and Undo restores it', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=categories' })
    const dialog = settingsDialog(page)
    await chipAction(page, 'Delete', '🛍️ Shopping')
    await expect(dialog.getByText('🛍️ Shopping', { exact: true })).toBeHidden()
    await expect(page.getByText('Deleted “🛍️ Shopping”')).toBeVisible()

    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(dialog.getByText('🛍️ Shopping', { exact: true })).toBeVisible()
  })

  test('deleting a group toasts with Undo, and Undo brings its categories back', async ({
    app
  }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=categories' })
    const dialog = settingsDialog(page)
    await dialog.getByRole('button', { name: 'Delete group 🎉 Wants' }).click()
    await expect(dialog.getByRole('heading', { name: '🎉 Wants', exact: true })).toBeHidden()
    await expect(page.getByText('Deleted “🎉 Wants”')).toBeVisible()

    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(dialog.getByRole('heading', { name: '🎉 Wants', exact: true })).toBeVisible()
    await expect(dialog.getByText('🍽️ Dining Out', { exact: true })).toBeVisible()
  })

  test('Reset to defaults asks first, then drops custom groups', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=categories' })
    const dialog = settingsDialog(page)
    await dialog.getByPlaceholder('New group name').fill('Pets')
    await dialog.getByRole('button', { name: 'Add group' }).click()
    await expect(dialog.getByRole('heading', { name: 'Pets', exact: true })).toBeVisible()

    await dialog.getByRole('button', { name: 'Reset', exact: true }).click()
    const confirm = page.getByRole('dialog', { name: 'Reset to defaults?' })
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(confirm).toBeHidden()
    await expect(dialog.getByRole('heading', { name: 'Pets', exact: true })).toBeVisible()

    await dialog.getByRole('button', { name: 'Reset', exact: true }).click()
    await page
      .getByRole('dialog', { name: 'Reset to defaults?' })
      .getByRole('button', { name: 'Reset', exact: true })
      .click()
    await expect(dialog.getByRole('heading', { name: 'Pets', exact: true })).toBeHidden()
    await expect(dialog.getByRole('heading', { name: '🎉 Wants', exact: true })).toBeVisible()
    await expect(dialog.getByText('🔄 Transfers', { exact: true })).toBeVisible()
  })

  test('the transfers toggle persists detectTransfers', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=categories' })
    const toggle = settingsDialog(page).getByRole('switch', {
      name: 'Detect transfers between accounts on sync'
    })
    await expect(toggle).toBeChecked()
    await toggle.click()
    await expect(toggle).not.toBeChecked()
    await expect.poll(() => storedSetting(app, 'detectTransfers')).toBe(false)
    await toggle.click()
    await expect.poll(() => storedSetting(app, 'detectTransfers')).toBe(true)
  })
})

const ruleRow = (page: Page, name: string): Locator =>
  settingsDialog(page)
    .getByText(name, { exact: true })
    .locator('xpath=ancestor::div[contains(@class, "gap-3")][1]')

async function pickOption(page: Page, trigger: Locator, option: string): Promise<void> {
  await trigger.click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

async function ruleNames(app: App): Promise<string[]> {
  const rows = await app.sql<{ name: string }>('SELECT name FROM rules ORDER BY priority, id')
  return rows.map((r) => r.name)
}

test.describe('Settings > Rules', () => {
  test('lists the household rules with readable descriptions', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=rules' })
    const dialog = settingsDialog(page)
    await expect(dialog.getByRole('heading', { name: 'Your rules' })).toBeVisible()
    await expect(
      dialog.getByText('If description contains "ACME CORP PAYROLL" → set category to 💵 Income')
    ).toBeVisible()
    await expect(
      dialog.getByText(
        `If description contains "TRADER JOE'S" or "SAFEWAY" or "WHOLE FOODS" → set category to 🛒 Groceries`
      )
    ).toBeVisible()
    expect(await ruleNames(app)).toHaveLength(8)
    for (const name of ['Paycheck', 'Rent', 'Groceries', 'Fuel', 'Interest and dividends']) {
      await expect(dialog.getByText(name, { exact: true })).toBeVisible()
    }
    await expect(dialog.getByRole('button', { name: 'Move up' }).first()).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'Move down' }).last()).toBeDisabled()
  })

  test('shows the empty state when there are no rules, and gates Apply', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=rules', dataset: 'starter' })
    const dialog = settingsDialog(page)
    await expect(dialog.getByText('No rules yet')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled()
  })

  test('the automation toggles persist', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=rules' })
    const dialog = settingsDialog(page)
    await dialog.getByRole('switch', { name: 'Apply rules automatically on sync' }).click()
    await expect.poll(() => storedSetting(app, 'applyRulesOnSync')).toBe(false)
    await dialog.getByRole('switch', { name: 'Suggest rules from repeated categorizing' }).click()
    await expect.poll(() => storedSetting(app, 'ruleSuggestionsEnabled')).toBe(false)
  })

  test('adds a rule; a phrase needs Enter or Add before the rule can save', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=rules' })
    const dialog = settingsDialog(page)
    await dialog.getByRole('button', { name: 'Add rule' }).click()
    await expect(dialog.getByRole('heading', { name: 'New rule' })).toBeVisible()
    const create = dialog.getByRole('button', { name: 'Create rule' })
    await expect(create).toBeDisabled()

    await dialog.getByLabel('Name').fill('Coffee')
    await pickOption(
      page,
      dialog.getByRole('combobox').filter({ hasText: 'Choose a category' }),
      '🍽️ Dining Out'
    )
    const phrase = dialog.getByPlaceholder('add a phrase')
    await phrase.fill('BLUE BOTTLE')
    // typed but not committed: still no condition
    await expect(create).toBeDisabled()
    await phrase.press('Enter')
    await expect(dialog.getByText('BLUE BOTTLE', { exact: true })).toBeVisible()
    await expect(phrase).toHaveValue('')
    await phrase.fill('PEETS')
    await dialog.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(dialog.getByText('PEETS', { exact: true })).toBeVisible()
    await expect(create).toBeEnabled()
    await create.click()

    await expect(dialog.getByRole('heading', { name: 'New rule' })).toBeHidden()
    await expect(
      dialog.getByText(
        'If description contains "BLUE BOTTLE" or "PEETS" → set category to 🍽️ Dining Out'
      )
    ).toBeVisible()
    expect((await ruleNames(app)).at(-1)).toBe('Coffee')
  })

  test('Escape cancels the inline rule form without closing Settings', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=rules' })
    const dialog = settingsDialog(page)
    await dialog.getByRole('button', { name: 'Add rule' }).click()
    await expect(dialog.getByRole('heading', { name: 'New rule' })).toBeVisible()
    await dialog.getByLabel('Name').press('Escape')
    await expect(dialog.getByRole('heading', { name: 'New rule' })).toBeHidden()
    await expect(dialog).toBeVisible()
    expect(await ruleNames(app)).toHaveLength(8)
  })

  test('a between amount needs a second value that is not below the first', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=rules' })
    const dialog = settingsDialog(page)
    await dialog.getByRole('button', { name: 'Add rule' }).click()
    await dialog.getByLabel('Name').fill('Mid-size')
    await pickOption(
      page,
      dialog.getByRole('combobox').filter({ hasText: 'Choose a category' }),
      '🛍️ Shopping'
    )
    await pickOption(
      page,
      dialog.getByRole('combobox').filter({ hasText: 'is more than' }),
      'is between'
    )

    const first = dialog.getByPlaceholder('amount').first()
    const second = dialog.getByPlaceholder('amount').last()
    const create = dialog.getByRole('button', { name: 'Create rule' })
    const message = dialog.getByText(
      'The second amount for a between range must be at least the first.'
    )
    await first.fill('50')
    await expect(message).toBeVisible()
    await expect(create).toBeDisabled()
    await second.fill('40')
    await expect(message).toBeVisible()
    await second.fill('60')
    await expect(message).toBeHidden()
    await expect(create).toBeEnabled()
    await create.click()
    await expect(
      dialog.getByText('If amount between $50 and $60 → set category to 🛍️ Shopping')
    ).toBeVisible()
  })

  test('a day-of-month window must run low to high', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=rules' })
    const dialog = settingsDialog(page)
    await dialog.getByRole('button', { name: 'Add rule' }).click()
    await dialog.getByLabel('Name').fill('Early month')
    await pickOption(
      page,
      dialog.getByRole('combobox').filter({ hasText: 'Choose a category' }),
      '🏠 Housing'
    )
    const message = dialog.getByText('The day-of-month start must be on or before the end.')
    await dialog.getByPlaceholder('1', { exact: true }).fill('20')
    await dialog.getByPlaceholder('31').fill('10')
    await expect(message).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Create rule' })).toBeDisabled()
    await dialog.getByPlaceholder('31').fill('25')
    await expect(message).toBeHidden()
    await dialog.getByRole('button', { name: 'Create rule' }).click()
    await expect(
      dialog.getByText('If day of month 20–25 → set category to 🏠 Housing')
    ).toBeVisible()
  })

  test('edits a rule in place', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=rules' })
    const dialog = settingsDialog(page)
    await dialog.getByRole('button', { name: 'Edit rule Fuel' }).click()
    await expect(dialog.getByRole('heading', { name: 'Edit rule' })).toBeVisible()
    await expect(dialog.getByLabel('Name')).toHaveValue('Fuel')
    await dialog.getByLabel('Name').fill('Gas stations')
    await dialog.getByPlaceholder('add a phrase').fill('CHEVRON')
    await dialog.getByPlaceholder('add a phrase').press('Enter')
    await dialog.getByRole('button', { name: 'Save rule' }).click()

    await expect(dialog.getByRole('heading', { name: 'Edit rule' })).toBeHidden()
    await expect(dialog.getByText('Gas stations', { exact: true })).toBeVisible()
    await expect(dialog.getByText('Fuel', { exact: true })).toBeHidden()
    await expect(
      dialog.getByText(
        'If description contains "SHELL OIL" or "CHEVRON" → set category to 🚗 Transportation'
      )
    ).toBeVisible()
    expect(await ruleNames(app)).toContain('Gas stations')
  })

  test('the enable switch persists', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=rules' })
    const toggle = settingsDialog(page).getByRole('switch', { name: 'Enable rule Fuel' })
    await expect(toggle).toBeChecked()
    await toggle.click()
    await expect(toggle).not.toBeChecked()
    await expect
      .poll(
        async () =>
          (await app.sql<{ enabled: number }>(`SELECT enabled FROM rules WHERE name = 'Fuel'`))[0]
            .enabled
      )
      .toBe(0)
  })

  test('moves a rule up and down', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=rules' })
    const dialog = settingsDialog(page)
    const before = await ruleNames(app)
    expect(before.slice(0, 3)).toEqual(['Paycheck', 'Rent', 'Groceries'])

    await ruleRow(page, 'Rent').getByRole('button', { name: 'Move up' }).click()
    await expect.poll(() => ruleNames(app)).toEqual(['Rent', 'Paycheck', ...before.slice(2)])
    await expect(dialog.getByRole('button', { name: 'Move up' }).first()).toBeDisabled()

    await ruleRow(page, 'Rent').getByRole('button', { name: 'Move down' }).click()
    await expect.poll(() => ruleNames(app)).toEqual(before)
  })

  test('deleting a rule toasts with Undo, and Undo restores it', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=rules' })
    const dialog = settingsDialog(page)
    await dialog.getByRole('button', { name: 'Delete rule Insurance' }).click()
    await expect(dialog.getByText('Insurance', { exact: true })).toBeHidden()
    await expect(page.getByText('Deleted “Insurance”')).toBeVisible()
    expect(await ruleNames(app)).not.toContain('Insurance')

    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(dialog.getByText('Insurance', { exact: true })).toBeVisible()
    expect(await ruleNames(app)).toContain('Insurance')
  })
})

test.describe('Settings > Rules > Apply rules now', () => {
  test('previews nothing when every rule has already run', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=rules' })
    const dialog = settingsDialog(page)
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(page).toHaveURL(/settingsPage=apply-rules/)
    await expect(dialog.getByRole('heading', { name: 'Apply rules' })).toBeVisible()
    await expect(dialog.getByText('No transactions match your rules right now.')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Nothing to apply' })).toBeDisabled()
    await expect(
      dialog.getByRole('checkbox', { name: 'Override existing categories' })
    ).not.toBeChecked()

    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog.getByRole('heading', { name: 'Your rules' })).toBeVisible()
    await expect(page).not.toHaveURL(/settingsPage=/)
  })

  test('override widens the preview; Apply writes categories and returns to Rules', async ({
    app
  }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=rules' })
    const dialog = settingsDialog(page)
    await dialog.getByRole('button', { name: 'Add rule' }).click()
    await dialog.getByLabel('Name').fill('Burritos')
    await dialog.getByPlaceholder('add a phrase').fill('CHIPOTLE')
    await dialog.getByPlaceholder('add a phrase').press('Enter')
    await pickOption(
      page,
      dialog.getByRole('combobox').filter({ hasText: 'Choose a category' }),
      '🛒 Groceries'
    )
    await dialog.getByRole('button', { name: 'Create rule' }).click()
    await expect(dialog.getByText('Burritos', { exact: true })).toBeVisible()

    const count = async (where: string): Promise<number> => {
      const [{ n }] = await app.sql<{ n: number }>(
        `SELECT count(*) AS n FROM transactions WHERE description LIKE '%CHIPOTLE%' AND ${where}`
      )
      return n
    }
    const uncategorized = await count('category_id IS NULL AND deleted_at IS NULL')
    const all = await count('deleted_at IS NULL')
    expect(uncategorized).toBeGreaterThan(0)
    expect(all).toBeGreaterThan(uncategorized)

    await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(dialog.getByRole('button', { name: `Apply to ${uncategorized}` })).toBeVisible()
    await expect(dialog.getByText('Burritos', { exact: true })).toBeVisible()

    await dialog.getByRole('checkbox', { name: 'Override existing categories' }).click()
    await expect(dialog.getByRole('button', { name: `Apply to ${all}` })).toBeVisible()
    await expect(dialog.getByText('🍽️ Dining Out').first()).toBeVisible()
    await dialog.getByRole('checkbox', { name: 'Override existing categories' }).click()
    await expect(dialog.getByRole('button', { name: `Apply to ${uncategorized}` })).toBeVisible()

    await dialog.getByRole('button', { name: `Apply to ${uncategorized}` }).click()
    await expect(dialog.getByRole('heading', { name: 'Your rules' })).toBeVisible()
    await expect.poll(() => count('category_id IS NULL AND deleted_at IS NULL')).toBe(0)
    const [{ n: groceries }] = await app.sql<{ n: number }>(
      `SELECT count(*) AS n FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE t.description LIKE '%CHIPOTLE%' AND c.name = '🛒 Groceries'`
    )
    expect(groceries).toBe(uncategorized)

    // the run is on the Activity feed, attributed to rules
    await page.keyboard.press('Escape')
    await page.getByRole('link', { name: 'Activity', exact: true }).click()
    await expect(page.getByText(/Rule "Burritos" categorized/)).toBeVisible()
  })
})

test.describe('Settings > Rules > Suggestions', () => {
  test('turning suggestions off hides the pending one, and on brings it back', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=rules' })
    const dialog = settingsDialog(page)
    const button = dialog.getByRole('button', { name: /^Suggestions\s*1$/ })
    const toggle = dialog.getByRole('switch', { name: 'Suggest rules from repeated categorizing' })
    await expect(button).toBeVisible()
    await toggle.click()
    await expect(button).toBeHidden()
    await toggle.click()
    await expect(button).toBeVisible()
  })

  test('the Suggestions button opens the page and Create rule drafts one rule', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=rules' })
    const dialog = settingsDialog(page)
    await dialog.getByRole('button', { name: /^Suggestions\s*1$/ }).click()
    await expect(page).toHaveURL(/settingsPage=suggestions/)
    await expect(dialog.getByRole('heading', { name: 'Suggestions' })).toBeVisible()
    await expect(dialog.getByText('🍽️ Dining Out', { exact: true })).toBeVisible()
    await expect(dialog.getByText('26 transactions')).toBeVisible()

    await dialog.getByRole('button', { name: 'Create rule' }).click()
    await expect(page).not.toHaveURL(/settingsPage=/)
    await expect(dialog.getByRole('heading', { name: 'New rule' })).toBeVisible()
    await expect(dialog.getByLabel('Name')).toHaveValue('TACOS EL GORDO → 🍽️ Dining Out')
    await expect(dialog.getByText('TACOS EL GORDO', { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Create rule' }).click()

    await expect(dialog.getByText('TACOS EL GORDO → 🍽️ Dining Out', { exact: true })).toBeVisible()
    // saving accepts the suggestion, so the button goes away
    await expect(dialog.getByRole('button', { name: /^Suggestions/ })).toBeHidden()
    expect(await app.sql('SELECT status FROM rule_suggestions')).toEqual([{ status: 'accepted' }])
  })

  test('Dismiss clears the group and leaves the empty state', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=rules&settingsPage=suggestions' })
    const dialog = settingsDialog(page)
    await dialog.getByRole('button', { name: 'Dismiss' }).click()
    await expect(dialog.getByText('No suggestions')).toBeVisible()
    await dialog.getByRole('button', { name: 'Back to Rules' }).click()
    await expect(dialog.getByRole('button', { name: /^Suggestions/ })).toBeHidden()
  })
})
