import { Fragment } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Delete02Icon } from '@hugeicons/core-free-icons'
import { groupEnvelopes, type BudgetSummary } from '@shared/budgets'
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
  pace,
  className
}: {
  summary: BudgetSummary
  pace: number | null
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
          {groupEnvelopes(summary.envelopes).map((section) => (
            <Fragment key={section.groupId ?? 'ungrouped'}>
              <TableRow className="bg-muted/40 font-medium hover:bg-muted/40">
                <TableCell>{section.groupName ?? 'Ungrouped'}</TableCell>
                <TableCell className="tabular-nums">
                  <Amount
                    value={section.totals.spent}
                    currency={summary.currency}
                    colored={false}
                  />{' '}
                  <span className="font-normal text-muted-foreground">spent</span>
                </TableCell>
                <TableCell className="tabular-nums">
                  {/* px-2 lines the subtotal up with the fill buttons' text */}
                  <span className="px-2">
                    <Amount
                      value={section.totals.fill}
                      currency={summary.currency}
                      colored={false}
                    />
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <Amount value={section.totals.balance} currency={summary.currency} colored />
                </TableCell>
                <TableCell />
              </TableRow>
              {section.envelopes.map((envelope) => (
                <TableRow key={envelope.categoryId}>
                  <TableCell>
                    <span className="block truncate">{envelope.categoryName}</span>
                  </TableCell>
                  <TableCell>
                    <EnvelopeBar
                      spent={envelope.spent}
                      fill={envelope.fill}
                      currency={summary.currency}
                      pace={pace}
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
            </Fragment>
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
