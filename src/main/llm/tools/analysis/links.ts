// The rows behind a typed result, as the All transactions filter that lists
// them. A tool knows the exact ids it counted; the readable filter it builds
// (period, account, category, direction, search) is checked against the
// table's own predicate, and only when the two disagree (a starting balance in
// range, a search that matched a merchant name, a currency left out) does the
// link pin the ids instead. So the count on the chip is what the table shows.
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import type { TransactionsLink } from '@shared/chat'
import {
  DEFAULT_TRANSACTION_FILTERS,
  resolveTransactionFilters,
  type TransactionFilters
} from '@shared/transaction-filters'
import { buildWhere } from '../../../reports/filters'
import { txWhere, type AnalysisContext, type TxFilter } from './common'
import type { Window } from './period'

export type Direction = 'spending' | 'income' | 'all'

const SIGN: Record<Direction, string> = {
  spending: 'amount < 0',
  income: 'amount > 0',
  all: ''
}

const dialect = new SQLiteSyncDialect()

/** the ids of the tx rows a filter matches, in one direction */
export function txIds(ctx: AnalysisContext, f: TxFilter, direction: Direction): number[] {
  const where = txWhere(f)
  const sign = SIGN[direction]
  const clause = sign ? (where.sql ? `${where.sql} AND ${sign}` : `WHERE ${sign}`) : where.sql
  return (
    ctx.db.prepare(`SELECT id FROM temp.tx ${clause}`).all(...where.params) as { id: number }[]
  ).map((r) => r.id)
}

/** a window's local days as the absolute range the date filter writes */
export function windowRange(w: { start: string; end: string }): TransactionFilters['dateRange'] {
  const at = (day: string, ...time: number[]): number => {
    const [y, m, d] = day.split('-').map(Number)
    return Math.floor(new Date(y, m - 1, d, ...time).getTime() / 1000)
  }
  return { kind: 'absolute', start: at(w.start), end: at(w.end, 23, 59, 59) }
}

const idsOf = (ctx: AnalysisContext, sql: string, value: string): number[] =>
  (ctx.db.prepare(sql).all(value) as { id: number }[]).map((r) => r.id)

/** the table filter that reads like a tool filter: same period, names, direction and search */
export function filtersFor(
  ctx: AnalysisContext,
  f: TxFilter & { window: Window },
  direction: Direction
): TransactionFilters {
  const account = f.account
    ? idsOf(ctx, 'SELECT id FROM temp.accounts WHERE name = ?', f.account)
    : ctx.accountId !== null
      ? [ctx.accountId]
      : undefined
  const search = f.search?.trim()
  return {
    dateRange: windowRange(f.window),
    ...(account ? { accountIds: account } : {}),
    ...(f.category
      ? { categoryIds: idsOf(ctx, 'SELECT id FROM main.categories WHERE name = ?', f.category) }
      : {}),
    direction: direction === 'spending' ? 'expense' : direction,
    ...(search ? { search } : {}),
    // the tx view leaves both out
    includePending: false,
    includeTransfers: false
  }
}

/** the ids the transactions table lists for a filter, run through its own predicate */
function tableIds(ctx: AnalysisContext, filters: TransactionFilters): number[] {
  const where = buildWhere(resolveTransactionFilters(filters, Math.floor(Date.now() / 1000)), {
    keepUnknownDates: true,
    keepOpeningBalances: true
  })
  const q = dialect.sqlToQuery(where!)
  // main.* aliased to the names the predicate uses: unqualified, they'd
  // resolve to the scoped temp views
  return (
    ctx.db
      .prepare(
        `SELECT "transactions"."id" AS id FROM main.transactions AS "transactions"
         JOIN main.accounts AS "accounts" ON "accounts"."id" = "transactions"."account_id"
         LEFT JOIN main.categories AS "categories" ON "categories"."id" = "transactions"."category_id"
         WHERE ${q.sql}`
      )
      .all(...q.params) as { id: number }[]
  ).map((r) => r.id)
}

// the most ids a link pins: a filter carries them in the URL and the saved
// message, and each one is a bound SQL variable (SQLite caps those at 32766)
export const MAX_PINNED = 2000

/**
 * The link to exactly these rows: the readable filter when the table agrees
 * with it, else that filter pinned to the ids, else the ids alone. No link
 * when only a pin would do and there are too many rows to pin.
 */
export function linkRows(
  ctx: AnalysisContext,
  ids: number[],
  filters: TransactionFilters,
  label?: string
): TransactionsLink | null {
  if (ids.length === 0) return null
  const want = new Set(ids)
  const exact = (f: TransactionFilters): boolean => {
    if ((f.transactionIds?.length ?? 0) > MAX_PINNED) return false
    const got = tableIds(ctx, f)
    return got.length === want.size && got.every((id) => want.has(id))
  }
  const link = (f: TransactionFilters): TransactionsLink => ({
    filters: f,
    count: ids.length,
    ...(label ? { label } : {})
  })
  // a link is extra: it must never fail the answer it belongs to
  try {
    if (exact(filters)) return link(filters)
    if (want.size > MAX_PINNED) return null
    // the tool's search is wider than the table's (it also matches merchants), so the pin replaces it
    const { search: _search, ...rest } = filters
    const pinned = { ...rest, transactionIds: [...want].sort((a, b) => a - b) }
    if (exact(pinned)) return link(pinned)
    return link({ ...DEFAULT_TRANSACTION_FILTERS, transactionIds: pinned.transactionIds })
  } catch (err) {
    console.warn(`transaction link failed: ${String((err as Error)?.message ?? err)}`)
    return null
  }
}

/** the links that exist, as a tool output carries them */
export const links = (...found: (TransactionsLink | null)[]): TransactionsLink[] =>
  found.filter((l): l is TransactionsLink => l !== null)
