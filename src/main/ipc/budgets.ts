import { ipcMain } from 'electron'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { budgets, categories } from '../db/schema'
import { getBudgetSummary } from '../budgets/summary'
import {
  BUDGETS_IPC,
  budgetRemoveSchema,
  budgetRestoreSchema,
  budgetSetFillSchema,
  budgetSummaryQuerySchema,
  type BudgetRemoveResult,
  type BudgetSummary
} from '@shared/budgets'

// envelopes only make sense for real spending categories; system categories
// (Income, Transfers) back built-in behavior and must stay unbudgetable
function assertBudgetable(categoryId: number): void {
  const row = db
    .select({ systemKey: categories.systemKey })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .get()
  if (!row) throw new Error(`Category ${categoryId} not found`)
  if (row.systemKey != null) throw new Error("System categories can't be budgeted")
}

export function registerBudgetsIpc(): void {
  ipcMain.handle(BUDGETS_IPC.summary, (_event, input: unknown): BudgetSummary => {
    const { month } = budgetSummaryQuerySchema.parse(input)
    return getBudgetSummary(month)
  })

  ipcMain.handle(BUDGETS_IPC.setFill, (_event, input: unknown): boolean => {
    const { categoryId, month, amount } = budgetSetFillSchema.parse(input)
    assertBudgetable(categoryId)
    db.insert(budgets)
      .values({ categoryId, month, amount })
      .onConflictDoUpdate({ target: [budgets.categoryId, budgets.month], set: { amount } })
      .run()
    return true
  })

  ipcMain.handle(BUDGETS_IPC.remove, (_event, input: unknown): BudgetRemoveResult => {
    const { categoryId } = budgetRemoveSchema.parse(input)
    const fills = db
      .delete(budgets)
      .where(eq(budgets.categoryId, categoryId))
      .returning({ month: budgets.month, amount: budgets.amount })
      .all()
    return { fills }
  })

  ipcMain.handle(BUDGETS_IPC.restore, (_event, input: unknown): boolean => {
    const { categoryId, fills } = budgetRestoreSchema.parse(input)
    assertBudgetable(categoryId)
    // onConflictDoNothing keeps a double-fired undo idempotent
    db.insert(budgets)
      .values(fills.map((f) => ({ categoryId, month: f.month, amount: f.amount })))
      .onConflictDoNothing()
      .run()
    return true
  })
}
