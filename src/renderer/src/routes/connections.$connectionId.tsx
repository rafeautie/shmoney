import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef, PaginationState, SortingState } from '@tanstack/react-table'
import type { Transaction } from '@shared/ipc'
import { Button } from '@/components/ui/button'
import { ipcErrorMessage, pageQuery } from '@/lib/utils'
import { Amount } from '@/components/amount'
import { DataTable, DataTableColumnHeader } from '@/components/data-table'

export const Route = createFileRoute('/connections/$connectionId')({
  component: ConnectionDetailPage
})

function ConnectionDetailPage() {
  const { connectionId } = Route.useParams()
  const id = Number(connectionId)
  const queryClient = useQueryClient()

  const connectionQuery = useQuery({
    queryKey: ['connections', 'detail', id],
    queryFn: () => window.api.connections.get(id)
  })
  const connection = connectionQuery.data

  const [sorting, setSorting] = useState<SortingState>([{ id: 'posted', desc: true }])
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 })
  const query = {
    connectionId: id,
    ...pageQuery(sorting, pagination, { id: 'posted' as const, desc: true })
  }

  const transactionsQuery = useQuery({
    queryKey: ['connections', id, 'transactions', query],
    queryFn: () => window.api.connections.transactions(query),
    placeholderData: keepPreviousData
  })

  const syncConnection = useMutation({
    mutationFn: () => window.api.connections.sync(id),
    onSettled: () => queryClient.invalidateQueries()
  })

  const columns = useMemo<ColumnDef<Transaction>[]>(
    () => [
      {
        accessorKey: 'posted',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
        cell: ({ row }) => new Date(row.original.posted * 1000).toLocaleDateString()
      },
      {
        accessorKey: 'accountName',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Account" />
      },
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
    []
  )

  return (
    <div className="flex h-full flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            {connection?.name ?? 'Connection'}
          </h2>
          <p className="text-muted-foreground">
            {connection?.lastSyncedAt
              ? `Last synced ${new Date(connection.lastSyncedAt * 1000).toLocaleString()}`
              : 'Never synced'}
          </p>
        </div>
        <Button disabled={syncConnection.isPending} onClick={() => syncConnection.mutate()}>
          {syncConnection.isPending ? 'Syncing...' : 'Sync'}
        </Button>
      </div>

      {syncConnection.isError && (
        <p className="text-sm text-destructive">
          Sync failed: {ipcErrorMessage(syncConnection.error)}
        </p>
      )}

      <DataTable
        className="min-h-0 flex-1"
        columns={columns}
        data={transactionsQuery.data?.rows ?? []}
        total={transactionsQuery.data?.total ?? 0}
        sorting={sorting}
        onSortingChange={setSorting}
        pagination={pagination}
        onPaginationChange={setPagination}
        isLoading={transactionsQuery.isLoading}
        emptyMessage="No transactions yet. Try syncing."
      />
    </div>
  )
}
