import { useEffect, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { FilterIcon, Search01Icon } from '@hugeicons/core-free-icons'
import type { TransactionFilters } from '@shared/transaction-filters'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  AccountsControl,
  AmountRangeControl,
  CategoriesControl,
  DateRangeControl,
  DirectionControl
} from '@/components/reports/filter-controls'
import { SavedFiltersMenu } from '@/components/saved-filters-menu'

interface FilterBarProps {
  filters: TransactionFilters
  onChange: (filters: TransactionFilters) => void
  /** what Reset restores — transactions default to all time, reports to 12 months */
  defaultFilters: TransactionFilters
  /** per-account pages: the page's account scope is fixed, so the accounts
   * control is hidden (loaded accountIds are stripped by the parent) */
  hideAccounts?: boolean
}

/** Broad search box: debounced while typing so each keystroke doesn't hit SQL */
function SearchInput({
  value,
  onChange
}: {
  value: string | undefined
  onChange: (value: string | undefined) => void
}) {
  const [text, setText] = useState(value ?? '')

  // reflect external changes (saved-filter load, reset) without clobbering
  // in-progress typing after our own debounced commit lands; state is adjusted
  // during render per https://react.dev/learn/you-might-not-need-an-effect
  const [prevValue, setPrevValue] = useState(value)
  if (value !== prevValue) {
    setPrevValue(value)
    if (text.trim() !== (value ?? '')) setText(value ?? '')
  }

  useEffect(() => {
    const trimmed = text.trim()
    const next = trimmed === '' ? undefined : trimmed
    if (next === value) return undefined
    const timer = setTimeout(() => onChange(next), 300)
    return () => clearTimeout(timer)
  }, [text, value, onChange])

  return (
    <InputGroup className="h-8 w-56">
      <InputGroupAddon>
        <HugeiconsIcon icon={Search01Icon} size={14} />
      </InputGroupAddon>
      <InputGroupInput
        placeholder="Search transactions..."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    </InputGroup>
  )
}

/** The one filter bar, shared by the transactions views and the report page so
 * their filtering never drifts apart. */
export function FilterBar({ filters, onChange, defaultFilters, hideAccounts }: FilterBarProps) {
  const [moreOpen, setMoreOpen] = useState(false)

  // descriptionSearch has no control here (the search box covers it) but old
  // saved filters and widget overrides can carry one — count it so its effect
  // is visible
  const moreCount =
    (filters.amountMin !== undefined || filters.amountMax !== undefined ? 1 : 0) +
    (filters.descriptionSearch ? 1 : 0) +
    (filters.includePending ? 0 : 1)

  const isDefault = JSON.stringify(filters) === JSON.stringify(defaultFilters)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchInput value={filters.search} onChange={(search) => onChange({ ...filters, search })} />
      <DateRangeControl
        value={filters.dateRange}
        onChange={(dateRange) => onChange({ ...filters, dateRange })}
      />
      {!hideAccounts && (
        <AccountsControl
          value={filters.accountIds}
          onChange={(accountIds) => onChange({ ...filters, accountIds })}
        />
      )}
      <CategoriesControl
        value={{
          categoryIds: filters.categoryIds,
          includeUncategorized: filters.includeUncategorized
        }}
        onChange={({ categoryIds, includeUncategorized }) =>
          onChange({ ...filters, categoryIds, includeUncategorized })
        }
      />
      <DirectionControl
        value={filters.direction}
        onChange={(direction) => onChange({ ...filters, direction })}
      />
      <Popover open={moreOpen} onOpenChange={setMoreOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="lg" className="border-input bg-input/20 font-normal">
            <HugeiconsIcon icon={FilterIcon} size={14} className="text-muted-foreground" />
            More
            {moreCount > 0 && (
              <Badge variant="secondary" className="px-1.5">
                {moreCount}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 space-y-4" align="start">
          <div className="space-y-2">
            <Label>Amount range</Label>
            <AmountRangeControl
              min={filters.amountMin}
              max={filters.amountMax}
              onChange={(amountMin, amountMax) => onChange({ ...filters, amountMin, amountMax })}
            />
          </div>
          <label className="flex items-center justify-between text-sm">
            Include pending transactions
            <Switch
              checked={filters.includePending}
              onCheckedChange={(includePending) => onChange({ ...filters, includePending })}
            />
          </label>
        </PopoverContent>
      </Popover>
      <SavedFiltersMenu currentFilters={filters} onLoad={onChange} />
      {!isDefault && (
        <Button
          variant="ghost"
          size="lg"
          className="text-muted-foreground"
          onClick={() => onChange(defaultFilters)}
        >
          Reset
        </Button>
      )}
    </div>
  )
}
