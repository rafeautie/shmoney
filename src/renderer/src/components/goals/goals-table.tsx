import type { GoalSummary } from '@shared/goals'
import { Amount } from '@/components/amount'
import {
  EditableName,
  EditableTarget,
  GoalAccounts,
  GoalActionsMenu,
  TargetDatePicker
} from '@/components/goals/goal-fields'
import { modeLabel } from '@/components/goals/goal-labels'
import { GoalBar, GoalStatusBadge } from '@/components/goals/goal-progress'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn, TABLE_BLEED } from '@/lib/utils'

/**
 * One row per goal, editing the same fields the card does, laid out like the
 * budget's envelope table. `saved` is what landed this month, so a goal with no
 * month-end level yet reads as a dash rather than as zero saved.
 */
export function GoalsTable({
  goals,
  savedThisMonth
}: {
  goals: GoalSummary[]
  savedThisMonth: Map<number, number>
}) {
  return (
    <table className={cn('w-full caption-bottom text-xs', TABLE_BLEED)}>
      {/* box-shadows stand in for the header's borders, which collapse drops while sticky */}
      <TableHeader className="sticky top-0 z-10 bg-background shadow-[inset_0_1px_0_0_var(--border),inset_0_-1px_0_0_var(--border)] [&_tr]:border-b-0">
        <TableRow>
          <TableHead>Goal</TableHead>
          <TableHead className="w-32">Status</TableHead>
          <TableHead className="w-64">Progress</TableHead>
          <TableHead className="w-32">Target</TableHead>
          <TableHead className="w-36">Target date</TableHead>
          <TableHead className="w-56">Accounts</TableHead>
          <TableHead className="w-28 text-right">Planned</TableHead>
          <TableHead className="w-28 text-right">Saved</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {goals.map((goal) => {
          const saved = savedThisMonth.get(goal.id)
          return (
            <TableRow key={goal.id}>
              <TableCell>
                <div className="flex min-w-0 flex-col">
                  <EditableName goal={goal} className="truncate text-left" />
                  <span className="truncate text-xs text-muted-foreground">{modeLabel(goal)}</span>
                </div>
              </TableCell>
              <TableCell>
                <GoalStatusBadge status={goal.status} />
              </TableCell>
              <TableCell>
                <GoalBar goal={goal} />
              </TableCell>
              <TableCell>
                <EditableTarget goal={goal} labelled={false} />
              </TableCell>
              <TableCell>
                <TargetDatePicker goal={goal} />
              </TableCell>
              <TableCell>
                <GoalAccounts goal={goal} />
              </TableCell>
              <TableCell className="text-right">
                {goal.neededPerMonth === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <Amount value={goal.neededPerMonth} currency={goal.currency} colored={false} />
                )}
              </TableCell>
              <TableCell className="text-right">
                {saved === undefined ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <Amount value={saved} currency={goal.currency} colored={false} />
                )}
              </TableCell>
              <TableCell>
                <GoalActionsMenu goal={goal} />
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </table>
  )
}
