import { beforeAll, describe, expect, it } from 'vitest'
import type { Page, Transaction, TransactionSortBy } from '@shared/ipc'
import type { ResolvedFilters } from '@shared/reports'
import type { SavedFilter } from '@shared/transaction-filters'
import {
  DEFAULT_TRANSACTION_FILTERS,
  resolveTransactionFilters,
  type TransactionFilters
} from '@shared/transaction-filters'
import { db } from '../../demo/db'
import { connections } from '../db/schema'
import { api } from './harness/api'
import { account, category, noon, systemCategory, txn } from './harness/builders'
import { count, query } from './harness/db'
import { expectUndoRoundTrip } from './harness/undo'

const NOW = noon(2026, 9, 15)

let checking: number
let food: number
let fun: number
let connectionId: number

const filtersFor = (over: Partial<TransactionFilters> = {}): TransactionFilters => ({
  ...DEFAULT_TRANSACTION_FILTERS,
  ...over
})

const resolved = (over: Partial<TransactionFilters> = {}): ResolvedFilters =>
  resolveTransactionFilters(filtersFor(over), NOW)

const row = (
  id: number
): {
  amount: number
  description: string
  posted: number
  category_id: number | null
  deleted_at: number | null
  simplefin_id: string
} =>
  query<{
    amount: number
    description: string
    posted: number
    category_id: number | null
    deleted_at: number | null
    simplefin_id: string
  }>(
    `SELECT amount, description, posted, category_id, deleted_at, simplefin_id FROM transactions WHERE id = ${id}`
  )[0]

const actionCount = (): number => count('action_log')
const lastEntry = (): { source: string; label: string } =>
  query<{ source: string; label: string }>(
    'SELECT source, label FROM action_log ORDER BY id DESC LIMIT 1'
  )[0]

/** every row of a sorted listing, following the cursor to the end */
async function walk(
  sortBy: TransactionSortBy,
  sortDir: 'asc' | 'desc',
  accountIds: number[],
  pageSize = 2
): Promise<{ rows: Transaction[]; pages: number; lastNext: unknown }> {
  const rows: Transaction[] = []
  let page: number | { date: number; id: number } = 0
  let pages = 0
  for (;;) {
    const result = await api.transactions.list({
      page,
      pageSize,
      sortBy,
      sortDir,
      filters: resolved({ accountIds })
    })
    pages++
    rows.push(...result.rows)
    if (result.next === null) return { rows, pages, lastNext: result.next }
    page = result.next
    if (pages > 50) throw new Error('cursor never ended')
  }
}

beforeAll(() => {
  checking = account({ name: 'Checking' })
  food = category('Food')
  fun = category('Fun')
  connectionId = db.insert(connections).values({ accessUrlEncrypted: 'x' }).returning().get().id
})

describe('transaction list', () => {
  it('sorts by amount with the id as tiebreak and ends with a null cursor', async () => {
    const acct = account({ name: 'Sort amount' })
    const ids = [-300, -100, -200, -100, -300].map((amount) => txn(acct, { amount }))
    const asc = await walk('amount', 'asc', [acct])
    expect(asc.rows.map((r) => r.id)).toEqual([ids[0], ids[4], ids[2], ids[1], ids[3]])
    expect(asc.pages).toBe(3)
    expect(asc.lastNext).toBeNull()
    const desc = await walk('amount', 'desc', [acct])
    expect(desc.rows.map((r) => r.id)).toEqual([ids[3], ids[1], ids[2], ids[4], ids[0]])
  })

  it('sorts by description', async () => {
    const acct = account({ name: 'Sort description' })
    const ids = ['pear', 'apple', 'pear', 'fig'].map((description) => txn(acct, { description }))
    const asc = await walk('description', 'asc', [acct])
    expect(asc.rows.map((r) => r.id)).toEqual([ids[1], ids[3], ids[0], ids[2]])
    const desc = await walk('description', 'desc', [acct])
    expect(desc.rows.map((r) => r.id)).toEqual([ids[2], ids[0], ids[3], ids[1]])
  })

  it('sorts by account name', async () => {
    const zed = account({ name: 'Sort zed' })
    const abe = account({ name: 'Sort abe' })
    const a = txn(zed)
    const b = txn(abe)
    const c = txn(zed)
    const d = txn(abe)
    const asc = await walk('accountName', 'asc', [zed, abe])
    expect(asc.rows.map((r) => r.id)).toEqual([b, d, a, c])
    const desc = await walk('accountName', 'desc', [zed, abe])
    expect(desc.rows.map((r) => r.id)).toEqual([c, a, d, b])
  })

  it('counts the total on the first page only', async () => {
    const acct = account({ name: 'Totals' })
    for (let i = 0; i < 3; i++) txn(acct)
    const first = await api.transactions.list({
      page: 0,
      pageSize: 2,
      sortBy: 'amount',
      sortDir: 'asc',
      filters: resolved({ accountIds: [acct] })
    })
    expect(first.total).toBe(3)
    expect(first.next).toBe(1)
    const second = await api.transactions.list({
      page: 1,
      pageSize: 2,
      sortBy: 'amount',
      sortDir: 'asc',
      filters: resolved({ accountIds: [acct] })
    })
    expect(second.total).toBeNull()
    expect(second.next).toBeNull()
  })

  it("nets the rest of a page's last day across the pages after it", async () => {
    const acct = account({ name: 'Day rest' })
    const day = (h: number): number => noon(2026, 8, 20) + h * 3600
    txn(acct, { posted: day(3), amount: -1_000 })
    txn(acct, { posted: day(2), amount: -2_000 })
    txn(acct, { posted: day(1), amount: -4_000 })
    txn(acct, { posted: day(-1), amount: 8_000 })
    txn(acct, { posted: noon(2026, 8, 19), amount: -16_000 })
    const page = (cursor: number | { date: number; id: number }): Promise<Page<Transaction>> =>
      api.transactions.list({
        page: cursor,
        pageSize: 2,
        sortBy: 'date',
        sortDir: 'desc',
        filters: resolved({ accountIds: [acct] })
      })

    const first = await page(0)
    expect(first.dayRest).toEqual([{ currency: 'USD', total: 4_000 }])
    // ends on the day's last row, so nothing of it is left
    const second = await page(first.next!)
    expect(second.dayRest).toEqual([])
    const third = await page(second.next!)
    expect(third.next).toBeNull()
    expect(third.dayRest).toBeUndefined()
  })

  it('marks rows in the Transfers category as transfers', async () => {
    const acct = account({ name: 'Transfer flag' })
    const moved = txn(acct, { categoryId: systemCategory('transfers') })
    const spent = txn(acct, { categoryId: food })
    const { rows } = await walk('amount', 'asc', [acct])
    expect(rows.find((r) => r.id === moved)!.isTransfer).toBe(true)
    expect(rows.find((r) => r.id === spent)!.isTransfer).toBe(false)
  })

  it('derives syncOwned from the account connection and the id space', async () => {
    const synced = account({ name: 'Synced', connectionId, simplefinId: 'acct-1' })
    const bank = txn(synced, { simplefinId: 'TRN-1' })
    const manual = txn(synced, { simplefinId: 'manual:abc' })
    const imported = txn(synced, { simplefinId: 'import:abc' })
    const detachedStyle = txn(checking, { simplefinId: 'TRN-2' })
    const flags = new Map(
      (await walk('amount', 'asc', [synced, checking], 100)).rows.map((r) => [r.id, r.syncOwned])
    )
    expect(flags.get(bank)).toBe(true)
    expect(flags.get(manual)).toBe(false)
    expect(flags.get(imported)).toBe(false)
    // no connection, so even a bank-style id is the user's row
    expect(flags.get(detachedStyle)).toBe(false)
  })
})

describe('transaction stats', () => {
  it('counts pending rows as uncategorized and leaves out system categories and deleted rows', async () => {
    const acct = account({ name: 'Stats' })
    const before = await api.transactions.stats()
    txn(acct)
    txn(acct, { pending: true })
    txn(acct, { categoryId: food })
    txn(acct, { categoryId: systemCategory('transfers') })
    txn(acct, { categoryId: systemCategory('opening') })
    txn(acct, { deletedAt: noon(2026, 9, 2) })
    const after = await api.transactions.stats()
    expect(after.total - before.total).toBe(5)
    expect(after.uncategorized - before.uncategorized).toBe(2)
  })
})

describe('saved filters', () => {
  const create = (name: string, over: Partial<TransactionFilters> = {}): Promise<SavedFilter> =>
    api.savedFilters.create({ name, filters: filtersFor(over) })
  const names = async (): Promise<string[]> => (await api.savedFilters.list()).map((f) => f.name)

  it('lists live presets ordered by name', async () => {
    await create('SF list charlie')
    await create('SF list alpha')
    await create('SF list bravo')
    const mine = (await names()).filter((n) => n.startsWith('SF list'))
    expect(mine).toEqual(['SF list alpha', 'SF list bravo', 'SF list charlie'])
  })

  it('trims the name on create and returns the stored filters', async () => {
    const saved = await create('  SF padded  ', { search: 'rent', direction: 'expense' })
    expect(saved.name).toBe('SF padded')
    expect(saved.filters).toMatchObject({ search: 'rent', direction: 'expense' })
  })

  it('rejects an empty name', async () => {
    await expect(create('   ')).rejects.toThrow()
  })

  it('rejects an exact duplicate name', async () => {
    await create('SF dup')
    await expect(create('SF dup')).rejects.toThrow()
  })

  it('allows a name that differs only by case', async () => {
    await create('SF case')
    await expect(create('sf case')).resolves.toMatchObject({ name: 'sf case' })
  })

  it('updates name and filters', async () => {
    const saved = await create('SF update')
    const updated = await api.savedFilters.update({
      id: saved.id,
      name: 'SF updated',
      filters: filtersFor({ search: 'new' })
    })
    expect(updated).toMatchObject({ name: 'SF updated', filters: { search: 'new' } })
    expect(await names()).toContain('SF updated')
    expect(await names()).not.toContain('SF update')
  })

  it('refuses to update an unknown id', async () => {
    await expect(api.savedFilters.update({ id: 999_999, name: 'Nope' })).rejects.toThrow(
      'Saved filter 999999 not found'
    )
  })

  it('refuses to update a deleted preset, and leaves it restorable as it was', async () => {
    const saved = await create('SF deleted edit')
    const entry = await api.savedFilters.delete(saved.id)
    await expect(api.savedFilters.update({ id: saved.id, name: 'SF ghost' })).rejects.toThrow(
      `Saved filter ${saved.id} not found`
    )
    await api.actionLog.undoEntry(entry!)
    expect(await names()).toContain('SF deleted edit')
    expect(await names()).not.toContain('SF ghost')
  })

  it('delete is soft, drops the preset from the list, and undoes and redoes', async () => {
    const saved = await create('SF delete')
    await expectUndoRoundTrip(() => api.savedFilters.delete(saved.id))
    // the round trip ends on redo, so the preset is deleted again
    expect(await names()).not.toContain('SF delete')
    expect(count('saved_filters', `id = ${saved.id} AND deleted_at IS NOT NULL`)).toBe(1)
  })

  it('delete resolves to null for an unknown or already deleted preset', async () => {
    expect(await api.savedFilters.delete(999_999)).toBeNull()
    const saved = await create('SF twice')
    expect(await api.savedFilters.delete(saved.id)).not.toBeNull()
    expect(await api.savedFilters.delete(saved.id)).toBeNull()
  })

  it('frees the name of a deleted preset for a new one', async () => {
    const saved = await create('SF reuse')
    await api.savedFilters.delete(saved.id)
    await expect(create('SF reuse')).resolves.toMatchObject({ name: 'SF reuse' })
  })

  it('undo is skipped while a live preset holds the same name', async () => {
    const saved = await create('SF taken')
    const entryId = (await api.savedFilters.delete(saved.id))!
    await create('SF taken')
    const undone = await api.actionLog.undoEntry(entryId)
    expect(undone.applied).toBe(0)
    expect(count('saved_filters', `id = ${saved.id} AND deleted_at IS NOT NULL`)).toBe(1)
    expect((await names()).filter((n) => n === 'SF taken')).toHaveLength(1)
  })
})

describe('setCategories', () => {
  const set = (
    changes: { transactionId: number; categoryId: number | null }[],
    source?: 'llm'
  ): Promise<number> => api.transactions.setCategories({ changes, source })

  it('rejects the whole batch when any category is unknown', async () => {
    const a = txn(checking)
    const b = txn(checking)
    const entries = actionCount()
    await expect(
      set([
        { transactionId: a, categoryId: food },
        { transactionId: b, categoryId: 999_999 }
      ])
    ).rejects.toThrow('Category not found')
    expect(row(a).category_id).toBeNull()
    expect(row(b).category_id).toBeNull()
    expect(actionCount()).toBe(entries)
  })

  it('skips missing, deleted, pending and no-op rows and returns the changed count', async () => {
    const live = txn(checking)
    const alreadyFood = txn(checking, { categoryId: food })
    const gone = txn(checking, { deletedAt: noon(2026, 9, 2) })
    const pending = txn(checking, { pending: true })
    const changed = await set([
      { transactionId: live, categoryId: food },
      { transactionId: alreadyFood, categoryId: food },
      { transactionId: gone, categoryId: food },
      { transactionId: pending, categoryId: food },
      { transactionId: 999_999, categoryId: food }
    ])
    expect(changed).toBe(1)
    expect(row(live).category_id).toBe(food)
    expect(row(gone).category_id).toBeNull()
    expect(row(pending).category_id).toBeNull()
  })

  it('writes no entry when nothing changes', async () => {
    const t = txn(checking, { categoryId: food })
    const entries = actionCount()
    expect(await set([{ transactionId: t, categoryId: food }])).toBe(0)
    expect(actionCount()).toBe(entries)
  })

  it('is one undoable entry, including clearing a category', async () => {
    const a = txn(checking)
    const b = txn(checking, { categoryId: fun })
    await expectUndoRoundTrip(() =>
      set([
        { transactionId: a, categoryId: food },
        { transactionId: b, categoryId: null }
      ])
    )
    expect(row(a).category_id).toBe(food)
    expect(row(b).category_id).toBeNull()
  })

  it('records source llm in the action log', async () => {
    const t = txn(checking)
    await set([{ transactionId: t, categoryId: fun }], 'llm')
    expect(lastEntry().source).toBe('llm')
  })

  it('records source user by default', async () => {
    const t = txn(checking)
    await set([{ transactionId: t, categoryId: fun }])
    expect(lastEntry().source).toBe('user')
  })
})

describe('transactions update', () => {
  const manual = (over: Parameters<typeof txn>[1] = {}): number =>
    txn(checking, { posted: noon(2026, 5, 5), amount: -2_000, description: 'Edit me', ...over })

  it('rejects an amount of zero, an empty description and a malformed date', async () => {
    const id = manual()
    await expect(api.transactions.update({ id, amount: 0 })).rejects.toThrow()
    await expect(api.transactions.update({ id, description: '   ' })).rejects.toThrow()
    await expect(api.transactions.update({ id, date: '2026/05/06' })).rejects.toThrow()
    await expect(api.transactions.update({ id, amount: 1.5 })).rejects.toThrow()
    expect(row(id)).toMatchObject({ amount: -2_000, description: 'Edit me' })
  })

  it('reports an unknown or deleted transaction as not found', async () => {
    await expect(api.transactions.update({ id: 999_999, amount: -1 })).rejects.toThrow(
      'Transaction not found'
    )
    const gone = manual({ deletedAt: noon(2026, 9, 2) })
    await expect(api.transactions.update({ id: gone, amount: -1 })).rejects.toThrow(
      'Transaction not found'
    )
  })

  it('refuses pending rows, even for the category', async () => {
    const pending = manual({ pending: true })
    await expect(api.transactions.update({ id: pending, categoryId: food })).rejects.toThrow(
      "Pending transactions can't be edited"
    )
  })

  it('refuses amount, description and date on a sync-owned row but allows the category', async () => {
    const synced = account({ name: 'Edit synced', connectionId, simplefinId: 'acct-edit' })
    const id = txn(synced, { simplefinId: 'TRN-9', amount: -5_000, description: 'Bank row' })
    const refused = 'Only the category can be edited on synced transactions'
    await expect(api.transactions.update({ id, amount: -1 })).rejects.toThrow(refused)
    await expect(api.transactions.update({ id, description: 'Mine' })).rejects.toThrow(refused)
    await expect(api.transactions.update({ id, date: '2026-01-01' })).rejects.toThrow(refused)
    // one forbidden field spoils a mixed edit
    await expect(api.transactions.update({ id, amount: -1, categoryId: food })).rejects.toThrow(
      refused
    )
    expect(row(id)).toMatchObject({ amount: -5_000, description: 'Bank row', category_id: null })

    expect(await api.transactions.update({ id, categoryId: food })).toBe(1)
    expect(row(id).category_id).toBe(food)
  })

  it('rejects an unknown category', async () => {
    const id = manual()
    await expect(api.transactions.update({ id, categoryId: 999_999 })).rejects.toThrow(
      'Category not found'
    )
  })

  it('returns 0 and writes no entry when nothing differs', async () => {
    const id = manual({ categoryId: food })
    const entries = actionCount()
    const same = await api.transactions.update({
      id,
      amount: -2_000,
      description: 'Edit me',
      date: '2026-05-05',
      categoryId: food
    })
    expect(same).toBe(0)
    expect(await api.transactions.update({ id })).toBe(0)
    expect(actionCount()).toBe(entries)
  })

  it('edits the amount, undoably', async () => {
    const id = manual()
    await expectUndoRoundTrip(() => api.transactions.update({ id, amount: -2_500 }))
    expect(row(id).amount).toBe(-2_500)
  })

  it('edits the description, undoably', async () => {
    const id = manual()
    await expectUndoRoundTrip(() => api.transactions.update({ id, description: 'Renamed' }))
    expect(row(id).description).toBe('Renamed')
  })

  it('edits the date at local noon, undoably', async () => {
    const id = manual()
    await expectUndoRoundTrip(() => api.transactions.update({ id, date: '2026-06-07' }))
    expect(row(id).posted).toBe(noon(2026, 6, 7))
  })

  it('edits the category, and clears it with null, undoably', async () => {
    const id = manual()
    await expectUndoRoundTrip(() => api.transactions.update({ id, categoryId: food }))
    expect(row(id).category_id).toBe(food)
    await expectUndoRoundTrip(() => api.transactions.update({ id, categoryId: null }))
    expect(row(id).category_id).toBeNull()
  })

  it('counts and logs every changed field as one entry', async () => {
    const id = manual()
    const entries = actionCount()
    const changed = await api.transactions.update({
      id,
      amount: -3_000,
      description: 'Both',
      categoryId: fun
    })
    expect(changed).toBe(3)
    expect(actionCount()).toBe(entries + 1)
    expect(lastEntry().label).toBe('Edited “Both”')
  })

  it('trims the description', async () => {
    const id = manual()
    await api.transactions.update({ id, description: '  Trimmed  ' })
    expect(row(id).description).toBe('Trimmed')
  })
})

describe('transactions create', () => {
  const input = { accountId: 0, amount: -4_200, description: 'Lunch', date: '2026-09-20' }

  it('rejects an unknown account and an unknown category, writing nothing', async () => {
    const rows = count('transactions')
    await expect(
      api.transactions.create({ ...input, accountId: 999_999, categoryId: null })
    ).rejects.toThrow('Account not found')
    await expect(
      api.transactions.create({ ...input, accountId: checking, categoryId: 999_999 })
    ).rejects.toThrow('Category not found')
    expect(count('transactions')).toBe(rows)
  })

  it('rejects zero amounts and malformed dates', async () => {
    await expect(
      api.transactions.create({ ...input, accountId: checking, amount: 0, categoryId: null })
    ).rejects.toThrow()
    await expect(
      api.transactions.create({
        ...input,
        accountId: checking,
        date: '20-09-2026',
        categoryId: null
      })
    ).rejects.toThrow()
  })

  it('stores a manual: id posted at local noon, and the row is editable', async () => {
    const id = await api.transactions.create({ ...input, accountId: checking, categoryId: food })
    expect(row(id)).toMatchObject({
      amount: -4_200,
      description: 'Lunch',
      posted: noon(2026, 9, 20),
      category_id: food
    })
    expect(row(id).simplefin_id).toMatch(/^manual:/)
    const listed = (await walk('amount', 'asc', [checking], 100)).rows.find((r) => r.id === id)!
    expect(listed.syncOwned).toBe(false)
    expect(listed.pending).toBe(false)
    expect(
      await api.transactions.update({
        id,
        amount: -4_300,
        description: 'Late lunch',
        date: '2026-09-21'
      })
    ).toBe(3)
  })

  it('undo soft-deletes the row and redo brings it back', async () => {
    let id = 0
    const entry = await expectUndoRoundTrip(async () => {
      id = await api.transactions.create({ ...input, accountId: checking, categoryId: null })
    })

    await api.actionLog.undoEntry(entry)
    expect(row(id).deleted_at).not.toBeNull()
    const gone = (await walk('amount', 'asc', [checking], 100)).rows.map((r) => r.id)
    expect(gone).not.toContain(id)

    await api.actionLog.redoEntry(entry)
    expect(row(id).deleted_at).toBeNull()
    const back = (await walk('amount', 'asc', [checking], 100)).rows.map((r) => r.id)
    expect(back).toContain(id)
  })
})

describe('bulk delete', () => {
  it('deletes only live, non-pending rows and returns their ids', async () => {
    const acct = account({ name: 'Bulk' })
    const a = txn(acct)
    const b = txn(acct)
    const pending = txn(acct, { pending: true })
    const gone = txn(acct, { deletedAt: noon(2026, 9, 2) })
    const kept = txn(acct)

    const deleted = await api.transactions.bulkDelete({
      transactionIds: [a, b, pending, gone, 999_999]
    })
    expect(deleted.sort()).toEqual([a, b].sort())
    expect(row(pending).deleted_at).toBeNull()
    // the already-deleted row keeps its original timestamp
    expect(row(gone).deleted_at).toBe(noon(2026, 9, 2))
    expect(row(kept).deleted_at).toBeNull()
  })

  it('is one undoable entry', async () => {
    const acct = account({ name: 'Bulk undo' })
    const ids = [txn(acct), txn(acct), txn(acct)]
    await expectUndoRoundTrip(() => api.transactions.bulkDelete({ transactionIds: ids }))
    expect(count('transactions', `account_id = ${acct} AND deleted_at IS NOT NULL`)).toBe(3)
  })

  it('writes no entry when every row is skipped', async () => {
    const acct = account({ name: 'Bulk nothing' })
    const pending = txn(acct, { pending: true })
    const entries = actionCount()
    expect(await api.transactions.bulkDelete({ transactionIds: [pending, 999_999] })).toEqual([])
    expect(actionCount()).toBe(entries)
  })

  it('removes the rows from the list, sums, stats and report queries', async () => {
    const acct = account({ name: 'Bulk gone' })
    const keep = txn(acct, { amount: -1_000 })
    const drop = txn(acct, { amount: -4_000 })
    const filters = resolved({ accountIds: [acct] })
    const reportCount = async (): Promise<number> => {
      const result = await api.reports.runQuery({
        measure: 'count',
        groupBy: 'none',
        timeGrain: 'none',
        filters
      })
      return result.rows[0]?.value ?? 0
    }

    const statsBefore = await api.transactions.stats()
    expect(await api.transactions.sums({ filters })).toEqual([{ currency: 'USD', total: -5_000 }])
    expect(await reportCount()).toBe(2)

    await api.transactions.bulkDelete({ transactionIds: [drop] })

    expect((await walk('amount', 'asc', [acct], 100)).rows.map((r) => r.id)).toEqual([keep])
    const page = await api.transactions.list({
      page: 0,
      pageSize: 10,
      sortBy: 'amount',
      sortDir: 'asc',
      filters
    })
    expect(page.total).toBe(1)
    expect(await api.transactions.sums({ filters })).toEqual([{ currency: 'USD', total: -1_000 }])
    expect(await reportCount()).toBe(1)
    const statsAfter = await api.transactions.stats()
    expect(statsBefore.total - statsAfter.total).toBe(1)
  })
})
