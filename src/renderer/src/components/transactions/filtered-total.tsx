import { useQuery } from '@tanstack/react-query'
import { Amount } from '@/components/amount'
import type { TransactionFilterState } from '@/lib/transaction-filters'

interface FilteredTotalProps {
  /** The same state driving the table below, so the two always agree */
  filterState: TransactionFilterState
  /** Account-scoped views; omitted = every account */
  accountId?: number
}

/**
 * Net total of every transaction the current filters match — all pages, not
 * just the loaded ones. Sits beside the account balance / net worth rather than
 * replacing it, and shows up only once the view is actually filtered: unfiltered
 * it would either restate that figure or, on the all-transactions view, differ
 * from it confusingly (balances include activity older than the synced window).
 */
export function FilteredTotal({ filterState, accountId }: FilteredTotalProps) {
  const { resolved, isDefault } = filterState

  const sumsQuery = useQuery({
    queryKey: ['transactions', 'sums', accountId ?? 'all', resolved],
    queryFn: () => window.api.transactions.sums({ filters: resolved, accountId }),
    enabled: !isDefault
  })

  const totals = sumsQuery.data ?? []
  // no rows matched (or the filters are at their defaults): nothing to total
  if (isDefault || totals.length === 0) return null

  return (
    <div>
      <p className="text-sm text-muted-foreground">Filtered total</p>
      <div className="flex flex-col items-start text-2xl font-semibold tracking-tight">
        {totals.map(({ currency, total }) => (
          <Amount key={currency} value={total} currency={currency} />
        ))}
      </div>
    </div>
  )
}
