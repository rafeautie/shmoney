import { sql, type SQL } from 'drizzle-orm'
import { categories, transactions } from './schema'
import type { SystemCategoryKey } from './defaults'

// scalar subquery resolving a system category's id. System rows can't be
// deleted, so it always resolves — no id plumbing through call sites needed.
export function systemCategoryIdSql(key: SystemCategoryKey): SQL<number> {
  return sql<number>`(select id from ${categories} where ${categories.systemKey} = ${key})`
}

/** NULL-safe "not in the Transfers system category": uncategorized rows pass too. */
export function notTransferSql(): SQL {
  return sql`(${transactions.categoryId} is null or ${transactions.categoryId} <> ${systemCategoryIdSql('transfers')})`
}
