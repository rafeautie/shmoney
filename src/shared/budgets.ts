import { z } from 'zod'

// ---------- IPC channels ----------

export const BUDGETS_IPC = {
  summary: 'budgets:summary',
  // upsert of a month's fill; also how an envelope is created
  setFill: 'budgets:setFill',
  // deletes every fill row for the category; returns them for undo
  remove: 'budgets:remove',
  // undo of remove: re-inserts a removed envelope's fill rows
  restore: 'budgets:restore'
} as const

// ---------- schemas ----------

/** 'YYYY-MM', matching the reports month-bucket label */
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)

export const budgetSummaryQuerySchema = z.object({ month: monthSchema })
export type BudgetSummaryQuery = z.infer<typeof budgetSummaryQuerySchema>

export const budgetSetFillSchema = z.object({
  categoryId: z.number().int().positive(),
  month: monthSchema,
  /** integer milliunits */
  amount: z.number().int().nonnegative()
})
export type BudgetSetFillInput = z.infer<typeof budgetSetFillSchema>

export const budgetRemoveSchema = z.object({ categoryId: z.number().int().positive() })
export type BudgetRemoveInput = z.infer<typeof budgetRemoveSchema>

export const budgetFillSchema = z.object({
  month: monthSchema,
  amount: z.number().int().nonnegative()
})
export type BudgetFill = z.infer<typeof budgetFillSchema>

export const budgetRestoreSchema = z.object({
  categoryId: z.number().int().positive(),
  fills: z.array(budgetFillSchema).min(1)
})
export type BudgetRestoreInput = z.infer<typeof budgetRestoreSchema>

// ---------- results ----------

export interface EnvelopeSummary {
  categoryId: number
  categoryName: string
  groupName: string | null
  /** month of the envelope's earliest fill row */
  startMonth: string
  /** effective fill for the viewed month, milliunits */
  fill: number
  /** viewed-month spending magnitude, milliunits */
  spent: number
  /** rollover through the viewed month; negative carries forward */
  balance: number
}

export interface BudgetSummary {
  month: string
  /** earliest envelope start; null = no envelopes exist */
  minMonth: string | null
  /** dominant account currency, for display only */
  currency: string
  /** sorted by group name then category name */
  envelopes: EnvelopeSummary[]
  /** viewed-month spending outside all envelopes (Transfers excluded) */
  unbudgetedSpent: number
  totals: { fill: number; spent: number; balance: number }
}

export interface BudgetRemoveResult {
  fills: BudgetFill[]
}
