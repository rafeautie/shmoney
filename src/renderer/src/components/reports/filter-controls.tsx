import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import type { DateRange as DayRange } from 'react-day-picker'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import type { DateRange } from '@shared/reports'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText
} from '@/components/ui/input-group'
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
    (value.kind === 'absolute' ? 'custom' : 'all')
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={presetKey}
        items={DATE_PRESET_ITEMS}
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
        <SelectTrigger size="lg" className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DATE_PRESETS.map((preset) => (
            <SelectItem key={preset.key} value={preset.key}>
              {preset.label}
            </SelectItem>
          ))}
          <SelectItem value="custom">Custom range</SelectItem>
        </SelectContent>
      </Select>
      {value.kind === 'absolute' && (
        <Popover
          onOpenChange={(open) => {
            if (open)
              setDraft({ from: new Date(value.start * 1000), to: new Date(value.end * 1000) })
          }}
        >
          <PopoverTrigger
            render={
              <Button
                variant="outline"
                size="lg"
                disabled={disabled}
                className="border-input bg-input/20 font-normal"
              />
            }
          >
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
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="lg"
            disabled={disabled}
            className="border-input bg-input/20 font-normal"
          />
        }
      >
        {label}
        <HugeiconsIcon icon={ArrowDown01Icon} size={14} className="text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search accounts..." />
          <CommandList>
            <CommandEmpty>No accounts found.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="all-accounts" onSelect={() => onChange(undefined)}>
                <span className={cn(value !== undefined && 'text-muted-foreground')}>
                  All accounts
                </span>
                {value === undefined && (
                  <HugeiconsIcon icon={Tick02Icon} size={14} className="ml-auto" />
                )}
              </CommandItem>
            </CommandGroup>
            <CommandGroup>
              {accounts.map((account) => (
                <CommandItem
                  key={account.id}
                  value={`${account.institutionName ?? ''} ${account.name}`}
                  onSelect={() => toggle(account.id)}
                >
                  <span className="truncate">{account.name}</span>
                  {selected.has(account.id) && (
                    <HugeiconsIcon icon={Tick02Icon} size={14} className="ml-auto" />
                  )}
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
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="lg"
            disabled={disabled}
            className="border-input bg-input/20 font-normal"
          />
        }
      >
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
              >
                <span className={cn(!allSelected && 'text-muted-foreground')}>All categories</span>
                {allSelected && <HugeiconsIcon icon={Tick02Icon} size={14} className="ml-auto" />}
              </CommandItem>
              <CommandItem
                value="uncategorized"
                onSelect={() => emit(selected, !value.includeUncategorized)}
              >
                <span className="text-muted-foreground">Uncategorized</span>
                {value.includeUncategorized && (
                  <HugeiconsIcon icon={Tick02Icon} size={14} className="ml-auto" />
                )}
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
                  >
                    <span className="font-medium">All {group.name}</span>
                    {allIn && <HugeiconsIcon icon={Tick02Icon} size={14} className="ml-auto" />}
                  </CommandItem>
                  {group.categories.map((category) => (
                    <CommandItem
                      key={category.id}
                      value={`${group.name} ${category.name}`}
                      onSelect={() => toggle(category.id)}
                    >
                      {category.name}
                      {selected.has(category.id) && (
                        <HugeiconsIcon icon={Tick02Icon} size={14} className="ml-auto" />
                      )}
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
                  >
                    {category.name}
                    {selected.has(category.id) && (
                      <HugeiconsIcon icon={Tick02Icon} size={14} className="ml-auto" />
                    )}
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
                  >
                    {category.name}
                    {selected.has(category.id) && (
                      <HugeiconsIcon icon={Tick02Icon} size={14} className="ml-auto" />
                    )}
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
      <SelectTrigger size="lg" className="w-36">
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
      <InputGroup className="h-8 w-24" data-disabled={disabled || undefined}>
        <InputGroupAddon>
          <InputGroupText>$</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput
          type="number"
          min={0}
          step="0.01"
          placeholder="Min"
          disabled={disabled}
          defaultValue={toDisplay(min)}
          key={`min-${min ?? 'none'}`}
          onBlur={(e) => onChange(fromDisplay(e.target.value), max)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
      </InputGroup>
      <span className="text-muted-foreground">–</span>
      <InputGroup className="h-8 w-24" data-disabled={disabled || undefined}>
        <InputGroupAddon>
          <InputGroupText>$</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput
          type="number"
          min={0}
          step="0.01"
          placeholder="Max"
          disabled={disabled}
          defaultValue={toDisplay(max)}
          key={`max-${max ?? 'none'}`}
          onBlur={(e) => onChange(min, fromDisplay(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
      </InputGroup>
    </div>
  )
}
