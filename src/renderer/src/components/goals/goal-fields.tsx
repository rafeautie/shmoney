import { useState } from 'react'
import { Archive02Icon, Delete02Icon, PencilEdit01Icon } from '@hugeicons/core-free-icons'
import type { GoalSummary } from '@shared/goals'
import { GoalDialog } from '@/components/goals/goal-dialog'
import { longDay } from '@/components/goals/goal-labels'
import { useRemoveGoal, useUpdateGoal } from '@/components/goals/use-goals'
import { Amount } from '@/components/amount'
import { ActionsMenu, ActionsMenuItem } from '@/components/actions-menu'
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
      <ActionsMenu label="Goal Actions">
        <ActionsMenuItem icon={PencilEdit01Icon} onClick={() => setEditing(true)}>
          Edit
        </ActionsMenuItem>
        <ActionsMenuItem
          icon={Archive02Icon}
          onClick={() => update.mutate({ id: goal.id, archived: goal.archivedAt === null })}
        >
          {goal.archivedAt === null ? 'Archive' : 'Unarchive'}
        </ActionsMenuItem>
        <ActionsMenuItem icon={Delete02Icon} destructive onClick={() => remove.mutate(goal)}>
          Delete
        </ActionsMenuItem>
      </ActionsMenu>
      <GoalDialog open={editing} onOpenChange={setEditing} currency={goal.currency} goal={goal} />
    </>
  )
}
