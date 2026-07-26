import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { FilterIcon } from '@hugeicons/core-free-icons'
import type { TransactionFilters } from '@shared/transaction-filters'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { AmountRangeControl } from '@/components/reports/filter-controls'

/** The filters that don't earn a spot in the bar itself: amount range and the
 * pending/transfer toggles. */
export function MoreFiltersPopover({
  filters,
  onChange,
  defaultFilters
}: {
  filters: TransactionFilters
  onChange: (filters: TransactionFilters) => void
  /** only used to tell whether the transfers toggle is off its context default */
  defaultFilters: TransactionFilters
}) {
  const [open, setOpen] = useState(false)

  // descriptionSearch has no control here (the search box covers it) but old
  // saved filters and widget overrides can carry one — count it so its effect
  // is visible
  const count =
    (filters.amountMin !== undefined || filters.amountMax !== undefined ? 1 : 0) +
    (filters.descriptionSearch ? 1 : 0) +
    (filters.includePending ? 0 : 1) +
    // transfers default differs by context (shown in transactions, hidden in reports)
    (filters.includeTransfers !== defaultFilters.includeTransfers ? 1 : 0)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="lg" className="border-input bg-input/20 font-normal" />
        }
      >
        <HugeiconsIcon icon={FilterIcon} size={14} className="text-muted-foreground" />
        More
        {count > 0 && (
          <Badge variant="secondary" className="px-1.5">
            {count}
          </Badge>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
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
        <label className="flex items-center justify-between text-sm">
          Include transfers
          <Switch
            checked={filters.includeTransfers}
            onCheckedChange={(includeTransfers) => onChange({ ...filters, includeTransfers })}
          />
        </label>
      </PopoverContent>
    </Popover>
  )
}
