import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  isNull,
  lt,
  sql,
  type SQL,
  type SQLWrapper
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { db } from '../db'
import { accounts, categories, transactions } from '../db/schema'
import { buildWhere } from '../reports/filters'
import { notTransferSql } from '../db/system-categories'
import type { ResolvedTransactionFilters } from '@shared/transaction-filters'
import {
  isSyncOwned,
  type CurrencyTotal,
  type Page,
  type PageCursor,
  type Transaction
} from '@shared/ipc'

export const transactionSortColumns = {
  // the generated column, so the (partial) date indexes serve the default sort
  date: transactions.effectiveDate,
  accountName: accounts.name,
  description: transactions.description,
  amount: transactions.amount
} as const

const pair = alias(transactions, 'pair')
const pairAccount = alias(accounts, 'pair_account')

/** Unix seconds bounding the local calendar day that contains `date` */
export function localDayBounds(date: number): [number, number] {
  const start = new Date(date * 1000)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return [start.getTime() / 1000, end.getTime() / 1000]
}

export function order(column: SQLWrapper, dir: 'asc' | 'desc'): SQL {
  return dir === 'asc' ? asc(column) : desc(column)
}

export function transactionsPage(
  where: SQL | undefined,
  q: {
    page: PageCursor
    pageSize: number
    sortBy: keyof typeof transactionSortColumns
    sortDir: 'asc' | 'desc'
  }
): Page<Transaction> {
  // soft-deleted rows are invisible everywhere; buildWhere() repeats this for
  // the report aggregates, which don't go through this function
  const visible = and(where, isNull(transactions.deletedAt))
  // the date sort seeks past the last row loaded; the others page by OFFSET
  const cursor = q.sortBy === 'date' && typeof q.page === 'object' ? q.page : null
  const pageIndex = typeof q.page === 'number' ? q.page : 0
  const seek = cursor
    ? sql`(${transactions.effectiveDate}, ${transactions.id}) ${sql.raw(q.sortDir === 'asc' ? '>' : '<')} (${cursor.date}, ${cursor.id})`
    : undefined
  const rows = db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      accountName: accounts.name,
      currency: accounts.currency,
      date: transactions.effectiveDate,
      amount: transactions.amount,
      description: transactions.description,
      pending: transactions.pending,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      categorySystemKey: categories.systemKey,
      connectionId: accounts.connectionId,
      simplefinId: transactions.simplefinId,
      pairAccountName: pairAccount.name
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    // the partner counts only while it's live and filed alongside this leg
    .leftJoin(
      pair,
      and(
        eq(pair.id, transactions.transferPairId),
        isNull(pair.deletedAt),
        eq(pair.categoryId, transactions.categoryId)
      )
    )
    .leftJoin(pairAccount, eq(pairAccount.id, pair.accountId))
    .where(and(visible, seek))
    // id is a stable tiebreaker so pages don't dup or skip rows when the sort
    // column ties (manual/imported rows all share local-noon dates)
    .orderBy(order(transactionSortColumns[q.sortBy], q.sortDir), order(transactions.id, q.sortDir))
    // one extra row says whether another page follows
    .limit(q.pageSize + 1)
    .offset(cursor ? 0 : pageIndex * q.pageSize)
    .all()
    // isTransfer is derived for display: membership in the Transfers system category;
    // syncOwned tells the edit dialog which fields sync would overwrite
    .map(({ categorySystemKey, connectionId, simplefinId, pairAccountName, ...row }) => {
      const isTransfer = categorySystemKey === 'transfers'
      return {
        ...row,
        isTransfer,
        transferAccountName: isTransfer ? pairAccountName : null,
        syncOwned: isSyncOwned(connectionId, simplefinId)
      }
    })
  const more = rows.length > q.pageSize
  rows.length = Math.min(rows.length, q.pageSize)
  const last = rows.at(-1)
  const next: PageCursor | null =
    !more || !last ? null : q.sortBy === 'date' ? { date: last.date, id: last.id } : pageIndex + 1
  // later pages only append rows, so only the first counts them
  const total =
    q.page !== 0
      ? null
      : (db
          .select({ value: count() })
          .from(transactions)
          .innerJoin(accounts, eq(transactions.accountId, accounts.id))
          // report filters can reference category columns, so keep joins in sync with the rows query
          .leftJoin(categories, eq(transactions.categoryId, categories.id))
          .where(visible)
          .get()?.value ?? 0)
  // day headers net a whole day minus transfers, and the rest of the last row's
  // day is on pages not loaded yet
  let dayRest: CurrencyTotal[] | undefined
  if (q.sortBy === 'date' && more && last) {
    const [start, end] = localDayBounds(last.date)
    const after = sql`(${transactions.effectiveDate}, ${transactions.id}) ${sql.raw(q.sortDir === 'asc' ? '>' : '<')} (${last.date}, ${last.id})`
    dayRest = transactionSums(
      and(
        where,
        after,
        notTransferSql(),
        gte(transactions.effectiveDate, start),
        lt(transactions.effectiveDate, end)
      )
    )
  }
  return { rows, total, next, dayRest }
}

/**
 * The table's filter predicate. An account-scoped view ignores accountIds from
 * a loaded saved filter: the page's account is authoritative
 */
export function filteredWhere(
  filters: ResolvedTransactionFilters,
  accountId: number | undefined
): SQL | undefined {
  const scoped = accountId !== undefined
  const filterWhere = buildWhere(scoped ? { ...filters, accountIds: undefined } : filters, {
    keepUnknownDates: true,
    keepOpeningBalances: true
  })
  return scoped ? and(eq(transactions.accountId, accountId), filterWhere) : filterWhere
}

export interface ExportRow {
  date: number
  accountName: string
  description: string
  categoryName: string | null
  amount: number
  currency: string
  pending: boolean
}

/** every row {@link transactionsPage} would list, in its order, unpaged */
export function transactionRows(
  where: SQL | undefined,
  sortBy: keyof typeof transactionSortColumns,
  sortDir: 'asc' | 'desc'
): ExportRow[] {
  return db
    .select({
      date: transactions.effectiveDate,
      accountName: accounts.name,
      description: transactions.description,
      categoryName: categories.name,
      amount: transactions.amount,
      currency: accounts.currency,
      pending: transactions.pending
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(and(where, isNull(transactions.deletedAt)))
    .orderBy(order(transactionSortColumns[sortBy], sortDir), order(transactions.id, sortDir))
    .all()
}

/**
 * Net total of the rows {@link transactionsPage} would list, across every page,
 * grouped by the account's currency. Amounts are signed, so the sum nets
 * income against spending the same way balances net debt against cash.
 */
export function transactionSums(where: SQL | undefined): CurrencyTotal[] {
  return (
    db
      .select({
        currency: accounts.currency,
        total: sql<number>`sum(${transactions.amount})`
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      // filters can reference category columns, so keep joins in sync with the rows query
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .where(and(where, isNull(transactions.deletedAt)))
      .groupBy(accounts.currency)
      .orderBy(asc(accounts.currency))
      .all()
  )
}
