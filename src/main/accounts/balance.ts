// Account balances are an anchor plus a forward delta, never a plain sum of
// transactions. Sync history accumulates but has a hard floor at (first sync
// − 90 days) with no backfill path, so a synced account's transaction sum is
// permanently short by whatever its balance was at that floor. The anchor is
// exactly that missing amount:
//
//   balance = accounts.balance + sum(transactions after accounts.balance_date)
//
// For a synced account the anchor is the bridge's balance at its balance-date,
// refreshed every sync — which makes the whole thing self-correcting, since
// drift from a missed or late-posting transaction is wiped rather than
// compounding. For a manual account balance_date is 0, so the anchor is an
// opening balance and every transaction counts.
//
// Kept free of the live db handle so it can be unit-tested (better-sqlite3
// won't load under vitest); connections.ts runs the query, the same split
// rules.ts and ipc/rules.ts use.
import { and, eq, gt, inArray, isNull, type SQL } from 'drizzle-orm'
import { accounts, transactions } from '../db/schema'
import { transactionDate } from '../db/expressions'

/**
 * Which transactions count toward an account's delta. Requires `accounts` to be
 * joined, since the cutoff is per-account.
 *
 * Pending rows are excluded to match what a bank calls the "current" balance,
 * which also keeps the derived value equal to the reported one right after a
 * sync. Their impact stays visible through available-balance and the Pending
 * badge in the transactions table.
 */
export function balanceDeltaWhere(ids?: number[]): SQL | undefined {
  return and(
    isNull(transactions.deletedAt),
    eq(transactions.pending, false),
    // strictly after: a transaction dated at the anchor is already baked into
    // it. Note this also drops unknown-date rows (txn_date 0) on a manual
    // account anchored at 0 — theoretical, since sync, import, and manual
    // create all set a date on non-pending rows.
    gt(transactionDate, accounts.balanceDate),
    ids ? inArray(transactions.accountId, ids) : undefined
  )
}

/**
 * Applies a delta to one account row, exposing the untouched anchor as
 * `reportedBalance`. Compare `availableBalance` against that rather than
 * `balance`: both come from the bridge, so comparing it to a derived figure
 * would make them look distinct on every account that has moved since its last
 * sync.
 */
export function withDerivedBalance<T extends { balance: number }>(
  row: T,
  delta: number
): T & { reportedBalance: number } {
  return { ...row, reportedBalance: row.balance, balance: row.balance + delta }
}
