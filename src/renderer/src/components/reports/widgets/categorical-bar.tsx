import { useMemo } from 'react'
import type { QueryRow, WidgetConfig } from '@shared/reports'
import { Chart } from '@/components/charts/chart'
import { groupTotals } from '../data'
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
  const measure = displayMeasure(config)
  const currency = currencies[0] ?? 'USD'
  const fv = makeFormatValue(measure, currency)
  const data = totals.map((t) => ({ label: t.label, value: t.value, currency: t.currency }))
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
