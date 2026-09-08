import { GOAL_STATUS_LABELS, GOAL_STATUS_TONE, type GoalSummary } from '@shared/goals'
import { Amount } from '@/components/amount'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

// Read-only goal display, exported from the start so the Goals page and the
// report widget draw the same bar rather than each growing its own — the way
// envelope-progress.tsx already serves the Budget page and the budget widget.

/**
 * Saved against target, with the pace line drawn as a thin tick at
 * `expectedByNow`. Colour comes from the shared status tone, never from a local
 * comparison, so a goal that is red here is red everywhere.
 */
export function GoalBar({ goal, className }: { goal: GoalSummary; className?: string }) {
  const pct = goal.targetAmount > 0 ? (goal.progress / goal.targetAmount) * 100 : 0
  const behind = GOAL_STATUS_TONE[goal.status] === 'destructive'
  const tick =
    goal.expectedByNow !== null && goal.targetAmount > 0
      ? Math.min(100, Math.max(0, (goal.expectedByNow / goal.targetAmount) * 100))
      : null

  return (
    <div className={cn('space-y-1', className)}>
      <div className="relative">
        <Progress
          value={Math.min(100, Math.max(0, pct))}
          className={cn(behind && '[&_[data-slot=progress-indicator]]:bg-destructive')}
        />
        {tick !== null && (
          <span
            aria-hidden
            className="absolute top-0 h-1 w-px bg-foreground/50"
            style={{ left: `${tick}%` }}
          />
        )}
      </div>
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
    <Badge variant={GOAL_STATUS_TONE[status] === 'destructive' ? 'destructive' : 'secondary'}>
      {GOAL_STATUS_LABELS[status]}
    </Badge>
  )
}

/** Compact read-only row: name, bar, status. The shape a report widget lists. */
export function GoalProgressRow({ goal }: { goal: GoalSummary }) {
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <span className="truncate text-sm">{goal.name}</span>
        <GoalBar goal={goal} />
      </div>
      <GoalStatusBadge status={goal.status} />
    </div>
  )
}
