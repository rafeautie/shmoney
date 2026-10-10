import type { Query, QueryClient } from '@tanstack/react-query'

// everything derived from transaction rows. List keys are built by their callers
// and may nest under an account (['accounts', id, 'transactions', ...]), so lists,
// sums and stats are matched by the 'transactions' segment anywhere in the key.
const DERIVED_ROOTS = new Set([
  'accounts',
  'budget-summary',
  'goals',
  'report-data',
  'actionLog',
  'ruleSuggestions'
])

export function isTransactionDerived(query: Query): boolean {
  const key = query.queryKey
  return DERIVED_ROOTS.has(key[0] as string) || key.includes('transactions')
}

/** Refetch what a change to transaction rows can affect, instead of every query in the app. */
export function invalidateTransactionData(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ predicate: isTransactionDerived })
}

/** Saving or removing a rule can accept or reopen rule suggestions. */
export function invalidateRuleData(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: (query) => ['rules', 'ruleSuggestions'].includes(query.queryKey[0] as string)
  })
}

const CATEGORY_ROOTS = new Set(['categories', 'rules', 'reports', 'report', 'saved-filters'])

/** A category change shows up in transaction rows, budgets, reports, rules and saved filters. */
export function invalidateCategoryData(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: (query) =>
      CATEGORY_ROOTS.has(query.queryKey[0] as string) || isTransactionDerived(query)
  })
}

// roots no action-log entry can change
const NON_DATA_ROOTS = new Set([
  'llm',
  'debug',
  'diagnostics',
  'storage',
  'demo',
  'connection',
  'settings'
])

/** Undo/redo can reverse any logged change (transactions, rules, categories, goals…), so
 * refetch every data query but skip the LLM, diagnostics and settings caches. */
export function invalidateUndoableData(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: (query) => !NON_DATA_ROOTS.has(query.queryKey[0] as string)
  })
}
