import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { FilterIcon } from '@hugeicons/core-free-icons'
import { DEFAULT_REPORT_FILTERS, type ReportFilters } from '@shared/reports'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  AccountsControl,
  AmountRangeControl,
  CategoriesControl,
  DateRangeControl,
  DirectionControl
} from './filter-controls'

interface ReportFilterBarProps {
  filters: ReportFilters
  onChange: (filters: ReportFilters) => void
}

export function ReportFilterBar({ filters, onChange }: ReportFilterBarProps) {
  const [moreOpen, setMoreOpen] = useState(false)

  const moreCount =
    (filters.amountMin !== undefined || filters.amountMax !== undefined ? 1 : 0) +
    (filters.descriptionSearch ? 1 : 0) +
    (filters.includePending ? 0 : 1)

  const isDefault = JSON.stringify(filters) === JSON.stringify(DEFAULT_REPORT_FILTERS)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DateRangeControl
        value={filters.dateRange}
        onChange={(dateRange) => onChange({ ...filters, dateRange })}
      />
      <AccountsControl
        value={filters.accountIds}
        onChange={(accountIds) => onChange({ ...filters, accountIds })}
      />
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
          <Button variant="outline" size="sm" className="border-input bg-input/20 font-normal">
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
          <div className="space-y-2">
            <Label htmlFor="filter-search">Description contains</Label>
            <Input
              id="filter-search"
              className="h-8"
              placeholder="e.g. coffee"
              key={filters.descriptionSearch ?? ''}
              defaultValue={filters.descriptionSearch ?? ''}
              onBlur={(e) =>
                onChange({ ...filters, descriptionSearch: e.target.value.trim() || undefined })
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
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
      {!isDefault && (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => onChange(DEFAULT_REPORT_FILTERS)}
        >
          Reset
        </Button>
      )}
    </div>
  )
}
