// The only place that computes what a goal has saved. Every surface reads it
// through goals:list or goals:series, so none can disagree with another.
import { eq, inArray, sum } from 'drizzle-orm'
import { db } from '../db'
import { accounts, savingsGoalAccounts, savingsGoals, transactions } from '../db/schema'
import { balanceDeltaWhere } from '../accounts/balance'
import { goalFlowWhere } from './flow'
import type { GoalMode } from '@shared/goals'

export interface GoalRef {
  id: number
  mode: GoalMode
  accountIds: number[]
}

/** One grouped query, since the per-goal cutoff rides on the joined row. */
export function contributionFlows(goalIds: number[]): Map<number, number> {
  if (goalIds.length === 0) return new Map()
  const rows = db
    .select({ goalId: savingsGoalAccounts.goalId, total: sum(transactions.amount) })
    .from(transactions)
    .innerJoin(savingsGoalAccounts, eq(savingsGoalAccounts.accountId, transactions.accountId))
    .innerJoin(savingsGoals, eq(savingsGoals.id, savingsGoalAccounts.goalId))
    .where(goalFlowWhere(goalIds))
    .groupBy(savingsGoalAccounts.goalId)
    .all()
  // drizzle types SQLite's sum() as string | null
  return new Map(rows.map((r) => [r.goalId, Number(r.total ?? 0)]))
}

function derivedBalances(accountIds: number[]): Map<number, number> {
  if (accountIds.length === 0) return new Map()
  const anchors = db
    .select({ id: accounts.id, balance: accounts.balance })
    .from(accounts)
    .where(inArray(accounts.id, accountIds))
    .all()
  const deltaRows = db
    .select({ accountId: transactions.accountId, delta: sum(transactions.amount) })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(balanceDeltaWhere(accountIds))
    .groupBy(transactions.accountId)
    .all()
  const deltas = new Map(deltaRows.map((r) => [r.accountId, Number(r.delta ?? 0)]))
  return new Map(anchors.map((a) => [a.id, a.balance + (deltas.get(a.id) ?? 0)]))
}

/** goalId -> milliunits saved, per each goal's mode. A goal with no accounts saves 0. */
export function savedNow(goals: GoalRef[]): Map<number, number> {
  const balanceGoals = goals.filter((g) => g.mode === 'balance')
  const flowGoals = goals.filter((g) => g.mode === 'contributions')

  const balances = derivedBalances([...new Set(balanceGoals.flatMap((g) => g.accountIds))])
  const flows = contributionFlows(flowGoals.map((g) => g.id))

  const saved = new Map<number, number>()
  for (const goal of balanceGoals) {
    saved.set(
      goal.id,
      goal.accountIds.reduce((total, id) => total + (balances.get(id) ?? 0), 0)
    )
  }
  for (const goal of flowGoals) saved.set(goal.id, flows.get(goal.id) ?? 0)
  return saved
}

/** Reads the goal's stored start, so callers write the row and links first. */
export function computeBaseline(goal: GoalRef): number {
  if (goal.mode === 'contributions') return 0
  const saved = savedNow([goal]).get(goal.id) ?? 0
  return saved - (contributionFlows([goal.id]).get(goal.id) ?? 0)
}
