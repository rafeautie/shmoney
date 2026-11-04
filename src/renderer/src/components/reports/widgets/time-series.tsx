import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  bucketBounds,
  bucketLabelFor,
  mergeFilters,
  previousWindow,
  type Measure,
  type QueryRow,
  type ReportFilters,
  type ReportWidget,
  type ResolvedQuery,
  type TimeGrain,
  type WidgetConfig
} from '@shared/reports'
import { formatBucketLabel } from '@/lib/format-date'
import { startOfTodayEpoch } from '@/lib/utils'
import { Chart } from '@/components/charts/chart'
import { pivotTimeSeries, projectInProgress } from '../data'
import { useEntityColors } from '../entity-colors'
import { CenteredNote, MixedCurrencyBadge } from './shared'
import { displayMeasure, makeFormatValue } from './measure'
import type { OnDrill } from '../use-drill'

const DAY = 86400

/** The window before often reaches past the start of the history (an import
 * covers the last year), and a ghost line at $0 there would read as a real
 * zero. Buckets before the first one with any data are left empty instead. */
function leadingGapsCleared<T extends { data: Record<string, string | number>[] }>(pivot: T): T {
  const first = pivot.data.findIndex((row) =>
    Object.entries(row).some(([key, v]) => key !== 'bucket' && typeof v === 'number' && v !== 0)
  )
  if (first <= 0) return pivot
  return {
    ...pivot,
    data: pivot.data.map((row, i) => (i < first ? { bucket: row.bucket } : row))
  }
}

/** An ungrouped chart's one series is named for what it measures (its rows
 * carry no group, which would otherwise read as "Uncategorized"). */
const MEASURE_SERIES_LABELS: Record<Measure, string> = {
  sum: 'Net',
  income: 'Income',
  expense: 'Expenses',
  count: 'Transactions',
  avg: 'Average'
}

/** The same query over the whole window before the widget's own, when it compares. */
function usePreviousWindow(
  widgetId: number,
  config: WidgetConfig,
  reportFilters: ReportFilters,
  resolved: ResolvedQuery
) {
  const today = startOfTodayEpoch()
  const merged = mergeFilters(reportFilters, config.filters)
  const compare = merged.compare === 'previous' && config.query.source !== 'goals'
  const span = compare ? previousWindow(merged.dateRange, today) : null
  const previous = span && {
    ...resolved,
    filters: { ...resolved.filters, dateStart: span.start, dateEnd: span.end }
  }
  const query = useQuery({
    meta: { silenceError: true },
    queryKey: ['report-data', widgetId, 'previous-window', previous],
    queryFn: () => window.api.reports.runQuery(previous!),
    enabled: previous !== null,
    placeholderData: (prev) => prev
  })
  return span && query.data ? { span, rows: query.data.rows } : null
}

export function TimeSeriesChart({
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
  const grain = config.query.timeGrain as Exclude<TimeGrain, 'none'>
  // a level, not a flow: a running total of one is nonsense, zero-filling
  // would draw a drop to $0 in a bucket that is merely quiet, and a level has
  // no pace to project
  const isGoals = config.query.source === 'goals'
  const cumulative = isGoals ? false : config.query.cumulative
  const additive = !isGoals && config.query.measure !== 'avg'
  const { dateStart, dateEnd } = resolved.filters
  const previous = usePreviousWindow(widget.id, config, reportFilters, resolved)
  const colorOf = useEntityColors(config.query.source, config.query.groupBy)
  // without a group by there is one series, drawn in the accent
  const grouped = isGoals || config.query.groupBy !== 'none'

  const chart = useMemo(() => {
    // day precision is enough: buckets after today are empty, and today's
    // share of a week or month reads from its middle
    const today = startOfTodayEpoch()
    const pivot = pivotTimeSeries(rows, grain, dateStart, dateEnd, cumulative, additive, today)
    // the bucket holding today is still filling up, like chat's partial months
    const current = bucketLabelFor(grain, new Date())
    const inProgressIndex = pivot.data.findIndex((row) => row.bucket === current)
    let projection: Record<string, number> | null = null
    // a day has no pace worth projecting, and a month-to-date line would jump at today
    if (additive && grain !== 'day' && inProgressIndex >= 0) {
      const raw = cumulative
        ? pivotTimeSeries(rows, grain, dateStart, dateEnd, false, true, today).data
        : pivot.data
      const bounds = bucketBounds(grain, current)
      const start = Math.max(bounds.start, dateStart ?? bounds.start)
      const end = Math.min(bounds.end, dateEnd ?? bounds.end)
      projection = projectInProgress(
        raw,
        pivot.data,
        inProgressIndex,
        pivot.series.map((s) => s.key),
        (today + DAY / 2 - start) / (end - start + 1)
      )
    }
    const before =
      previous &&
      leadingGapsCleared(
        pivotTimeSeries(
          previous.rows,
          grain,
          previous.span.start,
          previous.span.end,
          cumulative,
          additive
        )
      )
    return {
      ...pivot,
      inProgressIndex,
      projection,
      previous: before && { rows: before.data, label: previous.span.label }
    }
  }, [rows, grain, dateStart, dateEnd, cumulative, additive, previous])

  if (chart.tooManyBuckets) {
    return <CenteredNote>Too many data points. Pick a coarser time grain.</CenteredNote>
  }
  if (rows.length === 0) {
    return <CenteredNote>No transactions match these filters.</CenteredNote>
  }

  const { data, series } = chart
  const currency = currencies[0] ?? 'USD'
  const measure = displayMeasure(config)
  const fv = makeFormatValue(measure, currency)
  const chartSeries = series.map((s) => ({
    key: s.key,
    label: grouped ? s.label : MEASURE_SERIES_LABELS[config.query.measure],
    currency: s.currency,
    color: grouped ? colorOf?.(s.groupId) : undefined
  }))
  const kind = widget.type === 'line' ? 'line' : widget.type === 'area' ? 'area' : 'bar'

  return (
    <div className="relative h-full px-4 pb-4">
      <MixedCurrencyBadge currencies={currencies} />
      <Chart
        kind={kind}
        data={data}
        xKey="bucket"
        series={chartSeries}
        formatValue={fv}
        formatLabel={formatBucketLabel}
        stacked={config.display?.stacked ?? false}
        legend={config.display?.showLegend ?? false}
        sensitive={measure !== 'count'}
        inProgressIndex={chart.inProgressIndex}
        projection={chart.projection}
        previous={chart.previous}
        onSelect={
          onDrill &&
          ((index, key) => {
            const groupId = series.find((s) => s.key === key)?.groupId
            onDrill({
              bucket: String(data[index].bucket),
              // a running total at this point counts every bucket before it
              fromBucket: config.query.cumulative ? String(data[0].bucket) : undefined,
              groupIds: groupId === undefined ? undefined : [groupId]
            })
          })
        }
        className="h-full"
      />
    </div>
  )
}
