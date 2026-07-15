import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { Delete02Icon } from '@hugeicons/core-free-icons'
import type { BudgetSummary, EnvelopeSummary } from '@shared/budgets'
import { Amount } from '@/components/amount'
import { BalanceBadge, EnvelopeBar } from '@/components/budget/envelope-progress'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { parseDollars } from '@/lib/utils'

export function EnvelopeList({ summary }: { summary: BudgetSummary }) {
  const queryClient = useQueryClient()
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['budget-summary'] })
    queryClient.invalidateQueries({ queryKey: ['actionLog'] })
  }

  const setFill = useMutation({
    mutationFn: (input: { categoryId: number; month: string; amount: number }) =>
      window.api.budgets.setFill(input),
    onSettled: invalidate
  })

  const remove = useMutation({
    mutationFn: (envelope: EnvelopeSummary) =>
      window.api.budgets.remove({ categoryId: envelope.categoryId }).then((result) => ({
        envelope,
        actionId: result.actionId
      })),
    onSuccess: ({ envelope, actionId }) => {
      if (actionId === null) return
      // the removal is an action-log entry, so the toast's Undo replays the
      // same entry Ctrl+Z would — one undo path, no separate restore call
      toast(`Removed the ${envelope.categoryName} envelope`, {
        action: {
          label: 'Undo',
          onClick: () => {
            window.api.actionLog
              .undoEntry(actionId)
              .then(invalidate)
              .catch(() => {})
          }
        }
      })
    },
    onSettled: invalidate
  })

  return (
    <Table>
      <TableHeader>
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
              <FillCell
                envelope={envelope}
                currency={summary.currency}
                onCommit={(amount) =>
                  setFill.mutate({
                    categoryId: envelope.categoryId,
                    month: summary.month,
                    amount
                  })
                }
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
              <Amount value={summary.unbudgetedSpent} currency={summary.currency} colored={false} />
            </TableCell>
            <TableCell />
            <TableCell />
            <TableCell />
          </TableRow>
        )}
      </TableBody>
    </Table>
  )
}

// click-to-edit fill amount: an edit made while viewing month M re-anchors the
// fill from M forward and leaves earlier months' history untouched
function FillCell({
  envelope,
  currency,
  onCommit
}: {
  envelope: EnvelopeSummary
  currency: string
  onCommit: (amount: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  if (!editing) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 font-normal tabular-nums"
        onClick={() => {
          setDraft((envelope.fill / 1000).toString())
          setEditing(true)
        }}
      >
        <Amount value={envelope.fill} currency={currency} colored={false} />
      </Button>
    )
  }

  function commit() {
    const amount = parseDollars(draft)
    if (amount !== null && amount !== envelope.fill) onCommit(amount)
    setEditing(false)
  }

  return (
    <Input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setEditing(false)
      }}
      className="h-7 w-24"
    />
  )
}
