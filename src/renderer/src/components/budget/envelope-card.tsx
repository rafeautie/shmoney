import type { EnvelopeSummary } from '@shared/budgets'
import { EditableFill, EnvelopeActionsMenu } from '@/components/budget/envelope-fields'
import { Amount } from '@/components/amount'
import { BalanceBadge, EnvelopeMeter } from '@/components/budget/envelope-progress'
import { Card, CardContent } from '@/components/ui/card'

/** One envelope: title and balance, the bar, then one line with the editable fill. */
export function EnvelopeCard({
  envelope,
  month,
  currency,
  pace
}: {
  envelope: EnvelopeSummary
  month: string
  currency: string
  pace: number | null
}) {
  return (
    <Card className="gap-0 py-4">
      <CardContent className="space-y-3 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="min-w-0 truncate text-base font-semibold tracking-tight">
              {envelope.categoryName}
            </span>
            <BalanceBadge balance={envelope.balance} currency={currency} />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <EnvelopeActionsMenu envelope={envelope} />
          </div>
        </div>

        <EnvelopeMeter spent={envelope.spent} fill={envelope.fill} pace={pace} />

        {/* min-h holds the line steady while the fill swaps to its input */}
        <div className="flex min-h-8 items-center text-xs text-muted-foreground">
          <SpendStatus envelope={envelope} currency={currency} />
          <EditableFill envelope={envelope} month={month} currency={currency} />
        </div>
      </CardContent>
    </Card>
  )
}

function SpendStatus({ envelope, currency }: { envelope: EnvelopeSummary; currency: string }) {
  const { spent, fill } = envelope
  if (fill === 0)
    return (
      <span>
        <Amount value={spent} currency={currency} colored={false} /> spent of
      </span>
    )
  if (spent > fill)
    return (
      <span>
        <span className="font-medium text-destructive">
          <Amount value={spent - fill} currency={currency} colored={false} /> over
        </span>{' '}
        a fill of
      </span>
    )
  return (
    <span>
      <span className="font-medium text-foreground">
        <Amount value={fill - spent} currency={currency} colored={false} />
      </span>{' '}
      left of
    </span>
  )
}
