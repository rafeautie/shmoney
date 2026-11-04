import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  mergeFilters,
  type ReportFilters,
  type ReportWidget,
  type WidgetConfig
} from '@shared/reports'
import { Amount } from '@/components/amount'
import { Button } from '@/components/ui/button'
import { TransactionsTable } from '@/components/transactions/transactions-table'
import { useResolvedQuery } from '../use-widget-data'
import { useOpenTransactions } from '../drill-context'
import { CenteredNote, WidgetSkeleton } from './shared'

/** Enough to fill a tall card; the column wrap below hides whatever doesn't fit. */
const LIST_ROWS = 25

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
  if (config.display?.transactionsView === 'table') {
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
  return <RecentList widget={widget} config={config} reportFilters={reportFilters} />
}

/**
 * The latest rows as a short list, the way a dashboard shows recent activity:
 * a table that scrolls inside its card traps the wheel and repeats the
 * Transactions tab. "View all" opens the full, editable list.
 */
function RecentList({
  widget,
  config,
  reportFilters
}: {
  widget: ReportWidget
  config: WidgetConfig
  reportFilters: ReportFilters
}) {
  const resolved = useResolvedQuery(config, reportFilters)
  const openTransactions = useOpenTransactions()
  const query = useQuery({
    meta: { silenceError: true },
    queryKey: ['report-data', widget.id, 'recent', resolved.filters],
    queryFn: () =>
      window.api.reports.transactions({
        page: 0,
        pageSize: LIST_ROWS,
        sortBy: 'date',
        sortDir: 'desc',
        filters: resolved.filters
      }),
    placeholderData: (prev) => prev
  })
  if (query.isLoading) return <WidgetSkeleton />
  const rows = query.data?.rows ?? []
  if (rows.length === 0) return <CenteredNote>No transactions match these filters.</CenteredNote>
  // compare is a drawing choice, not a filter
  const { compare, ...filters } = mergeFilters(reportFilters, config.filters)
  return (
    <div className="@container flex h-full min-h-0 flex-col px-4 pb-3">
      {/* rows wrap into a second, clipped column instead of being cut in half */}
      <ul className="flex min-h-0 flex-1 flex-col flex-wrap content-start overflow-hidden">
        {rows.map((t) => (
          <li
            key={t.id}
            className="flex h-8 w-full shrink-0 items-center gap-3 border-b border-border/60 last:border-b-0"
          >
            <span className="w-12 shrink-0 text-footnote text-muted-foreground tabular-nums">
              {t.date ? format(new Date(t.date * 1000), 'MMM d') : ''}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {t.description}
              {t.pending && (
                <span className="ml-1.5 text-footnote text-muted-foreground">Pending</span>
              )}
            </span>
            {t.categoryName && (
              <span className="hidden max-w-40 shrink-0 truncate text-footnote text-muted-foreground @md:inline">
                {t.categoryName}
              </span>
            )}
            <Amount value={t.amount} currency={t.currency} className="shrink-0 text-right" />
          </li>
        ))}
      </ul>
      <Button
        variant="ghost"
        size="sm"
        className="mt-1 self-start text-muted-foreground"
        onClick={() => openTransactions(filters)}
      >
        View all
      </Button>
    </div>
  )
}
