import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { budgetDrillFilters, drillFilters, type DrillTarget } from '@shared/report-drill'
import type { ReportFilters, WidgetConfig } from '@shared/reports'
import type { TransactionFilters } from '@shared/transaction-filters'
import { startOfTodayEpoch } from '@/lib/utils'

export type OnDrill = (target: DrillTarget) => void
export type OnBudgetDrill = (categoryIds: number[]) => void

function useOpenTransactions() {
  const navigate = useNavigate()
  return (filters: TransactionFilters) =>
    void navigate({ to: '/accounts', search: { tab: 'transactions', filters } })
}

/** Opens All transactions filtered to a clicked mark; undefined when the widget can't drill. */
export function useDrill(
  config: WidgetConfig,
  reportFilters: ReportFilters,
  enabled: boolean
): OnDrill | undefined {
  const open = useOpenTransactions()
  // an ungrouped category-group mark drills by category id
  const list = useQuery({
    queryKey: ['categories'],
    queryFn: () => window.api.categories.list(),
    enabled: enabled && config.query.groupBy === 'categoryGroup'
  }).data
  const categories = list && [
    ...list.groups.flatMap((g) => g.categories),
    ...list.ungrouped,
    ...list.system
  ]
  if (!enabled || config.query.source === 'goals') return undefined
  return (target) => {
    const filters = drillFilters(config, reportFilters, target, startOfTodayEpoch(), categories)
    if (filters) open(filters)
  }
}

/** Opens the month's spending in the clicked envelopes. */
export function useBudgetDrill(month: string, enabled: boolean): OnBudgetDrill | undefined {
  const open = useOpenTransactions()
  if (!enabled) return undefined
  return (categoryIds) => open(budgetDrillFilters(month, categoryIds))
}

/** On the clickable container of a drillable item; pairs with DRILL_LABEL. */
export const DRILL_TARGET = 'group/drill cursor-pointer focus-visible:outline-none'
/** On the item's label: underlined while its container is hovered or focused. */
export const DRILL_LABEL =
  'underline-offset-4 group-hover/drill:underline group-focus-visible/drill:underline'
