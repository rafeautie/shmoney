import type { TransactionFilters } from '@shared/transaction-filters'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { DateRangeControl } from '@/components/reports/filter-controls'
import { ActiveFilterChips } from './active-filter-chips'
import { FilterSearchInput } from './filter-search-input'
import { FiltersPopover } from './filters-popover'
import { SavedFiltersMenu } from './saved-filters-menu'

interface FilterBarProps {
  filters: TransactionFilters
  onChange: (filters: TransactionFilters) => void
  /** what Reset restores — transactions default to all time, reports to 12 months */
  defaultFilters: TransactionFilters
  /** per-account pages: the page's account scope is fixed, so the accounts
   * control is hidden (loaded accountIds are stripped by the parent) */
  hideAccounts?: boolean
  /** reports: time charts can draw the window before beside their own */
  showCompare?: boolean
  /** reports: search is an occasional tool there, so it waits as an icon */
  collapseSearch?: boolean
}

const COMPARE_ITEMS = { none: 'No Comparison', previous: 'Vs Previous Period' }

/** The one filter bar, shared by the transactions views and the report page so
 * their filtering never drifts apart. The date range leads, since it frames
 * every number below; the rest sit behind Filter and show as chips once set. */
export function FilterBar({
  filters,
  onChange,
  defaultFilters,
  hideAccounts,
  showCompare,
  collapseSearch
}: FilterBarProps) {
  const isDefault = JSON.stringify(filters) === JSON.stringify(defaultFilters)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <DateRangeControl
          value={filters.dateRange}
          onChange={(dateRange) => onChange({ ...filters, dateRange })}
          showResolved
        />
        {showCompare && (
          <Select
            value={filters.compare ?? 'none'}
            items={COMPARE_ITEMS}
            onValueChange={(v) =>
              // 'none' is the absence of a comparison, so it leaves the filters at their default
              onChange({ ...filters, compare: v === 'previous' ? 'previous' : undefined })
            }
          >
            <SelectTrigger size="lg" aria-label="Compare" className="w-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No Comparison</SelectItem>
              <SelectItem value="previous">Vs Previous Period</SelectItem>
            </SelectContent>
          </Select>
        )}
        <FiltersPopover
          filters={filters}
          onChange={onChange}
          defaultFilters={defaultFilters}
          hideAccounts={hideAccounts}
        />
        <FilterSearchInput
          value={filters.search}
          onChange={(search) => onChange({ ...filters, search })}
          collapsible={collapseSearch}
        />
        <div className="flex-1" />
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
      <ActiveFilterChips
        filters={filters}
        onChange={onChange}
        defaultFilters={defaultFilters}
        hideAccounts={hideAccounts}
      />
    </div>
  )
}
