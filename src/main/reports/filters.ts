// The filter model shared by the report aggregates and the transaction tables:
// one ResolvedFilters in, one SQL predicate out. Kept free of the live db
// handle so it can be unit-tested (better-sqlite3 won't load under vitest),
// the same split rules.ts and accounts/balance.ts use.
import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import { accounts, categories, transactions } from '../db/schema'
import { notOpeningSql, notTransferSql } from '../db/system-categories'
import { transactionDate } from '../db/expressions'
import type { ResolvedFilters } from '@shared/reports'

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`)
}

export function buildWhere(
  f: ResolvedFilters,
  opts: { keepUnknownDates?: boolean; keepOpeningBalances?: boolean } = {}
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
  if (f.direction === 'income') preds.push(sql`${transactions.amount} > 0`)
  if (f.direction === 'expense') preds.push(sql`${transactions.amount} < 0`)
  // transfers are excluded unless the filter opts in. An explicit category
  // selection skips the exclusion: chosen categories already narrow the rows,
  // and picking Transfers there IS opting in — the exclusion would fight it
  if (!f.includeTransfers && !f.categoryIds?.length) preds.push(notTransferSql())
  // a starting balance is account setup, not activity — there is no report it
  // belongs in. Unlike transfers there's nothing to opt into, so it's not a
  // filter field; the transactions table opts out explicitly, same as it does
  // for unknown dates
  if (!opts.keepOpeningBalances) preds.push(notOpeningSql())
  if (f.amountMin !== undefined) preds.push(sql`abs(${transactions.amount}) >= ${f.amountMin}`)
  if (f.amountMax !== undefined) preds.push(sql`abs(${transactions.amount}) <= ${f.amountMax}`)
  // OR across phrases, AND against the rest of the filter: the description has
  // to contain one of them, the same semantics rule phrases carry
  if (f.descriptionSearch?.length) {
    preds.push(
      or(
        ...f.descriptionSearch.map(
          (phrase) =>
            sql`${transactions.description} like ${'%' + escapeLike(phrase) + '%'} escape '\\'`
        )
      )!
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
