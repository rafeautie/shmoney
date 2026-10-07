import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { ImportApplyResult, PickFileResult } from '@shared/import'
import { api } from './harness/api'
import { account, category, noon, rule, systemCategory, txn } from './harness/builders'
import { count, query } from './harness/db'
import { installBridge, sfinAccount, sfinTxn, type FakeBridge } from './harness/fakes/simplefin'
import { expectUndoRoundTrip } from './harness/undo'

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

const csvOf = (...rows: string[]): string => ['Date,Description,Amount', ...rows].join('\n')

async function applyCsv(
  text: string,
  target: Parameters<typeof api.import.apply>[0]['target'],
  excluded: string[] = []
): Promise<ImportApplyResult> {
  const file = await pick(text)
  return api.import.apply({ handle: file.handle, mapping: MAPPING, excluded, target })
}

const liveIds = (accountId: number): number[] =>
  query<{ id: number }>(
    `SELECT id FROM transactions WHERE account_id = ${accountId} AND deleted_at IS NULL ORDER BY id`
  ).map((r) => r.id)

describe('apply', () => {
  it('rejects when the user excluded every row', async () => {
    const file = await pick(csvOf('04/01/2024,Only row,-5.00'))
    const preview = await api.import.preview({ handle: file.handle, mapping: MAPPING })
    await expect(
      api.import.apply({
        handle: file.handle,
        mapping: MAPPING,
        excluded: preview.rows.map((r) => r.externalId),
        target: { newAccount: { name: 'Nothing', currency: 'USD' } }
      })
    ).rejects.toThrow('No rows selected')
    expect(count('accounts', "name = 'Nothing'")).toBe(0)
  })

  it('rejects a re-import of rows that are all live duplicates', async () => {
    const target = account({ name: 'All dupes' })
    const text = csvOf('04/02/2024,Dupe row,-6.00')
    await applyCsv(text, { accountId: target })
    await expect(applyCsv(text, { accountId: target })).rejects.toThrow('No rows selected')
  })

  it('rolls back entirely when the target account does not exist', async () => {
    const before = {
      transactions: count('transactions'),
      accounts: count('accounts'),
      entries: count('action_log'),
      runs: count('action_runs')
    }
    await expect(
      applyCsv(csvOf('04/03/2024,Orphan,-7.00'), { accountId: 999_999 })
    ).rejects.toThrow('Account not found')
    expect({
      transactions: count('transactions'),
      accounts: count('accounts'),
      entries: count('action_log'),
      runs: count('action_runs')
    }).toEqual(before)
  })

  it('creates a new account without an opening row when no balance is given', async () => {
    const result = await applyCsv(csvOf('04/04/2024,No opening,-8.00'), {
      newAccount: { name: 'No opening', currency: 'USD' }
    })
    expect(
      query(`SELECT description FROM transactions WHERE account_id = ${result.accountId}`)
    ).toEqual([{ description: 'No opening' }])
    expect(
      query(`SELECT connection_id, simplefin_id FROM accounts WHERE id = ${result.accountId}`)
    ).toEqual([{ connection_id: null, simplefin_id: null }])
  })

  it('creates no opening row for an explicit zero balance either', async () => {
    const result = await applyCsv(csvOf('04/05/2024,Zero opening,-9.00'), {
      newAccount: { name: 'Zero opening', currency: 'USD', balance: 0 }
    })
    expect(count('transactions', `account_id = ${result.accountId}`)).toBe(1)
  })

  it('never updates a live row when the same file is imported again', async () => {
    const target = account({ name: 'Edited live' })
    await applyCsv(csvOf('04/06/2024,Original text,-10.00'), { accountId: target })
    const [id] = liveIds(target)
    await api.transactions.update({ id, description: 'Edited by hand', amount: -10_500 })

    const result = await applyCsv(
      csvOf('04/06/2024,Original text,-10.00', '04/07/2024,Fresh row,-11.00'),
      { accountId: target }
    )
    expect(result).toMatchObject({ inserted: 1, skipped: 0 })
    expect(query(`SELECT description, amount FROM transactions WHERE id = ${id}`)).toEqual([
      { description: 'Edited by hand', amount: -10_500 }
    ])
  })

  it('leaves the file itself usable for a second apply into another account', async () => {
    const file = await pick(csvOf('04/08/2024,Twice over,-12.00'))
    const a = account({ name: 'First target' })
    const b = account({ name: 'Second target' })
    await api.import.apply({
      handle: file.handle,
      mapping: MAPPING,
      excluded: [],
      target: { accountId: a }
    })
    const second = await api.import.apply({
      handle: file.handle,
      mapping: MAPPING,
      excluded: [],
      target: { accountId: b }
    })
    expect(second.inserted).toBe(1)
  })
})

describe('action log', () => {
  const entriesFor = (runId: number): number => count('action_log', `run_id = ${runId}`)

  it('records one entry inside an import run', async () => {
    const target = account({ name: 'Logged' })
    const lastRun = query<{ id: number | null }>('SELECT max(id) AS id FROM action_runs')[0].id ?? 0
    await applyCsv(csvOf('05/01/2024,Log one,-13.01', '05/02/2024,Log two,-13.02'), {
      accountId: target
    })
    const runs = query<{ id: number; trigger: string; label: string }>(
      `SELECT id, trigger, label FROM action_runs WHERE id > ${lastRun}`
    )
    expect(runs).toEqual([{ id: expect.any(Number), trigger: 'import', label: 'Import from file' }])
    expect(entriesFor(runs[0].id)).toBe(1)
    expect(query(`SELECT source, label FROM action_log WHERE run_id = ${runs[0].id}`)).toEqual([
      { source: 'import', label: expect.stringMatching(/^Imported 2 transactions into /) }
    ])
  })

  it('writes no entry or run when nothing was inserted', async () => {
    const before = { entries: count('action_log'), runs: count('action_runs') }
    await expect(
      applyCsv(csvOf('05/03/2024,Phantom,-1.00'), { accountId: 999_999 })
    ).rejects.toThrow()
    expect({ entries: count('action_log'), runs: count('action_runs') }).toEqual(before)
  })

  it('undo soft-deletes exactly the imported rows and redo restores them', async () => {
    const target = account({ name: 'Undoable' })
    const bystander = txn(target, { posted: noon(2024, 5, 4), description: 'Already there' })
    const entry = await expectUndoRoundTrip(() =>
      applyCsv(csvOf('05/04/2024,Undo me,-14.01', '05/05/2024,Undo me too,-14.02'), {
        accountId: target
      })
    )
    const imported = liveIds(target).filter((id) => id !== bystander)
    expect(imported).toHaveLength(2)

    const undone = await api.actionLog.undoEntry(entry)
    expect(undone.applied).toBe(2)
    expect(liveIds(target)).toEqual([bystander])
    expect(count('transactions', `account_id = ${target} AND deleted_at IS NOT NULL`)).toBe(2)

    const redone = await api.actionLog.redoEntry(entry)
    expect(redone.applied).toBe(2)
    expect(liveIds(target)).toEqual([bystander, ...imported])
  })

  it('previews a re-import after undo as new and restores the same rows', async () => {
    const target = account({ name: 'Undo then redo import' })
    const text = csvOf('05/06/2024,Back again,-15.01', '05/07/2024,Back again too,-15.02')
    await applyCsv(text, { accountId: target })
    const ids = liveIds(target)
    const entry = query<{ id: number }>('SELECT max(id) AS id FROM action_log')[0].id
    await api.actionLog.undoEntry(entry)
    expect(liveIds(target)).toEqual([])

    const file = await pick(text)
    const preview = await api.import.preview({
      handle: file.handle,
      mapping: MAPPING,
      accountId: target
    })
    expect(preview.rows.map((r) => r.status)).toEqual(['new', 'new'])

    const result = await api.import.apply({
      handle: file.handle,
      mapping: MAPPING,
      excluded: [],
      target: { accountId: target }
    })
    expect(result).toMatchObject({ inserted: 2, skipped: 0 })
    expect(liveIds(target)).toEqual(ids)
    expect(count('transactions', `account_id = ${target}`)).toBe(2)
  })

  it('restores a category the user set before the undo', async () => {
    const target = account({ name: 'Kept category' })
    const text = csvOf('05/08/2024,Keep my category,-16.01')
    await applyCsv(text, { accountId: target })
    const [id] = liveIds(target)
    const kept = category('Kept by undo')
    await api.transactions.setCategories({ changes: [{ transactionId: id, categoryId: kept }] })
    const importEntry = query<{ id: number }>(
      "SELECT max(id) AS id FROM action_log WHERE source = 'import'"
    )[0].id
    await api.actionLog.undoEntry(importEntry)
    await applyCsv(text, { accountId: target })
    expect(query(`SELECT category_id, deleted_at FROM transactions WHERE id = ${id}`)).toEqual([
      { category_id: kept, deleted_at: null }
    ])
  })

  it('undo takes the starting balance of a new account with it, and redo brings it back', async () => {
    const result = await applyCsv(csvOf('05/09/2024,Opened with balance,-17.01'), {
      newAccount: { name: 'Opened by import', currency: 'USD', balance: 500_000 }
    })
    expect(liveIds(result.accountId)).toHaveLength(2)
    const entry = query<{ id: number }>('SELECT max(id) AS id FROM action_log')[0].id

    expect((await api.actionLog.undoEntry(entry)).applied).toBe(2)
    expect(liveIds(result.accountId)).toEqual([])
    expect((await api.accounts.get(result.accountId))!.balance).toBe(0)

    expect((await api.actionLog.redoEntry(entry)).applied).toBe(2)
    expect((await api.accounts.get(result.accountId))!.balance).toBe(500_000 - 17_010)
  })
})

describe('transfer detection and rules on import', () => {
  const unrelatedPair = (): { a: number; b: number } => {
    const a = account({ name: `Pair A ${Math.random()}` })
    const b = account({ name: `Pair B ${Math.random()}` })
    return {
      a: txn(a, { posted: noon(2024, 3, 10), amount: -33_000, description: 'Pair out' }),
      b: txn(b, { posted: noon(2024, 3, 10), amount: 33_000, description: 'Pair in' })
    }
  }
  const categoryOf = (id: number): number | null =>
    query<{ c: number | null }>(`SELECT category_id AS c FROM transactions WHERE id = ${id}`)[0].c

  async function setSetting(
    key: 'detectTransfers' | 'applyRulesOnSync',
    value: boolean
  ): Promise<void> {
    await api.settings.set(key, value)
  }

  afterEach(async () => {
    await setSetting('detectTransfers', true)
    await setSetting('applyRulesOnSync', true)
  })

  it('pairs only the inserted rows, leaving an unrelated old pair alone', async () => {
    const pair = unrelatedPair()
    const elsewhere = account({ name: 'Other leg' })
    const otherLeg = txn(elsewhere, {
      posted: noon(2024, 3, 11),
      amount: 75_000,
      description: 'Incoming leg'
    })
    const result = await applyCsv(csvOf('03/11/2024,Outgoing leg,-75.00'), {
      newAccount: { name: 'Detect target', currency: 'USD' }
    })
    const transfers = systemCategory('transfers')
    expect(result.detectedTransfers).toBe(1)
    expect(categoryOf(otherLeg)).toBe(transfers)
    expect(categoryOf(pair.a)).toBeNull()
    expect(categoryOf(pair.b)).toBeNull()
  })

  it('applies rules only to the inserted rows', async () => {
    const plumbing = category('Plumbing')
    rule('Plumber', 'zzplumber', plumbing)
    const oldRow = txn(account({ name: 'Old plumbing' }), { description: 'zzplumber old job' })

    const result = await applyCsv(csvOf('03/12/2024,zzplumber new job,-120.00'), {
      newAccount: { name: 'Rules target', currency: 'USD' }
    })
    expect(result.rulesApplied).toBe(1)
    expect(categoryOf(oldRow)).toBeNull()
    expect(
      query(
        `SELECT category_id FROM transactions WHERE account_id = ${result.accountId} AND description = 'zzplumber new job'`
      )
    ).toEqual([{ category_id: plumbing }])
  })

  it('skips detection when detectTransfers is off', async () => {
    await setSetting('detectTransfers', false)
    const elsewhere = account({ name: 'Other leg off' })
    const otherLeg = txn(elsewhere, { posted: noon(2024, 3, 13), amount: 76_000 })
    const result = await applyCsv(csvOf('03/13/2024,Outgoing off,-76.00'), {
      newAccount: { name: 'Detect off', currency: 'USD' }
    })
    expect(result.detectedTransfers).toBe(0)
    expect(categoryOf(otherLeg)).toBeNull()
  })

  it('skips rules when applyRulesOnSync is off', async () => {
    await setSetting('applyRulesOnSync', false)
    const result = await applyCsv(csvOf('03/14/2024,zzplumber off job,-121.00'), {
      newAccount: { name: 'Rules off', currency: 'USD' }
    })
    expect(result.rulesApplied).toBe(0)
    expect(
      query(`SELECT category_id FROM transactions WHERE account_id = ${result.accountId}`)
    ).toEqual([{ category_id: null }])
  })
})

describe('sync adopts imported rows', () => {
  let bridge: FakeBridge
  let bankId: number
  let otherBankId: number

  const bankTxns = (...txns: ReturnType<typeof sfinTxn>[]): void => {
    bridge.payload.accounts[0].transactions = txns
  }
  const idsOf = (accountId: number, where = '1'): string[] =>
    query<{ simplefin_id: string }>(
      `SELECT simplefin_id FROM transactions WHERE account_id = ${accountId} AND ${where} ORDER BY id`
    ).map((r) => r.simplefin_id)

  beforeAll(async () => {
    // keep the detector out of the way of rows these tests don't own
    await api.settings.set('detectTransfers', false)
    bridge = installBridge({
      accounts: [
        sfinAccount('bank-1', { name: 'Synced bank' }),
        sfinAccount('bank-2', { name: 'Second bank' })
      ]
    })
    await api.connection.connect({ setupToken: bridge.setupToken })
    await api.connection.sync()
    bankId = query<{ id: number }>("SELECT id FROM accounts WHERE simplefin_id = 'bank-1'")[0].id
    otherBankId = query<{ id: number }>("SELECT id FROM accounts WHERE simplefin_id = 'bank-2'")[0]
      .id
  })

  afterAll(async () => {
    await api.settings.set('detectTransfers', true)
  })

  // each test restubs fetch: setup.ts unstubs globals after every test
  beforeEach(() => {
    bridge = installBridge(bridge.payload)
  })

  it('claims an imported row for the bank transaction on the same day and amount', async () => {
    await applyCsv(csvOf('06/10/2024,CSV wording,-42.00'), { accountId: bankId })
    const [imported] = liveIds(bankId).slice(-1)
    const kept = category('Claimed keeps')
    await api.transactions.setCategories({
      changes: [{ transactionId: imported, categoryId: kept }]
    })

    bankTxns(sfinTxn('bank-claim', '-42.00', noon(2024, 6, 10), { description: 'BANK WORDING' }))
    const sync = await api.connection.sync()

    expect(sync.matchedImports).toBe(1)
    expect(
      query(
        `SELECT simplefin_id, description, category_id FROM transactions WHERE id = ${imported}`
      )
    ).toEqual([{ simplefin_id: 'bank-claim', description: 'BANK WORDING', category_id: kept }])
    expect(count('transactions', `account_id = ${bankId} AND amount = -42000`)).toBe(1)
  })

  it('does not claim an imported row for a pending bank transaction', async () => {
    await applyCsv(csvOf('06/11/2024,Pending twin,-43.00'), { accountId: bankId })
    bankTxns(sfinTxn('bank-pending', '-43.00', noon(2024, 6, 11), { pending: true }))
    const sync = await api.connection.sync()

    expect(sync.matchedImports).toBe(0)
    expect(idsOf(bankId, 'amount = -43000')).toEqual([
      expect.stringMatching(/^import:/),
      'bank-pending'
    ])
  })

  it('does not claim a manual row', async () => {
    const manual = txn(bankId, {
      simplefinId: 'manual:typed',
      posted: noon(2024, 6, 12),
      amount: -44_000,
      description: 'Typed by hand'
    })
    bankTxns(sfinTxn('bank-manual', '-44.00', noon(2024, 6, 12)))
    const sync = await api.connection.sync()

    expect(sync.matchedImports).toBe(0)
    expect(idsOf(bankId, 'amount = -44000')).toEqual(['manual:typed', 'bank-manual'])
    expect(query(`SELECT description FROM transactions WHERE id = ${manual}`)).toEqual([
      { description: 'Typed by hand' }
    ])
  })

  it('does not claim a row imported into a different account', async () => {
    await applyCsv(csvOf('06/13/2024,Wrong account,-45.00'), { accountId: otherBankId })
    bankTxns(sfinTxn('bank-elsewhere', '-45.00', noon(2024, 6, 13)))
    const sync = await api.connection.sync()

    expect(sync.matchedImports).toBe(0)
    expect(idsOf(otherBankId, 'amount = -45000')).toEqual([expect.stringMatching(/^import:/)])
    expect(idsOf(bankId, 'amount = -45000')).toEqual(['bank-elsewhere'])
  })

  it('does not claim a soft-deleted import, so the bank row inserts fresh', async () => {
    await applyCsv(csvOf('06/14/2024,Deleted import,-46.00'), { accountId: bankId })
    const [imported] = liveIds(bankId).slice(-1)
    await api.transactions.bulkDelete({ transactionIds: [imported] })

    bankTxns(sfinTxn('bank-after-delete', '-46.00', noon(2024, 6, 14)))
    const sync = await api.connection.sync()

    expect(sync.matchedImports).toBe(0)
    expect(
      query(`SELECT simplefin_id, deleted_at FROM transactions WHERE id = ${imported}`)
    ).toEqual([{ simplefin_id: expect.stringMatching(/^import:/), deleted_at: expect.any(Number) }])
    expect(idsOf(bankId, 'amount = -46000 AND deleted_at IS NULL')).toEqual(['bank-after-delete'])
  })

  it('undoing the import later leaves a claimed row to the bank', async () => {
    await applyCsv(csvOf('06/18/2024,Claimed then undone,-50.00', '06/19/2024,Unclaimed,-51.00'), {
      accountId: bankId
    })
    const entry = query<{ id: number }>(
      "SELECT max(id) AS id FROM action_log WHERE source = 'import'"
    )[0].id
    bankTxns(sfinTxn('bank-undo', '-50.00', noon(2024, 6, 18)))
    expect((await api.connection.sync()).matchedImports).toBe(1)

    expect((await api.actionLog.undoEntry(entry)).applied).toBe(1)
    expect(idsOf(bankId, 'amount IN (-50000, -51000) AND deleted_at IS NULL')).toEqual([
      'bank-undo'
    ])
    bridge = installBridge(bridge.payload)
    await api.connection.sync()
    expect(idsOf(bankId, 'amount = -50000 AND deleted_at IS NULL')).toEqual(['bank-undo'])
  })

  it('claims each imported row at most once', async () => {
    await applyCsv(csvOf('06/15/2024,Single import,-47.00'), { accountId: bankId })
    bankTxns(
      sfinTxn('bank-twin-1', '-47.00', noon(2024, 6, 15)),
      sfinTxn('bank-twin-2', '-47.00', noon(2024, 6, 15))
    )
    const sync = await api.connection.sync()

    expect(sync.matchedImports).toBe(1)
    expect(idsOf(bankId, 'amount = -47000').sort()).toEqual(['bank-twin-1', 'bank-twin-2'])
  })

  it('lets an imported row on a synced account be edited, while bank rows stay locked', async () => {
    await applyCsv(csvOf('06/16/2024,Editable import,-48.00'), { accountId: bankId })
    const [imported] = liveIds(bankId).slice(-1)
    await expect(
      api.transactions.update({ id: imported, description: 'Renamed import', amount: -48_500 })
    ).resolves.toBe(2)
    expect(query(`SELECT description, amount FROM transactions WHERE id = ${imported}`)).toEqual([
      { description: 'Renamed import', amount: -48_500 }
    ])

    bankTxns(sfinTxn('bank-locked', '-49.00', noon(2024, 6, 17)))
    await api.connection.sync()
    const [bankRow] = query<{ id: number }>(
      "SELECT id FROM transactions WHERE simplefin_id = 'bank-locked'"
    )
    await expect(api.transactions.update({ id: bankRow.id, description: 'Nope' })).rejects.toThrow(
      /Only the category can be edited/
    )
  })
})
