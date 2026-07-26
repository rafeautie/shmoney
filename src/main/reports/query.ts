import { eq, sql, type SQL } from 'drizzle-orm'
import { db } from '../db'
import { accounts, categories, categoryGroups, transactions } from '../db/schema'
import { buildWhere } from './filters'
import { transactionDate } from '../db/expressions'
import type { Measure, QueryRow, ResolvedQuery, RunQueryResult, TimeGrain } from '@shared/reports'

// bucket labels must match bucketLabelFor() in src/shared/reports.ts exactly,
// since the renderer zero-fills gaps by enumerating the same labels
export function bucketSql(grain: Exclude<TimeGrain, 'none'>): SQL<string> {
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
    // purely sign-based; transfers are kept out by the includeTransfers filter
    // (off by default in reports), not baked into the measure
    case 'income':
      return sql<number>`coalesce(sum(case when ${transactions.amount} > 0 then ${transactions.amount} else 0 end), 0)`
    case 'expense':
      return sql<number>`coalesce(sum(case when ${transactions.amount} < 0 then -${transactions.amount} else 0 end), 0)`
  }
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
