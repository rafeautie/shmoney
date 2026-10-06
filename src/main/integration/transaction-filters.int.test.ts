import { beforeAll, describe, expect, it } from 'vitest'
import type { CurrencyTotal, Page, Transaction } from '@shared/ipc'
import {
  DEFAULT_TRANSACTION_FILTERS,
  resolveTransactionFilters,
  type TransactionFilters
} from '@shared/transaction-filters'
import { api } from './harness/api'
import { account, category, group, noon, systemCategory, txn } from './harness/builders'

// one fixture shared by every test in the file; each test names the rows it expects
const NOW = noon(2026, 9, 15)

let checking: number
let card: number
let euro: number
let groceries: number
let games: number
let foodGroup: number
let transfers: number

const filtersFor = (over: Partial<TransactionFilters> = {}): TransactionFilters => ({
  ...DEFAULT_TRANSACTION_FILTERS,
  ...over
})

async function listed(over: Partial<TransactionFilters> = {}): Promise<string[]> {
  const page = await api.transactions.list({
    page: 0,
    pageSize: 100,
    sortBy: 'amount',
    sortDir: 'asc',
    filters: resolveTransactionFilters(filtersFor(over), NOW)
  })
  expect(page.next).toBeNull()
  return page.rows.map((r) => r.description).sort()
}

beforeAll(() => {
  checking = account({ name: 'Fx Checking' })
  card = account({ name: 'Fx Card' })
  euro = account({ name: 'Fx Euro', currency: 'EUR' })
  foodGroup = group('FxFood')
  groceries = category('FxGroceries', foodGroup)
  games = category('FxGames', group('FxFun'))
  transfers = systemCategory('transfers')

  txn(checking, {
    description: 'Whole Foods',
    amount: -80_000,
    posted: noon(2026, 8, 5),
    categoryId: groceries
  })
  txn(checking, {
    description: 'Steam Games',
    amount: -20_000,
    posted: noon(2026, 8, 20),
    categoryId: games
  })
  txn(checking, {
    description: 'Paycheck',
    amount: 300_000,
    posted: noon(2026, 9, 1),
    categoryId: systemCategory('income')
  })
  txn(card, { description: 'Mystery 100%', amount: -1_000, posted: noon(2026, 9, 10) })
  txn(checking, { description: 'Mystery 100x', amount: -1_500, posted: noon(2026, 9, 11) })
  txn(checking, {
    description: 'Pending Coffee',
    amount: -450,
    posted: noon(2026, 9, 12),
    pending: true
  })
  txn(checking, {
    description: 'To savings',
    amount: -50_000,
    posted: noon(2026, 9, 13),
    categoryId: transfers
  })
  txn(checking, {
    description: 'Opening balance',
    amount: 100_000,
    posted: noon(2026, 7, 1),
    categoryId: systemCategory('opening')
  })
  txn(checking, { description: 'No date', amount: -700, posted: 0 })
  txn(euro, {
    description: 'Euro lunch',
    amount: -12_000,
    posted: noon(2026, 9, 14),
    categoryId: groceries
  })
  txn(card, { description: 'Under_score', amount: -300, posted: noon(2026, 9, 15) })
  txn(card, {
    description: 'Deleted thing',
    amount: -9_999,
    posted: noon(2026, 9, 2),
    deletedAt: noon(2026, 9, 3)
  })
})

describe('transaction list filters, one field at a time', () => {
  it('shows every live row by default, unknown dates and opening balances included', async () => {
    const all = await listed()
    expect(all).toHaveLength(11)
    expect(all).toContain('No date')
    expect(all).toContain('Opening balance')
    expect(all).not.toContain('Deleted thing')
  })

  it('absolute date range is inclusive and drops unknown-date rows', async () => {
    expect(
      await listed({
        dateRange: { kind: 'absolute', start: noon(2026, 9, 10), end: noon(2026, 9, 12) }
      })
    ).toEqual(['Mystery 100%', 'Mystery 100x', 'Pending Coffee'])
  })

  it('relative range resolves against the supplied now', async () => {
    const lastMonth = { kind: 'relative', unit: 'month', count: 1, includeCurrent: false } as const
    expect(await listed({ dateRange: lastMonth })).toEqual(['Steam Games', 'Whole Foods'])
    const thisMonth = { ...lastMonth, includeCurrent: true }
    expect(await listed({ dateRange: thisMonth })).toEqual([
      'Euro lunch',
      'Mystery 100%',
      'Mystery 100x',
      'Paycheck',
      'Pending Coffee',
      'To savings',
      'Under_score'
    ])
  })

  it('keeps unknown-date rows only while no date bound is set', async () => {
    const start = noon(2026, 1, 1)
    const end = noon(2026, 12, 31)
    expect(await listed({ dateRange: { kind: 'all' } })).toContain('No date')
    expect(await listed({ dateRange: { kind: 'absolute', start, end } })).not.toContain('No date')
    // either bound alone is enough to exclude them
    const half = await api.transactions.list({
      page: 0,
      pageSize: 100,
      sortBy: 'amount',
      sortDir: 'asc',
      filters: { ...resolveTransactionFilters(filtersFor(), NOW), dateStart: start }
    })
    expect(half.rows.map((r) => r.description)).not.toContain('No date')
  })

  it('accountIds', async () => {
    expect(await listed({ accountIds: [card] })).toEqual(['Mystery 100%', 'Under_score'])
  })

  it('categoryIds', async () => {
    expect(await listed({ categoryIds: [groceries] })).toEqual(['Euro lunch', 'Whole Foods'])
  })

  it('includeUncategorized alone matches rows with no category', async () => {
    expect(await listed({ includeUncategorized: true })).toEqual([
      'Mystery 100%',
      'Mystery 100x',
      'No date',
      'Pending Coffee',
      'Under_score'
    ])
  })

  it('includeUncategorized pairs with categoryIds as a union', async () => {
    expect(await listed({ categoryIds: [games], includeUncategorized: true })).toEqual([
      'Mystery 100%',
      'Mystery 100x',
      'No date',
      'Pending Coffee',
      'Steam Games',
      'Under_score'
    ])
  })

  it('categoryGroupIds', async () => {
    expect(await listed({ categoryGroupIds: [foodGroup] })).toEqual(['Euro lunch', 'Whole Foods'])
  })

  it('direction', async () => {
    expect(await listed({ direction: 'income' })).toEqual(['Opening balance', 'Paycheck'])
    const expense = await listed({ direction: 'expense' })
    expect(expense).toHaveLength(9)
    expect(expense).not.toContain('Paycheck')
  })

  it('amountMin compares the absolute amount', async () => {
    expect(await listed({ amountMin: 50_000 })).toEqual([
      'Opening balance',
      'Paycheck',
      'To savings',
      'Whole Foods'
    ])
  })

  it('amountMax compares the absolute amount', async () => {
    expect(await listed({ amountMax: 1_000 })).toEqual([
      'Mystery 100%',
      'No date',
      'Pending Coffee',
      'Under_score'
    ])
  })

  it('amountMin and amountMax bound a range together', async () => {
    expect(await listed({ amountMin: 20_000, amountMax: 80_000 })).toEqual([
      'Steam Games',
      'To savings',
      'Whole Foods'
    ])
  })

  it('descriptionSearch matches any phrase', async () => {
    expect(await listed({ descriptionSearch: ['whole', 'steam'] })).toEqual([
      'Steam Games',
      'Whole Foods'
    ])
  })

  it('descriptionSearch treats % and _ literally', async () => {
    expect(await listed({ descriptionSearch: ['%'] })).toEqual(['Mystery 100%'])
    expect(await listed({ descriptionSearch: ['_'] })).toEqual(['Under_score'])
  })

  it('search covers description, account name and category name', async () => {
    expect(await listed({ search: 'paycheck' })).toEqual(['Paycheck'])
    expect(await listed({ search: 'Fx Card' })).toEqual(['Mystery 100%', 'Under_score'])
    expect(await listed({ search: 'FxGames' })).toEqual(['Steam Games'])
  })

  it('search treats wildcards literally', async () => {
    expect(await listed({ search: '100%' })).toEqual(['Mystery 100%'])
  })

  it('includePending false drops pending rows', async () => {
    const rows = await listed({ includePending: false })
    expect(rows).toHaveLength(10)
    expect(rows).not.toContain('Pending Coffee')
  })
})

describe('transfer exclusion', () => {
  it('drops Transfers rows only when includeTransfers is false', async () => {
    expect(await listed({ includeTransfers: true })).toContain('To savings')
    const rows = await listed({ includeTransfers: false })
    expect(rows).not.toContain('To savings')
    expect(rows).toHaveLength(10)
    // the opening balance is not a transfer
    expect(rows).toContain('Opening balance')
  })

  it('picking the Transfers category shows them even when includeTransfers is false', async () => {
    expect(await listed({ includeTransfers: false, categoryIds: [transfers] })).toEqual([
      'To savings'
    ])
  })

  it('a category pick other than Transfers does not bring transfers back', async () => {
    expect(await listed({ includeTransfers: false, categoryIds: [groceries] })).toEqual([
      'Euro lunch',
      'Whole Foods'
    ])
  })

  // reportFiltersSchema defaults includeTransfers to false (the report default), so
  // a saved filter or drill filter that omits it parses to false and hides transfers
  // in the transactions view, whose own default is true (src/shared/reports.ts:84).
  it.todo('TRIAGE: saved filter without includeTransfers hides transfers in the transactions view')
})

describe('account scoped list', () => {
  const scoped = (
    accountId: number,
    over: Partial<TransactionFilters>
  ): Promise<Page<Transaction>> =>
    api.accounts.transactions({
      accountId,
      page: 0,
      pageSize: 100,
      sortBy: 'amount',
      sortDir: 'asc',
      filters: resolveTransactionFilters(filtersFor(over), NOW)
    })

  it('ignores accountIds in the filters and scopes to the page account', async () => {
    const page = await scoped(card, { accountIds: [checking] })
    expect(page.rows.map((r) => r.description).sort()).toEqual(['Mystery 100%', 'Under_score'])
  })

  it('still applies the other filters', async () => {
    const page = await scoped(card, { search: 'score' })
    expect(page.rows.map((r) => r.description)).toEqual(['Under_score'])
  })
})

describe('filtered sums', () => {
  const sums = (filters: TransactionFilters, accountId?: number): Promise<CurrencyTotal[]> =>
    api.transactions.sums({ filters: resolveTransactionFilters(filters, NOW), accountId })

  it('nets signed amounts per currency', async () => {
    expect(await sums(filtersFor())).toEqual([
      { currency: 'EUR', total: -12_000 },
      { currency: 'USD', total: 246_050 }
    ])
  })

  it('totals exactly the rows the list shows', async () => {
    const filters = filtersFor({ includeTransfers: false, includePending: false, amountMin: 1_000 })
    const page = await api.transactions.list({
      page: 0,
      pageSize: 100,
      sortBy: 'amount',
      sortDir: 'asc',
      filters: resolveTransactionFilters(filters, NOW)
    })
    const byCurrency = new Map<string, number>()
    for (const r of page.rows) {
      byCurrency.set(r.currency, (byCurrency.get(r.currency) ?? 0) + r.amount)
    }
    const expected = [...byCurrency]
      .map(([currency, total]) => ({ currency, total }))
      .sort((a, b) => a.currency.localeCompare(b.currency))
    expect(await sums(filters)).toEqual(expected)
  })

  it('returns nothing when no row matches', async () => {
    expect(await sums(filtersFor({ search: 'no such thing' }))).toEqual([])
  })

  it('scopes to one account and ignores accountIds in the filters', async () => {
    expect(await sums(filtersFor({ accountIds: [euro] }), card)).toEqual([
      { currency: 'USD', total: -1_300 }
    ])
  })

  it('without an account scope, accountIds narrows as usual', async () => {
    expect(await sums(filtersFor({ accountIds: [euro] }))).toEqual([
      { currency: 'EUR', total: -12_000 }
    ])
  })
})
