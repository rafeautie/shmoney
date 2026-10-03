import { GOAL_STATUS_LABELS, GOAL_STATUS_TONE, type GoalSummary } from '@shared/goals'
import { Amount } from '@/components/amount'
import { PaceBar } from '@/components/pace-bar'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

// Exported so the Goals page and the report widget draw the same bar.

/** Saved against target, with `expectedByNow` as the pace. */
export function GoalMeter({ goal }: { goal: GoalSummary }) {
  const toPct = (amount: number): number =>
    goal.targetAmount > 0 ? (amount / goal.targetAmount) * 100 : 0
  return (
    <PaceBar
      value={toPct(goal.progress)}
      pace={
        goal.expectedByNow === null || goal.targetAmount === 0 ? null : toPct(goal.expectedByNow)
      }
      offPace="under"
      destructive={GOAL_STATUS_TONE[goal.status] === 'destructive'}
      label="Saved"
    />
  )
}

/** The meter with an "X of Y" caption, for rows that have no other progress line. */
export function GoalBar({ goal, className }: { goal: GoalSummary; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <GoalMeter goal={goal} />
      <div className="text-xs text-muted-foreground">
        <Amount value={goal.progress} currency={goal.currency} colored={false} /> of{' '}
        <Amount value={goal.targetAmount} currency={goal.currency} colored={false} />
      </div>
    </div>
  )
}

/** Nothing to badge on an undated goal: there is no pace to be on or off. */
export function GoalStatusBadge({ status }: { status: GoalSummary['status'] }) {
  if (status === 'no-date') return null
  return (
    <Badge
      variant={GOAL_STATUS_TONE[status] === 'destructive' ? 'destructive' : 'secondary'}
      className="shrink-0"
    >
      {GOAL_STATUS_LABELS[status]}
    </Badge>
  )
}

/** Compact read-only row, the shape a report widget lists. */
export function GoalProgressRow({ goal }: { goal: GoalSummary }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm">{goal.name}</span>
        <GoalStatusBadge status={goal.status} />
      </div>
      <GoalBar goal={goal} />
    </div>
  )
}
