import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ColumnDef, PaginationState, SortingState } from '@tanstack/react-table'
import type { Transaction } from '@shared/ipc'
import { pageQuery } from '@/lib/utils'
import { Amount } from '@/components/amount'
import { DataTable, DataTableColumnHeader } from '@/components/data-table'

export const Route = createFileRoute('/accounts/$accountId')({
  component: AccountDetailPage
})

function AccountDetailPage() {
  const { accountId } = Route.useParams()
  const id = Number(accountId)

  const accountQuery = useQuery({
    queryKey: ['accounts', 'detail', id],
    queryFn: () => window.api.accounts.get(id)
  })
  const account = accountQuery.data

  const [sorting, setSorting] = useState<SortingState>([{ id: 'posted', desc: true }])
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 })
  const query = {
    accountId: id,
    ...pageQuery(sorting, pagination, { id: 'posted' as const, desc: true })
  }

  const transactionsQuery = useQuery({
    queryKey: ['accounts', id, 'transactions', query],
    queryFn: () => window.api.accounts.transactions(query),
    placeholderData: keepPreviousData
  })

  const columns = useMemo<ColumnDef<Transaction>[]>(
    () => [
      {
        accessorKey: 'posted',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
        cell: ({ row }) => new Date(row.original.posted * 1000).toLocaleDateString()
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
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{account?.name ?? 'Account'}</h2>
        <p className="text-muted-foreground">
          {account && (
            <>
              {account.institutionName ? `${account.institutionName} · ` : ''}
              <Amount value={account.balance} currency={account.currency} />
            </>
          )}
        </p>
      </div>

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
