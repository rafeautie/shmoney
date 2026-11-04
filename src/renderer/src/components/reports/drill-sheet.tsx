import { useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowUpRight01Icon } from '@hugeicons/core-free-icons'
import type { TransactionFilters } from '@shared/transaction-filters'
import { useTransactionFilters } from '@/lib/transaction-filters'
import { DrillContext } from './drill-context'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { FilteredTransactionsTable } from '@/components/transactions/filtered-transactions-table'

/**
 * A report's drill-down: the transactions behind a clicked mark open beside the
 * report instead of replacing it, editable in place like the All Transactions
 * tab, with a way through to that tab for anything bigger.
 */
export function DrillSheetHost({ children }: { children: ReactNode }) {
  // a new drill gets a fresh panel: its filters seed the panel's own filter bar
  const [drill, setDrill] = useState<{ filters: TransactionFilters; key: number } | null>(null)
  const [open, setOpen] = useState(false)
  return (
    <DrillContext.Provider
      value={(filters) => {
        setDrill((prev) => ({ filters, key: (prev?.key ?? 0) + 1 }))
        setOpen(true)
      }}
    >
      {children}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-[min(64rem,92vw)] gap-0 data-[side=right]:sm:max-w-none">
          {drill && (
            <DrillPanel key={drill.key} initial={drill.filters} onClose={() => setOpen(false)} />
          )}
        </SheetContent>
      </Sheet>
    </DrillContext.Provider>
  )
}

function DrillPanel({ initial, onClose }: { initial: TransactionFilters; onClose: () => void }) {
  const navigate = useNavigate()
  const filterState = useTransactionFilters({ initial })
  return (
    <>
      <SheetHeader className="flex-row items-center gap-3 pr-14">
        <div className="min-w-0 flex-1 space-y-1">
          <SheetTitle className="text-base font-semibold">Transactions</SheetTitle>
          <SheetDescription>
            The rows behind what you clicked. Edits apply right away.
          </SheetDescription>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            onClose()
            void navigate({
              to: '/accounts',
              search: { tab: 'transactions', filters: filterState.filters }
            })
          }}
        >
          Open in Transactions
          <HugeiconsIcon icon={ArrowUpRight01Icon} className="size-4" />
        </Button>
      </SheetHeader>
      <FilteredTransactionsTable
        filterState={filterState}
        queryKey={['transactions']}
        fetchPage={(query) => window.api.transactions.list(query)}
        showAccount
        className="min-h-0 flex-1 pb-4 [--spacing-page:--spacing(5)]"
      />
    </>
  )
}
