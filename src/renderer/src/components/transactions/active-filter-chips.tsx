import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import type { TransactionFilters } from '@shared/transaction-filters'
import { formatAmount, plural } from '@/lib/utils'
import { useAccountCurrency } from '@/lib/currency'

interface Chip {
  key: string
  label: string
  /** the filters with this one back at its default */
  clear: TransactionFilters
}

/**
 * The filters in effect, one removable chip each, under the bar. With the
 * filters folded into one button, this is where you see what's narrowing the
 * rows without opening it.
 */
export function ActiveFilterChips({
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
  const currency = useAccountCurrency()
  const accounts = useQuery({
    queryKey: ['accounts'],
    queryFn: () => window.api.accounts.list()
  }).data
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => window.api.categories.list()
  }).data
  const categoryName = new Map(
    [
      ...(categories?.groups.flatMap((g) => g.categories) ?? []),
      ...(categories?.ungrouped ?? []),
      ...(categories?.system ?? [])
    ].map((c) => [c.id, c.name])
  )
  const money = (value: number) => formatAmount(value, currency)

  const chips: Chip[] = []
  if (!hideAccounts && filters.accountIds !== undefined) {
    const ids = filters.accountIds
    chips.push({
      key: 'accounts',
      label:
        ids.length === 1
          ? (accounts?.find((a) => a.id === ids[0])?.name ?? '1 account')
          : plural(ids.length, 'account'),
      clear: { ...filters, accountIds: undefined }
    })
  }
  if (filters.categoryIds !== undefined || filters.includeUncategorized) {
    const names = [
      ...(filters.categoryIds ?? []).map((id) => categoryName.get(id) ?? ''),
      ...(filters.includeUncategorized ? ['Uncategorized'] : [])
    ]
    chips.push({
      key: 'categories',
      label: names.length === 1 && names[0] ? names[0] : `${names.length} categories`,
      clear: { ...filters, categoryIds: undefined, includeUncategorized: undefined }
    })
  }
  // a drill into a category group's bar; no control sets this, so the chip is
  // the only place it shows
  if (filters.categoryGroupIds?.length) {
    const ids = filters.categoryGroupIds
    chips.push({
      key: 'groups',
      label:
        ids.length === 1
          ? (categories?.groups.find((g) => g.id === ids[0])?.name ?? '1 group')
          : plural(ids.length, 'group'),
      clear: { ...filters, categoryGroupIds: undefined }
    })
  }
  if (filters.direction !== 'all') {
    chips.push({
      key: 'direction',
      label: filters.direction === 'income' ? 'Income only' : 'Expenses only',
      clear: { ...filters, direction: 'all' }
    })
  }
  if (filters.amountMin !== undefined || filters.amountMax !== undefined) {
    const { amountMin: min, amountMax: max } = filters
    chips.push({
      key: 'amount',
      label:
        min !== undefined && max !== undefined
          ? `${money(min)} to ${money(max)}`
          : min !== undefined
            ? `${money(min)} or more`
            : `Up to ${money(max!)}`,
      clear: { ...filters, amountMin: undefined, amountMax: undefined }
    })
  }
  if (filters.descriptionSearch?.length) {
    chips.push({
      key: 'description',
      label: `Description: ${filters.descriptionSearch.join(', ')}`,
      clear: { ...filters, descriptionSearch: undefined }
    })
  }
  if (!filters.includePending) {
    chips.push({
      key: 'pending',
      label: 'No pending',
      clear: { ...filters, includePending: true }
    })
  }
  if (filters.includeTransfers !== defaultFilters.includeTransfers) {
    chips.push({
      key: 'transfers',
      label: filters.includeTransfers ? 'With transfers' : 'No transfers',
      clear: { ...filters, includeTransfers: defaultFilters.includeTransfers }
    })
  }
  // a chat answer's exact rows; clearing the pin keeps the rest of the filter
  if (filters.transactionIds?.length) {
    chips.push({
      key: 'pinned',
      label: plural(filters.transactionIds.length, 'pinned transaction'),
      clear: { ...filters, transactionIds: undefined }
    })
  }
  if (chips.length === 0) return null

  return (
    <ul className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
      {chips.map((chip) => (
        <li
          key={chip.key}
          className="flex h-6 max-w-72 items-center gap-1 rounded-full bg-muted pr-1 pl-2.5 text-footnote"
        >
          <span className="truncate">{chip.label}</span>
          <button
            type="button"
            aria-label={`Clear ${chip.label}`}
            className="flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={() => onChange(chip.clear)}
          >
            <HugeiconsIcon icon={Cancel01Icon} className="size-3" />
          </button>
        </li>
      ))}
    </ul>
  )
}
