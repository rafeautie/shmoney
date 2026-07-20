import { useMemo, type ReactNode } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis
} from 'recharts'
import { cn } from '@/lib/utils'
import { usePrivacy } from '@/lib/settings'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
} from '@/components/ui/chart'
import { BLUR_Y_TICK_LABELS, paletteColor } from './chart-style'

// The one chart-drawing surface shared by the report widgets and the chat
// charts. It owns the house style — axes, tooltip, legend, palette, per-point
// coloring, privacy blur — for the chart family both surfaces have in common
// (line / bar / area / pie / stat). Report-only widgets (radar, radial, gauge,
// budget) keep their own drawing in widget-renderer.
//
// It stays unit-agnostic: callers inject `formatValue`, so chat can pass real
// amounts and report widgets can pass milliunits without either data pipeline
// leaking into here. `currency` rides through `formatValue`'s options so a
// multi-currency report chart formats each series/slice in its own currency;
// single-currency callers just ignore it.

type ChartRow = Record<string, string | number | null>

/** value → display text; `compact` for axis ticks, `currency` for per-series formatting. */
export type FormatValue = (
  value: number,
  opts?: { compact?: boolean; currency?: string | null }
) => string

export interface ChartSeries {
  /** field in each data row; also the CSS --color-<key> key (must be [a-zA-Z0-9_-]) */
  key: string
  label: string
  /** per-series currency (report time series); omit for single-currency callers */
  currency?: string | null
}

export interface StatItem {
  value: number
  currency?: string | null
  /** green/red by sign (report sums); never for counts */
  colored?: boolean
  /** a signed secondary line under the headline (chat's period-over-period change) */
  change?: { value: number; label: string } | null
  /** false for counts: skip the privacy blur and sign coloring. Default true. */
  sensitive?: boolean
}

interface CommonProps {
  formatValue: FormatValue
  /** passthrough to the chart's root (height/aspect/padding); callers own outer layout */
  className?: string
}

interface CartesianProps {
  kind: 'line' | 'bar' | 'area'
  data: ChartRow[]
  xKey: string
  series: ChartSeries[]
  /** x-axis + tooltip label formatter (bucket → "Jan 2026"); identity by default */
  formatLabel?: (label: string) => string
  stacked?: boolean
  /** true | false | 'auto' (auto shows the legend when there's more than one series). Default 'auto'. */
  legend?: boolean | 'auto'
  /** single-series bars colored per point (categorical breakdowns) vs one color (time series). */
  colorByPoint?: boolean
  /** 'series' = top label + one row per series (time series); 'point' = a single row labelled by the datum. Default 'series'. */
  tooltipMode?: 'series' | 'point'
  /** false for counts: skip the y-axis privacy blur. Default true. */
  sensitive?: boolean
}

interface PieProps {
  kind: 'pie'
  /** pre-rolled slices (positive, sorted, top-N + "Other"); colored here by order */
  data: ChartRow[]
  /** slice label field (legend + tooltip) */
  labelKey: string
  /** slice value field */
  valueKey: string
  /** default true */
  legend?: boolean
  donut?: boolean
  /** false for counts: skip the tooltip blur. Default true. */
  sensitive?: boolean
}

interface StatProps {
  kind: 'stat'
  items: StatItem[]
}

export type ChartProps = CommonProps & (CartesianProps | PieProps | StatProps)

export function Chart(props: ChartProps) {
  switch (props.kind) {
    case 'pie':
      return <PieView {...props} />
    case 'stat':
      return <StatBlock {...props} />
    default:
      return <CartesianView {...props} />
  }
}

// ---------- shared pieces ----------

/** A formatted value with the standard privacy blur (and optional signed color). */
function ValueText({
  value,
  currency,
  formatValue,
  colored = false,
  sensitive = true,
  className
}: {
  value: number
  currency?: string | null
  formatValue: FormatValue
  colored?: boolean
  sensitive?: boolean
  className?: string
}) {
  const { blurAmounts } = usePrivacy()
  return (
    <span
      className={cn(
        'tabular-nums',
        sensitive && colored && value > 0 && 'text-green-500 dark:text-green-400',
        sensitive && colored && value < 0 && 'text-red-600 dark:text-red-500',
        sensitive && blurAmounts && 'bg-foreground/20 blur-sm select-none',
        className
      )}
    >
      {formatValue(value, { currency })}
    </span>
  )
}

/** Shared tooltip body: swatch, label on the left, formatted value on the right. */
function TooltipRow({
  label,
  value,
  currency,
  color,
  formatValue,
  sensitive
}: {
  label: ReactNode
  value: number
  currency?: string | null
  color?: string
  formatValue: FormatValue
  sensitive?: boolean
}) {
  return (
    <>
      {color && (
        <div className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: color }} />
      )}
      <div className="flex flex-1 items-center justify-between gap-4 leading-none">
        <span className="text-muted-foreground">{label}</span>
        <ValueText
          value={value}
          currency={currency}
          formatValue={formatValue}
          sensitive={sensitive}
          className="font-mono font-medium"
        />
      </div>
    </>
  )
}

/** Defensive fallback for degenerate data; callers guard real empty states themselves. */
function ChartNote({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-muted-foreground italic">{children}</p>
}

// ---------- line / bar / area ----------

function CartesianView({
  kind,
  data,
  xKey,
  series,
  formatValue,
  formatLabel,
  stacked = false,
  legend = 'auto',
  colorByPoint = false,
  tooltipMode = 'series',
  sensitive = true,
  className
}: CartesianProps & CommonProps) {
  const { blurAmounts } = usePrivacy()
  if (data.length === 0 || series.length === 0) return <ChartNote>Nothing to chart.</ChartNote>

  const chartConfig: ChartConfig = Object.fromEntries(
    series.map((s, i) => [s.key, { label: s.label, color: paletteColor(i) }])
  )
  const labelFmt = formatLabel ?? ((l: string) => l)
  const showLegend = legend === 'auto' ? series.length > 1 : legend
  const singleSeries = series.length === 1

  const axes = (
    <>
      <CartesianGrid vertical={false} />
      <XAxis
        dataKey={xKey}
        tickLine={false}
        axisLine={false}
        tickMargin={8}
        minTickGap={24}
        tickFormatter={labelFmt}
      />
      <YAxis
        tickLine={false}
        axisLine={false}
        width={56}
        tickFormatter={(value: number) => formatValue(value, { compact: true })}
      />
    </>
  )
  const tooltip =
    tooltipMode === 'point' ? (
      <ChartTooltip
        content={
          <ChartTooltipContent
            hideLabel
            formatter={(value, _name, item) => (
              <TooltipRow
                label={item.payload?.[xKey]}
                value={value as number}
                currency={item.payload?.currency}
                formatValue={formatValue}
                sensitive={sensitive}
              />
            )}
          />
        }
      />
    ) : (
      <ChartTooltip
        content={
          <ChartTooltipContent
            labelFormatter={(l) => (typeof l === 'string' ? labelFmt(l) : l)}
            formatter={(value, name, item) => (
              <TooltipRow
                color={item.color}
                label={chartConfig[name as string]?.label ?? name}
                value={value as number}
                currency={series.find((s) => s.key === name)?.currency ?? item.payload?.currency}
                formatValue={formatValue}
                sensitive={sensitive}
              />
            )}
          />
        }
      />
    )
  const legendEl = showLegend ? <ChartLegend content={<ChartLegendContent />} /> : null

  return (
    <ChartContainer
      config={chartConfig}
      className={cn(
        'aspect-auto w-full',
        blurAmounts && sensitive && BLUR_Y_TICK_LABELS,
        className
      )}
    >
      {kind === 'line' ? (
        <LineChart data={data} margin={{ top: 16, right: 8 }}>
          {axes}
          {tooltip}
          {legendEl}
          {series.map((s) => (
            <Line
              key={s.key}
              dataKey={s.key}
              type="monotone"
              stroke={`var(--color-${s.key})`}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      ) : kind === 'area' ? (
        <AreaChart data={data} margin={{ top: 16, right: 8 }}>
          {axes}
          {tooltip}
          {legendEl}
          {series.map((s) => (
            <Area
              key={s.key}
              dataKey={s.key}
              type="monotone"
              stroke={`var(--color-${s.key})`}
              fill={`var(--color-${s.key})`}
              fillOpacity={0.3}
              stackId={stacked ? 'stack' : s.key}
            />
          ))}
        </AreaChart>
      ) : (
        <BarChart data={data} margin={{ top: 16, right: 8 }}>
          {axes}
          {tooltip}
          {legendEl}
          {colorByPoint && singleSeries ? (
            // a single-series breakdown colors per bar, like the report's categorical bar
            <Bar dataKey={series[0].key} radius={stacked ? 0 : [2, 2, 0, 0]}>
              {data.map((_row, i) => (
                <Cell key={i} fill={paletteColor(i)} />
              ))}
            </Bar>
          ) : (
            series.map((s) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                fill={`var(--color-${s.key})`}
                stackId={stacked ? 'stack' : undefined}
                radius={stacked ? 0 : [2, 2, 0, 0]}
              />
            ))
          )}
        </BarChart>
      )}
    </ChartContainer>
  )
}

// ---------- pie / donut ----------

function PieView({
  data,
  labelKey,
  valueKey,
  formatValue,
  legend = true,
  donut = false,
  sensitive = true,
  className
}: PieProps & CommonProps) {
  // slices carry an explicit fill so Recharts colors each by order
  const slices = useMemo(() => data.map((row, i) => ({ ...row, fill: paletteColor(i) })), [data])
  if (data.length === 0) return <ChartNote>Nothing to chart.</ChartNote>

  // keyed by slice label: the legend looks entries up by the datum's nameKey
  const chartConfig: ChartConfig = Object.fromEntries(
    data.map((row) => [String(row[labelKey]), { label: String(row[labelKey]) }])
  )
  return (
    <ChartContainer config={chartConfig} className={cn('aspect-auto w-full', className)}>
      <PieChart>
        <ChartTooltip
          content={
            <ChartTooltipContent
              hideLabel
              formatter={(value, _name, item) => (
                <TooltipRow
                  label={item.payload?.[labelKey]}
                  value={value as number}
                  currency={item.payload?.currency}
                  formatValue={formatValue}
                  sensitive={sensitive}
                />
              )}
            />
          }
        />
        {legend ? <ChartLegend content={<ChartLegendContent nameKey={labelKey} />} /> : null}
        <Pie
          data={slices}
          dataKey={valueKey}
          nameKey={labelKey}
          innerRadius={donut ? '55%' : 0}
          strokeWidth={2}
        />
      </PieChart>
    </ChartContainer>
  )
}

// ---------- stat (headline numbers, optionally with a signed change) ----------

function StatBlock({ items, formatValue, className }: StatProps & CommonProps) {
  if (items.length === 0) return <ChartNote>Nothing to chart.</ChartNote>
  return (
    <div className={cn('flex flex-col items-start gap-1', className)}>
      {items.map((item, i) => (
        <div key={i} className="flex flex-col gap-1">
          <ValueText
            value={item.value}
            currency={item.currency}
            formatValue={formatValue}
            colored={item.colored}
            sensitive={item.sensitive ?? true}
            className="text-3xl font-semibold tracking-tight"
          />
          {item.change && (
            <div className="flex items-center gap-1.5">
              <ValueText
                value={item.change.value}
                currency={item.currency}
                formatValue={(value, opts) =>
                  `${item.change!.value > 0 ? '+' : ''}${formatValue(value, opts)}`
                }
                colored
                className="font-medium"
              />
              <span className="text-muted-foreground">{item.change.label}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
