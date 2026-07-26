import { useMemo, useState } from 'react'
import {
  DEFAULT_TRANSACTION_FILTERS,
  resolveTransactionFilters,
  type ResolvedTransactionFilters,
  type TransactionFilters
} from '@shared/transaction-filters'
import { startOfTodayEpoch } from './utils'

export interface TransactionFilterState {
  filters: TransactionFilters
  setFilters: (next: TransactionFilters) => void
  /** The same filters as the queries take them (relative date ranges resolved) */
  resolved: ResolvedTransactionFilters
  /** true ⇔ nothing is filtered out — the view is showing everything */
  isDefault: boolean
}

/**
 * Filter state for one transactions view. Owned by the page rather than the
 * table so the page header can total the very rows the table lists. Per-mount
 * (resets on navigation, like sorting); saved filters are the cross-view reuse
 * mechanism.
 */
export function useTransactionFilters(
  options: { lockedAccount?: boolean } = {}
): TransactionFilterState {
  const [filters, setFilters] = useState<TransactionFilters>(DEFAULT_TRANSACTION_FILTERS)
  const today = startOfTodayEpoch()
  const resolved = useMemo(() => resolveTransactionFilters(filters, today), [filters, today])

  return {
    filters,
    // the main-process handlers also drop accountIds for account-scoped queries;
    // stripping here too keeps the accounts chip from going stale
    setFilters: (next) =>
      setFilters(options.lockedAccount ? { ...next, accountIds: undefined } : next),
    resolved,
    isDefault: JSON.stringify(filters) === JSON.stringify(DEFAULT_TRANSACTION_FILTERS)
  }
}
