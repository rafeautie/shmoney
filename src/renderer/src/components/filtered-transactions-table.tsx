import { useMemo, useState } from 'react'
import type { Page, Transaction, TransactionSortBy } from '@shared/ipc'
import {
  DEFAULT_TRANSACTION_FILTERS,
  resolveTransactionFilters,
  type ResolvedTransactionFilters,
  type TransactionFilters
} from '@shared/transaction-filters'
import { cn, startOfTodayEpoch } from '@/lib/utils'
import { FilterBar } from '@/components/filter-bar'
import { TransactionsTable } from '@/components/transactions-table'

interface FilteredTransactionsTableProps {
  /** Base query key; resolved filters and sort are appended to it */
  queryKey: readonly unknown[]
  fetchPage: (query: {
    page: number
    pageSize: number
    sortBy: TransactionSortBy
    sortDir: 'asc' | 'desc'
    filters: ResolvedTransactionFilters
  }) => Promise<Page<Transaction>>
  /** per-account pages: hides the accounts control and strips accountIds from
   * loaded saved filters — the page's account scope always wins */
  lockedAccount?: boolean
  showAccount?: boolean
  className?: string
}

/** TransactionsTable with a filter bar. Filter state is per-mount (resets on
 * navigation, like sorting); saved filters are the cross-view reuse mechanism. */
export function FilteredTransactionsTable({
  queryKey,
  fetchPage,
  lockedAccount,
  showAccount,
  className
}: FilteredTransactionsTableProps) {
  const [filters, setFilters] = useState<TransactionFilters>(DEFAULT_TRANSACTION_FILTERS)

  function handleChange(next: TransactionFilters) {
    // the main-process handler also drops accountIds for account-scoped
    // queries; stripping here too keeps the accounts chip from going stale
    setFilters(lockedAccount ? { ...next, accountIds: undefined } : next)
  }

  const today = startOfTodayEpoch()
  const resolved = useMemo(() => resolveTransactionFilters(filters, today), [filters, today])
  const isDefault = JSON.stringify(filters) === JSON.stringify(DEFAULT_TRANSACTION_FILTERS)

  return (
    <div className={cn('flex min-h-0 flex-col gap-3', className)}>
      <div className="px-6">
        <FilterBar
          filters={filters}
          onChange={handleChange}
          defaultFilters={DEFAULT_TRANSACTION_FILTERS}
          hideAccounts={lockedAccount}
        />
      </div>
      <TransactionsTable
        queryKey={[...queryKey, resolved]}
        fetchPage={(query) => fetchPage({ ...query, filters: resolved })}
        showAccount={showAccount}
        emptyMessage={isDefault ? undefined : 'No transactions match the current filters.'}
        className="min-h-0 flex-1"
      />
    </div>
  )
}
