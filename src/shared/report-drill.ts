import {
  bucketBounds,
  mergeFilters,
  resolveDateRange,
  type ReportFilters,
  type WidgetConfig
} from './reports'
import type { Category } from './ipc'
import type { TransactionFilters } from './transaction-filters'

/** What a click on a chart mark picked out. */
export interface DrillTarget {
  /** the clicked time bucket; omitted on charts without a time axis */
  bucket?: string
  /** first bucket of the span, for cumulative charts whose points sum everything before them */
  fromBucket?: string
  /** group ids the mark stands for (several for an "Other" rollup); null = no category.
   * Omitted when the widget has no group by. */
  groupIds?: (number | null)[]
}

/**
 * The transaction filters behind one mark: the widget's effective filters
 * narrowed to the clicked bucket and group. Null when the mark has no
 * transaction-filter equivalent (goal sources, or an ungrouped mark before
 * the categories have loaded).
 */
export function drillFilters(
  config: WidgetConfig,
  reportFilters: ReportFilters,
  target: DrillTarget,
  nowSec: number,
  categories?: Pick<Category, 'id' | 'groupId' | 'systemKey'>[]
): TransactionFilters | null {
  if (config.query.source === 'goals') return null
  const filters: TransactionFilters = { ...mergeFilters(reportFilters, config.filters) }
  const { measure, groupBy, timeGrain } = config.query

  // income and expense measures only count one sign, so the list should too
  if ((measure === 'income' || measure === 'expense') && filters.direction === 'all') {
    filters.direction = measure
  }

  if (timeGrain !== 'none' && target.bucket) {
    const range = resolveDateRange(filters.dateRange, nowSec)
    const from = bucketBounds(timeGrain, target.fromBucket ?? target.bucket)
    const to = bucketBounds(timeGrain, target.bucket)
    filters.dateRange = {
      kind: 'absolute',
      start: Math.max(from.start, range.start ?? from.start),
      end: Math.min(to.end, range.end ?? to.end)
    }
  }

  const ids = target.groupIds
  if (groupBy !== 'none' && ids) {
    const known = ids.filter((id): id is number => id !== null)
    switch (groupBy) {
      case 'category':
        filters.categoryIds = known.length ? known : undefined
        filters.includeUncategorized = ids.includes(null) || undefined
        break
      case 'categoryGroup': {
        if (known.length === ids.length) {
          filters.categoryGroupIds = known
          break
        }
        // the ungrouped mark is every category outside a group plus the rows
        // with none, which a group filter can't say: list those categories
        // instead, minus the ones the report itself leaves out
        if (!categories) return null
        const groups = new Set(known)
        const picked = categories
          .filter((c) => c.groupId === null || groups.has(c.groupId))
          .filter((c) => c.systemKey !== 'opening')
          .filter((c) => filters.includeTransfers || c.systemKey !== 'transfers')
          .map((c) => c.id)
        filters.categoryIds = picked.length ? picked : undefined
        filters.includeUncategorized = true
        break
      }
      case 'account':
        filters.accountIds = known
        break
    }
  }
  return filters
}

/**
 * The transactions behind budget envelopes in one month, matching how the
 * budget counts spending: every account, pending included, outflows only.
 */
export function budgetDrillFilters(month: string, categoryIds: number[]): TransactionFilters {
  const { start, end } = bucketBounds('month', month)
  return {
    dateRange: { kind: 'absolute', start, end },
    direction: 'expense',
    includePending: true,
    includeTransfers: true,
    categoryIds
  }
}
