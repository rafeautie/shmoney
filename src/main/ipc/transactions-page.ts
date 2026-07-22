import { and, asc, count, desc, eq, isNull, sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { db } from '../db'
import { accounts, categories, transactions } from '../db/schema'
import { isSyncOwned, type Page, type Transaction } from '@shared/ipc'

// SimpleFIN sends posted = 0 for pending transactions; their real date is transacted_at
export const transactionDate = sql<number>`coalesce(nullif(${transactions.posted}, 0), ${transactions.transactedAt}, 0)`

export const transactionSortColumns = {
  date: transactionDate,
  accountName: accounts.name,
  description: transactions.description,
  amount: transactions.amount
} as const

export function order(column: SQLWrapper, dir: 'asc' | 'desc'): SQL {
  return dir === 'asc' ? asc(column) : desc(column)
}

export function transactionsPage(
  where: SQL | undefined,
  q: {
    page: number
    pageSize: number
    sortBy: keyof typeof transactionSortColumns
    sortDir: 'asc' | 'desc'
  }
): Page<Transaction> {
  // soft-deleted rows are invisible everywhere; buildWhere() repeats this for
  // the report aggregates, which don't go through this function
  const visible = and(where, isNull(transactions.deletedAt))
  const rows = db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      accountName: accounts.name,
      currency: accounts.currency,
      date: transactionDate,
      amount: transactions.amount,
      description: transactions.description,
      pending: transactions.pending,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      categorySystemKey: categories.systemKey,
      connectionId: accounts.connectionId,
      simplefinId: transactions.simplefinId
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(visible)
    // id is a stable tiebreaker so LIMIT/OFFSET pages don't dup or skip rows when
    // the sort column ties (manual/imported rows all share local-noon dates)
    .orderBy(order(transactionSortColumns[q.sortBy], q.sortDir), order(transactions.id, q.sortDir))
    .limit(q.pageSize)
    .offset(q.page * q.pageSize)
    .all()
    // isTransfer is derived for display: membership in the Transfers system category;
    // syncOwned tells the edit dialog which fields sync would overwrite
    .map(({ categorySystemKey, connectionId, simplefinId, ...row }) => ({
      ...row,
      isTransfer: categorySystemKey === 'transfers',
      syncOwned: isSyncOwned(connectionId, simplefinId)
    }))
  const total =
    db
      .select({ value: count() })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      // report filters can reference category columns, so keep joins in sync with the rows query
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .where(visible)
      .get()?.value ?? 0
  return { rows, total }
}
