import type { Locator, Page } from '@playwright/test'
import { expect, FIXED_NOW, test, type App } from '../fixtures'

// ids follow the household dataset's seeding order
const CHECKING = 1
const SAVINGS = 2
const BROKERAGE = 4

// seconds on the page's pinned clock
const NOW_SECONDS = FIXED_NOW.getTime() / 1000
const HOUR = 3600

function accountRow(page: Page, name: string): Locator {
  return page.getByRole('row', { name: new RegExp(name) })
}

// The renderer caches reads for 30s. After writing the database behind its back,
// age the cache and come back to the accounts page so it refetches.
async function reloadFromDatabase(app: App): Promise<void> {
  await app.page.clock.fastForward(60_000)
  await app.page.getByRole('link', { name: 'Budget', exact: true }).click()
  await expect(app.page).toHaveURL(/#\/budget/)
  await app.page.getByRole('link', { name: 'Accounts', exact: true }).click()
  await expect(app.page).toHaveURL(/#\/accounts/)
}

test.describe('accounts list', () => {
  test('groups accounts by institution under a net worth total', async ({ app }) => {
    const { page } = app
    await app.open()
    await expect(page.getByRole('heading', { name: '$89,979.56' })).toBeVisible()
    await expect(page.getByText('Net worth', { exact: true })).toBeVisible()

    const institutions = page
      .getByRole('tabpanel', { name: 'Accounts' })
      .locator('[data-slot=card-title]')
    await expect(institutions).toHaveText([
      'Evergreen Bank',
      'Northwind Investments',
      'Summit Card Services'
    ])

    await expect(accountRow(page, 'Everyday Checking')).toContainText('$16,645.20')
    await expect(accountRow(page, 'High-Yield Savings')).toContainText('$26,046.29')
    await expect(accountRow(page, 'Rewards Visa')).toContainText('-$1,618.05')
    // only the account with positions advertises them
    await expect(accountRow(page, 'Individual Brokerage')).toContainText('3 holdings')
    await expect(accountRow(page, 'Everyday Checking')).not.toContainText('holding')
  })

  test('clicking a row opens that account', async ({ app }) => {
    const { page } = app
    await app.open()
    await accountRow(page, 'High-Yield Savings').click()
    await expect(page).toHaveURL(new RegExp(`#/accounts/${SAVINGS}$`))
    await expect(page.getByRole('heading', { name: 'High-Yield Savings' })).toBeVisible()
  })

  test('net worth is kept per currency', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/budget', dataset: 'starter' })
    await app.sql("UPDATE accounts SET currency = 'EUR' WHERE id = 1")
    await reloadFromDatabase(app)
    const total = page.locator('p:text-is("Net worth") + h2')
    await expect(total).toContainText('€')
    await expect(total).toContainText('$')
  })

  test('the available balance shows only when it differs from the balance', async ({ app }) => {
    const { page } = app
    // the demo data reports no available balance, so give two accounts one
    await app.open({ route: '/budget' })
    await app.sql(`UPDATE accounts SET available_balance = balance + 100000 WHERE id = ${CHECKING}`)
    await app.sql(`UPDATE accounts SET available_balance = balance WHERE id = ${SAVINGS}`)
    await reloadFromDatabase(app)

    const checking = accountRow(page, 'Everyday Checking')
    await expect(checking).toContainText('$16,645.20')
    await expect(checking).toContainText('$16,745.20')
    // equal to the reported balance: no second line
    await expect(accountRow(page, 'High-Yield Savings')).toHaveText(
      /^High-Yield Savings\s*\$26,046\.29$/
    )

    await checking.getByText('$16,745.20').hover()
    // the tooltip popup has no role to query by
    await expect(page.locator('[data-slot=tooltip-content]')).toContainText(
      'Available balance as reported by your institution'
    )
  })

  test('an empty install offers to open the connection settings', async ({ app }) => {
    const { page } = app
    await app.open({ dataset: 'none' })
    await expect(page.getByText('No accounts yet')).toBeVisible()
    await expect(page.getByText('Connect SimpleFIN in Settings, then sync.')).toBeVisible()
    // with nothing to total, the header falls back to the page name
    await expect(page.getByRole('heading', { name: 'Accounts', level: 2 })).toBeVisible()
    await expect(page.getByText('Net worth', { exact: true })).toBeHidden()

    await page.getByRole('button', { name: 'Open Settings' }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Connection' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    await expect(dialog.getByText('Connect SimpleFIN')).toBeVisible()
    await expect(page).toHaveURL(/settings=connection/)
  })
})

test.describe('connection alerts', () => {
  // the demo has no way to make a sync fail, so the connection row is written
  // directly and the page re-reads it
  async function breakConnection(app: App, set: string): Promise<void> {
    await app.open({ route: '/budget' })
    await app.sql(`UPDATE connections SET ${set}`)
    await reloadFromDatabase(app)
  }

  test('a healthy connection shows no alert', async ({ app }) => {
    await app.open()
    await expect(app.page.getByRole('heading', { name: '$89,979.56' })).toBeVisible()
    await expect(app.page.getByRole('alert')).toHaveCount(0)
    await expect(app.page.getByRole('status')).toHaveCount(0)
  })

  test('a failed sync says when, why and what the data is from', async ({ app }) => {
    await breakConnection(
      app,
      `last_sync_failed_at = ${NOW_SECONDS - HOUR}, last_sync_failure = 'Bridge unreachable'`
    )
    const alert = app.page.getByRole('alert')
    await expect(alert).toContainText('Last sync failed 1 hour ago')
    await expect(alert).toContainText('Bridge unreachable')
    await expect(alert).toContainText('Your balances and transactions are from Sep 24')
    await expect(alert.getByRole('button', { name: 'Sync again' })).toBeVisible()
  })

  test('Sync again re-syncs and clears the failure', async ({ app }) => {
    await breakConnection(
      app,
      `last_sync_failed_at = ${NOW_SECONDS - HOUR}, last_sync_failure = 'Bridge unreachable'`
    )
    await app.page.getByRole('button', { name: 'Sync again' }).click()
    await expect(app.page.getByRole('alert')).toBeHidden()
    const [row] = await app.sql<{ last_sync_failed_at: number | null }>(
      'SELECT last_sync_failed_at FROM connections'
    )
    expect(row.last_sync_failed_at).toBeNull()
  })

  test('an auth failure asks the user to reauthorize at the bridge', async ({ app }) => {
    await breakConnection(
      app,
      `last_sync_errors = '[{"code":"gen.auth","msg":"Authentication required for Evergreen Bank"}]'`
    )
    const alert = app.page.getByRole('alert')
    await expect(alert).toContainText('SimpleFIN needs your attention')
    await expect(alert).toContainText('Authentication required for Evergreen Bank')
    await expect(alert).toContainText('Reconnect or re-authorize these at your SimpleFIN bridge')
    await expect(alert.getByRole('button', { name: 'Sync again' })).toBeVisible()
  })

  test('a first sync that failed before this launch is retried shortly after it', async ({
    app
  }) => {
    await breakConnection(
      app,
      `last_synced_at = NULL, last_sync_failed_at = ${NOW_SECONDS - HOUR}, last_sync_failure = 'Bridge unreachable'`
    )
    await app.page.clock.fastForward(11_000)
    await expect
      .poll(
        async () =>
          (await app.sql<{ at: number | null }>('SELECT last_synced_at AS at FROM connections'))[0]
            .at
      )
      .not.toBeNull()
  })

  test('data older than two days is flagged as stale', async ({ app }) => {
    // Let three days pass instead of rewriting the timestamp: the app syncs
    // itself once a day, and an old timestamp would trigger that at once.
    // setSystemTime moves the date without running timers; the page must also
    // be read again, so leave and come back.
    await app.open({ route: '/budget' })
    await app.page.clock.setSystemTime(new Date(FIXED_NOW.getTime() + 72 * HOUR * 1000))
    await app.page.getByRole('link', { name: 'Accounts', exact: true }).click()
    const status = app.page.getByRole('status')
    await expect(status).toContainText('Accounts last synced 3 days ago')
    await expect(status).toContainText('Balances and transactions may be out of date.')
  })

  test('transient bridge notices are listed, developer errors are not', async ({ app }) => {
    await breakConnection(
      app,
      `last_sync_errors = '[{"code":"act.failed","msg":"Rewards Visa could not be refreshed"},{"code":"gen.api","msg":"Bad request shape"}]'`
    )
    const status = app.page.getByRole('status')
    await expect(status).toContainText('SimpleFIN couldn’t fetch everything last sync')
    await expect(status).toContainText('Rewards Visa could not be refreshed')
    await expect(app.page.getByText('Bad request shape')).toBeHidden()
  })

  test('the alert also shows in the Connection settings', async ({ app }) => {
    await breakConnection(
      app,
      `last_sync_failed_at = ${NOW_SECONDS - HOUR}, last_sync_failure = 'Bridge unreachable'`
    )
    await app.page
      .getByRole('button', { name: 'Open Settings' })
      .or(app.page.getByRole('button', { name: 'Settings' }))
      .first()
      .click()
    await app.page
      .getByRole('dialog', { name: 'Settings' })
      .getByRole('button', { name: 'Connection' })
      .click()
    await expect(
      app.page.getByRole('dialog', { name: 'Settings' }).getByRole('alert')
    ).toContainText('Last sync failed 1 hour ago')
  })
})

test.describe('account detail', () => {
  test('shows the name, institution and balance, with no tabs for a plain account', async ({
    app
  }) => {
    const { page } = app
    await app.open({ route: `/accounts/${CHECKING}` })
    await expect(page.getByRole('heading', { name: 'Everyday Checking' })).toBeVisible()
    await expect(page.getByText('Evergreen Bank · $16,645.20')).toBeVisible()
    await expect(page.getByText('Backing:')).toBeHidden()
    // no holdings: the transactions table is the page, without a Holdings tab
    await expect(page.getByRole('tab', { name: 'Holdings' })).toBeHidden()
    await expect(page.getByRole('row', { name: /ACME CORP PAYROLL/ }).first()).toBeVisible()
  })

  test('lists the goals an account backs under its balance', async ({ app }) => {
    const { page } = app
    await app.open({ route: `/accounts/${SAVINGS}` })
    const strip = page.getByText(/^Backing:/)
    await expect(strip).toHaveText(/^Backing: Emergency fund \(\d+%\), Trip to Japan \(\d+%\)$/)
    await strip.getByRole('link').click()
    await expect(page).toHaveURL(/#\/goals/)

    await app.open({ route: `/accounts/${BROKERAGE}` })
    await expect(page.getByText(/^Backing:/)).toHaveText(/^Backing: House down payment \(\d+%\)$/)
  })

  test('holdings are the default tab, largest position first', async ({ app }) => {
    const { page } = app
    await app.open({ route: `/accounts/${BROKERAGE}` })
    await expect(page.getByRole('tab', { name: 'Holdings' })).toHaveAttribute(
      'aria-selected',
      'true'
    )

    const rows = page.getByRole('tabpanel', { name: 'Holdings' }).getByRole('row')
    await expect(rows.filter({ hasText: 'VTI' })).toContainText('Vanguard Total Stock Market ETF')
    // header + three positions
    await expect(rows).toHaveCount(4)
    await expect(rows.nth(1)).toContainText('VTI')
    await expect(rows.nth(2)).toContainText('VXUS')
    await expect(rows.nth(3)).toContainText('BND')
  })

  test('holdings show cost basis and gain, and sort by any column', async ({ app }) => {
    const { page } = app
    await app.open({ route: `/accounts/${BROKERAGE}` })
    const panel = page.getByRole('tabpanel', { name: 'Holdings' })
    for (const column of ['Symbol', 'Name', 'Shares', 'Market value', 'Cost basis', 'Gain']) {
      await expect(panel.getByRole('button', { name: column })).toBeVisible()
    }

    const vti = panel.getByRole('row', { name: /VTI/ })
    await expect(vti).toContainText('$26,880.00')
    await expect(vti).toContainText('$4,532.55')
    await expect(vti).toContainText('+16.9%')
    // BND is under water
    const bnd = panel.getByRole('row', { name: /BND/ })
    await expect(bnd).toContainText('-$79.45')
    await expect(bnd).toContainText('-1.0%')

    const symbols = panel.getByRole('row').filter({ hasText: /VTI|VXUS|BND/ })
    // each column's first click sorts ascending
    await panel.getByRole('button', { name: 'Symbol' }).click()
    await expect(symbols.first()).toContainText('BND')
    await expect(symbols.last()).toContainText('VXUS')

    await panel.getByRole('button', { name: 'Gain' }).click()
    await expect(symbols.first()).toContainText('BND')
    await expect(symbols.last()).toContainText('VTI')

    await panel.getByRole('button', { name: 'Shares' }).click()
    await expect(symbols.first()).toContainText('VTI')
    await expect(symbols.last()).toContainText('VXUS')

    await panel.getByRole('button', { name: 'Name' }).click()
    await expect(symbols.first()).toContainText('BND')
    await expect(symbols.last()).toContainText('VTI')
  })

  test('clicking a sorted column header again reverses the sort', async ({ app }) => {
    const { page } = app
    await app.open({ route: `/accounts/${BROKERAGE}` })
    const panel = page.getByRole('tabpanel', { name: 'Holdings' })
    const symbols = panel.getByRole('row').filter({ hasText: /VTI|VXUS|BND/ })
    const symbol = panel.getByRole('button', { name: 'Symbol' })

    await symbol.click()
    await expect(symbols.first()).toContainText('BND')
    await symbol.click()
    await expect(symbols.first()).toContainText('VXUS')
    await expect(symbols.last()).toContainText('BND')
  })

  test('cost basis and gain are hidden when no holding reports a cost', async ({ app }) => {
    const { page } = app
    await app.open()
    await app.sql('UPDATE holdings SET cost_basis = 0')
    await accountRow(page, 'Individual Brokerage').click()
    const panel = page.getByRole('tabpanel', { name: 'Holdings' })
    await expect(panel.getByRole('button', { name: 'Market value' })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Cost basis' })).toBeHidden()
    await expect(panel.getByRole('button', { name: 'Gain' })).toBeHidden()
  })

  test('the transactions tab shows the account activity', async ({ app }) => {
    const { page } = app
    await app.open({ route: `/accounts/${BROKERAGE}` })
    await page.getByRole('tab', { name: 'Transactions' }).click()
    await expect(
      page.getByRole('row', { name: /ACH DEPOSIT EVERGREEN BANK/ }).first()
    ).toBeVisible()
    await expect(page.getByRole('row', { name: /VTI Vanguard/ })).toBeHidden()
  })

  for (const id of ['999', 'abc', '0']) {
    test(`/accounts/${id} is not found and offers a way back`, async ({ app }) => {
      const { page } = app
      await app.open({ route: `/accounts/${id}` })
      await expect(page.getByText('Account not found')).toBeVisible()
      await expect(page.getByText('This account may have been deleted.')).toBeVisible()
      await page.getByRole('button', { name: 'Back to Accounts' }).click()
      await expect(page).toHaveURL(/#\/accounts$/)
      await expect(page.getByRole('heading', { name: '$89,979.56' })).toBeVisible()
    })
  }
})

test.describe('account menu', () => {
  async function startRename(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Account actions' }).click()
    await page.getByRole('menuitem', { name: 'Rename' }).click()
  }

  const storedName = async (app: App): Promise<string> =>
    (await app.sql<{ name: string }>(`SELECT name FROM accounts WHERE id = ${CHECKING}`))[0].name

  test('Rename edits the title in place and Enter saves it', async ({ app }) => {
    const { page } = app
    await app.open({ route: `/accounts/${CHECKING}` })
    await startRename(page)

    const field = page.getByRole('textbox', { name: 'Account name' })
    await expect(field).toBeFocused()
    await expect(field).toHaveValue('Everyday Checking')
    // the old name is selected, so typing replaces it
    await page.keyboard.type('Daily Spending')
    await page.keyboard.press('Enter')

    await expect(page.getByRole('heading', { name: 'Daily Spending' })).toBeVisible()
    await expect(field).toBeHidden()
    expect(await storedName(app)).toBe('Daily Spending')

    await page.getByRole('link', { name: 'Accounts', exact: true }).click()
    await expect(accountRow(page, 'Daily Spending')).toBeVisible()
    await expect(accountRow(page, 'Everyday Checking')).toBeHidden()
  })

  test('Escape cancels the rename', async ({ app }) => {
    const { page } = app
    await app.open({ route: `/accounts/${CHECKING}` })
    await startRename(page)
    await page.getByRole('textbox', { name: 'Account name' }).fill('Nope')
    await page.keyboard.press('Escape')

    await expect(page.getByRole('textbox', { name: 'Account name' })).toBeHidden()
    await expect(page.getByRole('heading', { name: 'Everyday Checking' })).toBeVisible()
    expect(await storedName(app)).toBe('Everyday Checking')
  })

  test('an empty name is a no-op', async ({ app }) => {
    const { page } = app
    await app.open({ route: `/accounts/${CHECKING}` })
    await startRename(page)
    await page.getByRole('textbox', { name: 'Account name' }).fill('   ')
    await page.keyboard.press('Enter')

    await expect(page.getByRole('textbox', { name: 'Account name' })).toBeHidden()
    await expect(page.getByRole('heading', { name: 'Everyday Checking' })).toBeVisible()
    expect(await storedName(app)).toBe('Everyday Checking')
  })

  test('clicking away saves the new name', async ({ app }) => {
    const { page } = app
    await app.open({ route: `/accounts/${CHECKING}` })
    await startRename(page)
    await page.getByRole('textbox', { name: 'Account name' }).fill('Blurred Name')
    await page.getByText('Evergreen Bank ·').click()

    await expect(page.getByRole('heading', { name: 'Blurred Name' })).toBeVisible()
    expect(await storedName(app)).toBe('Blurred Name')
  })

  test('Delete asks first, then removes the account and returns to the list', async ({ app }) => {
    const { page } = app
    await app.open({ route: `/accounts/${CHECKING}` })
    await page.getByRole('button', { name: 'Account actions' }).click()
    await page.getByRole('menuitem', { name: 'Delete account…' }).click()

    const dialog = page.getByRole('dialog', { name: 'Delete “Everyday Checking”?' })
    await expect(dialog).toContainText('future syncs will no longer import it')

    // Cancel changes nothing
    await dialog.getByRole('button', { name: /^Cancel/ }).click()
    await expect(dialog).toBeHidden()
    expect(await app.sql(`SELECT id FROM accounts WHERE id = ${CHECKING}`)).toHaveLength(1)

    await page.getByRole('button', { name: 'Account actions' }).click()
    await page.getByRole('menuitem', { name: 'Delete account…' }).click()
    await dialog.getByRole('button', { name: /^Delete account/ }).click()

    await expect(page).toHaveURL(/#\/accounts$/)
    await expect(accountRow(page, 'High-Yield Savings')).toBeVisible()
    await expect(accountRow(page, 'Everyday Checking')).toBeHidden()
    expect(await app.sql(`SELECT id FROM accounts WHERE id = ${CHECKING}`)).toHaveLength(0)
    await expect(page.getByRole('heading', { name: '$73,334.36' })).toBeVisible()
  })

  test('a manual account is deleted without the sync warning', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/budget' })
    await app.sql(`UPDATE accounts SET connection_id = NULL WHERE id = ${CHECKING}`)
    await page.evaluate((id) => {
      window.location.hash = `#/accounts/${id}`
    }, CHECKING)
    await page.getByRole('button', { name: 'Account actions' }).click()
    await page.getByRole('menuitem', { name: 'Delete account…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete “Everyday Checking”?' })
    await expect(dialog).toContainText('This permanently deletes the account')
    await expect(dialog).not.toContainText('future syncs')
  })
})
