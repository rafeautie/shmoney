import type { EnvelopeSummary } from '@shared/budgets'
import { Amount } from '@/components/amount'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

/**
 * Spent-vs-fill bar. With a `pace` (elapsed share of the current month) it
 * draws a tick there, and spending past the tick is hatched so being ahead of
 * pace reads without color; overspending turns the bar destructive.
 */
export function EnvelopeMeter({
  spent,
  fill,
  pace = null
}: {
  spent: number
  fill: number
  pace?: number | null
}) {
  const over = spent > fill
  const pct = fill > 0 ? Math.min(100, (spent / fill) * 100) : spent > 0 ? 100 : 0
  const pacePct = pace === null ? null : pace * 100
  const aheadOfPace = pacePct !== null && pct > pacePct
  return (
    <div className="relative">
      <Progress
        value={pct}
        aria-label={aheadOfPace ? 'Spent, ahead of pace' : 'Spent'}
        className={cn(
          '[&_[data-slot=progress-track]]:h-2',
          over && '[&_[data-slot=progress-indicator]]:bg-destructive'
        )}
      />
      {aheadOfPace && (
        <div aria-hidden className="absolute inset-0 overflow-hidden rounded-md">
          <div
            className="absolute inset-y-0 bg-[repeating-linear-gradient(-45deg,transparent_0_2px,var(--background)_2px_4px)] opacity-70"
            style={{ left: `${pacePct}%`, width: `${pct - pacePct}%` }}
          />
        </div>
      )}
      {pacePct !== null && (
        <div
          aria-hidden
          title={`${Math.round(pacePct)}% of the month has passed`}
          className="absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded-full bg-foreground shadow-[0_0_0_1px_var(--background)]"
          style={{ left: `${pacePct}%` }}
        />
      )}
    </div>
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
