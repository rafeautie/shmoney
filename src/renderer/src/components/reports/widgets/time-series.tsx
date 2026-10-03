import { useMemo } from 'react'
import type {
  QueryRow,
  ReportWidget,
  ResolvedQuery,
  TimeGrain,
  WidgetConfig
} from '@shared/reports'
import { formatBucketLabel } from '@/lib/format-date'
import { Chart } from '@/components/charts/chart'
import { pivotTimeSeries } from '../data'
import { CenteredNote, MixedCurrencyBadge } from './shared'
import { displayMeasure, makeFormatValue } from './measure'
import type { OnDrill } from '../use-drill'

export function TimeSeriesChart({
  widget,
  config,
  rows,
  currencies,
  resolved,
  onDrill
}: {
  widget: ReportWidget
  config: WidgetConfig
  rows: QueryRow[]
  currencies: string[]
  resolved: ResolvedQuery
  onDrill?: OnDrill
}) {
  const grain = config.query.timeGrain as Exclude<TimeGrain, 'none'>
  // a level, not a flow: a running total of one is nonsense, and zero-filling
  // would draw a drop to $0 in a bucket that is merely quiet
  const isGoals = config.query.source === 'goals'
  const { data, series, tooManyBuckets } = useMemo(
    () =>
      pivotTimeSeries(
        rows,
        grain,
        resolved.filters.dateStart,
        resolved.filters.dateEnd,
        isGoals ? false : config.query.cumulative,
        isGoals ? false : config.query.measure !== 'avg'
      ),
    [
      rows,
      grain,
      resolved.filters.dateStart,
      resolved.filters.dateEnd,
      isGoals,
      config.query.cumulative,
      config.query.measure
    ]
  )

  if (tooManyBuckets) {
    return <CenteredNote>Too many data points. Pick a coarser time grain.</CenteredNote>
  }
  if (rows.length === 0) {
    return <CenteredNote>No transactions match these filters.</CenteredNote>
  }

  const currency = currencies[0] ?? 'USD'
  const measure = displayMeasure(config)
  const fv = makeFormatValue(measure, currency)
  const chartSeries = series.map((s) => ({ key: s.key, label: s.label, currency: s.currency }))
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
