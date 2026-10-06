import { isNull } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { EnvelopeSummary } from '@shared/budgets'
import { db } from '../../demo/db'
import { accounts, budgets, categories, categoryGroups, transactions } from '../db/schema'
import { api } from './harness/api'
import { account, category, group, noon, systemCategory, txn } from './harness/builders'
import { count, query } from './harness/db'
import { expectUndoRoundTrip } from './harness/undo'

const lastEntry = (): { id: number; label: string; changes: { month: string }[] } => {
  const row = query<{ id: number; label: string; changes: string }>(
    'SELECT id, label, changes FROM action_log ORDER BY id DESC LIMIT 1'
  )[0]
  return { id: row.id, label: row.label, changes: JSON.parse(row.changes) }
}

const fills = (categoryId: number): { month: string; amount: number }[] =>
  query<{ month: string; amount: number }>(
    `SELECT month, amount FROM budgets WHERE category_id = ${categoryId} ORDER BY month`
  )

const envelope = async (month: string, categoryId: number): Promise<EnvelopeSummary | undefined> =>
  (await api.budgets.summary({ month })).envelopes.find((e) => e.categoryId === categoryId)

beforeEach(() => {
  db.delete(budgets).run()
  db.delete(transactions).run()
  db.delete(accounts).run()
  db.delete(categories).where(isNull(categories.systemKey)).run()
  db.delete(categoryGroups).run()
})

describe('setFill', () => {
  it.each([
    ['a thirteenth month', { month: '2026-13', amount: 1000 }],
    ['month zero', { month: '2026-00', amount: 1000 }],
    ['a two-digit year', { month: '26-09', amount: 1000 }],
    ['an unpadded month', { month: '2026-9', amount: 1000 }],
    ['a full date', { month: '2026-09-01', amount: 1000 }],
    ['an empty month', { month: '', amount: 1000 }],
    ['a negative amount', { month: '2026-09', amount: -1 }],
    ['a fractional amount', { month: '2026-09', amount: 1.5 }]
  ])('rejects %s and writes nothing', async (_name, input) => {
    const groceries = category('Groceries')
    await expect(api.budgets.setFill({ categoryId: groceries, ...input })).rejects.toThrow()
    expect(count('budgets')).toBe(0)
    expect(count('action_log', "label LIKE '%envelope%'")).toBe(0)
  })

  it('rejects category id 0', async () => {
    await expect(
      api.budgets.setFill({ categoryId: 0, month: '2026-09', amount: 1000 })
    ).rejects.toThrow()
    expect(count('budgets')).toBe(0)
  })

  it('accepts an amount of 0 and keeps the envelope', async () => {
    const groceries = category('Groceries')
    await api.budgets.setFill({ categoryId: groceries, month: '2026-09', amount: 0 })
    expect(fills(groceries)).toEqual([{ month: '2026-09', amount: 0 }])
    expect((await envelope('2026-09', groceries))?.fill).toBe(0)
  })

  it('rejects a missing category', async () => {
    await expect(
      api.budgets.setFill({ categoryId: 999_999, month: '2026-09', amount: 1000 })
    ).rejects.toThrow(/not found/)
    expect(count('budgets')).toBe(0)
  })

  it('refuses system categories', async () => {
    for (const key of ['income', 'transfers', 'opening'] as const) {
      await expect(
        api.budgets.setFill({ categoryId: systemCategory(key), month: '2026-09', amount: 1000 })
      ).rejects.toThrow(/System categories/)
    }
    expect(count('budgets')).toBe(0)
  })

  it('writes no entry when the fill already holds that amount', async () => {
    const groceries = category('Groceries')
    await api.budgets.setFill({ categoryId: groceries, month: '2026-09', amount: 5000 })
    const entries = count('action_log')
    expect(
      await api.budgets.setFill({ categoryId: groceries, month: '2026-09', amount: 5000 })
    ).toBe(true)
    expect(count('action_log')).toBe(entries)
    expect(fills(groceries)).toEqual([{ month: '2026-09', amount: 5000 }])
  })

  it('labels the first fill as an added envelope and later ones as changes', async () => {
    const groceries = category('Groceries')
    await api.budgets.setFill({ categoryId: groceries, month: '2026-09', amount: 5000 })
    expect(lastEntry().label).toBe('Added Groceries envelope')

    await api.budgets.setFill({ categoryId: groceries, month: '2026-09', amount: 6000 })
    expect(lastEntry().label).toBe('Changed Groceries envelope fill')

    // a fresh month on an envelope that already exists is still a change
    await api.budgets.setFill({ categoryId: groceries, month: '2026-11', amount: 6000 })
    expect(lastEntry().label).toBe('Changed Groceries envelope fill')
  })

  it('undoes and redoes an added envelope', async () => {
    const groceries = category('Groceries')
    await expectUndoRoundTrip(() =>
      api.budgets.setFill({ categoryId: groceries, month: '2026-09', amount: 5000 })
    )
  })

  it('undoes and redoes a changed fill', async () => {
    const groceries = category('Groceries')
    await api.budgets.setFill({ categoryId: groceries, month: '2026-09', amount: 5000 })
    await expectUndoRoundTrip(() =>
      api.budgets.setFill({ categoryId: groceries, month: '2026-09', amount: 7000 })
    )
    expect(fills(groceries)).toEqual([{ month: '2026-09', amount: 7000 }])
  })

  it('skips undoing an added envelope once the fill was edited', async () => {
    const groceries = category('Groceries')
    await api.budgets.setFill({ categoryId: groceries, month: '2026-09', amount: 5000 })
    const added = lastEntry().id
    await api.budgets.setFill({ categoryId: groceries, month: '2026-09', amount: 7000 })

    expect((await api.actionLog.undoEntry(added)).applied).toBe(0)
    expect(fills(groceries)).toEqual([{ month: '2026-09', amount: 7000 }])
  })
})

describe('remove', () => {
  it('deletes every month in one entry and undoes it whole', async () => {
    const groceries = category('Groceries')
    for (const [month, amount] of [
      ['2026-07', 1000],
      ['2026-08', 2000],
      ['2026-10', 3000]
    ] as const) {
      await api.budgets.setFill({ categoryId: groceries, month, amount })
    }
    const other = category('Other')
    await api.budgets.setFill({ categoryId: other, month: '2026-07', amount: 9000 })

    const entries = count('action_log')
    let actionId: number | null = null
    const entryId = await expectUndoRoundTrip(async () => {
      actionId = (await api.budgets.remove({ categoryId: groceries })).actionId
    })

    expect(actionId).toBe(entryId)
    // one entry for the removal; the round trip's undo and redo only flip it
    expect(count('action_log')).toBe(entries + 1)
    expect(fills(other)).toEqual([{ month: '2026-07', amount: 9000 }])
    // the round trip ends redone, so the removal is in force
    expect(fills(groceries)).toEqual([])
  })

  it('logs one change per month under a Removed label', async () => {
    const groceries = category('Groceries')
    await api.budgets.setFill({ categoryId: groceries, month: '2026-07', amount: 1000 })
    await api.budgets.setFill({ categoryId: groceries, month: '2026-08', amount: 2000 })
    await api.budgets.remove({ categoryId: groceries })
    const entry = lastEntry()
    expect(entry.label).toBe('Removed Groceries envelope')
    expect(entry.changes.map((c) => c.month).sort()).toEqual(['2026-07', '2026-08'])
  })

  it('returns a null action id and logs nothing when there is nothing to remove', async () => {
    const groceries = category('Groceries')
    const entries = count('action_log')
    expect(await api.budgets.remove({ categoryId: groceries })).toEqual({ actionId: null })
    expect(count('action_log')).toBe(entries)
  })

  it('skips undoing a removal once the category was deleted', async () => {
    const groceries = category('Groceries')
    await api.budgets.setFill({ categoryId: groceries, month: '2026-09', amount: 5000 })
    const { actionId } = await api.budgets.remove({ categoryId: groceries })
    await api.categories.delete(groceries)

    expect((await api.actionLog.undoEntry(actionId!)).applied).toBe(0)
    expect(fills(groceries)).toEqual([])
  })
})

describe('summary currency', () => {
  it('is USD with no accounts', async () => {
    expect((await api.budgets.summary({ month: '2026-09' })).currency).toBe('USD')
  })

  it('is the currency most accounts use', async () => {
    account({ currency: 'EUR' })
    account({ currency: 'EUR' })
    account({ currency: 'USD' })
    expect((await api.budgets.summary({ month: '2026-09' })).currency).toBe('EUR')
  })

  it('breaks a tie alphabetically', async () => {
    account({ currency: 'EUR' })
    account({ currency: 'CAD' })
    expect((await api.budgets.summary({ month: '2026-09' })).currency).toBe('CAD')
  })
})

describe('summary', () => {
  let checking: number
  let food: number

  beforeEach(() => {
    checking = account({ name: 'Checking' })
    food = category('Food')
  })

  const fill = (categoryId: number, month: string, amount: number): Promise<boolean> =>
    api.budgets.setFill({ categoryId, month, amount })

  it('is empty with no envelopes', async () => {
    txn(checking, { amount: -4000, posted: noon(2026, 9, 5) })
    expect(await api.budgets.summary({ month: '2026-09' })).toEqual({
      month: '2026-09',
      minMonth: null,
      currency: 'USD',
      envelopes: [],
      unbudgetedSpent: 4000,
      totals: { fill: 0, spent: 0, balance: 0 }
    })
  })

  it('rejects a malformed month', async () => {
    await expect(api.budgets.summary({ month: '2026-9' })).rejects.toThrow()
  })

  it('counts expenses only, so a refund does not reduce spending', async () => {
    await fill(food, '2026-09', 50_000)
    txn(checking, { categoryId: food, amount: -30_000, posted: noon(2026, 9, 3) })
    txn(checking, { categoryId: food, amount: 10_000, posted: noon(2026, 9, 4) })
    const e = await envelope('2026-09', food)
    expect(e).toMatchObject({ fill: 50_000, spent: 30_000, balance: 20_000 })
  })

  it('includes pending rows', async () => {
    await fill(food, '2026-09', 50_000)
    txn(checking, { categoryId: food, amount: -7000, pending: true, posted: noon(2026, 9, 3) })
    expect((await envelope('2026-09', food))?.spent).toBe(7000)
  })

  it('ignores soft-deleted rows and the opening balance', async () => {
    await fill(food, '2026-09', 50_000)
    txn(checking, { categoryId: food, amount: -7000, posted: noon(2026, 9, 3) })
    txn(checking, {
      categoryId: food,
      amount: -9000,
      posted: noon(2026, 9, 4),
      deletedAt: noon(2026, 9, 5)
    })
    txn(checking, {
      categoryId: systemCategory('opening'),
      amount: -500_000,
      posted: noon(2026, 9, 1)
    })
    const summary = await api.budgets.summary({ month: '2026-09' })
    expect(summary.envelopes[0].spent).toBe(7000)
    expect(summary.unbudgetedSpent).toBe(0)
  })

  it('buckets by the local month at the boundaries', async () => {
    await fill(food, '2026-08', 100_000)
    const lastMinuteOfAugust = new Date(2026, 7, 31, 23, 59).getTime() / 1000
    const firstMinuteOfSeptember = new Date(2026, 8, 1, 0, 0).getTime() / 1000
    txn(checking, { categoryId: food, amount: -1000, posted: lastMinuteOfAugust })
    txn(checking, { categoryId: food, amount: -2000, posted: firstMinuteOfSeptember })

    expect((await envelope('2026-08', food))?.spent).toBe(1000)
    expect((await envelope('2026-09', food))?.spent).toBe(2000)
  })

  it('inherits the latest fill forward through months with no row', async () => {
    await fill(food, '2026-06', 10_000)
    await fill(food, '2026-08', 20_000)
    expect((await envelope('2026-07', food))?.fill).toBe(10_000)
    expect((await envelope('2026-08', food))?.fill).toBe(20_000)
    expect((await envelope('2026-10', food))?.fill).toBe(20_000)
  })

  it('carries a negative balance forward', async () => {
    await fill(food, '2026-07', 10_000)
    txn(checking, { categoryId: food, amount: -25_000, posted: noon(2026, 7, 10) })
    expect((await envelope('2026-07', food))?.balance).toBe(-15_000)
    expect((await envelope('2026-08', food))?.balance).toBe(-5000)
    expect((await envelope('2026-09', food))?.balance).toBe(5000)
  })

  it('rolls underspending forward', async () => {
    await fill(food, '2026-07', 10_000)
    txn(checking, { categoryId: food, amount: -4000, posted: noon(2026, 7, 10) })
    expect((await envelope('2026-08', food))?.balance).toBe(16_000)
  })

  it('accrues the fill through future months', async () => {
    await fill(food, '2026-09', 10_000)
    expect(await envelope('2026-12', food)).toMatchObject({
      fill: 10_000,
      spent: 0,
      balance: 40_000
    })
  })

  it('omits an envelope that starts after the viewed month', async () => {
    const travel = category('Travel')
    await fill(food, '2026-08', 10_000)
    await fill(travel, '2026-10', 30_000)
    txn(checking, { categoryId: travel, amount: -6000, posted: noon(2026, 9, 12) })

    const summary = await api.budgets.summary({ month: '2026-09' })
    expect(summary.envelopes.map((e) => e.categoryName)).toEqual(['Food'])
    expect(summary.minMonth).toBe('2026-08')
    // spending in an envelope that has not started is unbudgeted for the month
    expect(summary.unbudgetedSpent).toBe(6000)
  })

  it('counts uncategorized and non-envelope expenses as unbudgeted, but not transfers', async () => {
    const hobby = category('Hobby')
    await fill(food, '2026-09', 50_000)
    txn(checking, { categoryId: food, amount: -1000, posted: noon(2026, 9, 2) })
    txn(checking, { categoryId: null, amount: -2000, posted: noon(2026, 9, 3) })
    txn(checking, { categoryId: hobby, amount: -4000, posted: noon(2026, 9, 4) })
    txn(checking, {
      categoryId: systemCategory('transfers'),
      amount: -80_000,
      posted: noon(2026, 9, 5)
    })
    txn(checking, {
      categoryId: systemCategory('income'),
      amount: 90_000,
      posted: noon(2026, 9, 6)
    })
    txn(checking, { categoryId: null, amount: -8000, posted: noon(2026, 8, 31) })

    const summary = await api.budgets.summary({ month: '2026-09' })
    expect(summary.unbudgetedSpent).toBe(6000)
    expect(summary.envelopes[0].spent).toBe(1000)
  })

  it('orders envelopes by group creation, then name, with ungrouped last', async () => {
    const first = group('First')
    const second = group('Second')
    const zebra = category('Zebra', first)
    const apple = category('Apple', first)
    const mango = category('Mango', second)
    const loose = category('Aardvark')
    // filled in an order unrelated to the expected one
    for (const id of [loose, mango, zebra, apple]) await fill(id, '2026-09', 1000)

    const summary = await api.budgets.summary({ month: '2026-09' })
    expect(summary.envelopes.map((e) => [e.groupName, e.categoryName])).toEqual([
      ['First', 'Apple'],
      ['First', 'Zebra'],
      ['Second', 'Mango'],
      [null, 'Aardvark']
    ])
  })

  it('reports minMonth and totals across envelopes', async () => {
    const rent = category('Rent')
    await fill(rent, '2026-07', 100_000)
    await fill(food, '2026-08', 20_000)
    txn(checking, { categoryId: food, amount: -5000, posted: noon(2026, 9, 2) })
    txn(checking, { categoryId: rent, amount: -100_000, posted: noon(2026, 9, 3) })

    const summary = await api.budgets.summary({ month: '2026-09' })
    expect(summary.minMonth).toBe('2026-07')
    const byName = Object.fromEntries(summary.envelopes.map((e) => [e.categoryName, e]))
    expect(byName.Rent).toMatchObject({ startMonth: '2026-07', fill: 100_000, balance: 200_000 })
    expect(byName.Food).toMatchObject({ startMonth: '2026-08', fill: 20_000, balance: 35_000 })
    expect(summary.totals).toEqual({ fill: 120_000, spent: 105_000, balance: 235_000 })
  })

  it('cascades fills when a category is deleted, and undoing the delete restores them', async () => {
    await fill(food, '2026-07', 10_000)
    await fill(food, '2026-09', 15_000)
    const before = await api.budgets.summary({ month: '2026-09' })

    const actionId = await api.categories.delete(food)
    expect(count('budgets')).toBe(0)
    expect((await api.budgets.summary({ month: '2026-09' })).envelopes).toEqual([])

    await api.actionLog.undoEntry(actionId!)
    expect(fills(food)).toEqual([
      { month: '2026-07', amount: 10_000 },
      { month: '2026-09', amount: 15_000 }
    ])
    expect(await api.budgets.summary({ month: '2026-09' })).toEqual(before)
  })

  it.todo(
    'TRIAGE: multi-currency spend is summed as one number with no conversion (src/main/budgets/summary.ts:23, :77, :111)'
  )
})
