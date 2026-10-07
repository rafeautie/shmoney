import { expect, test } from '../fixtures'
import type { Locator } from '@playwright/test'
import type { App } from '../fixtures'

// household goals: Emergency fund (balance, dated, on track), Trip to Japan
// (contributions, undated) and House down payment (contributions, behind)

function goalCard(app: App, name: string): Locator {
  return app.page.locator('[data-slot="card"]').filter({ hasText: name })
}

// the name swaps to an input while it is edited, so a card found by name would vanish
function japanCard(app: App): Locator {
  return app.page.locator('[data-slot="card"]').filter({ hasText: 'since 1 Apr 2026' })
}

function goalRow(app: App, name: string): Locator {
  return app.page.getByRole('row', { name: new RegExp(name) })
}

function statCard(app: App, label: string): Locator {
  return app.page.locator('[data-slot="card"]').filter({ hasText: new RegExp(`^${label}`) })
}

async function openCards(app: App): Promise<void> {
  await app.open({ route: '/goals' })
  await expect(goalCard(app, 'Emergency fund')).toBeVisible()
}

async function openTable(app: App): Promise<void> {
  await app.open({ route: '/goals' })
  await app.page.getByRole('tab', { name: 'Table view' }).click()
  await expect(goalRow(app, 'Emergency fund')).toBeVisible()
}

const goalRowSql = (name: string): string =>
  `SELECT name, target_amount, target_date, archived_at, deleted_at FROM savings_goals WHERE name = '${name}'`

test.describe('goal cards', () => {
  test('the household shows each goal with status, mode and pace', async ({ app }) => {
    await openCards(app)
    const emergency = goalCard(app, 'Emergency fund')
    await expect(emergency).toContainText('On track')
    await expect(emergency).toContainText('Balance of High-Yield Savings')
    await expect(emergency).toContainText('saved of')
    await expect(emergency).toContainText('$30,000.00')
    await expect(emergency).toContainText('30 Jun 2027')
    await expect(emergency).toContainText(/Save \$[\d,.]+\/month to reach it on time/)

    const trip = goalCard(app, 'Trip to Japan')
    await expect(trip).toContainText('New savings since 1 Apr 2026')
    await expect(trip).toContainText('$6,000.00')
    await expect(trip).toContainText(/you'll get there around \d+ \w+ \d{4}/)
    await expect(trip.getByRole('button', { name: 'Set a target date' })).toBeVisible()
    // an undated goal has no pace to be on or off, so no badge
    await expect(trip.locator('[data-slot="badge"]')).toHaveCount(0)

    const house = goalCard(app, 'House down payment')
    await expect(house).toContainText('Behind')
    await expect(house).toContainText('New savings since 1 Nov 2025')
    await expect(house).toContainText('Individual Brokerage')
    await expect(house.locator('[data-slot="badge"]')).toHaveCount(1)
  })

  test('each card has a progress bar labelled Saved', async ({ app }) => {
    await openCards(app)
    await expect(app.page.getByRole('progressbar', { name: 'Saved' })).toHaveCount(3)
  })

  test('the summary strip totals the active goals', async ({ app }) => {
    await openCards(app)
    await expect(statCard(app, 'Saved')).toBeVisible()
    await expect(statCard(app, 'Target')).toContainText('$61,000.00')
    await expect(statCard(app, 'Planned')).toContainText('this month')
    await expect(statCard(app, 'Planned')).toContainText(/\$[\d,.]+/)
  })
})

test.describe('empty state', () => {
  test('a fresh install invites the first goal and shows no summary', async ({ app }) => {
    await app.open({ route: '/goals', dataset: 'starter' })
    const { page } = app
    await expect(page.getByText('No savings goals yet')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add your first goal' })).toBeVisible()
    await expect(page.getByText('Target', { exact: true })).toHaveCount(0)
  })

  test('the empty state button opens the dialog and creating a goal replaces it', async ({
    app
  }) => {
    await app.open({ route: '/goals', dataset: 'starter' })
    const { page } = app
    await page.getByRole('button', { name: 'Add your first goal' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add goal' })
    await dialog.getByLabel('Name').fill('Rainy day')
    await dialog.getByLabel('Target amount').fill('1500')
    await dialog.getByRole('button', { name: 'Pick accounts...' }).click()
    await page.getByRole('option', { name: 'Checking' }).click()
    await page.keyboard.press('Escape')
    await dialog.getByRole('button', { name: 'Add goal' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText('No savings goals yet')).toBeHidden()
    await expect(goalCard(app, 'Rainy day')).toContainText('Balance of Checking')
  })
})

test.describe('cards and table view', () => {
  test('the toggle swaps the layout and is stored in settings', async ({ app }) => {
    await openCards(app)
    const { page } = app
    await expect(page.getByRole('tab', { name: 'Card view' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await page.getByRole('tab', { name: 'Table view' }).click()
    for (const name of ['Goal', 'Progress', 'Target', 'Target date', 'Accounts', 'This month']) {
      await expect(page.getByRole('columnheader', { name, exact: true })).toBeVisible()
    }
    await expect(goalRow(app, 'Trip to Japan')).toBeVisible()
    await expect(goalRow(app, 'House down payment')).toContainText('Behind')
    await expect
      .poll(() => app.sql("SELECT value FROM settings WHERE key = 'goalsView'"))
      .toEqual([{ value: '"table"' }])

    await page.getByRole('tab', { name: 'Card view' }).click()
    await expect(page.getByRole('columnheader', { name: 'Goal' })).toHaveCount(0)
    await expect(goalCard(app, 'Trip to Japan')).toBeVisible()
    await expect
      .poll(() => app.sql("SELECT value FROM settings WHERE key = 'goalsView'"))
      .toEqual([{ value: '"cards"' }])
  })

  test('the choice survives navigating away and back', async ({ app }) => {
    await openTable(app)
    const { page } = app
    await page.getByRole('link', { name: 'Budget', exact: true }).click()
    await expect(page).toHaveURL(/#\/budget/)
    await page.getByRole('link', { name: 'Goals', exact: true }).click()
    await expect(page.getByRole('tab', { name: 'Table view' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(goalRow(app, 'Emergency fund')).toBeVisible()
  })

  test('the table shows this month as saved of planned', async ({ app }) => {
    await openTable(app)
    await expect(goalRow(app, 'House down payment')).toContainText(/of \$[\d,.]+/)
    await expect(
      app.page.getByText(/^This month is what you saved of what you planned/)
    ).toBeVisible()
  })
})

test.describe('new goal dialog', () => {
  async function openDialog(app: App): Promise<Locator> {
    await openCards(app)
    await app.page.getByRole('button', { name: 'Add goal' }).click()
    return app.page.getByRole('dialog', { name: 'Add goal' })
  }

  test('submit needs a name, a target above zero and an account', async ({ app }) => {
    const dialog = await openDialog(app)
    const { page } = app
    const submit = dialog.getByRole('button', { name: 'Add goal' })
    await expect(submit).toBeDisabled()

    await dialog.getByLabel('Name').fill('Bike')
    await expect(submit).toBeDisabled()

    await dialog.getByLabel('Target amount').fill('0')
    await expect(submit).toBeDisabled()
    await dialog.getByLabel('Target amount').fill('800')
    await expect(submit).toBeDisabled()

    await dialog.getByRole('button', { name: 'Pick accounts...' }).click()
    await page.getByRole('option', { name: 'Everyday Checking' }).click()
    await page.keyboard.press('Escape')
    await expect(submit).toBeEnabled()

    await dialog.getByLabel('Name').fill('   ')
    await expect(submit).toBeDisabled()
    await dialog.getByLabel('Name').fill('Bike')
    await dialog.getByLabel('Target amount').fill('')
    await expect(submit).toBeDisabled()
  })

  test('each mode explains what it tracks', async ({ app }) => {
    const dialog = await openDialog(app)
    await expect(dialog.getByText('Progress is what the account holds')).toBeVisible()
    await dialog.getByRole('button', { name: 'Count new savings' }).click()
    await expect(dialog.getByText('Progress starts at zero')).toBeVisible()
    await expect(dialog.getByText('Progress is what the account holds')).toBeHidden()
    await dialog.getByRole('button', { name: 'Track the balance' }).click()
    await expect(dialog.getByText('Progress is what the account holds')).toBeVisible()
  })

  test('the account picker takes several accounts of one currency', async ({ app }) => {
    const dialog = await openDialog(app)
    const { page } = app
    await dialog.getByRole('button', { name: 'Pick accounts...' }).click()
    await expect(page.getByRole('option')).toHaveCount(4)
    await page.getByRole('option', { name: 'High-Yield Savings' }).click()
    await expect(dialog.getByRole('button', { name: 'High-Yield Savings' })).toBeVisible()
    await page.getByRole('option', { name: 'Everyday Checking' }).click()
    await expect(dialog.getByRole('button', { name: '2 accounts' })).toBeVisible()
    await page.getByRole('option', { name: 'Everyday Checking' }).click()
    await expect(dialog.getByRole('button', { name: 'High-Yield Savings' })).toBeVisible()
  })

  test('creating a balance goal adds its card and stores it', async ({ app }) => {
    const dialog = await openDialog(app)
    const { page } = app
    await dialog.getByLabel('Name').fill('Car fund')
    await dialog.getByLabel('Target amount').fill('100000')
    await dialog.getByRole('button', { name: 'Pick accounts...' }).click()
    await page.getByRole('option', { name: 'High-Yield Savings' }).click()
    await page.getByRole('option', { name: 'Everyday Checking' }).click()
    await page.keyboard.press('Escape')
    await dialog.getByRole('button', { name: 'Add goal' }).click()
    await expect(dialog).toBeHidden()

    const card = goalCard(app, 'Car fund')
    await expect(card).toContainText('Balance of Everyday Checking, High-Yield Savings')
    await expect(card).toContainText('$100,000.00')
    await expect(card).toContainText('2 accounts')
    await expect(statCard(app, 'Target')).toContainText('$161,000.00')
    await expect
      .poll(() =>
        app.sql(
          `SELECT g.mode, g.target_amount, g.target_date, count(a.account_id) AS accounts
           FROM savings_goals g JOIN savings_goal_accounts a ON a.goal_id = g.id
           WHERE g.name = 'Car fund' GROUP BY g.id`
        )
      )
      .toEqual([{ mode: 'balance', target_amount: 100_000_000, target_date: null, accounts: 2 }])
  })

  test('a contributions goal starts counting from today', async ({ app }) => {
    const dialog = await openDialog(app)
    const { page } = app
    await dialog.getByLabel('Name').fill('Garden')
    await dialog.getByRole('button', { name: 'Count new savings' }).click()
    await dialog.getByLabel('Target amount').fill('900')
    await dialog.getByRole('button', { name: 'Pick accounts...' }).click()
    await page.getByRole('option', { name: 'High-Yield Savings' }).click()
    await page.keyboard.press('Escape')
    await dialog.getByLabel('Name').press('Enter')
    await expect(dialog).toBeHidden()

    const card = goalCard(app, 'Garden')
    await expect(card).toContainText('New savings since 24 Sep 2026')
    await expect(card).toContainText('$0.00')
    await expect(card).toContainText('No pace yet: nothing saved toward it')
    expect(await app.sql("SELECT mode FROM savings_goals WHERE name = 'Garden'")).toEqual([
      { mode: 'contributions' }
    ])
  })

  test('Cancel closes without creating a goal', async ({ app }) => {
    const dialog = await openDialog(app)
    await dialog.getByLabel('Name').fill('Nope')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    await expect(goalCard(app, 'Nope')).toHaveCount(0)
    expect(await app.sql("SELECT id FROM savings_goals WHERE name = 'Nope'")).toEqual([])
  })

  test('the dialog opens blank each time', async ({ app }) => {
    const dialog = await openDialog(app)
    await dialog.getByLabel('Name').fill('Leftover')
    await dialog.getByRole('button', { name: 'Count new savings' }).click()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    await app.page.getByRole('button', { name: 'Add goal' }).click()
    await expect(dialog.getByLabel('Name')).toHaveValue('')
    await expect(dialog.getByText('Progress is what the account holds')).toBeVisible()
  })
})

test.describe('inline edits', () => {
  test('the name edits in place and Enter commits', async ({ app }) => {
    await openCards(app)
    const card = japanCard(app)
    await card.getByRole('button', { name: 'Trip to Japan' }).click()
    const input = card.getByRole('textbox')
    await expect(input).toBeFocused()
    await input.fill('Trip to Kyoto')
    await input.press('Enter')
    await expect(goalCard(app, 'Trip to Kyoto')).toBeVisible()
    await expect(goalCard(app, 'Trip to Japan')).toHaveCount(0)
    await expect.poll(() => app.sql(goalRowSql('Trip to Kyoto'))).toHaveLength(1)
  })

  test('Escape cancels a rename and a blank name changes nothing', async ({ app }) => {
    await openCards(app)
    const card = japanCard(app)
    await card.getByRole('button', { name: 'Trip to Japan' }).click()
    await card.getByRole('textbox').fill('Something else')
    await card.getByRole('textbox').press('Escape')
    await expect(card.getByRole('button', { name: 'Trip to Japan' })).toBeVisible()

    await card.getByRole('button', { name: 'Trip to Japan' }).click()
    await card.getByRole('textbox').fill('  ')
    await card.getByRole('textbox').press('Enter')
    await expect(card.getByRole('button', { name: 'Trip to Japan' })).toBeVisible()
    expect(await app.sql(goalRowSql('Trip to Japan'))).toHaveLength(1)
    expect(await app.sql(goalRowSql('Something else'))).toEqual([])
  })

  test('the target edits in place, persists, and ignores zero', async ({ app }) => {
    await openCards(app)
    const card = goalCard(app, 'Emergency fund')
    await card.getByRole('button', { name: '$30,000.00' }).click()
    await card.getByRole('textbox').fill('40000')
    await card.getByRole('textbox').press('Enter')
    await expect(card.getByRole('button', { name: '$40,000.00' })).toBeVisible()
    await expect(statCard(app, 'Target')).toContainText('$71,000.00')
    await expect
      .poll(() => app.sql(goalRowSql('Emergency fund')))
      .toMatchObject([{ target_amount: 40_000_000 }])

    await card.getByRole('button', { name: '$40,000.00' }).click()
    await card.getByRole('textbox').fill('0')
    await card.getByRole('textbox').press('Enter')
    await expect(card.getByRole('button', { name: '$40,000.00' })).toBeVisible()

    await card.getByRole('button', { name: '$40,000.00' }).click()
    await card.getByRole('textbox').fill('55')
    await card.getByRole('textbox').press('Escape')
    await expect(card.getByRole('button', { name: '$40,000.00' })).toBeVisible()
    expect(await app.sql(goalRowSql('Emergency fund'))).toMatchObject([
      { target_amount: 40_000_000 }
    ])
  })

  test('a target date can be set and then cleared', async ({ app }) => {
    await openCards(app)
    const { page } = app
    const card = goalCard(app, 'Trip to Japan')
    await card.getByRole('button', { name: 'Set a target date' }).click()
    await page
      .getByRole('gridcell', { name: /September 30th, 2026/ })
      .getByRole('button')
      .click()

    await expect(card.getByRole('button', { name: '30 Sep 2026' })).toBeVisible()
    await expect(card).toContainText('by')
    await expect(card).toContainText(/Save \$[\d,.]+\/month to reach it on time/)
    await expect
      .poll(() => app.sql(goalRowSql('Trip to Japan')))
      .toMatchObject([{ target_date: '2026-09-30' }])

    await card.getByRole('button', { name: '30 Sep 2026' }).click()
    await page.getByRole('button', { name: 'Clear the date' }).click()
    await expect(card.getByRole('button', { name: 'Set a target date' })).toBeVisible()
    await expect
      .poll(() => app.sql(goalRowSql('Trip to Japan')))
      .toMatchObject([{ target_date: null }])
  })

  test('linked accounts can be swapped, and the last one cannot be removed', async ({ app }) => {
    await openCards(app)
    const { page } = app
    const card = goalCard(app, 'Emergency fund')
    const accounts = `SELECT a.name FROM savings_goal_accounts l
      JOIN savings_goals g ON g.id = l.goal_id JOIN accounts a ON a.id = l.account_id
      WHERE g.name = 'Emergency fund' ORDER BY a.name`

    await card.getByRole('button', { name: 'High-Yield Savings' }).click()
    await page.getByRole('option', { name: 'Everyday Checking' }).click()
    await expect(card.getByRole('button', { name: '2 accounts' })).toBeVisible()
    await expect
      .poll(() => app.sql(accounts))
      .toEqual([{ name: 'Everyday Checking' }, { name: 'High-Yield Savings' }])

    await page.getByRole('option', { name: 'High-Yield Savings' }).click()
    await expect(card.getByRole('button', { name: 'Everyday Checking' })).toBeVisible()
    await expect(card).toContainText('Balance of Everyday Checking')

    await page.getByRole('option', { name: 'Everyday Checking' }).click()
    await expect(page.getByText('A goal needs at least one account')).toBeVisible()
    expect(await app.sql(accounts)).toEqual([{ name: 'Everyday Checking' }])
    await expect(card.getByRole('button', { name: 'Everyday Checking' })).toBeVisible()
  })

  test('the table view edits the same fields', async ({ app }) => {
    await openTable(app)
    const row = app.page.getByRole('row', { name: /since 1 Apr 2026/ })
    await row.getByRole('button', { name: 'Trip to Japan' }).click()
    await row.getByRole('textbox').fill('Trip to Osaka')
    await row.getByRole('textbox').press('Enter')
    await expect(goalRow(app, 'Trip to Osaka')).toBeVisible()

    await goalRow(app, 'Trip to Osaka').getByRole('button', { name: '$6,000.00' }).click()
    await goalRow(app, 'Trip to Osaka').getByRole('textbox').fill('7000')
    await goalRow(app, 'Trip to Osaka').getByRole('textbox').press('Enter')
    await expect(
      goalRow(app, 'Trip to Osaka').getByRole('button', { name: '$7,000.00' })
    ).toBeVisible()
    await expect
      .poll(() => app.sql(goalRowSql('Trip to Osaka')))
      .toMatchObject([{ target_amount: 7_000_000 }])
  })
})

test.describe('archive and delete', () => {
  test('archiving moves a goal into the Archived section, and unarchive brings it back', async ({
    app
  }) => {
    await openCards(app)
    const { page } = app
    await expect(statCard(app, 'Target')).toContainText('$61,000.00')
    await expect(page.getByRole('button', { name: /^Archived/ })).toHaveCount(0)

    await goalCard(app, 'Trip to Japan').getByRole('button', { name: 'Goal actions' }).click()
    await page.getByRole('menuitem', { name: 'Archive' }).click()
    await expect(goalCard(app, 'Trip to Japan')).toHaveCount(0)
    await expect(statCard(app, 'Target')).toContainText('$55,000.00')
    const archived = page.getByRole('button', { name: 'Archived · 1 goal' })
    await expect(archived).toBeVisible()
    await expect
      .poll(
        async () =>
          (await app.sql<{ archived_at: number | null }>(goalRowSql('Trip to Japan')))[0]
            .archived_at
      )
      .not.toBeNull()

    await archived.click()
    const card = goalCard(app, 'Trip to Japan')
    await expect(card).toBeVisible()
    await card.getByRole('button', { name: 'Goal actions' }).click()
    await expect(page.getByRole('menuitem', { name: 'Unarchive' })).toBeVisible()
    await page.getByRole('menuitem', { name: 'Unarchive' }).click()

    await expect(page.getByRole('button', { name: /^Archived/ })).toHaveCount(0)
    await expect(goalCard(app, 'Trip to Japan')).toBeVisible()
    await expect(statCard(app, 'Target')).toContainText('$61,000.00')
  })

  test('archiving works from the table view too', async ({ app }) => {
    await openTable(app)
    const { page } = app
    await goalRow(app, 'House down payment').getByRole('button', { name: 'Goal actions' }).click()
    await page.getByRole('menuitem', { name: 'Archive' }).click()
    await expect(page.getByRole('button', { name: 'Archived · 1 goal' })).toBeVisible()
    await expect(goalRow(app, 'House down payment')).toHaveCount(0)
    await page.getByRole('button', { name: 'Archived · 1 goal' }).click()
    await expect(goalRow(app, 'House down payment')).toBeVisible()
  })

  test('deleting a goal toasts with Undo, which restores it', async ({ app }) => {
    await openCards(app)
    const { page } = app
    await goalCard(app, 'Trip to Japan').getByRole('button', { name: 'Goal actions' }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()

    await expect(goalCard(app, 'Trip to Japan')).toHaveCount(0)
    await expect(page.getByText('Deleted Trip to Japan')).toBeVisible()
    await expect(statCard(app, 'Target')).toContainText('$55,000.00')

    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(goalCard(app, 'Trip to Japan')).toBeVisible()
    await expect(statCard(app, 'Target')).toContainText('$61,000.00')
  })

  test('deleting every goal leaves the empty state', async ({ app }) => {
    await openCards(app)
    const { page } = app
    for (const name of ['Emergency fund', 'Trip to Japan', 'House down payment']) {
      await goalCard(app, name).getByRole('button', { name: 'Goal actions' }).click()
      await page.getByRole('menuitem', { name: 'Delete' }).click()
      await expect(goalCard(app, name)).toHaveCount(0)
    }
    await expect(page.getByText('No savings goals yet')).toBeVisible()
  })
})

test.describe('summary per currency', () => {
  test('a goal in another currency gets its own strip instead of joining the totals', async ({
    app
  }) => {
    await app.open({ route: '/goals' })
    const { page } = app
    await page.evaluate(async () => {
      const qif = '!Type:Bank\nD01/02/2026\nT-5.00\nPCoffee\n^\n'
      const bytes = new TextEncoder().encode(qif)
      const picked = await window.api.import.pickFile({
        dropped: { fileName: 'euro.qif', bytes }
      })
      if (!picked || !('handle' in picked)) throw new Error('pick failed')
      await window.api.import.apply({
        handle: picked.handle,
        excluded: [],
        target: { newAccount: { name: 'Euro Savings', currency: 'EUR', balance: 1_000_000 } }
      })
    })

    // the accounts query is cached for 30s; once stale, returning to the page refetches it
    await page.clock.fastForward(31_000)
    await page.getByRole('link', { name: 'Accounts', exact: true }).click()
    await page.getByRole('link', { name: 'Goals', exact: true }).click()
    await expect(goalCard(app, 'Emergency fund')).toBeVisible()

    await page.getByRole('button', { name: 'Add goal' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add goal' })
    await dialog.getByLabel('Name').fill('Lisbon')
    await dialog.getByLabel('Target amount').fill('2000')
    await dialog.getByRole('button', { name: 'Pick accounts...' }).click()
    await page.getByRole('option', { name: 'Euro Savings' }).click()
    // the first pick fixes the currency, so the dollar accounts drop out
    await expect(page.getByRole('option')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await dialog.getByRole('button', { name: 'Add goal' }).click()
    await expect(dialog).toBeHidden()

    await expect(goalCard(app, 'Lisbon')).toContainText('€2,000.00')
    await expect(statCard(app, 'Target')).toHaveCount(2)
    // strips run in currency-code order
    await expect(statCard(app, 'Target').first()).toContainText('€2,000.00')
    await expect(statCard(app, 'Target').last()).toContainText('$61,000.00')
  })
})

test.describe('account page', () => {
  test('the goals strip names the goals an account backs and links to Goals', async ({ app }) => {
    await app.open({ route: '/accounts' })
    const { page } = app
    await page.getByRole('row', { name: /High-Yield Savings/ }).click()
    const strip = page.getByText(/^Backing:/)
    await expect(strip).toContainText('Emergency fund (')
    await expect(strip).toContainText('Trip to Japan (')
    await strip.getByRole('link').click()
    await expect(page).toHaveURL(/#\/goals/)
    await expect(goalCard(app, 'Emergency fund')).toBeVisible()
  })

  test('an account no goal points at has no strip, and an archived goal drops off', async ({
    app
  }) => {
    await app.open({ route: '/accounts' })
    const { page } = app
    await page.getByRole('row', { name: /Everyday Checking/ }).click()
    await expect(page.getByRole('heading', { name: 'Everyday Checking' })).toBeVisible()
    await expect(page.getByText(/^Backing:/)).toHaveCount(0)

    await page.getByRole('link', { name: 'Accounts', exact: true }).click()
    await page.getByRole('row', { name: /Individual Brokerage/ }).click()
    await expect(page.getByText(/^Backing: House down payment/)).toBeVisible()

    await page.getByRole('link', { name: 'Goals', exact: true }).click()
    await goalCard(app, 'House down payment').getByRole('button', { name: 'Goal actions' }).click()
    await page.getByRole('menuitem', { name: 'Archive' }).click()
    await expect(goalCard(app, 'House down payment')).toHaveCount(0)

    await page.getByRole('link', { name: 'Accounts', exact: true }).click()
    await page.getByRole('row', { name: /Individual Brokerage/ }).click()
    await expect(page.getByRole('heading', { name: 'Individual Brokerage' })).toBeVisible()
    await expect(page.getByText(/^Backing:/)).toHaveCount(0)
  })
})
