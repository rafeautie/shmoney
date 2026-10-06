import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Measure, QueryRow, ResolvedFilters, TimeGrain, GroupBy } from '@shared/reports'
import { api } from './harness/api'
import { query } from './harness/db'
import { account, category, group, noon, systemCategory, txn } from './harness/builders'

// Hand-computed fixture, local noon, amounts in milliunits. USD "Checking":
//   2025-12-30 Tue  -10_000  Dining
//   2026-01-05 Mon  -50_000  Groceries
//   2026-01-07 Wed  -20_000  Dining
//   2026-01-31 Sat +300_000  Income
//   2026-02-03 Tue  -30_000  Fun (no group)
//   2026-02-03 Tue   -5_000  uncategorized
//   2026-04-10 Fri  -40_000  Groceries
// EUR "Euro":
//   2026-02-04 Wed  -12_000  Groceries
//   2026-04-12 Sun   +8_000  uncategorized
// Plus rows no report may count: a transfer, an opening balance, an unknown
// date, and a soft-deleted row.

let checking: number
let euro: number
let food: number
let groceries: number
let dining: number
let fun: number
let incomeCat: number
let transfers: number

const base: ResolvedFilters = {
  dateStart: null,
  dateEnd: null,
  direction: 'all',
  includePending: true,
  includeTransfers: false
}

async function run(
  measure: Measure,
  groupBy: GroupBy,
  timeGrain: TimeGrain,
  filters: Partial<ResolvedFilters> = {}
): Promise<QueryRow[]> {
  const { rows, currencies } = await api.reports.runQuery({
    measure,
    groupBy,
    timeGrain,
    filters: { ...base, ...filters }
  })
  expect(currencies).toEqual([...new Set(rows.map((r) => r.currency))].sort())
  // GROUP BY has no defined order; compare in a stable one
  return rows.sort(
    (a, b) =>
      a.currency.localeCompare(b.currency) ||
      (a.bucket ?? '').localeCompare(b.bucket ?? '') ||
      (a.groupLabel ?? '').localeCompare(b.groupLabel ?? '')
  )
}

// a throwaway account for one test; its rows are removed so the shared fixture stays exact
const scratch: number[] = []
const scratchAccount = (name: string, currency: string): number => {
  const id = account({ name, currency })
  scratch.push(id)
  return id
}

afterEach(() => {
  for (const id of scratch.splice(0)) query(`DELETE FROM transactions WHERE account_id = ${id}`)
})

const row = (
  currency: string,
  value: number,
  over: Partial<Omit<QueryRow, 'currency' | 'value'>> = {}
): QueryRow => ({ bucket: null, groupId: null, groupLabel: null, currency, value, ...over })

beforeAll(() => {
  checking = account({ name: 'Checking' })
  euro = account({ name: 'Euro', currency: 'EUR' })
  food = group('Food')
  groceries = category('Groceries', food)
  dining = category('Dining', food)
  fun = category('Fun')
  incomeCat = systemCategory('income')
  transfers = systemCategory('transfers')

  const t = (
    accountId: number,
    description: string,
    amount: number,
    y: number,
    m: number,
    d: number,
    categoryId?: number
  ): number => txn(accountId, { description, amount, posted: noon(y, m, d), categoryId })

  t(checking, 'A Dec dining', -10_000, 2025, 12, 30, dining)
  t(checking, 'B Jan groceries', -50_000, 2026, 1, 5, groceries)
  t(checking, 'C Jan dining', -20_000, 2026, 1, 7, dining)
  t(checking, 'D Jan paycheck', 300_000, 2026, 1, 31, incomeCat)
  t(checking, 'E Feb games', -30_000, 2026, 2, 3, fun)
  t(checking, 'F Feb mystery', -5_000, 2026, 2, 3)
  t(euro, 'G Euro groceries', -12_000, 2026, 2, 4, groceries)
  t(checking, 'H Apr groceries', -40_000, 2026, 4, 10, groceries)
  t(euro, 'I Euro refund', 8_000, 2026, 4, 12)

  t(checking, 'Move to savings', -25_000, 2026, 1, 10, transfers)
  t(checking, 'Opening balance', 90_000, 2025, 11, 1, systemCategory('opening'))
  txn(checking, { description: 'No date', amount: -700, posted: 0 })
  txn(checking, {
    description: 'Deleted',
    amount: -9_999,
    posted: noon(2026, 1, 20),
    deletedAt: noon(2026, 1, 21)
  })
})

describe('runQuery measures (no grouping, no time grain)', () => {
  it('sum nets income against spending, per currency', async () => {
    expect(await run('sum', 'none', 'none')).toEqual([row('EUR', -4_000), row('USD', 145_000)])
  })

  it('count counts rows', async () => {
    expect(await run('count', 'none', 'none')).toEqual([row('EUR', 2), row('USD', 7)])
  })

  it('avg is the mean signed amount', async () => {
    const [eur, usd] = await run('avg', 'none', 'none')
    expect(eur).toEqual(row('EUR', -2_000))
    expect(usd.currency).toBe('USD')
    expect(usd.value).toBeCloseTo(145_000 / 7, 5)
  })

  it('income sums only positive amounts', async () => {
    expect(await run('income', 'none', 'none')).toEqual([row('EUR', 8_000), row('USD', 300_000)])
  })

  it('expense sums negative amounts as a positive number', async () => {
    expect(await run('expense', 'none', 'none')).toEqual([row('EUR', 12_000), row('USD', 155_000)])
  })

  it('returns nothing, and no currencies, when no row matches', async () => {
    const empty = { dateStart: noon(2030, 1, 1), dateEnd: noon(2030, 12, 31) }
    expect(
      await api.reports.runQuery({
        measure: 'sum',
        groupBy: 'none',
        timeGrain: 'none',
        filters: { ...base, ...empty }
      })
    ).toEqual({ rows: [], currencies: [] })
  })
})

describe('runQuery groupBy (no time grain)', () => {
  it('category: one row per category and currency, null for uncategorized', async () => {
    expect(await run('sum', 'category', 'none')).toEqual([
      row('EUR', 8_000),
      row('EUR', -12_000, { groupId: groceries, groupLabel: 'Groceries' }),
      row('USD', -5_000),
      // system categories carry an emoji prefix in their name
      row('USD', 300_000, { groupId: incomeCat, groupLabel: '💵 Income' }),
      row('USD', -30_000, { groupId: dining, groupLabel: 'Dining' }),
      row('USD', -30_000, { groupId: fun, groupLabel: 'Fun' }),
      row('USD', -90_000, { groupId: groceries, groupLabel: 'Groceries' })
    ])
  })

  it('categoryGroup: categories without a group collapse into one null row', async () => {
    expect(await run('sum', 'categoryGroup', 'none')).toEqual([
      row('EUR', 8_000),
      row('EUR', -12_000, { groupId: food, groupLabel: 'Food' }),
      // Fun, Income and the uncategorized row: -30_000 + 300_000 - 5_000
      row('USD', 265_000),
      row('USD', -120_000, { groupId: food, groupLabel: 'Food' })
    ])
  })

  it('account: one row per account', async () => {
    expect(await run('count', 'account', 'none')).toEqual([
      row('EUR', 2, { groupId: euro, groupLabel: 'Euro' }),
      row('USD', 7, { groupId: checking, groupLabel: 'Checking' })
    ])
  })
})

describe('runQuery time grain (no grouping)', () => {
  const buckets = (rows: QueryRow[]): [string, string | null, number][] =>
    rows.map((r) => [r.currency, r.bucket, r.value])

  it('day', async () => {
    expect(buckets(await run('sum', 'none', 'day'))).toEqual([
      ['EUR', '2026-02-04', -12_000],
      ['EUR', '2026-04-12', 8_000],
      ['USD', '2025-12-30', -10_000],
      ['USD', '2026-01-05', -50_000],
      ['USD', '2026-01-07', -20_000],
      ['USD', '2026-01-31', 300_000],
      // two rows on one day share a bucket
      ['USD', '2026-02-03', -35_000],
      ['USD', '2026-04-10', -40_000]
    ])
  })

  it('week is labelled by its Monday, Sunday included in the week it ends', async () => {
    expect(buckets(await run('sum', 'none', 'week'))).toEqual([
      ['EUR', '2026-02-02', -12_000],
      // Sunday 2026-04-12 belongs to the week starting Monday 2026-04-06
      ['EUR', '2026-04-06', 8_000],
      ['USD', '2025-12-29', -10_000],
      ['USD', '2026-01-05', -70_000],
      ['USD', '2026-01-26', 300_000],
      ['USD', '2026-02-02', -35_000],
      ['USD', '2026-04-06', -40_000]
    ])
  })

  it('month', async () => {
    expect(buckets(await run('sum', 'none', 'month'))).toEqual([
      ['EUR', '2026-02', -12_000],
      ['EUR', '2026-04', 8_000],
      ['USD', '2025-12', -10_000],
      ['USD', '2026-01', 230_000],
      ['USD', '2026-02', -35_000],
      ['USD', '2026-04', -40_000]
    ])
  })

  it('quarter', async () => {
    expect(buckets(await run('sum', 'none', 'quarter'))).toEqual([
      ['EUR', '2026-Q1', -12_000],
      ['EUR', '2026-Q2', 8_000],
      ['USD', '2025-Q4', -10_000],
      ['USD', '2026-Q1', 195_000],
      ['USD', '2026-Q2', -40_000]
    ])
  })

  it('year', async () => {
    expect(buckets(await run('sum', 'none', 'year'))).toEqual([
      ['EUR', '2026', -4_000],
      ['USD', '2025', -10_000],
      ['USD', '2026', 155_000]
    ])
  })

  it('buckets by the local calendar day, not UTC', async () => {
    // 23:30 local on Jan 31 is already Feb 1 in UTC
    const late = scratchAccount('Late', 'CAD')
    txn(late, { amount: -1_000, posted: new Date(2026, 0, 31, 23, 30).getTime() / 1000 })
    expect(buckets(await run('sum', 'none', 'day', { accountIds: [late] }))).toEqual([
      ['CAD', '2026-01-31', -1_000]
    ])
  })
})

describe('runQuery grouping and time grain together', () => {
  it('splits each month by group, with count and expense measures', async () => {
    const rows = await run('expense', 'categoryGroup', 'month', { accountIds: [checking] })
    expect(rows.map((r) => [r.bucket, r.groupLabel, r.value])).toEqual([
      ['2025-12', 'Food', 10_000],
      // Income contributes nothing to an expense measure but still forms a row
      ['2026-01', null, 0],
      ['2026-01', 'Food', 70_000],
      ['2026-02', null, 35_000],
      ['2026-04', 'Food', 40_000]
    ])
    const counts = await run('count', 'account', 'quarter')
    expect(counts.map((r) => [r.currency, r.bucket, r.groupLabel, r.value])).toEqual([
      ['EUR', '2026-Q1', 'Euro', 1],
      ['EUR', '2026-Q2', 'Euro', 1],
      ['USD', '2025-Q4', 'Checking', 1],
      ['USD', '2026-Q1', 'Checking', 5],
      ['USD', '2026-Q2', 'Checking', 1]
    ])
  })
})

describe('runQuery filters', () => {
  it('leaves out transfers, opening balances, unknown dates and deleted rows by default', async () => {
    // every figure above already proves it; make the exclusions explicit
    const [usd] = (await run('count', 'none', 'none')).filter((r) => r.currency === 'USD')
    expect(usd.value).toBe(7)
  })

  it('includeTransfers brings transfers in, but never the opening balance', async () => {
    const [, usd] = await run('sum', 'none', 'none', { includeTransfers: true })
    expect(usd).toEqual(row('USD', 120_000))
  })

  it('selecting categories skips the transfer exclusion', async () => {
    expect(await run('sum', 'category', 'none', { categoryIds: [transfers] })).toEqual([
      row('USD', -25_000, { groupId: transfers, groupLabel: '🔄 Transfers' })
    ])
    // other categories alongside are unaffected
    const picked = await run('count', 'none', 'none', { categoryIds: [transfers, fun] })
    expect(picked).toEqual([row('USD', 2)])
  })

  it('date bounds are inclusive and keep unknown dates out', async () => {
    const rows = await run('sum', 'none', 'day', {
      dateStart: noon(2026, 1, 5),
      dateEnd: noon(2026, 1, 7)
    })
    expect(rows.map((r) => [r.bucket, r.value])).toEqual([
      ['2026-01-05', -50_000],
      ['2026-01-07', -20_000]
    ])
  })

  it('direction, account and group filters narrow the rows', async () => {
    expect(await run('count', 'none', 'none', { direction: 'income' })).toEqual([
      row('EUR', 1),
      row('USD', 1)
    ])
    expect(await run('sum', 'none', 'none', { accountIds: [euro] })).toEqual([row('EUR', -4_000)])
    expect(await run('sum', 'none', 'none', { categoryGroupIds: [food] })).toEqual([
      row('EUR', -12_000),
      row('USD', -120_000)
    ])
  })

  it('pending rows follow includePending', async () => {
    const card = scratchAccount('Pending card', 'GBP')
    txn(card, { amount: -1_000, posted: noon(2026, 3, 1) })
    txn(card, { amount: -2_000, posted: noon(2026, 3, 2), pending: true })
    expect(await run('sum', 'none', 'none', { accountIds: [card] })).toEqual([row('GBP', -3_000)])
    expect(await run('sum', 'none', 'none', { accountIds: [card], includePending: false })).toEqual(
      [row('GBP', -1_000)]
    )
  })

  it('rejects an invalid query', async () => {
    await expect(
      api.reports.runQuery({
        measure: 'median' as never,
        groupBy: 'none',
        timeGrain: 'none',
        filters: base
      })
    ).rejects.toThrow()
  })
})

describe('reports.transactions', () => {
  const page = (over: object = {}): ReturnType<typeof api.reports.transactions> =>
    api.reports.transactions({
      page: 0,
      pageSize: 100,
      sortBy: 'date',
      sortDir: 'desc',
      filters: base,
      ...over
    })

  const names = (rows: { description: string }[]): string[] =>
    rows.map((r) => r.description.split(' ')[0])

  it('lists only rows a report counts: no transfer, opening balance, unknown date or deleted row', async () => {
    const { rows, total, next } = await page()
    expect(names(rows)).toEqual(['I', 'H', 'G', 'F', 'E', 'D', 'C', 'B', 'A'])
    expect(total).toBe(9)
    expect(next).toBeNull()
    expect(rows[0]).toMatchObject({
      accountName: 'Euro',
      currency: 'EUR',
      amount: 8_000,
      categoryName: null,
      isTransfer: false
    })
  })

  it('seeks through the date sort by cursor, breaking date ties by id', async () => {
    const first = await page({ pageSize: 4 })
    expect(names(first.rows)).toEqual(['I', 'H', 'G', 'F'])
    expect(first.total).toBe(9)
    const second = await page({ pageSize: 4, page: first.next })
    expect(names(second.rows)).toEqual(['E', 'D', 'C', 'B'])
    // later pages do not recount
    expect(second.total).toBeNull()
    const third = await page({ pageSize: 4, page: second.next })
    expect(names(third.rows)).toEqual(['A'])
    expect(third.next).toBeNull()
  })

  it('sorts by amount and pages by offset', async () => {
    const first = await page({ sortBy: 'amount', sortDir: 'asc', pageSize: 4 })
    expect(names(first.rows)).toEqual(['B', 'H', 'E', 'C'])
    expect(first.next).toBe(1)
    const second = await page({ sortBy: 'amount', sortDir: 'asc', pageSize: 4, page: 1 })
    expect(names(second.rows)).toEqual(['G', 'A', 'F', 'I'])
    const last = await page({ sortBy: 'amount', sortDir: 'asc', pageSize: 4, page: 2 })
    expect(names(last.rows)).toEqual(['D'])
    expect(last.next).toBeNull()
  })

  it('sorts by account name and description', async () => {
    const byAccount = await page({ sortBy: 'accountName', sortDir: 'asc', filters: base })
    expect(byAccount.rows.map((r) => r.accountName).slice(0, 8)).toEqual(
      Array(7).fill('Checking').concat(['Euro'])
    )
    const byDescription = await page({ sortBy: 'description', sortDir: 'desc' })
    expect(names(byDescription.rows)).toEqual(['I', 'H', 'G', 'F', 'E', 'D', 'C', 'B', 'A'])
  })

  it('applies the filters, including the transfer opt-in', async () => {
    expect(names((await page({ filters: { ...base, direction: 'income' } })).rows)).toEqual([
      'I',
      'D'
    ])
    const withTransfers = await page({ filters: { ...base, includeTransfers: true } })
    expect(withTransfers.total).toBe(10)
    expect(withTransfers.rows.find((r) => r.description === 'Move to savings')).toMatchObject({
      isTransfer: true
    })
    const bounded = await page({
      filters: { ...base, dateStart: noon(2026, 1, 1), dateEnd: noon(2026, 1, 31) }
    })
    expect(names(bounded.rows)).toEqual(['D', 'C', 'B'])
  })

  it('rejects a page size over 100', async () => {
    await expect(page({ pageSize: 101 })).rejects.toThrow()
  })
})
