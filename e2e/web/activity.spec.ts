import type { Locator, Page } from '@playwright/test'
import { expect, test, type App } from '../fixtures'

const RUN = 'Sync with SimpleFIN'
const SUMMARY = 'Detected 36 transfers · 8 rules categorized 283 transactions'

async function storedSetting(app: App, key: string): Promise<unknown> {
  const rows = await app.sql<{ value: string }>(`SELECT value FROM settings WHERE key = '${key}'`)
  return rows.length > 0 ? JSON.parse(rows[0].value) : undefined
}

async function uncategorized(app: App): Promise<number> {
  const [{ n }] = await app.sql<{ n: number }>(
    'SELECT count(*) AS n FROM transactions WHERE category_id IS NULL AND deleted_at IS NULL'
  )
  return n
}

const filterChip = (page: Page, name: string): Locator =>
  page.getByRole('button', { name, exact: true })

// the collapsible a feed row's label sits in
const entryRow = (page: Page, label: string): Locator =>
  page
    .getByText(label, { exact: true })
    .locator('xpath=ancestor::*[contains(@class, "group/entry")][1]')

const runCard = (page: Page): Locator =>
  page
    .getByText(RUN, { exact: true })
    .locator('xpath=ancestor::*[contains(@class, "group/run")][1]')

const activityDot = (page: Page): Locator =>
  page.getByRole('link', { name: 'Activity', exact: true }).locator('span.bg-info')

test.describe('feed', () => {
  test('groups the seeded sync into one run card under today', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/activity' })
    await expect(page.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: /^Today/ })).toContainText('Thursday, Sep 24')
    const card = runCard(page)
    await expect(card).toBeVisible()
    await expect(card).toContainText(SUMMARY)
    await expect(card.getByRole('button', { name: 'Undo all' })).toBeVisible()
    // entries stay folded away until the card opens
    await expect(page.getByText('Rule "Paycheck" categorized 24 transactions')).toBeHidden()

    await card.getByRole('button', { name: 'Show entries' }).click()
    await expect(page.getByText('Rule "Paycheck" categorized 24 transactions')).toBeVisible()
    await expect(page.getByText('Detected 36 transfers', { exact: true })).toBeVisible()
  })

  test('Undo all and Redo all flip the whole run and its stored effects', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/activity' })
    const before = await uncategorized(app)
    const card = runCard(page)

    await card.getByRole('button', { name: 'Undo all' }).click()
    await expect(card.getByRole('button', { name: 'Redo all' })).toBeVisible()
    await expect(card.getByText('Undone', { exact: true })).toBeVisible()
    expect(await uncategorized(app)).toBeGreaterThan(before)
    expect(await app.sql('SELECT id FROM action_log WHERE undone_at IS NULL')).toHaveLength(0)

    await card.getByRole('button', { name: 'Redo all' }).click()
    await expect(card.getByRole('button', { name: 'Undo all' })).toBeVisible()
    await expect(card.getByText('Undone', { exact: true })).toBeHidden()
    expect(await uncategorized(app)).toBe(before)
  })

  test('an entry opens to its change lines and loads the rest on request', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/activity' })
    await runCard(page).getByRole('button', { name: 'Show entries' }).click()
    const entry = entryRow(page, 'Rule "Interest and dividends" categorized 16 transactions')
    await expect(entry).toContainText('to 💵 Income')

    await entry.getByRole('button', { name: 'Show changes' }).click()
    await expect(entry.getByText('INTEREST PAYMENT').first()).toBeVisible()
    await expect(entry.getByText('Uncategorized').first()).toBeVisible()
    await expect(entry.getByText('DIVIDEND RECEIVED VTI')).toHaveCount(0)

    await entry.getByRole('button', { name: 'Show 8 more' }).click()
    await expect(entry.getByText('DIVIDEND RECEIVED VTI').first()).toBeAttached()
    await expect(entry.getByRole('button', { name: /Show \d+ more/ })).toBeHidden()
  })

  test('undoing one entry inside a run leaves the rest and tags it as undone', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/activity' })
    const card = runCard(page)
    await card.getByRole('button', { name: 'Show entries' }).click()
    const entry = entryRow(page, 'Rule "Fuel" categorized 42 transactions')
    const before = await uncategorized(app)

    await entry.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(entry.getByText(/^Undone/)).toBeVisible()
    await expect(entry.getByRole('button', { name: 'Redo', exact: true })).toBeVisible()
    await expect(card).toContainText('1 of 9 undone')
    await expect(card.getByRole('button', { name: 'Undo all' })).toBeVisible()
    expect(await uncategorized(app)).toBe(before + 42)

    await entry.getByRole('button', { name: 'Redo', exact: true }).click()
    await expect(entry.getByText(/^Undone/)).toBeHidden()
    expect(await uncategorized(app)).toBe(before)
  })

  test('a change made in the app lands as its own entry that Undo reverts', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=rules' })
    await page
      .getByRole('dialog', { name: 'Settings' })
      .getByRole('button', { name: 'Delete rule Insurance' })
      .click()
    await expect(page.getByText('Deleted “Insurance”')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByRole('link', { name: 'Activity', exact: true }).click()

    const entry = entryRow(page, 'Delete rule')
    await expect(entry).toBeVisible()
    await expect(entry).toContainText('1 rule')
    await entry.getByRole('button', { name: 'Show changes' }).click()
    await expect(entry.getByText('Insurance')).toBeVisible()
    await expect(entry.getByText('Deleted', { exact: true })).toBeVisible()
    expect(await app.sql(`SELECT id FROM rules WHERE name = 'Insurance'`)).toHaveLength(0)

    await entry.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(entry.getByText(/^Undone/)).toBeVisible()
    expect(await app.sql(`SELECT id FROM rules WHERE name = 'Insurance'`)).toHaveLength(1)
  })

  test('a fresh install shows the empty state', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/activity', dataset: 'none' })
    await expect(page.getByText('No activity yet')).toBeVisible()
    await expect(
      page.getByText('Categorizing, deleting, or marking transfers shows up here.')
    ).toBeVisible()
    await expect(page.getByText('Needs review')).toBeHidden()
  })
})

test.describe('filters', () => {
  test('source chips narrow the feed, list entries individually and keep their state', async ({
    app
  }) => {
    const { page } = app
    await app.open({ route: '/activity' })
    await expect(filterChip(page, 'All')).toHaveAttribute('aria-pressed', 'true')

    await filterChip(page, 'Rules').click()
    await expect(filterChip(page, 'Rules')).toHaveAttribute('aria-pressed', 'true')
    await expect(filterChip(page, 'All')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByText('Rule "Paycheck" categorized 24 transactions')).toBeVisible()
    await expect(page.getByText('Detected 36 transfers', { exact: true })).toBeHidden()
    await expect(page.getByText(RUN, { exact: true })).toBeHidden()
    // suggestions belong to the unfiltered view
    await expect(page.getByText('Needs review')).toBeHidden()
    await expect.poll(() => storedSetting(app, 'activitySource')).toBe('rule')

    await filterChip(page, 'Transfers').click()
    await expect(page.getByText('Detected 36 transfers', { exact: true })).toBeVisible()
    await expect(page.getByText('Rule "Paycheck" categorized 24 transactions')).toBeHidden()
    await expect.poll(() => storedSetting(app, 'activitySource')).toBe('detector')

    // the choice is a stored setting, so it outlives leaving the page
    await page.getByRole('link', { name: 'Budget', exact: true }).click()
    await page.getByRole('link', { name: 'Activity', exact: true }).click()
    await expect(filterChip(page, 'Transfers')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('Detected 36 transfers', { exact: true })).toBeVisible()

    await filterChip(page, 'All').click()
    await expect(page.getByText(RUN, { exact: true })).toBeVisible()
    await expect.poll(() => storedSetting(app, 'activitySource')).toBe(null)
  })

  test('a source with no activity says nothing matches, and Clear filters resets', async ({
    app
  }) => {
    const { page } = app
    await app.open({ route: '/activity' })
    await filterChip(page, 'AI').click()
    await expect(page.getByText('Nothing matches')).toBeVisible()
    await expect(page.getByText('No activity fits this filter.')).toBeVisible()

    await page.getByRole('button', { name: 'Clear filters' }).click()
    await expect(page.getByText('Nothing matches')).toBeHidden()
    await expect(filterChip(page, 'All')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText(RUN, { exact: true })).toBeVisible()
    await expect.poll(() => storedSetting(app, 'activitySource')).toBe(null)
  })

  test('search narrows entries; a miss offers Clear filters that empties the box', async ({
    app
  }) => {
    const { page } = app
    await app.open({ route: '/activity' })
    const search = page.getByPlaceholder('Search activity...')
    await search.fill('Paycheck')
    await expect(page.getByText('Rule "Paycheck" categorized 24 transactions')).toBeVisible()
    await expect(page.getByText('Rule "Rent" categorized 12 transactions')).toBeHidden()

    await search.fill('zzzz-no-such-activity')
    await expect(page.getByText('Nothing matches')).toBeVisible()
    await page.getByRole('button', { name: 'Clear filters' }).click()
    await expect(search).toHaveValue('')
    await expect(page.getByText(RUN, { exact: true })).toBeVisible()
  })
})

test.describe('Needs review', () => {
  test('lists the pending suggestion with its sample and reach', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/activity' })
    const section = page.locator('section').filter({ hasText: 'Needs review' })
    await expect(section).toContainText('1 rule suggestion')
    await expect(section).toContainText('🍽️ Dining Out')
    await expect(section).toContainText('SQ *TACOS EL GORDO')
    await expect(section).toContainText('26 transactions')
  })

  test('Create rule opens the editor prefilled; saving removes the suggestion', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/activity' })
    await page.getByRole('button', { name: 'Create rule' }).click()

    const editor = page.getByRole('dialog', { name: 'New rule' })
    await expect(editor).toBeVisible()
    await expect(page).toHaveURL(/#\/activity/)
    await expect(editor.getByLabel('Name')).toHaveValue('TACOS EL GORDO → 🍽️ Dining Out')
    await expect(editor.getByText('TACOS EL GORDO', { exact: true })).toBeVisible()
    await expect(editor.getByText('🍽️ Dining Out')).toBeVisible()
    await editor.getByRole('button', { name: 'Create rule' }).click()

    await expect(editor).toBeHidden()
    await expect(page.getByText('Needs review')).toBeHidden()
    expect(await app.sql(`SELECT name FROM rules WHERE name LIKE 'TACOS%'`)).toHaveLength(1)
    expect(await app.sql('SELECT status FROM rule_suggestions')).toEqual([{ status: 'accepted' }])
  })

  test('cancelling the editor keeps the suggestion pending', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/activity' })
    await page.getByRole('button', { name: 'Create rule' }).click()
    const editor = page.getByRole('dialog', { name: 'New rule' })
    await editor.getByRole('button', { name: 'Cancel' }).click()
    await expect(editor).toBeHidden()
    await expect(page.getByText('Needs review')).toBeVisible()
    expect(await app.sql('SELECT status FROM rule_suggestions')).toEqual([{ status: 'pending' }])
  })

  test('Dismiss removes the group', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/activity' })
    await page.getByRole('button', { name: 'Dismiss' }).click()
    await expect(page.getByText('Needs review')).toBeHidden()
    expect(await app.sql('SELECT status FROM rule_suggestions')).toEqual([{ status: 'dismissed' }])
    // the history below is untouched
    await expect(page.getByText(RUN, { exact: true })).toBeVisible()
  })
})

test.describe('sidebar dot', () => {
  test('an automated change lights the Activity dot until the page is visited', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts' })
    await expect(page.getByRole('link', { name: 'Activity', exact: true })).toBeVisible()
    await expect(activityDot(page)).toHaveCount(0)

    // a rule that matches fresh rows, applied from Settings
    await page.evaluate(async () => {
      const { groups } = await window.api.categories.list()
      const dining = groups.flatMap((g) => g.categories).find((c) => c.name.includes('Dining'))!
      await window.api.rules.create({
        name: 'Burritos',
        conditions: { description: { op: 'contains', phrases: ['CHIPOTLE'] } },
        action: { type: 'setCategory', categoryId: dining.id }
      })
    })
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.getByRole('button', { name: 'Rules' }).click()
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
    await dialog.getByRole('button', { name: /^Apply to \d+$/ }).click()
    await expect(dialog.getByRole('heading', { name: 'Your rules' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(activityDot(page)).toBeVisible()

    await page.getByRole('link', { name: 'Activity', exact: true }).click()
    await expect(page.getByText(/Rule "Burritos" categorized/)).toBeVisible()
    await expect(activityDot(page)).toHaveCount(0)
    await expect.poll(() => storedSetting(app, 'activitySeenAt')).not.toBeNull()
  })
})
