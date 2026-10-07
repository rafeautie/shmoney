import { useMemo } from 'react'
import { RadialBar, RadialBarChart } from 'recharts'
import type { QueryRow, WidgetConfig } from '@shared/reports'
import { cn } from '@/lib/utils'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
} from '@/components/ui/chart'
import { paletteColor } from '@/components/charts/chart-style'
import { groupTotals } from '../data'
import { CenteredNote, MixedCurrencyBadge, TooltipRow } from './shared'
import type { OnDrill } from '../use-drill'
import { displayMeasure } from './measure'

/**
 * A sweep of exactly 360 makes an arc's start and end point coincide, and
 * Recharts rounds path coordinates to 4 decimals. Solving that near-degenerate
 * arc back to a centre amplifies the rounding into a several-pixel shift, so
 * full rings (every `background` track, plus the largest bar) drift away from
 * the partial ones. A hair under a full turn keeps the arc well conditioned;
 * the gap it leaves is a fraction of a pixel.
 */
const FULL_TURN = 359.9

// past this many rings the inner ones shrink to unreadable arcs; the rest fold into "Other"
const MAX_RINGS = 6

export function RadialChartWidget({
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
        Math.min(config.query.limit ?? MAX_RINGS, MAX_RINGS)
      ).filter((t) => t.value > 0),
    [rows, config.query.sort, config.query.limit]
  )
  if (totals.length === 0) {
    return (
      <CenteredNote>No positive values to chart. Try the expense or income measure.</CenteredNote>
    )
  }
  const measure = displayMeasure(config)
  // keyed by arc label, mirroring the pie widget's legend lookup
  const chartConfig: ChartConfig = Object.fromEntries(
    totals.map((t) => [t.label, { label: t.label }])
  )
  const data = totals.map((t, i) => ({ ...t, fill: paletteColor(i) }))
  return (
    <div className="relative flex h-full flex-col px-4 pb-4">
      <MixedCurrencyBadge currencies={currencies} />
      <ChartContainer
        config={chartConfig}
        className={cn(
          'aspect-auto min-h-0 w-full flex-1',
          onDrill && '[&_.recharts-radial-bar-sector]:cursor-pointer'
        )}
      >
        <RadialBarChart
          data={data}
          startAngle={0}
          endAngle={FULL_TURN}
          innerRadius="25%"
          outerRadius="100%"
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
                    currency={item.payload?.currency}
                  />
                )}
              />
            }
          />
          <RadialBar
            dataKey="value"
            background
            isAnimationActive={false}
            onClick={onDrill && ((_bar, index) => onDrill({ groupIds: totals[index].groupIds }))}
          />
        </RadialBarChart>
      </ChartContainer>
      {/* rendered outside the chart: Recharts overlays its legend on polar plots */}
      {config.display?.showLegend && (
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-3 text-xs">
          {data.map((d) => (
            <div
              key={`${d.groupId}-${d.currency}-${d.label}`}
              className="flex items-center gap-1.5"
            >
              <div className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: d.fill }} />
              {d.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
