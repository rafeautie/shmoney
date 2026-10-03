import { useNavigate } from '@tanstack/react-router'
import { drillFilters, type DrillTarget } from '@shared/report-drill'
import type { ReportFilters, WidgetConfig } from '@shared/reports'
import { startOfTodayEpoch } from '@/lib/utils'

export type OnDrill = (target: DrillTarget) => void

/** Opens All transactions filtered to a clicked mark; undefined when the widget can't drill. */
export function useDrill(
  config: WidgetConfig,
  reportFilters: ReportFilters,
  enabled: boolean
): OnDrill | undefined {
  const navigate = useNavigate()
  if (!enabled || config.query.source === 'goals') return undefined
  return (target) => {
    const filters = drillFilters(config, reportFilters, target, startOfTodayEpoch())
    if (filters) void navigate({ to: '/accounts', search: { tab: 'transactions', filters } })
  }
}
