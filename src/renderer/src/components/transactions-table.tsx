import { useMemo, useState } from 'react'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import type { ColumnDef, RowSelectionState, SortingState } from '@tanstack/react-table'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDataTransferHorizontalIcon } from '@hugeicons/core-free-icons'
import type { Page, Transaction, TransactionSortBy } from '@shared/ipc'
import { PAGE_SIZE, cn, nextPageParam, sortQuery } from '@/lib/utils'
import { Amount } from '@/components/amount'
import { CategoryCell } from '@/components/category-cell'
import { DataTable, DataTableColumnHeader } from '@/components/data-table'
import { TransactionsBulkActions } from '@/components/transactions-bulk-actions'
import { Checkbox } from '@/components/ui/checkbox'

interface TransactionsTableProps {
  /** Base query key; the current sort is appended to it */
  queryKey: readonly unknown[]
  fetchPage: (query: {
    page: number
    pageSize: number
    sortBy: TransactionSortBy
    sortDir: 'asc' | 'desc'
  }) => Promise<Page<Transaction>>
  /** Show the account column (for views spanning multiple accounts) */
  showAccount?: boolean
  emptyMessage?: string
  className?: string
}

export function TransactionsTable({
  queryKey,
  fetchPage,
  showAccount,
  emptyMessage = 'No transactions yet. Try syncing.',
  className
}: TransactionsTableProps) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'date', desc: true }])
  const sort = sortQuery<TransactionSortBy>(sorting, { id: 'date', desc: true })
  // keyed by transaction id, so selection survives refetches and filter changes
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})

  const transactionsQuery = useInfiniteQuery({
    queryKey: [...queryKey, sort],
    queryFn: ({ pageParam }) => fetchPage({ page: pageParam, pageSize: PAGE_SIZE, ...sort }),
    initialPageParam: 0,
    getNextPageParam: nextPageParam,
    placeholderData: keepPreviousData
  })
  const transactions = useMemo(
    () => transactionsQuery.data?.pages.flatMap((page) => page.rows) ?? [],
    [transactionsQuery.data]
  )

  // bulk actions apply to the selection ∩ the rows the current filters show,
  // so selected rows that a filter hides are never acted on
  const selectedTransactions = useMemo(
    () => transactions.filter((transaction) => rowSelection[String(transaction.id)]),
    [transactions, rowSelection]
  )

  const columns = useMemo<ColumnDef<Transaction>[]>(
    () => [
      {
        id: 'select',
        enableSorting: false,
        // the base cell strips right padding next to checkboxes; restore breathing room
        meta: { className: 'pr-4!' },
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllRowsSelected() || (table.getIsSomeRowsSelected() && 'indeterminate')
            }
            onCheckedChange={(value) => table.toggleAllRowsSelected(!!value)}
            aria-label="Select all"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            disabled={!row.getCanSelect()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            onClick={(event) => event.stopPropagation()}
            aria-label="Select row"
          />
        )
      },
      {
        accessorKey: 'date',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
        cell: ({ row }) =>
          row.original.date ? format(new Date(row.original.date * 1000), 'MMM d, yyyy') : '—'
      },
      ...(showAccount
        ? [
            {
              accessorKey: 'accountName',
              header: ({ column }) => <DataTableColumnHeader column={column} title="Account" />
            } satisfies ColumnDef<Transaction>
          ]
        : []),
      {
        accessorKey: 'description',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Description" />,
        // greedy column: soaks up remaining width and truncates instead of overflowing
        meta: { className: 'w-full max-w-0' },
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-1.5" title={row.original.description}>
            {row.original.isTransfer && (
              <span title="Transfer" className="flex shrink-0">
                <HugeiconsIcon
                  icon={ArrowDataTransferHorizontalIcon}
                  size={14}
                  className="text-muted-foreground"
                />
              </span>
            )}
            <span className="truncate">
              {row.original.description}
              {row.original.pending && <span className="text-muted-foreground"> (pending)</span>}
            </span>
          </div>
        )
      },
      {
        id: 'category',
        header: 'Category',
        enableSorting: false,
        cell: ({ row }) => <CategoryCell transaction={row.original} />
      },
      {
        accessorKey: 'amount',
        header: ({ column }) => (
          <div className="text-right">
            <DataTableColumnHeader column={column} title="Amount" className="-mr-2 ml-0" />
          </div>
        ),
        cell: ({ row }) => (
          <div className="text-right">
            <Amount
              value={row.original.amount}
              currency={row.original.currency}
              colored={!row.original.isTransfer}
              className={cn(row.original.isTransfer && 'text-muted-foreground')}
            />
          </div>
        )
      }
    ],
    [showAccount]
  )

  return (
    <div className={cn('relative flex min-h-0 flex-col', className)}>
      <DataTable
        bleed
        className="min-h-0 flex-1"
        columns={columns}
        data={transactions}
        sorting={sorting}
        onSortingChange={setSorting}
        onLoadMore={transactionsQuery.fetchNextPage}
        hasMore={transactionsQuery.hasNextPage}
        isFetchingMore={transactionsQuery.isFetchingNextPage}
        isLoading={transactionsQuery.isLoading}
        emptyMessage={emptyMessage}
        // transfers are neither income nor expense, so dim the whole row to de-emphasize them
        rowClassName={(transaction) => transaction.isTransfer && 'opacity-60'}
        // pending rows can't be selected: sync drops and re-inserts them, so bulk edits would be lost
        enableRowSelection={(row) => !row.original.pending}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        getRowId={(transaction) => String(transaction.id)}
      />
      <TransactionsBulkActions
        transactions={selectedTransactions}
        onClearSelection={() => setRowSelection({})}
      />
    </div>
  )
}
