import type { GoalSummary } from '@shared/goals'
import { GoalBar, GoalStatusBadge } from '@/components/goals/goal-progress'
import {
  EditableName,
  EditableTarget,
  GoalAccounts,
  GoalActionsMenu,
  TargetDatePicker
} from '@/components/goals/goal-fields'
import { modeLabel, paceLine } from '@/components/goals/goal-labels'
import { Card, CardContent } from '@/components/ui/card'

/** One goal, editing in place; every field commits on Enter or blur. */
export function GoalCard({ goal }: { goal: GoalSummary }) {
  return (
    <Card className="gap-0 py-4">
      <CardContent className="space-y-3 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <EditableName
                goal={goal}
                className="min-w-0 truncate text-left text-base font-semibold tracking-tight"
              />
              <GoalStatusBadge status={goal.status} />
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{modeLabel(goal)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <GoalActionsMenu goal={goal} />
          </div>
        </div>

        <GoalBar goal={goal} />

        <p className="text-xs text-muted-foreground">{paceLine(goal)}</p>

        {/* The settings of the goal, penned off from the progress it reports.
            Flex, not space-y: an open popover appends out-of-flow markers after
            its trigger, and space-y's margin would land on the trigger once it
            is no longer the last child, growing the card as it opens. */}
        <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <EditableTarget goal={goal} />
            <TargetDatePicker goal={goal} />
          </div>
          <GoalAccounts goal={goal} />
        </div>
      </CardContent>
    </Card>
  )
}
