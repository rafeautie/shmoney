import { beforeAll, describe, expect, it } from 'vitest'
import type { PickFileResult } from '@shared/import'
import { api } from './harness/api'
import { account, category, noon, txn } from './harness/builders'
import { query } from './harness/db'

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

let foodId: number

async function pick(text: string, fileName = 'bank.csv'): Promise<Exclude<PickFileResult, null>> {
  const result = await api.import.pickFile({
    dropped: { fileName, bytes: new TextEncoder().encode(text) }
  })
  if (!result) throw new Error('canceled')
  return result
}

beforeAll(() => {
  const savings = account({ name: 'Savings' })
  // the other leg of the file's transfer, already in the ledger
  txn(savings, {
    simplefinId: 's1',
    posted: noon(2024, 1, 7),
    amount: 250000,
    description: 'Transfer from checking'
  })
  foodId = category('Food')
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
    await api.rules.create({
      name: 'Coffee',
      conditions: { description: { op: 'contains', phrases: ['coffee'] } },
      action: { type: 'setCategory', categoryId: foodId }
    })
    const file = await pick(CSV)
    const preview = await api.import.preview({ handle: file.handle, mapping: MAPPING })
    expect(preview.rows).toHaveLength(5)
    expect(preview.rows.every((r) => r.status === 'new')).toBe(true)

    const groceries = preview.rows.find((r) => r.description === 'Groceries')!
    const result = await api.import.apply({
      handle: file.handle,
      mapping: MAPPING,
      excluded: [groceries.externalId],
      target: { newAccount: { name: 'Checking', currency: 'USD', balance: 100000 } }
    })
    accountId = result.accountId
    expect(result).toMatchObject({ inserted: 4, skipped: 0, detectedTransfers: 1, rulesApplied: 2 })

    const rows = query<{ description: string; posted: number }>(
      `SELECT description, posted FROM transactions WHERE account_id = ${accountId}`
    )
    expect(rows.map((r) => r.description).sort()).toEqual([
      'Coffee',
      'Coffee',
      'Paycheck',
      'Starting balance',
      'Transfer to savings'
    ])
    const opening = rows.find((r) => r.description === 'Starting balance')!
    expect(opening.posted).toBe(noon(2024, 1, 5) - 86400)
  })

  it('marks a re-import as duplicates and skips them', async () => {
    const file = await pick(CSV)
    const preview = await api.import.preview({ handle: file.handle, mapping: MAPPING, accountId })
    expect(preview.rows.filter((r) => r.status === 'duplicate')).toHaveLength(4)

    const result = await api.import.apply({
      handle: file.handle,
      mapping: MAPPING,
      excluded: [],
      target: { accountId }
    })
    // only the row left out last time is importable
    expect(result).toMatchObject({ inserted: 1, skipped: 0 })
  })

  it('forgets a released handle', async () => {
    const file = await pick(CSV)
    await api.import.release(file.handle)
    await expect(api.import.preview({ handle: file.handle, mapping: MAPPING })).rejects.toThrow(
      /no longer loaded/
    )
  })

  it('parses QIF into a rows handle', async () => {
    const file = await pick('!Type:Bank\nD1/2/2024\nT-1.00\nPX\n^', 'old.qif')
    expect(file).toMatchObject({ kind: 'rows', format: 'qif', rowCount: 1 })
  })
})

describe('rules preview', () => {
  it('caps the rows it returns but counts every match', async () => {
    const card = account({ name: 'Card' })
    for (let i = 0; i < 60; i++) {
      txn(card, { posted: noon(2024, 2, 1) + i, amount: -5000, description: 'Latte stand' })
    }
    await api.rules.create({
      name: 'Latte',
      conditions: { description: { op: 'contains', phrases: ['latte'] } },
      action: { type: 'setCategory', categoryId: foodId }
    })
    const preview = await api.rules.preview()
    const group = preview.find((g) => g.ruleName === 'Latte')!
    expect(group.total).toBe(60)
    expect(group.transactions).toHaveLength(50)
  })
})
