import type { Page, Transaction, TransactionSortBy } from '@shared/ipc'
import {
  DEFAULT_TRANSACTION_FILTERS,
  type ResolvedTransactionFilters
} from '@shared/transaction-filters'
import { cn } from '@/lib/utils'
import type { TransactionFilterState } from '@/lib/transaction-filters'
import { FilterBar } from './filter-bar'
import { TransactionsTable } from './transactions-table'

interface FilteredTransactionsTableProps {
  /** From {@link useTransactionFilters} in the page that owns this view */
  filterState: TransactionFilterState
  /** Base query key; resolved filters and sort are appended to it */
  queryKey: readonly unknown[]
  fetchPage: (query: {
    page: number
    pageSize: number
    sortBy: TransactionSortBy
    sortDir: 'asc' | 'desc'
    filters: ResolvedTransactionFilters
  }) => Promise<Page<Transaction>>
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
  lockedAccount,
  showAccount,
  showCreateRow,
  createAccountId,
  className
}: FilteredTransactionsTableProps) {
  const { filters, setFilters, resolved, isDefault } = filterState

  return (
    <div className={cn('flex min-h-0 flex-col gap-3', className)}>
      <div className="px-6">
        <FilterBar
          filters={filters}
          onChange={setFilters}
          defaultFilters={DEFAULT_TRANSACTION_FILTERS}
          hideAccounts={lockedAccount}
        />
      </div>
      <TransactionsTable
        queryKey={[...queryKey, resolved]}
        fetchPage={(query) => fetchPage({ ...query, filters: resolved })}
        showAccount={showAccount}
        showCreateRow={showCreateRow}
        createAccountId={createAccountId}
        emptyMessage={isDefault ? undefined : 'No transactions match the current filters.'}
        className="min-h-0 flex-1"
      />
    </div>
  )
}
