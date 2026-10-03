import type { EnvelopeSummary } from '@shared/budgets'
import { Amount } from '@/components/amount'
import { PaceBar } from '@/components/pace-bar'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/** Spent against fill, with the month's elapsed share as the pace in the current month. */
export function EnvelopeMeter({
  spent,
  fill,
  pace = null
}: {
  spent: number
  fill: number
  pace?: number | null
}) {
  const pct = fill > 0 ? (spent / fill) * 100 : spent > 0 ? 100 : 0
  return (
    <PaceBar
      value={pct}
      pace={pace === null ? null : pace * 100}
      offPace="over"
      destructive={spent > fill}
      label="Spent"
    />
  )
}

/** The meter with an "X of Y" caption, for rows that have no other spend line. */
export function EnvelopeBar({
  spent,
  fill,
  currency,
  pace = null,
  className
}: {
  spent: number
  fill: number
  currency: string
  pace?: number | null
  className?: string
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <EnvelopeMeter spent={spent} fill={fill} pace={pace} />
      <div className="text-xs text-muted-foreground">
        <Amount value={spent} currency={currency} colored={false} /> of{' '}
        <Amount value={fill} currency={currency} colored={false} />
      </div>
    </div>
  )
}

/** Envelope rollover balance; negative balances carry forward and show destructive. */
export function BalanceBadge({ balance, currency }: { balance: number; currency: string }) {
  return (
    <Badge variant={balance < 0 ? 'destructive' : 'secondary'}>
      <Amount value={balance} currency={currency} colored={false} />
    </Badge>
  )
}

/** Compact read-only envelope row, shared by the Budget page and the report widget. */
export function EnvelopeProgressRow({
  envelope,
  currency
}: {
  envelope: EnvelopeSummary
  currency: string
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm">{envelope.categoryName}</span>
          {envelope.groupName && (
            <span className="truncate text-xs text-muted-foreground">{envelope.groupName}</span>
          )}
        </div>
        <EnvelopeBar spent={envelope.spent} fill={envelope.fill} currency={currency} />
      </div>
      <BalanceBadge balance={envelope.balance} currency={currency} />
    </div>
  )
}
