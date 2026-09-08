import { ipcMain } from 'electron'
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { db } from '../db'
import { createLogger } from '../logging'
import { accounts, savingsGoalAccounts, savingsGoals } from '../db/schema'
import { computeBaseline } from '../goals/saved'
import { getGoalSeries } from '../goals/series'
import { getGoalSummaries } from '../goals/summary'
import { endOfDay } from 'date-fns'
import { parseLocalDay } from '../goals/pace'
import { recordAction } from './action-log'
import {
  GOALS_IPC,
  goalCreateSchema,
  goalRemoveSchema,
  goalSeriesQuerySchema,
  goalUpdateSchema,
  type GoalRemoveResult,
  type GoalSummary
} from '@shared/goals'
import type { RunQueryResult } from '@shared/reports'

const log = createLogger('goals')

function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

/** A prior session's undo toast is gone, so those rows can never come back. */
function purgeDeletedGoals(): void {
  const removed = db.delete(savingsGoals).where(isNotNull(savingsGoals.deletedAt)).run().changes
  if (removed > 0) log.info('goals.purged-deleted', { count: removed })
}

/** A goal is a scalar amount and can't keep currencies apart. */
function sharedCurrency(accountIds: number[]): string {
  const rows = db
    .select({ id: accounts.id, currency: accounts.currency })
    .from(accounts)
    .where(inArray(accounts.id, accountIds))
    .all()
  if (rows.length !== accountIds.length) throw new Error('One of those accounts no longer exists')
  const currencies = new Set(rows.map((r) => r.currency))
  if (currencies.size > 1) throw new Error('A goal can only track accounts that share one currency')
  return rows[0].currency
}

// the target day is compared at its end, matching how computePace reads the
// deadline; comparing its midnight made a same-day target legal for a back-dated
// start (midnight minus one second) and illegal for a start of now
function assertDatesOrdered(startedAt: number, targetDate: string | null): void {
  if (targetDate === null) return
  const dayEnd = Math.floor(endOfDay(parseLocalDay(targetDate)).getTime() / 1000)
  if (dayEnd <= startedAt) throw new Error('The target date has to be after the start')
}

function oneSummary(id: number): GoalSummary {
  const [summary] = getGoalSummaries([id])
  if (!summary) throw new Error(`Goal ${id} not found`)
  return summary
}

export function registerGoalsIpc(): void {
  purgeDeletedGoals()

  ipcMain.handle(GOALS_IPC.list, (): GoalSummary[] => getGoalSummaries())

  ipcMain.handle(GOALS_IPC.series, (_event, input: unknown): RunQueryResult =>
    getGoalSeries(goalSeriesQuerySchema.parse(input))
  )

  ipcMain.handle(GOALS_IPC.create, (_event, input: unknown): GoalSummary => {
    const { name, mode, targetAmount, targetDate, startedAt, accountIds } =
      goalCreateSchema.parse(input)
    const now = nowSec()
    const start = startedAt ?? now
    if (start > now) throw new Error("A goal can't start in the future")
    assertDatesOrdered(start, targetDate ?? null)
    const currency = sharedCurrency(accountIds)

    const id = db.transaction((tx) => {
      const [row] = tx
        .insert(savingsGoals)
        .values({
          name,
          mode,
          targetAmount,
          targetDate: targetDate ?? null,
          startedAt: start,
          baselineAmount: 0,
          currency,
          createdAt: now,
          updatedAt: now
        })
        .returning({ id: savingsGoals.id })
        .all()
      tx.insert(savingsGoalAccounts)
        .values(accountIds.map((accountId) => ({ goalId: row.id, accountId })))
        .run()
      return row.id
    })

    // the baseline reads the stored start and links, so the row goes in first
    setBaseline(id, mode, accountIds)
    return oneSummary(id)
  })

  ipcMain.handle(GOALS_IPC.update, (_event, input: unknown): GoalSummary => {
    const patch = goalUpdateSchema.parse(input)
    const existing = db
      .select()
      .from(savingsGoals)
      .where(and(eq(savingsGoals.id, patch.id), isNull(savingsGoals.deletedAt)))
      .get()
    if (!existing) throw new Error(`Goal ${patch.id} not found`)

    const now = nowSec()
    const start = patch.startedAt ?? existing.startedAt
    if (start > now) throw new Error("A goal can't start in the future")
    const targetDate = patch.targetDate === undefined ? existing.targetDate : patch.targetDate
    assertDatesOrdered(start, targetDate ?? null)
    const accountIds = patch.accountIds
    const currency = accountIds ? sharedCurrency(accountIds) : existing.currency

    db.transaction((tx) => {
      tx.update(savingsGoals)
        .set({
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.targetAmount !== undefined ? { targetAmount: patch.targetAmount } : {}),
          ...(patch.targetDate !== undefined ? { targetDate: patch.targetDate ?? null } : {}),
          ...(patch.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
          ...(patch.archived !== undefined ? { archivedAt: patch.archived ? now : null } : {}),
          currency,
          updatedAt: now
        })
        .where(eq(savingsGoals.id, patch.id))
        .run()
      if (accountIds) {
        tx.delete(savingsGoalAccounts).where(eq(savingsGoalAccounts.goalId, patch.id)).run()
        tx.insert(savingsGoalAccounts)
          .values(accountIds.map((accountId) => ({ goalId: patch.id, accountId })))
          .run()
      }
    })

    if (patch.startedAt !== undefined || accountIds)
      setBaseline(patch.id, existing.mode, accountIds ?? linkedAccountIds(patch.id))
    return oneSummary(patch.id)
  })

  // soft delete so undo can bring the goal back; that is why there is no confirm
  ipcMain.handle(GOALS_IPC.remove, (_event, input: unknown): GoalRemoveResult => {
    const { id } = goalRemoveSchema.parse(input)
    const now = nowSec()
    const actionId = db.transaction((tx) => {
      const row = tx
        .select({ name: savingsGoals.name })
        .from(savingsGoals)
        .where(and(eq(savingsGoals.id, id), isNull(savingsGoals.deletedAt)))
        .get()
      if (!row) return null
      tx.update(savingsGoals).set({ deletedAt: now }).where(eq(savingsGoals.id, id)).run()
      return recordAction(tx, {
        source: 'user',
        label: 'Delete savings goal',
        changes: [
          { field: 'savingsGoalDeletedAt', goalId: id, name: row.name, before: null, after: now }
        ]
      })
    })
    return { actionId }
  })
}

function linkedAccountIds(goalId: number): number[] {
  return db
    .select({ accountId: savingsGoalAccounts.accountId })
    .from(savingsGoalAccounts)
    .where(eq(savingsGoalAccounts.goalId, goalId))
    .all()
    .map((r) => r.accountId)
}

function setBaseline(id: number, mode: 'balance' | 'contributions', accountIds: number[]): void {
  const baselineAmount = computeBaseline({ id, mode, accountIds })
  db.update(savingsGoals).set({ baselineAmount }).where(eq(savingsGoals.id, id)).run()
}
