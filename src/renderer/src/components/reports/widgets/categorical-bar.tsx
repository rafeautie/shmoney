import { useMemo } from 'react'
import type { QueryRow, WidgetConfig } from '@shared/reports'
import { Chart } from '@/components/charts/chart'
import { POINT_COLOR } from '@/components/charts/chart-style'
import { totalColor, useEntityColors } from '../entity-colors'
import { groupTotals, type GroupTotal } from '../data'
import { CenteredNote, MixedCurrencyBadge } from './shared'
import { displayMeasure, makeFormatValue } from './measure'
import type { OnDrill } from '../use-drill'

// no time axis, grouped
export function CategoricalBarChart({
  config,
  rows,
  currencies,
  onDrill
}: {
  config: WidgetConfig
  rows: QueryRow[]
  currencies: string[]
  onDrill?: OnDrill
}) {
  const totals = useMemo(
    () => groupTotals(rows, config.query.sort ?? { by: 'value', dir: 'desc' }, config.query.limit),
    [rows, config.query.sort, config.query.limit]
  )
  if (totals.length === 0) {
    return <CenteredNote>No transactions match these filters.</CenteredNote>
  }
  return (
    <TotalsBarChart config={config} totals={totals} currencies={currencies} onDrill={onDrill} />
  )
}

/** One bar per group total; also what radar draws when it has too few axes. */
export function TotalsBarChart({
  config,
  totals,
  currencies,
  onDrill
}: {
  config: WidgetConfig
  totals: GroupTotal[]
  currencies: string[]
  onDrill?: OnDrill
}) {
  const colorOf = useEntityColors(config.query.source, config.query.groupBy)
  const measure = displayMeasure(config)
  const fv = makeFormatValue(measure, currencies[0] ?? 'USD')
  // each bar is an entity, so it wears that entity's color from every other widget
  const data = totals.map((t) => ({
    label: t.label,
    value: t.value,
    currency: t.currency,
    [POINT_COLOR]: totalColor(t, colorOf) ?? null
  }))
  return (
    <div className="relative h-full px-4 pb-4">
      <MixedCurrencyBadge currencies={currencies} />
      <Chart
        kind="bar"
        data={data}
        xKey="label"
        series={[{ key: 'value', label: 'Value' }]}
        formatValue={fv}
        colorByPoint
        tooltipMode="point"
        sensitive={measure !== 'count'}
        onSelect={onDrill && ((index) => onDrill({ groupIds: totals[index].groupIds }))}
        className="h-full"
      />
    </div>
  )
}
