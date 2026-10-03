import { useMemo } from 'react'
import { PolarAngleAxis, PolarGrid, Radar, RadarChart } from 'recharts'
import type { QueryRow, WidgetConfig } from '@shared/reports'
import { cn } from '@/lib/utils'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
} from '@/components/ui/chart'
import { groupTotals } from '../data'
import { CenteredNote, MixedCurrencyBadge, TooltipRow } from './shared'
import type { OnDrill } from '../use-drill'
import { displayMeasure } from './measure'

export function RadarChartWidget({
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
  const currency = currencies[0] ?? 'USD'
  const chartConfig: ChartConfig = { value: { label: 'Value', color: 'var(--chart-1)' } }
  return (
    <div className="relative h-full px-4 pb-4">
      <MixedCurrencyBadge currencies={currencies} />
      <ChartContainer
        config={chartConfig}
        className={cn(
          'aspect-auto h-full w-full',
          onDrill && '[&_.recharts-surface]:cursor-pointer'
        )}
      >
        <RadarChart
          data={totals}
          onClick={
            onDrill &&
            ((state) => {
              const total = totals[Number(state.activeTooltipIndex)]
              if (total) onDrill({ groupIds: total.groupIds })
            })
          }
        >
          <ChartTooltip
            content={
              <ChartTooltipContent
                hideLabel
                formatter={(value, _name, item) => (
                  <TooltipRow
                    label={item.payload?.label}
                    measure={measure}
                    value={value as number}
                    currency={item.payload?.currency ?? currency}
                  />
                )}
              />
            }
          />
          <PolarAngleAxis dataKey="label" />
          <PolarGrid />
          <Radar
            dataKey="value"
            fill="var(--color-value)"
            fillOpacity={0.6}
            isAnimationActive={false}
          />
        </RadarChart>
      </ChartContainer>
    </div>
  )
}
