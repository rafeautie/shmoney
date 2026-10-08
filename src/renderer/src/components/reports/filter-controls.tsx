import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import type { DateRange as DayRange } from 'react-day-picker'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import type { DateRange } from '@shared/reports'
import { cn, currencySymbol } from '@/lib/utils'
import { useAccountCurrency } from '@/lib/currency'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { NumberInput } from '@/components/ui/number-input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

// ---------- date range ----------

const DATE_PRESETS: { key: string; label: string; range: DateRange }[] = [
  {
    key: 'this-month',
    label: 'This month',
    range: { kind: 'relative', unit: 'month', count: 1, includeCurrent: true }
  },
  {
    key: 'last-month',
    label: 'Last month',
    range: { kind: 'relative', unit: 'month', count: 1, includeCurrent: false }
  },
  {
    key: 'last-3-months',
    label: 'Last 3 months',
    range: { kind: 'relative', unit: 'month', count: 3, includeCurrent: true }
  },
  {
    key: 'last-6-months',
    label: 'Last 6 months',
    range: { kind: 'relative', unit: 'month', count: 6, includeCurrent: true }
  },
  {
    key: 'last-12-months',
    label: 'Last 12 months',
    range: { kind: 'relative', unit: 'month', count: 12, includeCurrent: true }
  },
  {
    key: 'this-year',
    label: 'This year',
    range: { kind: 'relative', unit: 'year', count: 1, includeCurrent: true }
  },
  {
    key: 'last-year',
    label: 'Last year',
    range: { kind: 'relative', unit: 'year', count: 1, includeCurrent: false }
  },
  { key: 'all', label: 'All time', range: { kind: 'all' } }
]

// items lets the trigger's <SelectValue /> resolve the label before the
// popup has ever been opened (without it, Base UI shows the raw value)
const DATE_PRESET_ITEMS = [
  ...DATE_PRESETS.map((p) => ({ value: p.key, label: p.label })),
  { value: 'custom', label: 'Custom range' }
]

/** a relative range no preset covers, named the way the presets are */
function relativeLabel(range: Extract<DateRange, { kind: 'relative' }>): string {
  const { unit, count, includeCurrent } = range
  if (count === 1) return includeCurrent ? `This ${unit}` : `Last ${unit}`
  return includeCurrent ? `Last ${count} ${unit}s` : `Last ${count} full ${unit}s`
}

export function DateRangeControl({
  value,
  onChange,
  disabled
}: {
  value: DateRange
  onChange: (range: DateRange) => void
  disabled?: boolean
}) {
  // in-progress calendar selection; committed once both ends are picked
  const [draft, setDraft] = useState<DayRange | undefined>()
  const presetKey =
    DATE_PRESETS.find((p) => JSON.stringify(p.range) === JSON.stringify(value))?.key ??
    (value.kind === 'absolute' ? 'custom' : value.kind === 'relative' ? 'relative' : 'all')
  // a saved or drilled relative range outside the presets shows as itself
  const otherRelative = value.kind === 'relative' && presetKey === 'relative' ? value : null
  const items = otherRelative
    ? [...DATE_PRESET_ITEMS, { value: 'relative', label: relativeLabel(otherRelative) }]
    : DATE_PRESET_ITEMS
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={presetKey}
        items={items}
        disabled={disabled}
        onValueChange={(key) => {
          if (key === 'custom') {
            // day-align the seeded range the same way the calendar commit does,
            // so today's local-noon rows aren't excluded before the user edits it
            const now = new Date()
            const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30)
            const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)
            onChange({
              kind: 'absolute',
              start: Math.floor(start.getTime() / 1000),
              end: Math.floor(end.getTime() / 1000)
            })
          } else {
            const preset = DATE_PRESETS.find((p) => p.key === key)
            if (preset) onChange(preset.range)
          }
        }}
      >
        <SelectTrigger size="lg" aria-label="Date range" className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DATE_PRESETS.map((preset) => (
            <SelectItem key={preset.key} value={preset.key}>
              {preset.label}
            </SelectItem>
          ))}
          <SelectItem value="custom">Custom range</SelectItem>
          {otherRelative && (
            <SelectItem value="relative">{relativeLabel(otherRelative)}</SelectItem>
          )}
        </SelectContent>
      </Select>
      {value.kind === 'absolute' && (
        <Popover
          onOpenChange={(open) => {
            if (open)
              setDraft({ from: new Date(value.start * 1000), to: new Date(value.end * 1000) })
          }}
        >
          <PopoverTrigger render={<Button variant="field" size="lg" disabled={disabled} />}>
            {format(new Date(value.start * 1000), 'MMM d, yyyy')} –{' '}
            {format(new Date(value.end * 1000), 'MMM d, yyyy')}
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              numberOfMonths={2}
              showOutsideDays={false}
              defaultMonth={new Date(value.start * 1000)}
              selected={draft}
              onSelect={(range) => {
                setDraft(range)
                if (!range?.from || !range.to) return
                const { from, to } = range
                onChange({
                  ...value,
                  start: Math.floor(
                    new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime() / 1000
                  ),
                  end: Math.floor(
                    new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59).getTime() /
                      1000
                  )
                })
              }}
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}

// ---------- accounts multiselect ----------

export function AccountsControl({
  value,
  onChange,
  disabled
}: {
  /** undefined = all accounts */
  value: number[] | undefined
  onChange: (ids: number[] | undefined) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: () => window.api.accounts.list()
  })
  const accounts = accountsQuery.data ?? []
  const selected = new Set(value ?? [])
  const label =
    value === undefined
      ? 'All accounts'
      : value.length === 1
        ? (accounts.find((a) => a.id === value[0])?.name ?? '1 account')
        : `${value.length} accounts`

  function toggle(id: number) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next.size === 0 ? undefined : [...next])
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="field" size="lg" disabled={disabled} />}>
        {label}
        <HugeiconsIcon icon={ArrowDown01Icon} size={14} className="text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search accounts..." />
          <CommandList>
            <CommandEmpty>No accounts found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="all-accounts"
                onSelect={() => onChange(undefined)}
                checked={value === undefined}
              >
                <span className={cn(value !== undefined && 'text-muted-foreground')}>
                  All accounts
                </span>
              </CommandItem>
            </CommandGroup>
            <CommandGroup>
              {accounts.map((account) => (
                <CommandItem
                  key={account.id}
                  value={`${account.institutionName ?? ''} ${account.name}`}
                  onSelect={() => toggle(account.id)}
                  checked={selected.has(account.id)}
                >
                  <span className="truncate">{account.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ---------- goals multiselect ----------

/** Archived goals are left out: the widget is a status board, not an archive. */
export function GoalsControl({
  value,
  onChange
}: {
  /** undefined = every active goal */
  value: number[] | undefined
  onChange: (ids: number[] | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const goalsQuery = useQuery({ queryKey: ['goals'], queryFn: () => window.api.goals.list() })
  const goals = (goalsQuery.data ?? []).filter((goal) => goal.archivedAt === null)
  const selected = new Set(value ?? [])
  const label =
    value === undefined
      ? 'All active goals'
      : value.length === 1
        ? (goals.find((g) => g.id === value[0])?.name ?? '1 goal')
        : `${value.length} goals`

  function toggle(id: number) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next.size === 0 ? undefined : [...next])
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="field" size="lg" />}>
        {label}
        <HugeiconsIcon icon={ArrowDown01Icon} size={14} className="text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search goals..." />
          <CommandList>
            <CommandEmpty>No goals found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="all-goals"
                onSelect={() => onChange(undefined)}
                checked={value === undefined}
              >
                <span className={cn(value !== undefined && 'text-muted-foreground')}>
                  All active goals
                </span>
              </CommandItem>
            </CommandGroup>
            <CommandGroup>
              {goals.map((goal) => (
                <CommandItem
                  key={goal.id}
                  value={goal.name}
                  onSelect={() => toggle(goal.id)}
                  checked={selected.has(goal.id)}
                >
                  <span className="truncate">{goal.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ---------- categories multiselect ----------

export interface CategoryFilterValue {
  categoryIds: number[] | undefined
  includeUncategorized: boolean | undefined
}

export function CategoriesControl({
  value,
  onChange,
  disabled
}: {
  value: CategoryFilterValue
  onChange: (value: CategoryFilterValue) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => window.api.categories.list()
  })
  const data = categoriesQuery.data
  const selected = new Set(value.categoryIds ?? [])
  const allSelected = value.categoryIds === undefined && !value.includeUncategorized

  const count = (value.categoryIds?.length ?? 0) + (value.includeUncategorized ? 1 : 0)
  const label = allSelected ? 'All categories' : `${count} categor${count === 1 ? 'y' : 'ies'}`

  function emit(ids: Set<number>, uncategorized: boolean | undefined) {
    onChange({
      categoryIds: ids.size === 0 ? undefined : [...ids],
      includeUncategorized: uncategorized || undefined
    })
  }

  function toggle(id: number) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    emit(next, value.includeUncategorized)
  }

  function toggleGroup(ids: number[]) {
    const next = new Set(selected)
    const allIn = ids.every((id) => next.has(id))
    for (const id of ids) {
      if (allIn) next.delete(id)
      else next.add(id)
    }
    emit(next, value.includeUncategorized)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="field" size="lg" disabled={disabled} />}>
        {label}
        <HugeiconsIcon icon={ArrowDown01Icon} size={14} className="text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search categories..." />
          <CommandList>
            <CommandEmpty>No categories found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="all-categories"
                onSelect={() =>
                  onChange({ categoryIds: undefined, includeUncategorized: undefined })
                }
                checked={allSelected}
              >
                <span className={cn(!allSelected && 'text-muted-foreground')}>All categories</span>
              </CommandItem>
              <CommandItem
                value="uncategorized"
                onSelect={() => emit(selected, !value.includeUncategorized)}
                checked={value.includeUncategorized}
              >
                <span className="text-muted-foreground">Uncategorized</span>
              </CommandItem>
            </CommandGroup>
            {data?.groups.map((group) => {
              const groupIds = group.categories.map((c) => c.id)
              const allIn = groupIds.length > 0 && groupIds.every((id) => selected.has(id))
              return (
                <CommandGroup key={group.id} heading={group.name}>
                  <CommandItem
                    value={`${group.name} (whole group)`}
                    onSelect={() => toggleGroup(groupIds)}
                    checked={allIn}
                  >
                    <span className="font-medium">All {group.name}</span>
                  </CommandItem>
                  {group.categories.map((category) => (
                    <CommandItem
                      key={category.id}
                      value={`${group.name} ${category.name}`}
                      onSelect={() => toggle(category.id)}
                      checked={selected.has(category.id)}
                    >
                      {category.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )
            })}
            {data && data.ungrouped.length > 0 && (
              <CommandGroup heading="Ungrouped">
                {data.ungrouped.map((category) => (
                  <CommandItem
                    key={category.id}
                    value={`Ungrouped ${category.name}`}
                    onSelect={() => toggle(category.id)}
                    checked={selected.has(category.id)}
                  >
                    {category.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {data && data.system.length > 0 && (
              <CommandGroup heading="System">
                {data.system.map((category) => (
                  <CommandItem
                    key={category.id}
                    value={`System ${category.name}`}
                    onSelect={() => toggle(category.id)}
                    checked={selected.has(category.id)}
                  >
                    {category.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ---------- direction ----------

type Direction = 'all' | 'income' | 'expense'

export function DirectionControl({
  value,
  onChange,
  disabled
}: {
  value: Direction
  onChange: (value: Direction) => void
  disabled?: boolean
}) {
  return (
    <Select
      value={value}
      items={{ all: 'All directions', income: 'Income only', expense: 'Expenses only' }}
      onValueChange={(v) => onChange(v as Direction)}
      disabled={disabled}
    >
      <SelectTrigger size="lg" aria-label="Direction" className="w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All directions</SelectItem>
        <SelectItem value="income">Income only</SelectItem>
        <SelectItem value="expense">Expenses only</SelectItem>
      </SelectContent>
    </Select>
  )
}

// ---------- amount range (dollars in the UI, milliunits in the model) ----------

export function AmountRangeControl({
  min,
  max,
  onChange,
  disabled
}: {
  min: number | undefined
  max: number | undefined
  onChange: (min: number | undefined, max: number | undefined) => void
  disabled?: boolean
}) {
  const toDisplay = (v: number | undefined) => (v === undefined ? '' : String(v / 1000))
  const fromDisplay = (raw: string) => {
    if (raw.trim() === '') return undefined
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 1000) : undefined
  }
  return (
    <div className="flex items-center gap-1">
      {/* keyed on the committed value: an outside change (saved filter, reset)
          remounts the field so its draft restarts from the new bound */}
      <AmountField
        key={`min-${min ?? 'none'}`}
        initial={toDisplay(min)}
        placeholder="Min"
        disabled={disabled}
        onCommit={(raw) => onChange(fromDisplay(raw), max)}
      />
      <span className="text-muted-foreground">–</span>
      <AmountField
        key={`max-${max ?? 'none'}`}
        initial={toDisplay(max)}
        placeholder="Max"
        disabled={disabled}
        onCommit={(raw) => onChange(min, fromDisplay(raw))}
      />
    </div>
  )
}

/** One end of the range: edits a local draft, commits it on blur or Enter. */
function AmountField({
  initial,
  placeholder,
  disabled,
  onCommit
}: {
  initial: string
  placeholder: string
  disabled?: boolean
  onCommit: (raw: string) => void
}) {
  const [draft, setDraft] = useState(initial)
  // the range is matched against every account, so it carries no single
  // currency; the dominant one labels it
  const currency = useAccountCurrency()
  return (
    <NumberInput
      className="h-7 w-24"
      prefix={currencySymbol(currency)}
      min={0}
      placeholder={placeholder}
      disabled={disabled}
      value={draft}
      onValueChange={setDraft}
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}
