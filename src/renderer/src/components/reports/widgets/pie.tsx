import { useMemo } from 'react'
import type { QueryRow, WidgetConfig } from '@shared/reports'
import { Chart } from '@/components/charts/chart'
import { groupTotals } from '../data'
import { CenteredNote, MixedCurrencyBadge } from './shared'
import { displayMeasure, makeFormatValue } from './measure'
import type { OnDrill } from '../use-drill'

export function PieChartWidget({
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
    () =>
      groupTotals(
        rows,
        config.query.sort ?? { by: 'value', dir: 'desc' },
        config.query.limit ?? 8
      ).filter((t) => t.value > 0),
    [rows, config.query.sort, config.query.limit]
  )
  if (totals.length === 0) {
    return (
      <CenteredNote>No positive values to chart. Try the expense or income measure.</CenteredNote>
    )
  }
  const measure = displayMeasure(config)
  const fv = makeFormatValue(measure, currencies[0] ?? 'USD')
  const data = totals.map((t) => ({ label: t.label, value: t.value, currency: t.currency }))
  return (
    <div className="relative h-full px-4 pb-4">
      <MixedCurrencyBadge currencies={currencies} />
      <Chart
        kind="pie"
        data={data}
        labelKey="label"
        valueKey="value"
        formatValue={fv}
        donut={config.display?.donut ?? false}
        legend={config.display?.showLegend ?? false}
        sensitive={measure !== 'count'}
        onSelect={onDrill && ((index) => onDrill({ groupIds: totals[index].groupIds }))}
        className="h-full"
      />
    </div>
  )
}
