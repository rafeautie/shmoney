import { useMemo } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import {
  resolveQuery,
  type ReportFilters,
  type ResolvedQuery,
  type RunQueryResult,
  type WidgetConfig
} from '@shared/reports'
import { resolveGoalQuery } from '@shared/goals'
import { startOfTodayEpoch } from '@/lib/utils'

export function useResolvedQuery(
  config: WidgetConfig,
  reportFilters: ReportFilters
): ResolvedQuery {
  const today = startOfTodayEpoch()
  return useMemo(() => resolveQuery(config, reportFilters, today), [config, reportFilters, today])
}

/** Fetch aggregated rows for a widget. The resolved query object is part of the
 * key: filter-bar changes refetch only widgets that inherit them. Goal sources
 * call goals:series, which returns the same shape, so nothing downstream changes. */
export function useWidgetData(
  widgetId: number,
  config: WidgetConfig,
  reportFilters: ReportFilters
): { resolved: ResolvedQuery; query: UseQueryResult<RunQueryResult> } {
  const resolved = useResolvedQuery(config, reportFilters)
  const isGoals = config.query.source === 'goals'
  const goalQuery = useMemo(() => resolveGoalQuery(config, resolved), [config, resolved])
  const query = useQuery({
    queryKey: isGoals
      ? ['goals', 'widget-series', widgetId, goalQuery]
      : ['report-data', widgetId, resolved],
    queryFn: () =>
      isGoals ? window.api.goals.series(goalQuery) : window.api.reports.runQuery(resolved),
    placeholderData: (prev) => prev
  })
  return { resolved, query }
}
