import { beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import type { ImportApplyResult, ImportPreview, PickFileResult } from '@shared/import'
import type { RulePreview } from '@shared/rules'

// better-sqlite3 won't load under vitest; the web demo's sql.js database runs
// the same drizzle code against the real migrations
vi.mock('electron', () => import('../../demo/shims/electron'))
vi.mock('../db', () => import('../../demo/db'))
vi.mock('../logging', () => import('../../demo/shims/logging'))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))

const { db, runMigrations } = await import('../../demo/db')
const schema = await import('../db/schema')
const { ipcRenderer } = await import('../../demo/shims/electron')
const { IMPORT_IPC } = await import('@shared/import')
const { RULES_IPC } = await import('@shared/rules')
const { registerImportIpc } = await import('./import')
const { registerRulesIpc } = await import('./rules')

const noon = (y: number, m0: number, d: number): number => new Date(y, m0, d, 12).getTime() / 1000

const CSV = [
  'Date,Description,Amount',
  '01/05/2024,Coffee,-4.50',
  '01/06/2024,Transfer to savings,-250.00',
  '01/07/2024,Groceries,-82.10',
  '01/08/2024,Coffee,-4.50',
  '01/09/2024,Paycheck,1500.00'
].join('\n')

const MAPPING = {
  dateColumn: 0,
  dateFormat: 'MM/dd/yyyy',
  descriptionColumn: 1,
  amount: { kind: 'single' as const, column: 2, invert: false }
}

let savingsId: number
let foodId: number

async function pick(text: string, fileName = 'bank.csv'): Promise<Exclude<PickFileResult, null>> {
  const bytes = new TextEncoder().encode(text)
  const result = (await ipcRenderer.invoke(IMPORT_IPC.pickFile, {
    dropped: { fileName, bytes }
  })) as PickFileResult
  if (!result) throw new Error('canceled')
  return result
}

beforeAll(() => {
  runMigrations()
  registerImportIpc()
  registerRulesIpc()
  savingsId = db
    .insert(schema.accounts)
    .values({ name: 'Savings', currency: 'USD', balance: 0, balanceDate: 0 })
    .returning({ id: schema.accounts.id })
    .get().id
  // the other leg of the file's transfer, already in the ledger
  db.insert(schema.transactions)
    .values({
      accountId: savingsId,
      simplefinId: 's1',
      posted: noon(2024, 0, 7),
      amount: 250000,
      description: 'Transfer from checking'
    })
    .run()
  foodId = db
    .insert(schema.categories)
    .values({ name: 'Food' })
    .returning({ id: schema.categories.id })
    .get().id
})

describe('file import over a handle', () => {
  let accountId: number

  it('returns a sample and count instead of every row', async () => {
    const file = await pick(CSV)
    expect(file.kind).toBe('csv')
    if (file.kind !== 'csv') return
    expect(file.rowCount).toBe(5)
    expect(file.sampleRows).toHaveLength(3)
    expect(file.suggestedMapping).not.toBeNull()
  })

  it('applies the preview selection, scoping transfers and rules to the new rows', async () => {
    await ipcRenderer.invoke(RULES_IPC.create, {
      name: 'Coffee',
      conditions: { description: { op: 'contains', phrases: ['coffee'] } },
      action: { type: 'setCategory', categoryId: foodId }
    })
    const file = await pick(CSV)
    const preview = (await ipcRenderer.invoke(IMPORT_IPC.preview, {
      handle: file.handle,
      mapping: MAPPING
    })) as ImportPreview
    expect(preview.rows).toHaveLength(5)
    expect(preview.rows.every((r) => r.status === 'new')).toBe(true)

    const groceries = preview.rows.find((r) => r.description === 'Groceries')!
    const result = (await ipcRenderer.invoke(IMPORT_IPC.apply, {
      handle: file.handle,
      mapping: MAPPING,
      excluded: [groceries.externalId],
      target: { newAccount: { name: 'Checking', currency: 'USD', balance: 100000 } }
    })) as ImportApplyResult
    accountId = result.accountId
    expect(result).toMatchObject({ inserted: 4, skipped: 0, detectedTransfers: 1, rulesApplied: 2 })

    const rows = db
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.accountId, accountId))
      .all()
    expect(rows.map((r) => r.description).sort()).toEqual([
      'Coffee',
      'Coffee',
      'Paycheck',
      'Starting balance',
      'Transfer to savings'
    ])
    const opening = rows.find((r) => r.description === 'Starting balance')!
    expect(opening.posted).toBe(noon(2024, 0, 5) - 86400)
  })

  it('marks a re-import as duplicates and skips them', async () => {
    const file = await pick(CSV)
    const preview = (await ipcRenderer.invoke(IMPORT_IPC.preview, {
      handle: file.handle,
      mapping: MAPPING,
      accountId
    })) as ImportPreview
    const statuses = preview.rows.map((r) => r.status)
    expect(statuses.filter((s) => s === 'duplicate')).toHaveLength(4)

    const result = (await ipcRenderer.invoke(IMPORT_IPC.apply, {
      handle: file.handle,
      mapping: MAPPING,
      excluded: [],
      target: { accountId }
    })) as ImportApplyResult
    // only the row left out last time is importable
    expect(result).toMatchObject({ inserted: 1, skipped: 0 })
  })

  it('forgets a released handle', async () => {
    const file = await pick(CSV)
    await ipcRenderer.invoke(IMPORT_IPC.release, file.handle)
    await expect(
      ipcRenderer.invoke(IMPORT_IPC.preview, { handle: file.handle, mapping: MAPPING })
    ).rejects.toThrow(/no longer loaded/)
  })

  it('parses QIF into a rows handle', async () => {
    const file = await pick('!Type:Bank\nD1/2/2024\nT-1.00\nPX\n^', 'old.qif')
    expect(file).toMatchObject({ kind: 'rows', format: 'qif', rowCount: 1 })
  })
})

describe('rules preview', () => {
  it('caps the rows it returns but counts every match', async () => {
    const account = db
      .insert(schema.accounts)
      .values({ name: 'Card', currency: 'USD', balance: 0, balanceDate: 0 })
      .returning({ id: schema.accounts.id })
      .get().id
    for (let i = 0; i < 60; i++) {
      db.insert(schema.transactions)
        .values({
          accountId: account,
          simplefinId: `latte-${i}`,
          posted: noon(2024, 1, 1) + i,
          amount: -5000,
          description: 'Latte stand'
        })
        .run()
    }
    await ipcRenderer.invoke(RULES_IPC.create, {
      name: 'Latte',
      conditions: { description: { op: 'contains', phrases: ['latte'] } },
      action: { type: 'setCategory', categoryId: foodId }
    })
    const preview = (await ipcRenderer.invoke(RULES_IPC.preview, {})) as RulePreview
    const group = preview.find((g) => g.ruleName === 'Latte')!
    expect(group.total).toBe(60)
    expect(group.transactions).toHaveLength(50)
  })
})
