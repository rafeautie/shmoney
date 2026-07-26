import { sql, type SQL } from 'drizzle-orm'
import { categories, transactions } from './schema'
import type { SystemCategoryKey } from './defaults'

// scalar subquery resolving a system category's id. System rows can't be
// deleted, so it always resolves — no id plumbing through call sites needed.
export function systemCategoryIdSql(key: SystemCategoryKey): SQL<number> {
  return sql<number>`(select id from ${categories} where ${categories.systemKey} = ${key})`
}

/** NULL-safe "not in this system category": uncategorized rows pass too. */
function notSystemCategorySql(key: SystemCategoryKey): SQL {
  return sql`(${transactions.categoryId} is null or ${transactions.categoryId} <> ${systemCategoryIdSql(key)})`
}

export function notTransferSql(): SQL {
  return notSystemCategorySql('transfers')
}

/**
 * Excludes a manual account's starting-balance line. It exists to make the
 * account's ledger add up to its balance, so it belongs in the transactions
 * table but never in spending analysis, where it would read as a large income.
 */
export function notOpeningSql(): SQL {
  return notSystemCategorySql('opening')
}
