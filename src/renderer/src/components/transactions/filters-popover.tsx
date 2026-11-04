import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { FilterIcon } from '@hugeicons/core-free-icons'
import type { TransactionFilters } from '@shared/transaction-filters'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  AccountsControl,
  AmountRangeControl,
  CategoriesControl,
  DirectionControl
} from '@/components/reports/filter-controls'

/** How many filters differ from their defaults; what the Filter button counts. */
function activeFilterCount(
  filters: TransactionFilters,
  defaultFilters: TransactionFilters,
  hideAccounts = false
): number {
  return (
    (!hideAccounts && filters.accountIds !== undefined ? 1 : 0) +
    (filters.categoryIds !== undefined || filters.includeUncategorized ? 1 : 0) +
    (filters.categoryGroupIds?.length ? 1 : 0) +
    (filters.direction !== 'all' ? 1 : 0) +
    (filters.amountMin !== undefined || filters.amountMax !== undefined ? 1 : 0) +
    // descriptionSearch has no control here (the search box covers it) but old
    // saved filters and widget overrides can carry one
    (filters.descriptionSearch?.length ? 1 : 0) +
    (filters.includePending ? 0 : 1) +
    // transfers default differs by context (shown in transactions, hidden in reports)
    (filters.includeTransfers !== defaultFilters.includeTransfers ? 1 : 0)
  )
}

/**
 * Every filter except the date range and search behind one button, so the bar
 * leads with the date and doesn't spend a control per filter saying "All".
 * What's set shows beside the bar as removable chips.
 */
export function FiltersPopover({
  filters,
  onChange,
  defaultFilters,
  hideAccounts
}: {
  filters: TransactionFilters
  onChange: (filters: TransactionFilters) => void
  defaultFilters: TransactionFilters
  hideAccounts?: boolean
}) {
  const [open, setOpen] = useState(false)
  const count = activeFilterCount(filters, defaultFilters, hideAccounts)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="field" size="lg" />}>
        <HugeiconsIcon icon={FilterIcon} size={14} className="text-muted-foreground" />
        Filter
        {count > 0 && (
          <Badge variant="secondary" className="px-1.5">
            {count}
          </Badge>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        {!hideAccounts && (
          <div className="space-y-2">
            <Label>Accounts</Label>
            <AccountsControl
              value={filters.accountIds}
              onChange={(accountIds) => onChange({ ...filters, accountIds })}
              className="w-full justify-between"
            />
          </div>
        )}
        <div className="space-y-2">
          <Label>Categories</Label>
          <CategoriesControl
            value={{
              categoryIds: filters.categoryIds,
              includeUncategorized: filters.includeUncategorized
            }}
            onChange={({ categoryIds, includeUncategorized }) =>
              onChange({ ...filters, categoryIds, includeUncategorized })
            }
            className="w-full justify-between"
          />
        </div>
        <div className="space-y-2">
          <Label>Direction</Label>
          <DirectionControl
            value={filters.direction}
            onChange={(direction) => onChange({ ...filters, direction })}
            className="w-full"
          />
        </div>
        <div className="space-y-2">
          <Label>Amount Range</Label>
          <AmountRangeControl
            min={filters.amountMin}
            max={filters.amountMax}
            onChange={(amountMin, amountMax) => onChange({ ...filters, amountMin, amountMax })}
          />
        </div>
        <label className="flex items-center justify-between text-sm">
          Include Pending Transactions
          <Switch
            checked={filters.includePending}
            onCheckedChange={(includePending) => onChange({ ...filters, includePending })}
          />
        </label>
        <label className="flex items-center justify-between text-sm">
          Include Transfers
          <Switch
            checked={filters.includeTransfers}
            onCheckedChange={(includeTransfers) => onChange({ ...filters, includeTransfers })}
          />
        </label>
      </PopoverContent>
    </Popover>
  )
}
