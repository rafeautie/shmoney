import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDownRight01Icon, ArrowUpRight01Icon, MinusSignIcon } from '@hugeicons/core-free-icons'
import {
  mergeFilters,
  previousPeriod,
  type Measure,
  type QueryRow,
  type ReportFilters,
  type ReportWidget,
  type ResolvedQuery,
  type WidgetConfig
} from '@shared/reports'
import { cn, startOfTodayEpoch } from '@/lib/utils'
import { Amount } from '@/components/amount'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { CenteredNote } from './shared'
import { displayMeasure, formatMeasureValue } from './measure'
import { DRILL_LABEL, DRILL_TARGET, type OnDrill } from '../use-drill'

function totalFor(rows: QueryRow[], currency: string): number {
  return rows.filter((r) => r.currency === currency).reduce((sum, r) => sum + r.value, 0)
}

/** The same query over the window before the widget's own. */
function usePreviousPeriod(
  widgetId: number,
  config: WidgetConfig,
  reportFilters: ReportFilters,
  resolved: ResolvedQuery
) {
  const today = startOfTodayEpoch()
  const period = useMemo(
    () =>
      config.query.source === 'goals'
        ? null
        : previousPeriod(mergeFilters(reportFilters, config.filters).dateRange, today),
    [config, reportFilters, today]
  )
  const previous = useMemo(
    () =>
      period && {
        ...resolved,
        filters: { ...resolved.filters, dateStart: period.start, dateEnd: period.end }
      },
    [period, resolved]
  )
  const query = useQuery({
    queryKey: ['report-data', widgetId, 'previous', previous],
    queryFn: () => window.api.reports.runQuery(previous!),
    enabled: previous !== null,
    placeholderData: (prev) => prev
  })
  return { period, rows: query.data?.rows, isLoading: query.isLoading }
}

// up is good news for money in, bad news for money out; counts and averages
// have no good direction
const UP_TONE: Partial<Record<Measure, 'good' | 'bad'>> = {
  sum: 'good',
  income: 'good',
  expense: 'bad'
}

const percentFormat = new Intl.NumberFormat(undefined, {
  style: 'percent',
  maximumFractionDigits: 0,
  signDisplay: 'exceptZero'
})

function StatChange({
  measure,
  current,
  previous,
  currency,
  label,
  range
}: {
  measure: Measure
  current: number
  previous: number
  currency: string
  label: string
  range: string
}) {
  const delta = current - previous
  const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
  const tone =
    direction === 'flat'
      ? undefined
      : (direction === 'up') === (UP_TONE[measure] === 'good')
        ? UP_TONE[measure] && 'text-green-600 dark:text-green-400'
        : UP_TONE[measure] && 'text-red-600 dark:text-red-500'
  const icon =
    direction === 'up'
      ? ArrowUpRight01Icon
      : direction === 'down'
        ? ArrowDownRight01Icon
        : MinusSignIcon
  return (
    <div
      className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
      title={`Compared with ${range}`}
    >
      <span className={cn('flex shrink-0 items-center gap-0.5 font-medium', tone)}>
        <HugeiconsIcon icon={icon} className="size-3.5" aria-hidden />
        <span className="sr-only">
          {direction === 'up' ? 'Up' : direction === 'down' ? 'Down' : 'No change'}
        </span>
        {direction !== 'flat' && (
          <>
            <span>
              {delta > 0 ? '+' : '−'}
              {measure === 'count' ? (
                formatMeasureValue(measure, Math.abs(delta), currency)
              ) : (
                <Amount value={Math.abs(delta)} currency={currency} colored={false} />
              )}
            </span>
            {previous !== 0 && (
              <span className="tabular-nums">
                ({percentFormat.format(delta / Math.abs(previous))})
              </span>
            )}
          </>
        )}
      </span>
      <span className="truncate">vs {label}</span>
    </div>
  )
}

export function StatCardWidget({
  widget,
  config,
  rows,
  currencies,
  resolved,
  reportFilters,
  onDrill
}: {
  widget: ReportWidget
  config: WidgetConfig
  rows: QueryRow[]
  currencies: string[]
  resolved: ResolvedQuery
  reportFilters: ReportFilters
  onDrill?: OnDrill
}) {
  const measure = displayMeasure(config)
  const previous = usePreviousPeriod(widget.id, config, reportFilters, resolved)
  // the group is always the goal, so summing them would answer nobody's question
  if (config.query.source === 'goals') {
    return (
      <ScrollArea className="h-full">
        <div className="space-y-3 p-4">
          {rows.map((row) => (
            <div key={`${row.groupId}-${row.currency}`} className="min-w-0">
              <div className="truncate text-xs text-muted-foreground">{row.groupLabel}</div>
              <Amount
                value={row.value}
                currency={row.currency}
                colored={false}
                className="text-2xl font-semibold tracking-tight"
              />
            </div>
          ))}
        </div>
      </ScrollArea>
    )
  }
  // one row per currency when groupBy/timeGrain are 'none'; a currency that only
  // appears in the previous window has nothing to headline, so it is left out
  const byCurrency = currencies.map((currency) => ({ currency, value: totalFor(rows, currency) }))
  if (byCurrency.length === 0) {
    return <CenteredNote>No transactions match these filters.</CenteredNote>
  }
  const { period } = previous
  const range =
    period &&
    `${format(new Date(period.start * 1000), 'MMM d, yyyy')} to ${format(new Date(period.end * 1000), 'MMM d, yyyy')}`
  const headline = cn('text-3xl font-semibold tracking-tight', onDrill && DRILL_LABEL)
  return (
    <div
      className={cn(
        'flex h-full flex-col items-start justify-center gap-2 overflow-hidden p-4',
        onDrill && cn(DRILL_TARGET, 'rounded-xl focus-visible:ring-2 focus-visible:ring-ring/50')
      )}
      {...(onDrill && {
        role: 'button',
        tabIndex: 0,
        // the tile sums every bucket and group, so it opens the whole filtered list
        onClick: () => onDrill({}),
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault()
          onDrill({})
        }
      })}
    >
      {byCurrency.map(({ currency, value }) => (
        <div key={currency} className="flex max-w-full min-w-0 flex-col gap-1">
          {
            // a count is not money: no currency, no sign color, and nothing to hide
            // behind the privacy blur
            measure === 'count' ? (
              <span className={cn(headline, 'tabular-nums')}>
                {formatMeasureValue(measure, value, currency)}
              </span>
            ) : (
              <Amount
                value={value}
                currency={currency}
                colored={measure === 'sum'}
                className={headline}
              />
            )
          }
          {period &&
            (previous.rows ? (
              <StatChange
                measure={config.query.measure}
                current={value}
                previous={totalFor(previous.rows, currency)}
                currency={currency}
                label={period.label}
                range={range!}
              />
            ) : (
              // holds the line's height so the tile doesn't jump when it loads
              <Skeleton className="h-4 w-32" />
            ))}
        </div>
      ))}
    </div>
  )
}
