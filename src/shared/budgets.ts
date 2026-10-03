import { z } from 'zod'

// ---------- IPC channels ----------

export const BUDGETS_IPC = {
  summary: 'budgets:summary',
  // upsert of a month's fill; also how an envelope is created
  setFill: 'budgets:setFill',
  // deletes every fill row for the category; returns the action-log id for undo
  remove: 'budgets:remove'
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

// ---------- results ----------

export interface EnvelopeSummary {
  categoryId: number
  categoryName: string
  /** null = ungrouped */
  groupId: number | null
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
  /** grouped in Categories-settings order (ungrouped last), then by name */
  envelopes: EnvelopeSummary[]
  /** viewed-month spending outside all envelopes (Transfers excluded) */
  unbudgetedSpent: number
  totals: { fill: number; spent: number; balance: number }
}

export interface BudgetRemoveResult {
  /** action-log entry to replay for undo; null when there was nothing to remove */
  actionId: number | null
}

export interface EnvelopeSection {
  groupId: number | null
  groupName: string | null
  envelopes: EnvelopeSummary[]
  totals: { fill: number; spent: number; balance: number }
}

/** Splits the summary's already-ordered envelopes into one section per group. */
export function groupEnvelopes(envelopes: EnvelopeSummary[]): EnvelopeSection[] {
  const sections: EnvelopeSection[] = []
  for (const envelope of envelopes) {
    let section = sections.at(-1)
    if (section === undefined || section.groupId !== envelope.groupId) {
      section = {
        groupId: envelope.groupId,
        groupName: envelope.groupName,
        envelopes: [],
        totals: { fill: 0, spent: 0, balance: 0 }
      }
      sections.push(section)
    }
    section.envelopes.push(envelope)
    section.totals.fill += envelope.fill
    section.totals.spent += envelope.spent
    section.totals.balance += envelope.balance
  }
  return sections
}

/**
 * Share of `month` that has elapsed, 0 to 1, when it is the current local
 * month; null otherwise (past months are complete, future ones not started).
 */
export function monthPace(month: string, now: Date = new Date()): number | null {
  const [year, m] = month.split('-').map(Number)
  if (now.getFullYear() !== year || now.getMonth() !== m - 1) return null
  const start = new Date(year, m - 1, 1).getTime()
  const end = new Date(year, m, 1).getTime()
  return (now.getTime() - start) / (end - start)
}
