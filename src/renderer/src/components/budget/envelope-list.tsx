import { HugeiconsIcon } from '@hugeicons/react'
import { Delete02Icon } from '@hugeicons/core-free-icons'
import type { BudgetSummary } from '@shared/budgets'
import { Amount } from '@/components/amount'
import { EditableFill } from '@/components/budget/envelope-fields'
import { BalanceBadge, EnvelopeBar } from '@/components/budget/envelope-progress'
import { useRemoveEnvelope } from '@/components/budget/use-envelopes'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn, TABLE_BLEED } from '@/lib/utils'

export function EnvelopeList({
  summary,
  className
}: {
  summary: BudgetSummary
  className?: string
}) {
  const remove = useRemoveEnvelope()

  return (
    // full-bleed like the transactions table: rows and hover reach the app
    // edges, while TABLE_BLEED keeps edge-cell content aligned with p-6 chrome
    <ScrollArea className={cn('min-h-0 flex-1', className)}>
      <table className={cn('w-full caption-bottom text-xs', TABLE_BLEED)}>
        {/* box-shadows stand in for the header's borders, which collapse drops while sticky */}
        <TableHeader className="sticky top-0 z-10 bg-background shadow-[inset_0_1px_0_0_var(--border),inset_0_-1px_0_0_var(--border)] [&_tr]:border-b-0">
          <TableRow>
            <TableHead>Category</TableHead>
            <TableHead className="w-64">This month</TableHead>
            <TableHead className="w-32">Monthly fill</TableHead>
            <TableHead className="w-28 text-right">Available</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {summary.envelopes.map((envelope) => (
            <TableRow key={envelope.categoryId}>
              <TableCell>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate">{envelope.categoryName}</span>
                  {envelope.groupName && (
                    <span className="truncate text-xs text-muted-foreground">
                      {envelope.groupName}
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <EnvelopeBar
                  spent={envelope.spent}
                  fill={envelope.fill}
                  currency={summary.currency}
                />
              </TableCell>
              <TableCell>
                <EditableFill
                  envelope={envelope}
                  month={summary.month}
                  currency={summary.currency}
                />
              </TableCell>
              <TableCell className="text-right">
                <BalanceBadge balance={envelope.balance} currency={summary.currency} />
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => remove.mutate(envelope)}
                  disabled={remove.isPending}
                >
                  <HugeiconsIcon icon={Delete02Icon} size={14} />
                  <span className="sr-only">Remove envelope</span>
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {summary.unbudgetedSpent > 0 && (
            <TableRow className="hover:bg-transparent">
              <TableCell className="text-muted-foreground">Unbudgeted spending</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                <Amount
                  value={summary.unbudgetedSpent}
                  currency={summary.currency}
                  colored={false}
                />
              </TableCell>
              <TableCell />
              <TableCell />
              <TableCell />
            </TableRow>
          )}
        </TableBody>
      </table>
    </ScrollArea>
  )
}
