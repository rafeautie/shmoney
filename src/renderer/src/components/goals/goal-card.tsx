import type { GoalSummary } from '@shared/goals'
import { Amount } from '@/components/amount'
import { GoalMeter, GoalStatusBadge } from '@/components/goals/goal-progress'
import {
  GoalAccounts,
  GoalActionsMenu,
  GoalTarget,
  GoalTargetDate
} from '@/components/goals/goal-fields'
import { modeLabel, paceLine } from '@/components/goals/goal-labels'
import { Card, CardContent } from '@/components/ui/card'

/** One goal; its actions menu opens the Edit dialog for every field. */
export function GoalCard({ goal }: { goal: GoalSummary }) {
  return (
    <Card className="gap-0 py-4">
      {/* Flex, not space-y: an open popover appends out-of-flow markers after its
          trigger, and space-y's margin would land on the trigger once it is no
          longer the last child, growing the card as it opens. */}
      <CardContent className="flex flex-col gap-3 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate text-base font-semibold tracking-tight">
                {goal.name}
              </span>
              <GoalStatusBadge status={goal.status} />
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{modeLabel(goal)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <GoalActionsMenu goal={goal} />
          </div>
        </div>

        <GoalMeter goal={goal} />

        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            <Amount value={goal.progress} currency={goal.currency} colored={false} tween />
          </span>{' '}
          saved of <GoalTarget goal={goal} />
          {goal.targetDate !== null && (
            <>
              {' '}
              by <GoalTargetDate goal={goal} />
            </>
          )}
        </p>

        <p className="text-xs text-muted-foreground">{paceLine(goal)}</p>

        <GoalAccounts goal={goal} className="text-xs text-muted-foreground" />
      </CardContent>
    </Card>
  )
}
