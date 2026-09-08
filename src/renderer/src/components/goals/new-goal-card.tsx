import { useState } from 'react'
import { format } from 'date-fns'
import { startInstantForDay, type GoalMode } from '@shared/goals'
import { GoalAccountPicker } from '@/components/goals/goal-account-picker'
import { useCreateGoal } from '@/components/goals/use-goals'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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

/** Pinned create card, like the transactions table's entry row. Enter saves, Escape discards. */
export function NewGoalCard({ currency, onDone }: { currency: string; onDone: () => void }) {
  const create = useCreateGoal()
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [mode, setMode] = useState<GoalMode>('balance')
  const [accounts, setAccounts] = useState<{ id: number; name: string }[]>([])
  const [targetDate, setTargetDate] = useState<string | null>(null)
  const [startDay, setStartDay] = useState<string | null>(null)
  const [dateOpen, setDateOpen] = useState(false)
  const [startOpen, setStartOpen] = useState(false)

  const targetAmount = parseDollars(target)
  const ready =
    name.trim() !== '' && targetAmount !== null && targetAmount > 0 && accounts.length > 0

  const save = (): void => {
    if (!ready) return
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
  }

  return (
    <Card className="gap-0 border-dashed py-4" onKeyDown={(e) => e.key === 'Escape' && onDone()}>
      <CardContent className="space-y-3 px-4">
        <Input
          autoFocus
          placeholder="Goal name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          className="h-8"
        />

        <div className="grid grid-cols-2 gap-2">
          {MODES.map((option) => (
            <button
              key={option.value}
              type="button"
              title={option.hint}
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
        <p className="text-xs text-muted-foreground">{MODES.find((m) => m.value === mode)!.hint}</p>

        <NumberInput
          prefix={currencySymbol(currency)}
          min={0}
          placeholder="Target amount"
          value={target}
          onValueChange={setTarget}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          className="h-8"
        />

        <div className="flex items-center justify-between gap-2">
          <DayPicker
            open={dateOpen}
            onOpenChange={setDateOpen}
            day={targetDate}
            onPick={setTargetDate}
            placeholder="Target date (optional)"
          />
          <DayPicker
            open={startOpen}
            onOpenChange={setStartOpen}
            day={startDay}
            onPick={setStartDay}
            placeholder="Starts today"
          />
        </div>

        <GoalAccountPicker selected={accounts} onChange={setAccounts} />

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onDone}>
            Cancel
          </Button>
          <Button size="sm" disabled={!ready || create.isPending} onClick={save}>
            Create goal
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function DayPicker({
  open,
  onOpenChange,
  day,
  onPick,
  placeholder
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  day: string | null
  onPick: (day: string) => void
  placeholder: string
}) {
  const [y, m, d] = (day ?? '').split('-').map(Number)
  const selected = day ? new Date(y, m - 1, d) : undefined
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={<Button variant="ghost" size="sm" className="h-7 px-2 text-xs font-normal" />}
      >
        {day ?? placeholder}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(next) => {
            if (next) onPick(format(next, 'yyyy-MM-dd'))
            onOpenChange(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
