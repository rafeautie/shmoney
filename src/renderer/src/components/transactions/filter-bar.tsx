import type { TransactionFilters } from '@shared/transaction-filters'
import { Button } from '@/components/ui/button'
import {
  AccountsControl,
  CategoriesControl,
  DateRangeControl,
  DirectionControl
} from '@/components/reports/filter-controls'
import { FilterSearchInput } from './filter-search-input'
import { MoreFiltersPopover } from './more-filters-popover'
import { SavedFiltersMenu } from './saved-filters-menu'

interface FilterBarProps {
  filters: TransactionFilters
  onChange: (filters: TransactionFilters) => void
  /** what Reset restores — transactions default to all time, reports to 12 months */
  defaultFilters: TransactionFilters
  /** per-account pages: the page's account scope is fixed, so the accounts
   * control is hidden (loaded accountIds are stripped by the parent) */
  hideAccounts?: boolean
}

/** The one filter bar, shared by the transactions views and the report page so
 * their filtering never drifts apart. */
export function FilterBar({ filters, onChange, defaultFilters, hideAccounts }: FilterBarProps) {
  const isDefault = JSON.stringify(filters) === JSON.stringify(defaultFilters)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <FilterSearchInput
        value={filters.search}
        onChange={(search) => onChange({ ...filters, search })}
      />
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
      <MoreFiltersPopover filters={filters} onChange={onChange} defaultFilters={defaultFilters} />
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
