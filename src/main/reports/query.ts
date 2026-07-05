import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import { db } from '../db'
import { accounts, categories, categoryGroups, transactions } from '../db/schema'
import { transactionDate } from '../ipc/transactions-page'
import type {
  Measure,
  QueryRow,
  ResolvedFilters,
  ResolvedQuery,
  RunQueryResult,
  TimeGrain
} from '@shared/reports'

// bucket labels must match bucketLabelFor() in src/shared/reports.ts exactly,
// since the renderer zero-fills gaps by enumerating the same labels
function bucketSql(grain: Exclude<TimeGrain, 'none'>): SQL<string> {
  const d = sql`${transactionDate}, 'unixepoch', 'localtime'`
  switch (grain) {
    case 'day':
      return sql<string>`strftime('%Y-%m-%d', ${d})`
    case 'week':
      // Monday start: advance to the coming Sunday, then back 6 days
      return sql<string>`date(${d}, 'weekday 0', '-6 days')`
    case 'month':
      return sql<string>`strftime('%Y-%m', ${d})`
    case 'quarter':
      return sql<string>`strftime('%Y', ${d}) || '-Q' || cast((cast(strftime('%m', ${d}) as integer) + 2) / 3 as text)`
    case 'year':
      return sql<string>`strftime('%Y', ${d})`
  }
}

function measureSql(measure: Measure): SQL<number> {
  switch (measure) {
    case 'sum':
      return sql<number>`coalesce(sum(${transactions.amount}), 0)`
    case 'count':
      return sql<number>`count(*)`
    case 'avg':
      return sql<number>`coalesce(avg(${transactions.amount}), 0)`
    // transfers between accounts are neither income nor expense, so they never
    // count toward these measures regardless of the direction filter
    case 'income':
      return sql<number>`coalesce(sum(case when ${transactions.amount} > 0 and ${transactions.isTransfer} = 0 then ${transactions.amount} else 0 end), 0)`
    case 'expense':
      return sql<number>`coalesce(sum(case when ${transactions.amount} < 0 and ${transactions.isTransfer} = 0 then -${transactions.amount} else 0 end), 0)`
  }
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`)
}

export function buildWhere(
  f: ResolvedFilters,
  opts: { keepUnknownDates?: boolean } = {}
): SQL | undefined {
  // soft-deleted rows never count, in lists or aggregates
  const preds: SQL[] = [isNull(transactions.deletedAt)]
  // rows whose date resolves to 0 have an unknown date; keep them out of every
  // report query so they can't form a phantom 1970 bucket. The transactions
  // table shows those rows (as "—"), so it opts out unless a date bound is set
  // (an unknown date can't satisfy a range)
  if (!opts.keepUnknownDates || f.dateStart !== null || f.dateEnd !== null) {
    preds.push(sql`${transactionDate} > 0`)
  }
  if (f.dateStart !== null) preds.push(sql`${transactionDate} >= ${f.dateStart}`)
  if (f.dateEnd !== null) preds.push(sql`${transactionDate} <= ${f.dateEnd}`)
  if (f.accountIds?.length) preds.push(inArray(transactions.accountId, f.accountIds))
  if (f.categoryIds?.length || f.includeUncategorized) {
    const parts: SQL[] = []
    if (f.categoryIds?.length) parts.push(inArray(transactions.categoryId, f.categoryIds))
    if (f.includeUncategorized) parts.push(isNull(transactions.categoryId))
    preds.push(or(...parts)!)
  }
  if (f.categoryGroupIds?.length) preds.push(inArray(categories.groupId, f.categoryGroupIds))
  // income/expense exclude transfers; 'transfer' shows only them
  if (f.direction === 'income') preds.push(sql`${transactions.amount} > 0 and ${transactions.isTransfer} = 0`)
  if (f.direction === 'expense') preds.push(sql`${transactions.amount} < 0 and ${transactions.isTransfer} = 0`)
  if (f.direction === 'transfer') preds.push(sql`${transactions.isTransfer} = 1`)
  if (f.amountMin !== undefined) preds.push(sql`abs(${transactions.amount}) >= ${f.amountMin}`)
  if (f.amountMax !== undefined) preds.push(sql`abs(${transactions.amount}) <= ${f.amountMax}`)
  if (f.descriptionSearch) {
    preds.push(
      sql`${transactions.description} like ${'%' + escapeLike(f.descriptionSearch) + '%'} escape '\\'`
    )
  }
  if (f.search) {
    const term = '%' + escapeLike(f.search) + '%'
    preds.push(
      or(
        sql`${transactions.description} like ${term} escape '\\'`,
        sql`${accounts.name} like ${term} escape '\\'`,
        // NULL LIKE ... is NULL, which is falsy in OR — uncategorized rows just don't match here
        sql`${categories.name} like ${term} escape '\\'`
      )!
    )
  }
  if (!f.includePending) preds.push(eq(transactions.pending, false))
  return and(...preds)
}

export function runQuery(q: ResolvedQuery): RunQueryResult {
  const bucket = q.timeGrain === 'none' ? null : bucketSql(q.timeGrain)
  const groupCols = {
    none: null,
    category: { id: transactions.categoryId, label: categories.name },
    categoryGroup: { id: categories.groupId, label: categoryGroups.name },
    account: { id: transactions.accountId, label: accounts.name }
  }[q.groupBy]

  const rows: QueryRow[] = db
    .select({
      bucket: bucket ?? sql<string | null>`null`,
      groupId: groupCols?.id ?? sql<number | null>`null`,
      groupLabel: groupCols?.label ?? sql<string | null>`null`,
      currency: accounts.currency,
      value: measureSql(q.measure)
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .where(buildWhere(q.filters))
    .groupBy(
      ...[bucket, groupCols?.id, groupCols?.label, accounts.currency].filter(
        (c): c is NonNullable<typeof c> => Boolean(c)
      )
    )
    .all()

  const currencies = [...new Set(rows.map((r) => r.currency))].sort()
  return { rows, currencies }
}
