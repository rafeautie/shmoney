import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../db'
import { accounts, savingsGoalAccounts, savingsGoals, type SavingsGoalRow } from '../db/schema'
import { computePace } from './pace'
import { savedNow, type GoalRef } from './saved'
import type { GoalSummary } from '@shared/goals'

function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

/** goalId -> its linked accounts, in name order */
export function goalAccounts(goalIds: number[]): Map<number, { id: number; name: string }[]> {
  const byGoal = new Map<number, { id: number; name: string }[]>()
  if (goalIds.length === 0) return byGoal
  const rows = db
    .select({ goalId: savingsGoalAccounts.goalId, id: accounts.id, name: accounts.name })
    .from(savingsGoalAccounts)
    .innerJoin(accounts, eq(accounts.id, savingsGoalAccounts.accountId))
    .where(inArray(savingsGoalAccounts.goalId, goalIds))
    .orderBy(asc(accounts.name))
    .all()
  for (const row of rows) {
    const list = byGoal.get(row.goalId)
    if (list) list.push({ id: row.id, name: row.name })
    else byGoal.set(row.goalId, [{ id: row.id, name: row.name }])
  }
  return byGoal
}

/** Every non-deleted goal, or just the named ones. Archived goals are included. */
export function loadGoalRows(ids?: number[]): SavingsGoalRow[] {
  return db
    .select()
    .from(savingsGoals)
    .where(
      ids
        ? and(isNull(savingsGoals.deletedAt), inArray(savingsGoals.id, ids))
        : isNull(savingsGoals.deletedAt)
    )
    .orderBy(asc(savingsGoals.createdAt))
    .all()
}

/** A row plus its accounts, in the shape saved.ts and series.ts work from. */
export function toGoalRef(row: SavingsGoalRow, accountIds: number[]): GoalRef {
  return { id: row.id, mode: row.mode, accountIds }
}

/**
 * Everything the Goals page renders, in one call: the row, its accounts, what
 * it has saved, and every pace output. Archived goals sort last so the history
 * stays visible without crowding active goals.
 */
export function getGoalSummaries(ids?: number[]): GoalSummary[] {
  const rows = loadGoalRows(ids)
  if (rows.length === 0) return []

  const linked = goalAccounts(rows.map((r) => r.id))
  const refs = rows.map((row) =>
    toGoalRef(
      row,
      (linked.get(row.id) ?? []).map((a) => a.id)
    )
  )
  const saved = savedNow(refs)
  const now = nowSec()

  return rows
    .map((row) => {
      const progress = saved.get(row.id) ?? 0
      return {
        id: row.id,
        name: row.name,
        mode: row.mode,
        targetAmount: row.targetAmount,
        targetDate: row.targetDate,
        startedAt: row.startedAt,
        baselineAmount: row.baselineAmount,
        currency: row.currency,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        archivedAt: row.archivedAt,
        accounts: linked.get(row.id) ?? [],
        progress,
        ...computePace({
          targetAmount: row.targetAmount,
          baselineAmount: row.baselineAmount,
          progress,
          startedAt: row.startedAt,
          targetDate: row.targetDate,
          now
        })
      }
    })
    .sort((a, b) => {
      const archived = Number(a.archivedAt !== null) - Number(b.archivedAt !== null)
      return archived !== 0 ? archived : a.createdAt - b.createdAt
    })
}
