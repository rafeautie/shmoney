import { useState, type ComponentProps, type ReactNode } from 'react'
import { format } from 'date-fns'
import {
  startInstantForDay,
  type GoalMode,
  type GoalSummary,
  type GoalUpdateInput
} from '@shared/goals'
import { GoalAccountPicker } from '@/components/goals/goal-account-picker'
import { useCreateGoal, useUpdateGoal } from '@/components/goals/use-goals'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NumberInput } from '@/components/ui/number-input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn, currencySymbol, parseDollars } from '@/lib/utils'

const MODES: { value: GoalMode; label: string; hint: string }[] = [
  {
    value: 'balance',
    label: 'Track the balance',
    hint: 'Progress is what the account holds, so it always matches Accounts.'
  },
  {
    value: 'contributions',
    label: 'Count new savings',
    hint: 'Progress starts at zero and counts what lands after the start.'
  }
]

/**
 * Adds a goal, or edits every field of `goal` when one is given. The form lives
 * in DialogContent, which unmounts on close, so each open starts from fresh
 * state: blank for a new goal, the goal's current values for an edit.
 */
export function GoalDialog({
  open,
  onOpenChange,
  currency,
  goal
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** dominant account currency, for the amount prefix; an edit uses the goal's */
  currency: string
  goal?: GoalSummary
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-100">
        <GoalForm
          goal={goal}
          currency={goal?.currency ?? currency}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function GoalForm({
  goal,
  currency,
  onDone
}: {
  goal?: GoalSummary
  currency: string
  onDone: () => void
}) {
  const create = useCreateGoal()
  const update = useUpdateGoal()
  const initialStartDay = goal ? startDayOf(goal.startedAt) : null
  const [name, setName] = useState(goal?.name ?? '')
  const [target, setTarget] = useState(goal ? (goal.targetAmount / 1000).toString() : '')
  const [mode, setMode] = useState<GoalMode>(goal?.mode ?? 'balance')
  const [accounts, setAccounts] = useState<{ id: number; name: string }[]>(goal?.accounts ?? [])
  const [targetDate, setTargetDate] = useState<string | null>(goal?.targetDate ?? null)
  const [startDay, setStartDay] = useState<string | null>(initialStartDay)

  const pending = create.isPending || update.isPending
  const targetAmount = parseDollars(target)
  const canSubmit =
    name.trim() !== '' &&
    targetAmount !== null &&
    targetAmount > 0 &&
    accounts.length > 0 &&
    !pending

  const save = (): void => {
    if (!canSubmit || targetAmount === null) return
    if (!goal) {
      create.mutate(
        {
          name: name.trim(),
          mode,
          targetAmount,
          targetDate,
          startedAt: startDay === null ? undefined : startInstantForDay(startDay),
          accountIds: accounts.map((a) => a.id)
        },
        { onSuccess: onDone }
      )
      return
    }

    // only what changed: an untouched start must keep its exact instant, which
    // a round trip through its day would move to that day's midnight
    const patch: GoalUpdateInput = { id: goal.id }
    if (name.trim() !== goal.name) patch.name = name.trim()
    if (mode !== goal.mode) patch.mode = mode
    if (targetAmount !== goal.targetAmount) patch.targetAmount = targetAmount
    if (targetDate !== goal.targetDate) patch.targetDate = targetDate
    if (startDay !== null && startDay !== initialStartDay)
      patch.startedAt = startInstantForDay(startDay)
    const ids = accounts.map((a) => a.id)
    if (
      !sameIds(
        ids,
        goal.accounts.map((a) => a.id)
      )
    )
      patch.accountIds = ids
    if (Object.keys(patch).length === 1) return onDone()
    update.mutate(patch, { onSuccess: onDone })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{goal ? 'Edit goal' : 'Add goal'}</DialogTitle>
        <DialogDescription>
          A target amount and the accounts the money lands in. Progress comes from your
          transactions, never typed in.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="goal-name">Name</Label>
          <Input
            id="goal-name"
            autoFocus
            placeholder="Emergency fund"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
        </div>

        <div className="space-y-2">
          <Label>What it tracks</Label>
          <div className="grid grid-cols-2 gap-2">
            {MODES.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setMode(option.value)}
                className={cn(
                  'rounded-md border px-2 py-1.5 text-left text-xs',
                  mode === option.value ? 'border-primary bg-accent' : 'text-muted-foreground'
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {MODES.find((m) => m.value === mode)!.hint}
            {goal && mode !== goal.mode && ' Progress so far is recounted this way.'}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="goal-target">Target amount</Label>
          <NumberInput
            id="goal-target"
            placeholder="0.00"
            prefix={currencySymbol(currency)}
            min={0}
            value={target}
            onValueChange={setTarget}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Target date</Label>
            <DayPicker
              day={targetDate}
              onPick={setTargetDate}
              placeholder="Optional"
              // a saved goal may already be past its date, so an edit only
              // holds the order against the start
              disabled={{
                before: startDay ? parseDay(startDay) : goal ? new Date(0) : new Date()
              }}
              clearLabel="Clear the date"
            />
          </div>
          <div className="space-y-2">
            <Label>Starts</Label>
            <DayPicker
              day={startDay}
              onPick={setStartDay}
              placeholder="Today"
              disabled={{ after: new Date() }}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Accounts</Label>
          <GoalAccountPicker
            modal
            placeholder="Pick accounts..."
            selected={accounts}
            onChange={setAccounts}
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button disabled={!canSubmit} onClick={save}>
          {goal ? (pending ? 'Saving...' : 'Save') : pending ? 'Adding...' : 'Add goal'}
        </Button>
      </DialogFooter>
    </>
  )
}

/** The new-goal dialog and the button that opens it. `children` overrides the
 * label for entry points that phrase it differently (e.g. an empty state). */
export function NewGoalButton({
  currency,
  children = 'Add goal'
}: {
  currency: string
  children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>{children}</Button>
      <GoalDialog open={open} onOpenChange={setOpen} currency={currency} />
    </>
  )
}

/** The day a stored start belongs to: a picked day is stored one second before
 * its midnight (startInstantForDay), a default start is some time during it. */
function startDayOf(startedAt: number): string {
  return format(new Date((startedAt + 1) * 1000), 'yyyy-MM-dd')
}

function sameIds(a: number[], b: number[]): boolean {
  const set = new Set(b)
  return a.length === b.length && a.every((id) => set.has(id))
}

/** 'YYYY-MM-DD' as a local day; `new Date(string)` would read it as UTC. */
function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function DayPicker({
  day,
  onPick,
  placeholder,
  disabled,
  clearLabel
}: {
  day: string | null
  onPick: (day: string | null) => void
  placeholder: string
  disabled?: ComponentProps<typeof Calendar>['disabled']
  /** offers a way back to no day at all when set */
  clearLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = day ? parseDay(day) : undefined
  return (
    // modal, like every popover in a dialog: the popup portals outside the
    // DialogContent and the dialog's scroll lock would otherwise swallow it
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="field" className="w-full justify-between" />}>
        <span className={cn(!day && 'text-muted-foreground')}>{day ?? placeholder}</span>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          disabled={disabled}
          onSelect={(next) => {
            if (next) onPick(format(next, 'yyyy-MM-dd'))
            setOpen(false)
          }}
        />
        {clearLabel && day !== null && (
          <div className="border-t p-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full font-normal"
              onClick={() => {
                onPick(null)
                setOpen(false)
              }}
            >
              {clearLabel}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
