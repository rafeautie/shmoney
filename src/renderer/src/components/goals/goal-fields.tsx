import { useState } from 'react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { HugeiconsIcon } from '@hugeicons/react'
import { Archive02Icon, Delete02Icon, MoreHorizontalIcon } from '@hugeicons/core-free-icons'
import type { GoalSummary } from '@shared/goals'
import { GoalAccountPicker } from '@/components/goals/goal-account-picker'
import { longDay } from '@/components/goals/goal-labels'
import { useRemoveGoal, useUpdateGoal } from '@/components/goals/use-goals'
import { Amount } from '@/components/amount'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { NumberInput } from '@/components/ui/number-input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { currencySymbol, parseDollars } from '@/lib/utils'

// The card and the table are two views of the same goal, so they edit it
// through the same fields; every one commits on Enter or blur.

export function EditableName({
  goal,
  className
}: {
  goal: GoalSummary
  /** the resting label's type scale, which differs between the views */
  className?: string
}) {
  const update = useUpdateGoal()
  const [draft, setDraft] = useState<string | null>(null)

  if (draft === null) {
    return (
      <button type="button" className={className} onClick={() => setDraft(goal.name)}>
        {goal.name}
      </button>
    )
  }

  const commit = (): void => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== goal.name) update.mutate({ id: goal.id, name: trimmed })
    setDraft(null)
  }

  return (
    <Input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setDraft(null)
      }}
      className="h-7 min-w-0 flex-1"
    />
  )
}

export function EditableTarget({
  goal,
  labelled = true
}: {
  goal: GoalSummary
  labelled?: boolean
}) {
  const update = useUpdateGoal()
  const [draft, setDraft] = useState<string | null>(null)

  if (draft === null) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 font-normal tabular-nums"
        onClick={() => setDraft((goal.targetAmount / 1000).toString())}
      >
        {labelled && 'Target'}{' '}
        <Amount value={goal.targetAmount} currency={goal.currency} colored={false} />
      </Button>
    )
  }

  const commit = (): void => {
    const amount = parseDollars(draft)
    if (amount !== null && amount > 0 && amount !== goal.targetAmount)
      update.mutate({ id: goal.id, targetAmount: amount })
    setDraft(null)
  }

  return (
    <NumberInput
      autoFocus
      prefix={currencySymbol(goal.currency)}
      min={0}
      value={draft}
      onValueChange={setDraft}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setDraft(null)
      }}
      className="w-28"
    />
  )
}

export function TargetDatePicker({ goal }: { goal: GoalSummary }) {
  const update = useUpdateGoal()
  const [open, setOpen] = useState(false)
  const [y, m, d] = (goal.targetDate ?? '').split('-').map(Number)
  const selected = goal.targetDate ? new Date(y, m - 1, d) : undefined

  const commit = (targetDate: string | null): void => {
    update.mutate({ id: goal.id, targetDate })
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="ghost" size="sm" className="h-7 px-2 font-normal" />}
      >
        {goal.targetDate ? longDay(goal.targetDate) : 'Set a target date'}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          disabled={{ before: new Date(goal.startedAt * 1000) }}
          onSelect={(next) => next && commit(format(next, 'yyyy-MM-dd'))}
        />
        {goal.targetDate !== null && (
          <div className="border-t p-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full font-normal"
              onClick={() => commit(null)}
            >
              Clear the date
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** A goal with no account tracks nothing, so the last one cannot be removed. */
export function GoalAccounts({ goal }: { goal: GoalSummary }) {
  const update = useUpdateGoal()
  return (
    <GoalAccountPicker
      selected={goal.accounts}
      onChange={(next) =>
        next.length > 0
          ? update.mutate({ id: goal.id, accountIds: next.map((a) => a.id) })
          : toast('A goal needs at least one account')
      }
    />
  )
}

export function GoalActionsMenu({ goal }: { goal: GoalSummary }) {
  const update = useUpdateGoal()
  const remove = useRemoveGoal()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" />}
        aria-label="Goal actions"
      >
        <HugeiconsIcon icon={MoreHorizontalIcon} className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
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
  )
}
