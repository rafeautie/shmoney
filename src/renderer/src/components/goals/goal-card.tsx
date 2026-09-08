import { useState } from 'react'
import { format } from 'date-fns'
import { HugeiconsIcon } from '@hugeicons/react'
import { Archive02Icon, Delete02Icon, MoreHorizontalIcon } from '@hugeicons/core-free-icons'
import type { GoalSummary } from '@shared/goals'
import { GoalBar, GoalStatusBadge } from '@/components/goals/goal-progress'
import { GoalAccountPicker } from '@/components/goals/goal-account-picker'
import { useRemoveGoal, useUpdateGoal } from '@/components/goals/use-goals'
import { Amount } from '@/components/amount'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { NumberInput } from '@/components/ui/number-input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { currencySymbol, formatAmount, parseDollars } from '@/lib/utils'

/**
 * One goal, editing in place. There is no edit dialog: every field commits on
 * Enter or blur, the way the budget page's fill cells do.
 */
export function GoalCard({ goal }: { goal: GoalSummary }) {
  const update = useUpdateGoal()
  const remove = useRemoveGoal()

  return (
    <Card className="gap-0 py-4">
      <CardContent className="space-y-3 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <EditableName goal={goal} onCommit={(name) => update.mutate({ id: goal.id, name })} />
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{modeLabel(goal)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <GoalStatusBadge status={goal.status} />
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon" className="size-7" />}
                aria-label="Goal actions"
              >
                <HugeiconsIcon icon={MoreHorizontalIcon} size={16} />
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
          </div>
        </div>

        <GoalBar goal={goal} />

        <div className="flex items-center justify-between gap-2 text-xs">
          <EditableTarget
            goal={goal}
            onCommit={(targetAmount) => update.mutate({ id: goal.id, targetAmount })}
          />
          <TargetDatePicker
            goal={goal}
            onCommit={(targetDate) => update.mutate({ id: goal.id, targetDate })}
          />
        </div>

        <p className="text-xs text-muted-foreground">{paceLine(goal)}</p>

        <GoalAccountPicker
          selected={goal.accounts}
          onChange={(next) =>
            next.length > 0 && update.mutate({ id: goal.id, accountIds: next.map((a) => a.id) })
          }
        />
      </CardContent>
    </Card>
  )
}

/** Says which number the card is showing, so the reader knows what they are looking at. */
function modeLabel(goal: GoalSummary): string {
  const accounts = goal.accounts.map((a) => a.name).join(', ')
  if (goal.accounts.length === 0) return 'No linked account yet'
  return goal.mode === 'balance'
    ? `Balance of ${accounts}`
    : `New savings since ${format(new Date(goal.startedAt * 1000), 'd MMM yyyy')}`
}

function paceLine(goal: GoalSummary): string {
  if (goal.status === 'reached') return 'Reached'
  if (goal.accounts.length === 0) return 'Link an account to start tracking this goal'
  if (goal.neededPerMonth !== null && goal.targetDate !== null)
    return `Save ${formatAmount(goal.neededPerMonth, goal.currency)}/month to reach it by ${longDay(goal.targetDate)}`
  if (goal.projectedDate !== null)
    return `At ${formatAmount(goal.averagePerMonth, goal.currency)}/month you'll get there around ${longDay(goal.projectedDate)}`
  if (goal.status === 'overdue') return 'Past its target date'
  return 'No pace yet: nothing saved toward it'
}

/** 'YYYY-MM-DD' read as a local day, never as UTC, then written the way people say it */
function longDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return format(new Date(y, m - 1, d), 'd MMM yyyy')
}

function EditableName({ goal, onCommit }: { goal: GoalSummary; onCommit: (name: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null)

  if (draft === null) {
    return (
      <button
        type="button"
        className="truncate text-left text-base font-semibold tracking-tight"
        onClick={() => setDraft(goal.name)}
      >
        {goal.name}
      </button>
    )
  }

  const commit = (): void => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== goal.name) onCommit(trimmed)
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
      className="h-7"
    />
  )
}

function EditableTarget({
  goal,
  onCommit
}: {
  goal: GoalSummary
  onCommit: (targetAmount: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)

  if (draft === null) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 font-normal tabular-nums"
        onClick={() => setDraft((goal.targetAmount / 1000).toString())}
      >
        Target <Amount value={goal.targetAmount} currency={goal.currency} colored={false} />
      </Button>
    )
  }

  const commit = (): void => {
    const amount = parseDollars(draft)
    if (amount !== null && amount > 0 && amount !== goal.targetAmount) onCommit(amount)
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

function TargetDatePicker({
  goal,
  onCommit
}: {
  goal: GoalSummary
  onCommit: (targetDate: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [y, m, d] = (goal.targetDate ?? '').split('-').map(Number)
  const selected = goal.targetDate ? new Date(y, m - 1, d) : undefined

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
          onSelect={(next) => {
            if (next) onCommit(format(next, 'yyyy-MM-dd'))
            setOpen(false)
          }}
        />
        {goal.targetDate !== null && (
          <div className="border-t p-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full font-normal"
              onClick={() => {
                onCommit(null)
                setOpen(false)
              }}
            >
              Clear the date
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
