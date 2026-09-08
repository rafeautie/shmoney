// Which transactions count toward a savings goal. The sibling of
// balanceDeltaWhere in accounts/balance.ts: same settled-rows rule, same
// strictly-after cutoff, but the cutoff is the goal's own start instant rather
// than the account anchor.
//
// No category clause. A back-dated goal's opening balance is money that was in
// the account, which is savings, and excluding it would make the two modes
// disagree about the same manual account (a derived balance already includes
// the opening line).
//
// Kept free of the live db handle so it can be unit-tested (better-sqlite3
// won't load under vitest); saved.ts and series.ts run the queries.
import { and, gt, inArray, type SQL } from 'drizzle-orm'
import { savingsGoalAccounts, savingsGoals } from '../db/schema'
import { transactionDate } from '../db/expressions'
import { settledRowsWhere } from '../accounts/balance'

/**
 * Contributions toward a goal, counted from its stored start instant. Requires
 * `savings_goal_accounts` and `savings_goals` joined to `transactions`, since
 * the cutoff is per-goal.
 */
export function goalFlowWhere(goalIds?: number[]): SQL | undefined {
  return and(
    settledRowsWhere(),
    // strictly after, so a transaction posted before the goal was created is
    // not counted as new saving
    gt(transactionDate, savingsGoals.startedAt),
    goalIds ? inArray(savingsGoalAccounts.goalId, goalIds) : undefined
  )
}

/**
 * The same rule with an explicit cutoff, for the series: it walks time buckets
 * and needs flows after each bucket's end, not after the goal's start. Requires
 * `savings_goal_accounts` joined; `savings_goals` is not read here.
 */
export function flowSinceWhere(cutoff: number, goalIds?: number[]): SQL | undefined {
  return and(
    settledRowsWhere(),
    gt(transactionDate, cutoff),
    goalIds ? inArray(savingsGoalAccounts.goalId, goalIds) : undefined
  )
}
