import { useState } from 'react'
import type { SortingState } from '@tanstack/react-table'
import type { Page, PageCursor, Transaction, TransactionSortBy } from '@shared/ipc'
import {
  DEFAULT_TRANSACTION_FILTERS,
  type ResolvedTransactionFilters
} from '@shared/transaction-filters'
import { cn, sortQuery } from '@/lib/utils'
import { DEFAULT_TRANSACTION_SORTING, type TransactionFilterState } from '@/lib/transaction-filters'
import { ExportCsvButton } from './export-csv-button'
import { FilterBar } from './filter-bar'
import { TransactionsTable } from './transactions-table'

interface FilteredTransactionsTableProps {
  /** From {@link useTransactionFilters} in the page that owns this view */
  filterState: TransactionFilterState
  /** Base query key; resolved filters and sort are appended to it */
  queryKey: readonly unknown[]
  fetchPage: (query: {
    page: PageCursor
    pageSize: number
    sortBy: TransactionSortBy
    sortDir: 'asc' | 'desc'
    filters: ResolvedTransactionFilters
  }) => Promise<Page<Transaction>>
  /** per-account pages: the page's account, which the CSV export scopes to */
  accountId?: number
  /** per-account pages: hides the accounts control (the page's account scope always wins) */
  lockedAccount?: boolean
  showAccount?: boolean
  /** Pin the inline entry row at the top of the table */
  showCreateRow?: boolean
  /** Fixed account for the entry row; omitted = pick from an account cell */
  createAccountId?: number
  className?: string
}

/** TransactionsTable with a filter bar over it. */
export function FilteredTransactionsTable({
  filterState,
  queryKey,
  fetchPage,
  accountId,
  lockedAccount,
  showAccount,
  showCreateRow,
  createAccountId,
  className
}: FilteredTransactionsTableProps) {
  const { filters, setFilters, resolved, isDefault } = filterState
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_TRANSACTION_SORTING)
  const sort = sortQuery<TransactionSortBy>(sorting, DEFAULT_TRANSACTION_SORTING[0])

  return (
    <div className={cn('flex min-h-0 flex-col gap-3', className)}>
      <div className="flex items-start gap-2 px-6">
        <div className="min-w-0 flex-1">
          <FilterBar
            filters={filters}
            onChange={setFilters}
            defaultFilters={DEFAULT_TRANSACTION_FILTERS}
            hideAccounts={lockedAccount}
          />
        </div>
        <ExportCsvButton filters={resolved} accountId={accountId} {...sort} />
      </div>
      <TransactionsTable
        queryKey={[...queryKey, resolved]}
        fetchPage={(query) => fetchPage({ ...query, filters: resolved })}
        filters={resolved}
        sorting={sorting}
        onSortingChange={setSorting}
        showAccount={showAccount}
        showCreateRow={showCreateRow}
        createAccountId={createAccountId}
        emptyMessage={isDefault ? undefined : 'No transactions match the current filters.'}
        className="min-h-0 flex-1"
      />
    </div>
  )
}
