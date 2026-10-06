import type { Locator, Page } from '@playwright/test'
import { expect, test, type App } from '../fixtures'

// household ids, in seeding order
const CHECKING = 1
const VISA = 3

interface FileSpec {
  name: string
  mimeType: string
  buffer: Buffer
}

const file = (name: string, text: string, mimeType = 'text/csv'): FileSpec => ({
  name,
  mimeType,
  buffer: Buffer.from(text)
})

const BANK_CSV = file(
  'bank.csv',
  `Date,Description,Amount
2026-09-01,COFFEE SHOP,-4.50
2026-09-02,PAYCHECK,1500.00
2026-09-03,GROCERY STORE,-82.10
`
)

const DEBIT_CREDIT_CSV = file(
  'statement.csv',
  `Posted Date,Payee,Withdrawal,Deposit
09/01/2026,COFFEE SHOP,4.50,
09/02/2026,PAYCHECK,,1500.00
09/03/2026,GROCERY STORE,82.10,
`
)

// no header the app can recognise, so nothing is suggested
const UNLABELED_CSV = file(
  'odd.csv',
  `When,What,How much
2026-09-01,COFFEE SHOP,-4.50
2026-09-02,PAYCHECK,1500.00
`
)

// the last row's date can't be read, which also stops the app suggesting a mapping
const BROKEN_ROW_CSV = file(
  'broken.csv',
  `Date,Description,Amount
2026-09-01,COFFEE SHOP,-4.50
2026-09-02,PAYCHECK,1500.00
2026-09-03,GROCERY STORE,-82.10
bad-date,BROKEN,5.00
`
)

const OFX = file(
  'export.ofx',
  `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>1
<STMTRS>
<CURDEF>USD
<BANKACCTFROM>
<BANKID>123456789
<ACCTID>0001
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260901
<DTEND>20260930
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260904120000
<TRNAMT>-12.34
<FITID>FIT-1
<NAME>OFX COFFEE
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260907120000
<TRNAMT>250.00
<FITID>FIT-2
<NAME>OFX REFUND
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`,
  'application/x-ofx'
)

const QIF = file(
  'export.qif',
  `!Type:Bank
D9/4/2026
T-21.00
PQIF LUNCH
^
D9/8/2026
T1,000.00
PQIF PAYCHECK
^`,
  'application/qif'
)

function importDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Import transactions' })
}

async function openImport(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  const dialog = importDialog(page)
  await expect(dialog.getByText('Drop a file here')).toBeVisible()
  return dialog
}

async function chooseFile(page: Page, spec: FileSpec): Promise<void> {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Choose file…' }).click()
  await (await chooser).setFiles(spec)
}

async function pickAccount(page: Page, dialog: Locator, label: RegExp): Promise<void> {
  await dialog.getByRole('combobox').click()
  await page.getByRole('option', { name: label }).click()
  await expect(page.getByRole('option')).toHaveCount(0)
}

async function newAccount(dialog: Locator, name: string, balance?: string): Promise<void> {
  await dialog.getByRole('tab', { name: 'New account' }).click()
  await dialog.getByLabel('Name').fill(name)
  if (balance !== undefined) await dialog.getByLabel('Opening balance (optional)').fill(balance)
}

// the mapping labels aren't tied to their selects, so reach each through its row
function mappingSelect(dialog: Locator, label: string): Locator {
  return dialog.getByText(label, { exact: true }).locator('xpath=..').getByRole('combobox')
}

async function chooseColumn(
  page: Page,
  dialog: Locator,
  label: string,
  option: string
): Promise<void> {
  await mappingSelect(dialog, label).click()
  await page.getByRole('option', { name: option, exact: true }).click()
  // the popup animates out; a stale one would make the next option ambiguous
  await expect(page.getByRole('option')).toHaveCount(0)
}

const next = (dialog: Locator): Locator => dialog.getByRole('button', { name: 'Next' })
const back = (dialog: Locator): Locator => dialog.getByRole('button', { name: 'Back' })
const stepDots = (dialog: Locator): Locator => dialog.locator('span.size-1\\.5')

/** csv file -> existing-account target -> preview, with the suggested mapping */
async function previewCsv(
  page: Page,
  spec: FileSpec,
  target: RegExp | { newAccount: string }
): Promise<Locator> {
  const dialog = await openImport(page)
  await chooseFile(page, spec)
  if (target instanceof RegExp) await pickAccount(page, dialog, target)
  else await newAccount(dialog, target.newAccount)
  await next(dialog).click()
  await next(dialog).click()
  return dialog
}
interface Transaction {
  description: string
  amount: number
  deleted_at: number | null
}

async function transactionsOf(app: App, accountId: number): Promise<Transaction[]> {
  return app.sql<Transaction>(
    `SELECT description, amount, deleted_at FROM transactions WHERE account_id = ${accountId} ORDER BY posted, id`
  )
}

test.describe('opening the dialog', () => {
  test('the Import button opens it on the file step', async ({ app }) => {
    const { page } = app
    await app.open()
    const dialog = await openImport(page)
    await expect(
      dialog.getByText('Choose a CSV, OFX, QFX, or QIF file exported from your bank.')
    ).toBeVisible()
    await expect(
      dialog.getByText('CSV, TSV, OFX, QFX, or QIF exported from your bank')
    ).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Choose file…' })).toBeVisible()
    // no Back/Next until a file is chosen
    await expect(next(dialog)).toBeHidden()

    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toBeHidden()
  })

  test('the command palette opens it from any page', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/budget' })
    await page.keyboard.press(`${app.mod}+k`)
    await page.getByPlaceholder('Search pages, actions, and transactions...').fill('Import')
    await page.getByRole('option', { name: 'Import', exact: true }).click()
    await expect(importDialog(page).getByText('Drop a file here')).toBeVisible()
    await expect(page).toHaveURL(/#\/budget/)
  })

  test('Escape closes it', async ({ app }) => {
    const { page } = app
    await app.open()
    const dialog = await openImport(page)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })
})

test.describe('csv import', () => {
  test('walks a file into a new account and lands the rows', async ({ app }) => {
    const { page } = app
    await app.open()
    const dialog = await openImport(page)
    await chooseFile(page, BANK_CSV)

    // account step
    await expect(dialog.getByText('Pick the account these transactions belong to.')).toBeVisible()
    await expect(dialog.getByText('bank.csv · 3 rows')).toBeVisible()
    await expect(next(dialog)).toBeDisabled()
    await newAccount(dialog, 'Old Checking')
    await next(dialog).click()

    // mapping step: the headers were recognised
    await expect(dialog.getByText('Match the file’s columns to transaction fields.')).toBeVisible()
    await expect(mappingSelect(dialog, 'Date')).toHaveText('Date')
    await expect(mappingSelect(dialog, 'Date format')).toHaveText('yyyy-MM-dd')
    await expect(mappingSelect(dialog, 'Description')).toHaveText('Description')
    await expect(mappingSelect(dialog, 'Amount')).toHaveText('Amount')
    await expect(dialog.getByText('First 3 of 3 rows')).toBeVisible()
    await expect(dialog.getByRole('row', { name: '2026-09-02 PAYCHECK 1500.00' })).toBeVisible()
    await next(dialog).click()

    // preview
    await expect(
      dialog.getByText('Review what will be imported. Nothing is written until you confirm.')
    ).toBeVisible()
    await expect(dialog.getByRole('row', { name: /COFFEE SHOP/ })).toContainText('Sep 1, 2026')
    await expect(dialog.getByRole('row', { name: /COFFEE SHOP/ })).toContainText('-$4.50')
    await expect(dialog.getByRole('row', { name: /PAYCHECK/ })).toContainText('$1,500.00')
    await expect(dialog.getByRole('checkbox', { name: 'Include in import' })).toHaveCount(3)
    await dialog.getByRole('button', { name: 'Import 3 transactions' }).click()

    await expect(page.getByText('Imported 3 transactions')).toBeVisible()
    await expect(dialog).toBeHidden()

    const [account] = await app.sql<{ id: number; connection_id: number | null }>(
      "SELECT id, connection_id FROM accounts WHERE name = 'Old Checking'"
    )
    expect(account.connection_id).toBeNull()
    expect(await transactionsOf(app, account.id)).toEqual([
      { description: 'COFFEE SHOP', amount: -4500, deleted_at: null },
      { description: 'PAYCHECK', amount: 1_500_000, deleted_at: null },
      { description: 'GROCERY STORE', amount: -82_100, deleted_at: null }
    ])

    // and it shows up on the accounts page, with its rows behind it
    await expect(page.getByRole('row', { name: /Old Checking/ })).toContainText('$1,413.40')
    await page.getByRole('row', { name: /Old Checking/ }).click()
    await expect(page.getByRole('row', { name: /GROCERY STORE/ })).toContainText('-$82.10')
    await expect(page.getByRole('row', { name: /PAYCHECK/ })).toBeVisible()
  })

  test('imports into an existing account', async ({ app }) => {
    const { page } = app
    await app.open()
    const before = await transactionsOf(app, CHECKING)
    const dialog = await previewCsv(page, BANK_CSV, /Everyday Checking/)
    await dialog.getByRole('button', { name: 'Import 3 transactions' }).click()
    await expect(page.getByText('Imported 3 transactions')).toBeVisible()

    expect(await transactionsOf(app, CHECKING)).toHaveLength(before.length + 3)
    await page.getByRole('row', { name: /Everyday Checking/ }).click()
    await expect(page.getByRole('row', { name: /GROCERY STORE/ })).toBeVisible()
    await expect(page.getByRole('row', { name: /COFFEE SHOP/ })).toBeVisible()
  })

  test('the toast reports rules that categorized the new rows', async ({ app }) => {
    const { page } = app
    await app.open()
    const bonus = file(
      'bonus.csv',
      'Date,Description,Amount\n2026-09-10,ACME CORP PAYROLL BONUS,500.00\n'
    )
    const dialog = await previewCsv(page, bonus, /Everyday Checking/)
    await dialog.getByRole('button', { name: 'Import 1 transaction' }).click()
    await expect(page.getByText('Imported 1 transaction', { exact: true })).toBeVisible()
    await expect(page.getByText('1 categorized by rules')).toBeVisible()
  })

  test('debit and credit columns are recognised and need no sign flip', async ({ app }) => {
    const { page } = app
    await app.open()
    const dialog = await openImport(page)
    await chooseFile(page, DEBIT_CREDIT_CSV)
    await newAccount(dialog, 'Statement Account')
    await next(dialog).click()

    await expect(mappingSelect(dialog, 'Date format')).toHaveText('M/d/yyyy')
    await expect(mappingSelect(dialog, 'Description')).toHaveText('Payee')
    await expect(mappingSelect(dialog, 'Debit (money out)')).toHaveText('Withdrawal')
    await expect(mappingSelect(dialog, 'Credit (money in)')).toHaveText('Deposit')
    // the direction comes from the columns, so there is nothing to flip
    await expect(dialog.getByRole('switch')).toBeHidden()
    await next(dialog).click()

    await expect(dialog.getByRole('row', { name: /COFFEE SHOP/ })).toContainText('-$4.50')
    await expect(dialog.getByRole('row', { name: /PAYCHECK/ })).toContainText('$1,500.00')
    await expect(dialog.getByRole('row', { name: /PAYCHECK/ })).not.toContainText('-$')
  })

  test('the sign switch flips every amount, and only exists for a single amount column', async ({
    app
  }) => {
    const { page } = app
    await app.open()
    const dialog = await openImport(page)
    await chooseFile(page, BANK_CSV)
    await newAccount(dialog, 'Flipped')
    await next(dialog).click()

    const flip = dialog.getByRole('switch', { name: 'Flip the sign of every amount' })
    await expect(flip).not.toBeChecked()
    await flip.click()
    await expect(flip).toBeChecked()
    await next(dialog).click()
    await expect(dialog.getByRole('row', { name: /COFFEE SHOP/ })).toContainText('$4.50')
    await expect(dialog.getByRole('row', { name: /COFFEE SHOP/ })).not.toContainText('-$')
    await expect(dialog.getByRole('row', { name: /GROCERY STORE/ })).not.toContainText('-$')
    await expect(dialog.getByRole('row', { name: /PAYCHECK/ })).toContainText('-$1,500.00')
    await dialog.getByRole('button', { name: 'Import 3 transactions' }).click()
    await expect(page.getByText('Imported 3 transactions')).toBeVisible()

    const [account] = await app.sql<{ id: number }>(
      "SELECT id FROM accounts WHERE name = 'Flipped'"
    )
    expect((await transactionsOf(app, account.id)).map((t) => t.amount)).toEqual([
      4500, -1_500_000, 82_100
    ])
  })

  test('choosing separate debit / credit columns swaps the switch for two selects', async ({
    app
  }) => {
    const { page } = app
    await app.open()
    const dialog = await openImport(page)
    await chooseFile(page, BANK_CSV)
    await newAccount(dialog, 'Split')
    await next(dialog).click()

    await expect(dialog.getByRole('switch')).toBeVisible()
    await chooseColumn(page, dialog, 'Amount', 'Separate debit / credit columns')
    await expect(dialog.getByRole('switch')).toBeHidden()
    await expect(dialog.getByText('Debit (money out)')).toBeVisible()
    await expect(dialog.getByText('Credit (money in)')).toBeVisible()
  })

  test('an unrecognised file is mapped by hand, and Next waits for the mapping', async ({
    app
  }) => {
    const { page } = app
    await app.open()
    const dialog = await openImport(page)
    await chooseFile(page, UNLABELED_CSV)
    await newAccount(dialog, 'Odd Bank')
    await next(dialog).click()

    await expect(mappingSelect(dialog, 'Date')).toHaveText('Select a column')
    await expect(next(dialog)).toBeDisabled()
    await chooseColumn(page, dialog, 'Date', 'When')
    await chooseColumn(page, dialog, 'Description', 'What')
    await chooseColumn(page, dialog, 'Amount', 'How much')
    await expect(next(dialog)).toBeEnabled()
    await next(dialog).click()

    await expect(dialog.getByRole('row', { name: /COFFEE SHOP/ })).toContainText('-$4.50')
    await dialog.getByRole('button', { name: 'Import 2 transactions' }).click()
    await expect(page.getByText('Imported 2 transactions')).toBeVisible()
  })

  test('the date format can be changed to match the file', async ({ app }) => {
    const { page } = app
    await app.open()
    const dayFirst = file(
      'dayfirst.csv',
      'Date,Description,Amount\n03/09/2026,LUNCH,-9.00\n04/09/2026,DINNER,-30.00\n'
    )
    const dialog = await openImport(page)
    await chooseFile(page, dayFirst)
    await newAccount(dialog, 'Day First')
    await next(dialog).click()
    // ambiguous dates default to month first
    await expect(mappingSelect(dialog, 'Date format')).toHaveText('M/d/yyyy')

    await chooseColumn(page, dialog, 'Date format', 'd/M/yyyy')
    await next(dialog).click()
    await expect(dialog.getByRole('row', { name: /LUNCH/ })).toContainText('Sep 3, 2026')
    await expect(dialog.getByRole('row', { name: /DINNER/ })).toContainText('Sep 4, 2026')
  })

  test('rows that cannot be read are counted and left out', async ({ app }) => {
    const { page } = app
    await app.open()
    const dialog = await openImport(page)
    await chooseFile(page, BROKEN_ROW_CSV)
    await newAccount(dialog, 'Broken Rows')
    await next(dialog).click()
    await chooseColumn(page, dialog, 'Date', 'Date')
    await chooseColumn(page, dialog, 'Description', 'Description')
    await chooseColumn(page, dialog, 'Amount', 'Amount')
    await next(dialog).click()

    await expect(
      dialog.getByText('1 row couldn’t be read (e.g. line 4: Unparseable date: "bad-date")')
    ).toBeVisible()
    await expect(dialog.getByRole('checkbox', { name: 'Include in import' })).toHaveCount(3)
    await dialog.getByRole('button', { name: 'Import 3 transactions' }).click()
    await expect(page.getByText('Imported 3 transactions')).toBeVisible()
  })

  test('importing the same file again marks every row as a duplicate', async ({ app }) => {
    const { page } = app
    await app.open()
    let dialog = await previewCsv(page, BANK_CSV, /Everyday Checking/)
    await dialog.getByRole('button', { name: 'Import 3 transactions' }).click()
    await expect(page.getByText('Imported 3 transactions')).toBeVisible()
    await expect(dialog).toBeHidden()
    const imported = (await transactionsOf(app, CHECKING)).length

    dialog = await previewCsv(page, BANK_CSV, /Everyday Checking/)
    await expect(dialog.getByText('3 duplicates will be skipped')).toBeVisible()
    await expect(dialog.getByText('Duplicate', { exact: true })).toHaveCount(3)
    // duplicates are greyed out and can't be opted in
    await expect(dialog.getByRole('checkbox', { name: 'Include in import' })).toHaveCount(0)
    await expect(dialog.getByRole('row', { name: /COFFEE SHOP/ })).toHaveClass(/opacity-50/)
    await expect(dialog.getByRole('button', { name: 'Nothing to import' })).toBeDisabled()
    expect(await transactionsOf(app, CHECKING)).toHaveLength(imported)
  })

  test('a row matching an existing day and amount is a possible duplicate, off by default', async ({
    app
  }) => {
    const { page } = app
    await app.open()
    // the household card already has NETFLIX.COM for -15.49 on the 5th
    const overlap = file(
      'overlap.csv',
      'Date,Description,Amount\n2026-09-05,NETFLIX MONTHLY,-15.49\n2026-09-06,NEW MERCHANT,-7.00\n'
    )
    const dialog = await previewCsv(page, overlap, /Rewards Visa/)

    const probable = dialog.getByRole('row', { name: /NETFLIX MONTHLY/ })
    await expect(probable).toContainText('Possible duplicate')
    await expect(probable.getByRole('checkbox')).not.toBeChecked()
    await expect(
      dialog.getByRole('row', { name: /NEW MERCHANT/ }).getByRole('checkbox')
    ).toBeChecked()
    // a possible duplicate is only flagged; the summary line is for sure ones
    await expect(dialog.getByText(/will be skipped/)).toBeHidden()
    await expect(dialog.getByRole('button', { name: 'Import 1 transaction' })).toBeVisible()

    await probable.getByRole('checkbox').click()
    await expect(dialog.getByRole('button', { name: 'Import 2 transactions' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Import 2 transactions' }).click()
    await expect(page.getByText('Imported 2 transactions')).toBeVisible()
    const rows = await transactionsOf(app, VISA)
    expect(rows.filter((r) => r.description === 'NETFLIX MONTHLY')).toHaveLength(1)
  })

  test('unchecking a row leaves it out of the import', async ({ app }) => {
    const { page } = app
    await app.open()
    const dialog = await previewCsv(page, BANK_CSV, { newAccount: 'Picky' })
    await dialog
      .getByRole('row', { name: /GROCERY STORE/ })
      .getByRole('checkbox')
      .click()
    await expect(dialog.getByRole('button', { name: 'Import 2 transactions' })).toBeVisible()

    await dialog
      .getByRole('row', { name: /COFFEE SHOP/ })
      .getByRole('checkbox')
      .click()
    await dialog
      .getByRole('row', { name: /PAYCHECK/ })
      .getByRole('checkbox')
      .click()
    await expect(dialog.getByRole('button', { name: 'Nothing to import' })).toBeDisabled()

    await dialog
      .getByRole('row', { name: /PAYCHECK/ })
      .getByRole('checkbox')
      .click()
    await dialog.getByRole('button', { name: 'Import 1 transaction' }).click()
    await expect(page.getByText('Imported 1 transaction', { exact: true })).toBeVisible()
    const [account] = await app.sql<{ id: number }>("SELECT id FROM accounts WHERE name = 'Picky'")
    expect((await transactionsOf(app, account.id)).map((t) => t.description)).toEqual(['PAYCHECK'])
  })

  // import-dialog.tsx:447 and :596-618: a half-filled mapping is still sent
  // upward (unset roles are -1) and `!mapping` is the only gate on Next, so
  // picking just the Date column enables Next, and the preview then shows the
  // raw zod issue list ("too_small ... mapping.descriptionColumn") after the
  // query's retries instead of keeping Next disabled
  test.fixme('TRIAGE: a partial CSV mapping enables Next and shows a raw ZodError', async () => {})

  // import-dialog.tsx:660-672: the Amount select's value is null whenever the
  // mapping isn't a single column, so with separate debit / credit columns
  // (detected or chosen) it still reads "Select a column" over the two
  // selects that are filled
  test.fixme('TRIAGE: the Amount select shows its placeholder in debit / credit mode', async () => {})
})

test.describe('account step', () => {
  test('Next needs an account, and a new account needs a name', async ({ app }) => {
    const { page } = app
    await app.open()
    const dialog = await openImport(page)
    await chooseFile(page, BANK_CSV)
    await expect(dialog.getByRole('tab', { name: 'Existing account' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(dialog.getByRole('combobox')).toHaveText('Select an account')
    await expect(next(dialog)).toBeDisabled()

    await dialog.getByRole('combobox').click()
    await expect(page.getByRole('option')).toHaveText([
      'Evergreen Bank · Everyday Checking',
      'Evergreen Bank · High-Yield Savings',
      'Northwind Investments · Individual Brokerage',
      'Summit Card Services · Rewards Visa'
    ])
    await page.getByRole('option', { name: /High-Yield Savings/ }).click()
    await expect(dialog.getByRole('combobox')).toHaveText('Evergreen Bank · High-Yield Savings')
    await expect(next(dialog)).toBeEnabled()

    await dialog.getByRole('tab', { name: 'New account' }).click()
    await expect(next(dialog)).toBeDisabled()
    await dialog.getByLabel('Name').fill('   ')
    await expect(next(dialog)).toBeDisabled()
    await dialog.getByLabel('Name').fill('Fresh')
    await expect(next(dialog)).toBeEnabled()
    await expect(dialog.getByRole('combobox', { name: 'Currency' })).toHaveText('USD — US Dollar')
  })

  test('a new account takes a currency and a negative opening balance', async ({ app }) => {
    const { page } = app
    await app.open()
    const dialog = await openImport(page)
    await chooseFile(page, BANK_CSV)
    await newAccount(dialog, 'Euro Card', '-250.50')
    await expect(next(dialog)).toBeEnabled()

    await dialog.getByRole('combobox', { name: 'Currency' }).click()
    await page.getByPlaceholder('Search currencies...').fill('euro')
    await page.getByRole('option', { name: 'EUR Euro', exact: true }).click()
    await expect(dialog.getByRole('combobox', { name: 'Currency' })).toHaveText('EUR — Euro')
    await next(dialog).click()
    await next(dialog).click()
    await expect(dialog.getByRole('row', { name: /COFFEE SHOP/ })).toContainText('-€4.50')
    await dialog.getByRole('button', { name: 'Import 3 transactions' }).click()
    await expect(page.getByText('Imported 3 transactions')).toBeVisible()

    const [account] = await app.sql<{ id: number; currency: string }>(
      "SELECT id, currency FROM accounts WHERE name = 'Euro Card'"
    )
    expect(account.currency).toBe('EUR')
    const rows = await transactionsOf(app, account.id)
    expect(rows[0]).toEqual({ description: 'Starting balance', amount: -250_500, deleted_at: null })
    expect(rows).toHaveLength(4)
    // -250.50 + 1500.00 - 4.50 - 82.10
    await expect(page.getByRole('row', { name: /Euro Card/ })).toContainText('€1,162.90')
  })

  test('Back steps through the dialog and keeps what was chosen', async ({ app }) => {
    const { page } = app
    await app.open()
    const dialog = await openImport(page)
    await chooseFile(page, BANK_CSV)
    await pickAccount(page, dialog, /Rewards Visa/)
    await next(dialog).click()
    await next(dialog).click()
    await expect(dialog.getByRole('button', { name: 'Import 3 transactions' })).toBeVisible()
    await expect(stepDots(dialog)).toHaveCount(3)

    await back(dialog).click()
    await expect(dialog.getByText('Match the file’s columns to transaction fields.')).toBeVisible()
    await expect(mappingSelect(dialog, 'Amount')).toHaveText('Amount')
    await back(dialog).click()
    await expect(dialog.getByText('Pick the account these transactions belong to.')).toBeVisible()
    await expect(dialog.getByRole('combobox')).toHaveText('Summit Card Services · Rewards Visa')

    // forward again reuses the preview without asking for the file
    await next(dialog).click()
    await next(dialog).click()
    await expect(dialog.getByRole('button', { name: 'Import 3 transactions' })).toBeVisible()

    await back(dialog).click()
    await back(dialog).click()
    await back(dialog).click()
    await expect(dialog.getByText('Drop a file here')).toBeVisible()
    await expect(next(dialog)).toBeHidden()
  })

  test('closing and reopening starts over', async ({ app }) => {
    const { page } = app
    await app.open()
    let dialog = await openImport(page)
    await chooseFile(page, BANK_CSV)
    await newAccount(dialog, 'Half Done', '10')
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toBeHidden()

    dialog = await openImport(page)
    await chooseFile(page, BANK_CSV)
    await expect(dialog.getByRole('tab', { name: 'Existing account' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(dialog.getByRole('combobox')).toHaveText('Select an account')
    await expect(next(dialog)).toBeDisabled()
    await dialog.getByRole('tab', { name: 'New account' }).click()
    await expect(dialog.getByLabel('Name')).toHaveValue('')
    await expect(dialog.getByLabel('Opening balance (optional)')).toHaveValue('')
    expect(await app.sql("SELECT id FROM accounts WHERE name = 'Half Done'")).toHaveLength(0)
  })
})

test.describe('ofx and qif', () => {
  test('an OFX file goes from the account step straight to the preview', async ({ app }) => {
    const { page } = app
    await app.open()
    const dialog = await openImport(page)
    await chooseFile(page, OFX)
    await expect(dialog.getByText('export.ofx · 2 transactions')).toBeVisible()
    await expect(stepDots(dialog)).toHaveCount(2)
    await pickAccount(page, dialog, /Everyday Checking/)
    await next(dialog).click()

    await expect(dialog.getByText('Match the file’s columns')).toBeHidden()
    await expect(dialog.getByRole('row', { name: /OFX COFFEE/ })).toContainText('-$12.34')
    await expect(dialog.getByRole('row', { name: /OFX REFUND/ })).toContainText('$250.00')
    await back(dialog).click()
    await expect(dialog.getByText('Pick the account these transactions belong to.')).toBeVisible()
    await next(dialog).click()

    await dialog.getByRole('button', { name: 'Import 2 transactions' }).click()
    await expect(page.getByText('Imported 2 transactions')).toBeVisible()
    const rows = await transactionsOf(app, CHECKING)
    expect(rows.filter((r) => r.description.startsWith('OFX '))).toHaveLength(2)
  })

  test('an OFX re-import is recognised by the bank ids', async ({ app }) => {
    const { page } = app
    await app.open()
    for (const expected of ['Import 2 transactions', 'Nothing to import']) {
      const dialog = await openImport(page)
      await chooseFile(page, OFX)
      await pickAccount(page, dialog, /Everyday Checking/)
      await next(dialog).click()
      await expect(dialog.getByRole('button', { name: expected })).toBeVisible()
      if (expected === 'Nothing to import') {
        await expect(dialog.getByText('2 duplicates will be skipped')).toBeVisible()
      } else {
        await dialog.getByRole('button', { name: expected }).click()
        await expect(importDialog(page)).toBeHidden()
      }
    }
  })

  test('a QIF file goes straight to the preview too', async ({ app }) => {
    const { page } = app
    await app.open()
    const dialog = await openImport(page)
    await chooseFile(page, QIF)
    await expect(dialog.getByText('export.qif · 2 transactions')).toBeVisible()
    await newAccount(dialog, 'Quicken Import')
    await next(dialog).click()

    await expect(dialog.getByRole('row', { name: /QIF LUNCH/ })).toContainText('Sep 4, 2026')
    await expect(dialog.getByRole('row', { name: /QIF LUNCH/ })).toContainText('-$21.00')
    // thousands separators are read, not truncated
    await expect(dialog.getByRole('row', { name: /QIF PAYCHECK/ })).toContainText('$1,000.00')
    await dialog.getByRole('button', { name: 'Import 2 transactions' }).click()
    await expect(page.getByText('Imported 2 transactions')).toBeVisible()
    await expect(page.getByRole('row', { name: /Quicken Import/ })).toContainText('$979.00')
  })
})

test.describe('files from outside the dialog', () => {
  test('dropping a file on the drop zone starts the import', async ({ app }) => {
    const { page } = app
    await app.open()
    const dialog = await openImport(page)
    await dialog.locator('[data-slot=empty]').evaluate((zone, text) => {
      const transfer = new DataTransfer()
      transfer.items.add(new File([text], 'dropped.csv', { type: 'text/csv' }))
      zone.dispatchEvent(new DragEvent('dragover', { dataTransfer: transfer, bubbles: true }))
      zone.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true }))
    }, 'Date,Description,Amount\n2026-09-01,DROPPED ROW,-1.00\n')

    await expect(dialog.getByText('dropped.csv · 1 row')).toBeVisible()
    await newAccount(dialog, 'Dropped')
    await next(dialog).click()
    await next(dialog).click()
    await expect(dialog.getByRole('row', { name: /DROPPED ROW/ })).toContainText('-$1.00')
  })

  test('a file the OS opens lands on the account step', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/budget' })
    await app.bridge(
      (b, arg: { fileName: string; text: string }) =>
        b.push('app:openImportFile', {
          fileName: arg.fileName,
          bytes: new TextEncoder().encode(arg.text)
        }),
      { fileName: 'from-os.csv', text: BANK_CSV.buffer.toString() }
    )

    const dialog = importDialog(page)
    await expect(dialog.getByText('from-os.csv · 3 rows')).toBeVisible()
    await expect(dialog.getByText('Pick the account these transactions belong to.')).toBeVisible()
    await expect(page).toHaveURL(/#\/budget/)
    await pickAccount(page, dialog, /Everyday Checking/)
    await next(dialog).click()
    await next(dialog).click()
    await dialog.getByRole('button', { name: 'Import 3 transactions' }).click()
    await expect(page.getByText('Imported 3 transactions')).toBeVisible()
    await expect(dialog).toBeHidden()
  })
})
