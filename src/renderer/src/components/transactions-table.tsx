import { useMemo, useState } from 'react'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import type { Page, Transaction, TransactionSortBy } from '@shared/ipc'
import { PAGE_SIZE, nextPageParam, sortQuery } from '@/lib/utils'
import { Amount } from '@/components/amount'
import { DataTable, DataTableColumnHeader } from '@/components/data-table'

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
  className?: string
}

export function TransactionsTable({
  queryKey,
  fetchPage,
  showAccount,
  className
}: TransactionsTableProps) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'posted', desc: true }])
  const sort = sortQuery<TransactionSortBy>(sorting, { id: 'posted', desc: true })

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

  const columns = useMemo<ColumnDef<Transaction>[]>(
    () => [
      {
        accessorKey: 'posted',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
        cell: ({ row }) => new Date(row.original.posted * 1000).toLocaleDateString()
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
        cell: ({ row }) => (
          <>
            {row.original.description}
            {row.original.pending && <span className="text-muted-foreground"> (pending)</span>}
          </>
        )
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
            <Amount value={row.original.amount} currency={row.original.currency} />
          </div>
        )
      }
    ],
    [showAccount]
  )

  return (
    <DataTable
      bleed
      className={className}
      columns={columns}
      data={transactions}
      sorting={sorting}
      onSortingChange={setSorting}
      onLoadMore={transactionsQuery.fetchNextPage}
      hasMore={transactionsQuery.hasNextPage}
      isFetchingMore={transactionsQuery.isFetchingNextPage}
      isLoading={transactionsQuery.isLoading}
      emptyMessage="No transactions yet. Try syncing."
    />
  )
}
