import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import initSqlJs from 'sql.js'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app, dialog } from 'electron'
import {
  DEFAULT_TRANSACTION_FILTERS,
  resolveTransactionFilters,
  type TransactionFilters,
  type TransactionsExportQuery
} from '@shared/transaction-filters'
import { api } from './harness/api'
import { account, category, noon, txn } from './harness/builders'

// The electron shim has no save/folder pickers and no relaunch; each spec
// installs what it needs and points userData at a scratch folder
const shim = { app, dialog } as unknown as {
  app: Record<string, unknown>
  dialog: Record<string, unknown>
}

const NOW = noon(2026, 9, 15)
let scratch: string
let checking: number
let card: number

const read = (file: string): string => fs.readFileSync(file, 'utf8')
const lines = (csv: string): string[] =>
  csv.replace(String.fromCharCode(0xfeff), '').trimEnd().split(/\r\n/)

function saveTo(file: string | undefined): void {
  shim.dialog.showSaveDialog = vi.fn(async () => ({ canceled: !file, filePath: file ?? '' }))
}

async function exportCsv(
  over: Partial<TransactionFilters> = {},
  query: Partial<TransactionsExportQuery> = {}
): Promise<string[]> {
  const file = path.join(scratch, `export-${Math.random()}.csv`)
  saveTo(file)
  const result = await api.transactions.exportCsv({
    filters: resolveTransactionFilters({ ...DEFAULT_TRANSACTION_FILTERS, ...over }, NOW),
    sortBy: 'date',
    sortDir: 'desc',
    ...query
  })
  expect(result).toBe(file)
  return lines(read(file))
}

beforeAll(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'shmoney-storage-'))
  vi.spyOn(app, 'getPath').mockReturnValue(scratch)

  checking = account({ name: 'Csv Checking' })
  card = account({ name: 'Csv Card', currency: 'EUR' })
  const coffee = category('CsvCoffee')
  txn(checking, {
    description: 'Blue Bottle, "Mission"',
    amount: -4_500,
    posted: noon(2026, 9, 3),
    categoryId: coffee
  })
  txn(checking, { description: '=HYPERLINK("x")', amount: 1_234_560, posted: noon(2026, 9, 1) })
  txn(card, { description: 'Café Lumen', amount: -12_345, posted: noon(2026, 9, 2), pending: true })
  txn(checking, { description: 'Csv deleted', posted: noon(2026, 9, 4), deletedAt: NOW })
})

afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }))

describe('Export CSV', () => {
  it('writes the filtered rows in the table’s order, readable in a spreadsheet', async () => {
    const csv = await exportCsv({ search: 'Csv' }, { sortBy: 'amount', sortDir: 'asc' })
    expect(csv).toEqual([
      'Date,Account,Description,Category,Amount,Currency,Pending',
      // the account name matches the search for all three; the soft-deleted row never shows
      '2026-09-02,Csv Card,Café Lumen,,-12.345,EUR,yes',
      '2026-09-03,Csv Checking,"Blue Bottle, ""Mission""",CsvCoffee,-4.50,USD,no',
      // a description that would run as a formula is defused
      `2026-09-01,Csv Checking,"'=HYPERLINK(""x"")",,1234.56,USD,no`
    ])
  })

  it('starts with a BOM so Excel reads it as UTF-8', async () => {
    const file = path.join(scratch, 'bom.csv')
    saveTo(file)
    await api.transactions.exportCsv({
      filters: resolveTransactionFilters(DEFAULT_TRANSACTION_FILTERS, NOW),
      sortBy: 'date',
      sortDir: 'desc'
    })
    expect(fs.readFileSync(file)[0]).toBe(0xef)
  })

  it('applies the same filters as the table', async () => {
    const csv = await exportCsv({ search: 'Csv', direction: 'expense', includePending: false })
    expect(csv.slice(1)).toEqual([
      '2026-09-03,Csv Checking,"Blue Bottle, ""Mission""",CsvCoffee,-4.50,USD,no'
    ])
  })

  it('scopes to the page’s account, ignoring accountIds from a saved filter', async () => {
    const csv = await exportCsv({ accountIds: [card] }, { accountId: checking })
    expect(csv.slice(1).map((line) => line.split(',')[1])).toEqual(['Csv Checking', 'Csv Checking'])
  })

  it('writes nothing when the save dialog is cancelled', async () => {
    saveTo(undefined)
    const before = fs.readdirSync(scratch).length
    expect(
      await api.transactions.exportCsv({
        filters: resolveTransactionFilters(DEFAULT_TRANSACTION_FILTERS, NOW),
        sortBy: 'date',
        sortDir: 'desc'
      })
    ).toBeNull()
    expect(fs.readdirSync(scratch)).toHaveLength(before)
  })
})

describe('backups', () => {
  beforeEach(() => {
    shim.app.relaunch = vi.fn()
    shim.app.quit = vi.fn()
  })

  it('Back up now writes a snapshot of the live data and lists it', async () => {
    const backup = await api.storage.backupNow()
    expect(backup.kind).toBe('manual')
    expect(backup.bytes).toBeGreaterThan(0)
    expect((await api.storage.listBackups()).map((b) => b.name)).toContain(backup.name)

    const SQL = await initSqlJs()
    const copy = new SQL.Database(fs.readFileSync(path.join(scratch, 'backups', backup.name)))
    const [result] = copy.exec("SELECT count(*) FROM transactions WHERE description LIKE 'Csv%'")
    expect(result.values[0][0]).toBe(1)
    copy.close()
  })

  it('restore snapshots the current data first, then relaunches into the backup', async () => {
    const [target] = await api.storage.listBackups()
    await api.storage.restoreBackup(target.name)

    const backups = await api.storage.listBackups()
    expect(backups[0].kind).toBe('pre-restore')
    expect(JSON.parse(read(path.join(scratch, 'restore-pending.json')))).toEqual({
      name: target.name
    })
    expect(shim.app.relaunch).toHaveBeenCalledOnce()
    expect(shim.app.quit).toHaveBeenCalledOnce()
    fs.rmSync(path.join(scratch, 'restore-pending.json'))
  })

  it('refuses a backup that is missing or damaged, without relaunching', async () => {
    await expect(api.storage.restoreBackup('shmoney.db')).rejects.toThrow('no longer exists')

    const damaged = 'shmoney-2026-01-01-120000000-manual.db'
    fs.writeFileSync(path.join(scratch, 'backups', damaged), 'not a database')
    await expect(api.storage.restoreBackup(damaged)).rejects.toThrow('damaged')

    expect(shim.app.relaunch).not.toHaveBeenCalled()
    expect(fs.existsSync(path.join(scratch, 'restore-pending.json'))).toBe(false)
    fs.rmSync(path.join(scratch, 'backups', damaged))
  })
})

describe('Export everything', () => {
  it('writes one CSV per table and a copy of the database to a new folder', async () => {
    const parent = path.join(scratch, 'exports')
    fs.mkdirSync(parent)
    shim.dialog.showOpenDialog = vi.fn(async () => ({ canceled: false, filePaths: [parent] }))

    const first = await api.storage.exportAll()
    const second = await api.storage.exportAll()
    expect(path.dirname(first!.path)).toBe(parent)
    // a second export never overwrites the first
    expect(second!.path).toBe(`${first!.path} (2)`)

    const files = fs.readdirSync(first!.path)
    expect(files).toContain('shmoney.db')
    expect(files).toContain('transactions.csv')
    expect(files).toContain('accounts.csv')
    expect(files).not.toContain('__drizzle_migrations.csv')

    // raw rows, soft-deleted ones included, with the stored integer amounts
    const transactions = lines(read(path.join(first!.path, 'transactions.csv')))
    expect(transactions[0].split(',')).toContain('amount')
    expect(transactions.some((line) => line.includes('Csv deleted'))).toBe(true)
    expect(transactions.some((line) => line.includes(',1234560,'))).toBe(true)
  })

  it('does nothing when the folder picker is cancelled', async () => {
    shim.dialog.showOpenDialog = vi.fn(async () => ({ canceled: true, filePaths: [] }))
    expect(await api.storage.exportAll()).toBeNull()
  })
})
