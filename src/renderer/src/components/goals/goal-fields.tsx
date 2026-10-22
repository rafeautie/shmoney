import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Archive02Icon,
  Delete02Icon,
  MoreHorizontalIcon,
  PencilEdit01Icon
} from '@hugeicons/core-free-icons'
import type { GoalSummary } from '@shared/goals'
import { GoalDialog } from '@/components/goals/goal-dialog'
import { longDay } from '@/components/goals/goal-labels'
import { useRemoveGoal, useUpdateGoal } from '@/components/goals/use-goals'
import { Amount } from '@/components/amount'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

// The card and the table are two views of the same goal, so they show it
// through the same fields. None edits in place: every change goes through the
// Edit dialog in the actions menu, so a stray click on a compact layout can't
// start one.

export function GoalTarget({ goal }: { goal: GoalSummary }) {
  return (
    <span className="tabular-nums">
      <Amount value={goal.targetAmount} currency={goal.currency} colored={false} />
    </span>
  )
}

export function GoalTargetDate({ goal }: { goal: GoalSummary }) {
  return goal.targetDate ? (
    <span>{longDay(goal.targetDate)}</span>
  ) : (
    <span className="text-muted-foreground">No target date</span>
  )
}

/** Worded like the account picker; a goal with no account tracks nothing, so
 * that reads as a warning. */
export function GoalAccounts({ goal, className }: { goal: GoalSummary; className?: string }) {
  if (goal.accounts.length === 0)
    return <span className={cn('text-destructive', className)}>No linked account</span>
  const names = goal.accounts.map((a) => a.name).join(', ')
  return (
    <span className={cn('block truncate', className)} title={names}>
      {goal.accounts.length === 1 ? names : `${goal.accounts.length} accounts`}
    </span>
  )
}

export function GoalActionsMenu({ goal }: { goal: GoalSummary }) {
  const update = useUpdateGoal()
  const remove = useRemoveGoal()
  const [editing, setEditing] = useState(false)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon" />}
          aria-label="Goal actions"
        >
          <HugeiconsIcon icon={MoreHorizontalIcon} className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditing(true)}>
            <HugeiconsIcon icon={PencilEdit01Icon} size={14} />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => update.mutate({ id: goal.id, archived: goal.archivedAt === null })}
          >
            <HugeiconsIcon icon={Archive02Icon} size={14} />
            {goal.archivedAt === null ? 'Archive' : 'Unarchive'}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => remove.mutate(goal)}>
            <HugeiconsIcon icon={Delete02Icon} size={14} />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <GoalDialog open={editing} onOpenChange={setEditing} currency={goal.currency} goal={goal} />
    </>
  )
}
