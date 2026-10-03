import type { ReportFilters, ReportWidget, WidgetConfig } from '@shared/reports'
import { TransactionsTable } from '@/components/transactions/transactions-table'
import { useResolvedQuery } from '../use-widget-data'

export function TransactionsWidget({
  widget,
  config,
  reportFilters
}: {
  widget: ReportWidget
  config: WidgetConfig
  reportFilters: ReportFilters
}) {
  const resolved = useResolvedQuery(config, reportFilters)
  return (
    <TransactionsTable
      queryKey={['report-data', widget.id, resolved.filters]}
      fetchPage={(query) =>
        window.api.reports.transactions({ ...query, filters: resolved.filters })
      }
      showAccount
      className="h-full min-h-0 [--table-edge:--spacing(4)]"
    />
  )
}
