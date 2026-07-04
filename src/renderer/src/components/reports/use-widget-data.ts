import { useMemo } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import {
  resolveQuery,
  type ReportFilters,
  type ResolvedQuery,
  type RunQueryResult,
  type WidgetConfig
} from '@shared/reports'
import { startOfTodayEpoch } from '@/lib/utils'

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
