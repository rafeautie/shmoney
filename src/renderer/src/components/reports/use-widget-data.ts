import { useMemo } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import {
  resolveQuery,
  type ReportFilters,
  type ResolvedQuery,
  type RunQueryResult,
  type WidgetConfig
} from '@shared/reports'

/** Stable within a calendar day, so resolved relative ranges (and the React
 * Query keys built from them) don't churn on every render. */
export function startOfTodayEpoch(): number {
  const now = new Date()
  return Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000)
}

export function useResolvedQuery(
  config: WidgetConfig,
  reportFilters: ReportFilters
): ResolvedQuery {
  const today = startOfTodayEpoch()
  return useMemo(() => resolveQuery(config, reportFilters, today), [config, reportFilters, today])
}

/** Fetch aggregated rows for a widget. The resolved query object is part of the
 * key: filter-bar changes refetch only widgets that inherit them. */
export function useWidgetData(
  widgetId: number,
  config: WidgetConfig,
  reportFilters: ReportFilters
): { resolved: ResolvedQuery; query: UseQueryResult<RunQueryResult> } {
  const resolved = useResolvedQuery(config, reportFilters)
  const query = useQuery({
    queryKey: ['report-data', widgetId, resolved],
    queryFn: () => window.api.reports.runQuery(resolved),
    placeholderData: (prev) => prev
  })
  return { resolved, query }
}
