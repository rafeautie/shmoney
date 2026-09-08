// Siblings of balanceDeltaWhere, cut off at the goal's start rather than the
// account anchor. Kept db-free so the SQL can be snapshot-tested.
import { and, gt, inArray, type SQL } from 'drizzle-orm'
import { savingsGoalAccounts, savingsGoals } from '../db/schema'
import { transactionDate } from '../db/expressions'
import { settledRowsWhere } from '../accounts/balance'

/**
 * Requires `savings_goal_accounts` and `savings_goals` joined; the cutoff is
 * per-goal. No category clause: a back-dated opening balance is savings too.
 */
export function goalFlowWhere(goalIds?: number[]): SQL | undefined {
  return and(
    settledRowsWhere(),
    gt(transactionDate, savingsGoals.startedAt),
    goalIds ? inArray(savingsGoalAccounts.goalId, goalIds) : undefined
  )
}

/** The same rule at an explicit cutoff, for the series' per-bucket walk. */
export function flowSinceWhere(cutoff: number, goalIds?: number[]): SQL | undefined {
  return and(
    settledRowsWhere(),
    gt(transactionDate, cutoff),
    goalIds ? inArray(savingsGoalAccounts.goalId, goalIds) : undefined
  )
}
