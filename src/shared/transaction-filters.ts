import { z } from 'zod'
import { accountIdSchema, idSchema, transactionsQuerySchema } from './ipc'
import {
  reportFiltersSchema,
  resolvedFiltersSchema,
  resolveDateRange,
  type ReportFilters,
  type ResolvedFilters
} from './reports'

// ---------- filter model ----------

// The transaction views and the report filter bar share one filter model (and
// one FilterBar component), so a filter saved in either place loads in both.
export const transactionFiltersSchema = reportFiltersSchema
export type TransactionFilters = ReportFilters

// the table defaults to showing everything (reports default to 12 months)
export const DEFAULT_TRANSACTION_FILTERS: TransactionFilters = {
  dateRange: { kind: 'all' },
  direction: 'all',
  includePending: true
}

// ---------- resolved shape (crosses IPC) ----------

export const resolvedTransactionFiltersSchema = resolvedFiltersSchema
export type ResolvedTransactionFilters = ResolvedFilters

export function resolveTransactionFilters(
  filters: TransactionFilters,
  nowSec: number
): ResolvedTransactionFilters {
  const { dateRange, ...rest } = filters
  const { start, end } = resolveDateRange(dateRange, nowSec)
  return { ...rest, dateStart: start, dateEnd: end }
}

// ---------- list queries (extended here, not ipc.ts, to avoid an import cycle) ----------

export const filteredTransactionsQuerySchema = transactionsQuerySchema.extend({
  filters: resolvedTransactionFiltersSchema.optional()
})
export type FilteredTransactionsQuery = z.infer<typeof filteredTransactionsQuerySchema>

export const filteredAccountTransactionsQuerySchema = filteredTransactionsQuerySchema.extend({
  accountId: accountIdSchema
})
export type FilteredAccountTransactionsQuery = z.infer<
  typeof filteredAccountTransactionsQuerySchema
>

// ---------- saved filters ----------

export interface SavedFilter {
  id: number
  name: string
  filters: TransactionFilters
  createdAt: number
  updatedAt: number
}

const savedFilterNameSchema = z.string().trim().min(1).max(100)

export const savedFilterCreateSchema = z.object({
  name: savedFilterNameSchema,
  filters: transactionFiltersSchema
})
export type SavedFilterCreateInput = z.infer<typeof savedFilterCreateSchema>

export const savedFilterUpdateSchema = z.object({
  id: idSchema,
  name: savedFilterNameSchema.optional(),
  filters: transactionFiltersSchema.optional()
})
export type SavedFilterUpdateInput = z.infer<typeof savedFilterUpdateSchema>

export const SAVED_FILTERS_IPC = {
  list: 'savedFilters:list',
  create: 'savedFilters:create',
  update: 'savedFilters:update',
  delete: 'savedFilters:delete'
} as const
