import { useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { Column, ColumnDef, SortingState } from '@tanstack/react-table'
import type { Holding } from '@shared/ipc'
import { cn } from '@/lib/utils'
import { Amount, Shares } from '@/components/amount'
import { DataTable, DataTableColumnHeader } from '@/components/data-table'

interface HoldingsTableProps {
  accountId: number
  /** account currency — holding market values are denominated in it, not holding.currency */
  currency: string
  className?: string
}

function gain(h: Holding): number {
  return h.marketValue - h.costBasis
}

/** The account's investment positions, styled and sorted like the transactions
 * table. The list is fetched whole (no paging), so sorting is done client-side. */
export function HoldingsTable({ accountId, currency, className }: HoldingsTableProps) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'marketValue', desc: true }])

  const holdingsQuery = useQuery({
    queryKey: ['accounts', accountId, 'holdings'],
    queryFn: () => window.api.accounts.holdings(accountId),
    placeholderData: keepPreviousData
  })
  const holdings = useMemo(() => holdingsQuery.data ?? [], [holdingsQuery.data])

  // hide cost-basis/gain entirely when nothing in this account reports a cost
  // basis (common for crypto, where it's 0.00 across the board)
  const showCost = holdings.some((h) => h.costBasis > 0)

  const sorted = useMemo(() => {
    const [s] = sorting
    if (!s) return holdings
    const dir = s.desc ? -1 : 1
    return [...holdings].sort((a, b) => {
      switch (s.id) {
        case 'symbol':
          return dir * a.symbol.localeCompare(b.symbol)
        case 'description':
          return dir * a.description.localeCompare(b.description)
        case 'shares':
          return dir * (Number(a.shares) - Number(b.shares))
        case 'costBasis':
          return dir * (a.costBasis - b.costBasis)
        case 'gain':
          return dir * (gain(a) - gain(b))
        default:
          return dir * (a.marketValue - b.marketValue)
      }
    })
  }, [holdings, sorting])

  const columns = useMemo<ColumnDef<Holding>[]>(() => {
    const rightHeader = (title: string) => (props: { column: Column<Holding, unknown> }) => (
      <div className="text-right">
        <DataTableColumnHeader column={props.column} title={title} className="-mr-2 ml-0" />
      </div>
    )
    return [
      {
        accessorKey: 'symbol',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Symbol" />,
        cell: ({ row }) => <span className="font-medium">{row.original.symbol}</span>
      },
      {
        accessorKey: 'description',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
        // greedy column: soaks up remaining width and truncates instead of overflowing
        meta: { className: 'w-full max-w-0' },
        cell: ({ row }) => (
          <span className="block truncate text-muted-foreground" title={row.original.description}>
            {row.original.description}
          </span>
        )
      },
      {
        accessorKey: 'shares',
        header: rightHeader('Shares'),
        cell: ({ row }) => (
          <div className="text-right">
            <Shares value={row.original.shares} />
          </div>
        )
      },
      {
        accessorKey: 'marketValue',
        header: rightHeader('Market value'),
        cell: ({ row }) => (
          <div className="text-right">
            <Amount value={row.original.marketValue} currency={currency} colored={false} />
          </div>
        )
      },
      ...(showCost
        ? [
            {
              accessorKey: 'costBasis',
              header: rightHeader('Cost basis'),
              cell: ({ row }) => (
                <div className="text-right">
                  {row.original.costBasis > 0 ? (
                    <Amount value={row.original.costBasis} currency={currency} colored={false} />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </div>
              )
            } satisfies ColumnDef<Holding>,
            {
              id: 'gain',
              accessorFn: gain,
              header: rightHeader('Gain'),
              cell: ({ row }) => {
                const h = row.original
                if (h.costBasis <= 0) {
                  return <div className="text-right text-muted-foreground">—</div>
                }
                const pct = (gain(h) / h.costBasis) * 100
                return (
                  <div className="text-right">
                    <span className="inline-flex items-baseline justify-end gap-1.5">
                      <Amount value={gain(h)} currency={currency} />
                      <span className="text-xs text-muted-foreground">
                        {pct >= 0 ? '+' : ''}
                        {pct.toFixed(1)}%
                      </span>
                    </span>
                  </div>
                )
              }
            } satisfies ColumnDef<Holding>
          ]
        : [])
    ]
  }, [currency, showCost])

  return (
    <DataTable
      bleed
      className={cn('min-h-0 flex-1', className)}
      columns={columns}
      data={sorted}
      sorting={sorting}
      onSortingChange={setSorting}
      isLoading={holdingsQuery.isLoading}
      emptyMessage="No holdings."
      getRowId={(holding) => String(holding.id)}
    />
  )
}
