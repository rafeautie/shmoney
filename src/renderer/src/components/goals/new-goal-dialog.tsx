import { useEffect, useState, type ComponentProps, type ReactNode } from 'react'
import { format } from 'date-fns'
import { startInstantForDay, type GoalMode } from '@shared/goals'
import { GoalAccountPicker } from '@/components/goals/goal-account-picker'
import { useCreateGoal } from '@/components/goals/use-goals'
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

export function NewGoalDialog({
  open,
  onOpenChange,
  currency
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** dominant account currency, for the amount prefix */
  currency: string
}) {
  const create = useCreateGoal()
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [mode, setMode] = useState<GoalMode>('balance')
  const [accounts, setAccounts] = useState<{ id: number; name: string }[]>([])
  const [targetDate, setTargetDate] = useState<string | null>(null)
  const [startDay, setStartDay] = useState<string | null>(null)

  // reset the form whenever the dialog (re)opens: Cancel and a successful create
  // both close via the controlled `open` prop, bypassing the Dialog's own
  // onOpenChange, so a close-time reset would miss them and leak stale state
  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- wholesale reset on reopen is the point; the extra render on a closed->open transition is harmless
    setName('')
    setTarget('')
    setMode('balance')
    setAccounts([])
    setTargetDate(null)
    setStartDay(null)
  }, [open])

  const targetAmount = parseDollars(target)
  const canSubmit =
    name.trim() !== '' &&
    targetAmount !== null &&
    targetAmount > 0 &&
    accounts.length > 0 &&
    !create.isPending

  const save = (): void => {
    if (!canSubmit || targetAmount === null) return
    create.mutate(
      {
        name: name.trim(),
        mode,
        targetAmount,
        targetDate,
        startedAt: startDay === null ? undefined : startInstantForDay(startDay),
        accountIds: accounts.map((a) => a.id)
      },
      { onSuccess: () => onOpenChange(false) }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-100">
        <DialogHeader>
          <DialogTitle>New goal</DialogTitle>
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
                disabled={{ before: startDay ? parseDay(startDay) : new Date() }}
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={save}>
            {create.isPending ? 'Creating...' : 'Create goal'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The new-goal dialog and the button that opens it. `children` overrides the
 * label for entry points that phrase it differently (e.g. an empty state). */
export function NewGoalButton({
  currency,
  children = 'New goal'
}: {
  currency: string
  children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>{children}</Button>
      <NewGoalDialog open={open} onOpenChange={setOpen} currency={currency} />
    </>
  )
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
  disabled
}: {
  day: string | null
  onPick: (day: string) => void
  placeholder: string
  disabled?: ComponentProps<typeof Calendar>['disabled']
}) {
  const [open, setOpen] = useState(false)
  const selected = day ? parseDay(day) : undefined
  return (
    // modal, like every popover in a dialog: the popup portals outside the
    // DialogContent and the dialog's scroll lock would otherwise swallow it
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            className="w-full justify-between border-input bg-input/20 font-normal"
          />
        }
      >
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
      </PopoverContent>
    </Popover>
  )
}
