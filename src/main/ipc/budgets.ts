import { ipcMain } from 'electron'
import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import { budgets, categories } from '../db/schema'
import { getBudgetSummary } from '../budgets/summary'
import { recordAction, type Runner } from './action-log'
import {
  BUDGETS_IPC,
  budgetRemoveSchema,
  budgetSetFillSchema,
  budgetSummaryQuerySchema,
  type BudgetSetFillInput,
  type BudgetRemoveResult,
  type BudgetSummary
} from '@shared/budgets'

// envelopes only make sense for real spending categories; system categories
// (Income, Transfers) back built-in behavior and must stay unbudgetable
function budgetableCategoryName(categoryId: number): string {
  const row = db
    .select({ name: categories.name, systemKey: categories.systemKey })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .get()
  if (!row) throw new Error(`Category ${categoryId} not found`)
  if (row.systemKey != null) throw new Error("System categories can't be budgeted")
  return row.name
}

/**
 * Write one category's fill at a month (later months inherit it) as an undoable
 * action-log entry. Returns the entry id, or null when the fill already held
 * that amount. label overrides the default "Added/Changed ... envelope" wording.
 */
export function setBudgetFill(
  { categoryId, month, amount }: BudgetSetFillInput,
  label?: string,
  runner: Runner = db
): number | null {
  const name = budgetableCategoryName(categoryId)
  return runner.transaction((tx) => {
    const existing = tx
      .select({ amount: budgets.amount })
      .from(budgets)
      .where(and(eq(budgets.categoryId, categoryId), eq(budgets.month, month)))
      .get()
    if (existing?.amount === amount) return null
    // "Added" only when the category has no fills yet (the envelope is being
    // created); editing an inherited fill at a fresh month is a change to an
    // envelope that already exists, not a new one
    const isNewEnvelope =
      tx
        .select({ id: budgets.id })
        .from(budgets)
        .where(eq(budgets.categoryId, categoryId))
        .get() === undefined
    tx.insert(budgets)
      .values({ categoryId, month, amount })
      .onConflictDoUpdate({ target: [budgets.categoryId, budgets.month], set: { amount } })
      .run()
    return recordAction(tx, {
      source: 'user',
      label: label ?? (isNewEnvelope ? `Added ${name} envelope` : `Changed ${name} envelope fill`),
      changes: [
        {
          field: 'budgetAmount',
          categoryId,
          month,
          before: existing?.amount ?? null,
          after: amount
        }
      ]
    })
  })
}

export function registerBudgetsIpc(): void {
  ipcMain.handle(BUDGETS_IPC.summary, (_event, input: unknown): BudgetSummary => {
    const { month } = budgetSummaryQuerySchema.parse(input)
    return getBudgetSummary(month)
  })

  ipcMain.handle(BUDGETS_IPC.setFill, (_event, input: unknown): boolean => {
    setBudgetFill(budgetSetFillSchema.parse(input))
    return true
  })

  // deletes every fill row for the category; the returned action-log id is how
  // callers undo it (toast Undo and Ctrl+Z both replay the same entry)
  ipcMain.handle(BUDGETS_IPC.remove, (_event, input: unknown): BudgetRemoveResult => {
    const { categoryId } = budgetRemoveSchema.parse(input)
    return db.transaction((tx) => {
      const fills = tx
        .delete(budgets)
        .where(eq(budgets.categoryId, categoryId))
        .returning({ month: budgets.month, amount: budgets.amount })
        .all()
      if (fills.length === 0) return { actionId: null }
      const name =
        tx
          .select({ name: categories.name })
          .from(categories)
          .where(eq(categories.id, categoryId))
          .get()?.name ?? 'Unknown'
      const actionId = recordAction(tx, {
        source: 'user',
        label: `Removed ${name} envelope`,
        changes: fills.map((f) => ({
          field: 'budgetAmount' as const,
          categoryId,
          month: f.month,
          before: f.amount,
          after: null
        }))
      })
      return { actionId }
    })
  })
}
