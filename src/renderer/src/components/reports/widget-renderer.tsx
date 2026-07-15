import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { format } from 'date-fns'
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
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  RadialBar,
  RadialBarChart,
  XAxis,
  YAxis
} from 'recharts'
import type {
  Measure,
  QueryRow,
  ReportFilters,
  ReportWidget,
  ResolvedQuery,
  TimeGrain,
  WidgetConfig
} from '@shared/reports'
import type { BudgetSummary } from '@shared/budgets'
import { cn, formatAmount } from '@/lib/utils'
import { usePrivacy } from '@/lib/settings'
import { Amount } from '@/components/amount'
import { EnvelopeProgressRow } from '@/components/budget/envelope-progress'
import { TransactionsTable } from '@/components/transactions-table'
import { Badge } from '@/components/ui/badge'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
} from '@/components/ui/chart'
import { groupTotals, pivotTimeSeries, type SeriesInfo } from './data'
import { useResolvedQuery, useWidgetData } from './use-widget-data'

const PALETTE_SIZE = 10

// Recharts renders y-axis tick text outside the g that YAxis's className lands
// on, so the privacy blur has to target the labels from the chart container.
const BLUR_Y_TICK_LABELS =
  '[&_.recharts-yAxis-tick-labels]:blur-sm [&_.recharts-yAxis-tick-labels]:select-none'

/** Cycles through --chart-1..10; series beyond the palette get the same hues
 * tinted lighter, then darker, so up to 30 series never share a color. */
function paletteColor(index: number): string {
  const base = `var(--chart-${(index % PALETTE_SIZE) + 1})`
  const cycle = Math.floor(index / PALETTE_SIZE) % 3
  if (cycle === 0) return base
  return `color-mix(in oklab, ${base}, ${cycle === 1 ? 'white' : 'black'} 30%)`
}

function formatMeasureValue(measure: Measure, value: number, currency: string): string {
  if (measure === 'count') return Math.round(value).toLocaleString()
  return formatAmount(value, currency)
}

/** Compact axis ticks: "$1.2K" for money (milliunits), "1.2K" for counts */
function tickFormatter(measure: Measure, currency: string): (value: number) => string {
  if (measure === 'count') {
    return (value) => new Intl.NumberFormat(undefined, { notation: 'compact' }).format(value)
  }
  return (value) => {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        notation: 'compact'
      }).format(value / 1000)
    } catch {
      return new Intl.NumberFormat(undefined, { notation: 'compact' }).format(value / 1000)
    }
  }
}

/** Shared body for chart tooltips: label on the left, formatted value on the right. */
function TooltipRow({
  label,
  measure,
  value,
  currency,
  color
}: {
  label: React.ReactNode
  measure: Measure
  value: number
  currency: string
  color?: string
}) {
  return (
    <>
      {color && (
        <div className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: color }} />
      )}
      <div className="flex flex-1 items-center justify-between gap-4 leading-none">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-medium tabular-nums">
          {measure === 'count' ? (
            formatMeasureValue(measure, value, currency)
          ) : (
            <Amount value={value} currency={currency} colored={false} />
          )}
        </span>
      </div>
    </>
  )
}

/** Money renders via <Amount> (signed coloring for sums only); counts as plain text. */
function MeasureValue({
  measure,
  value,
  currency
}: {
  measure: Measure
  value: number
  currency: string
}) {
  if (measure === 'count') return <>{formatMeasureValue(measure, value, currency)}</>
  return <Amount value={value} currency={currency} colored={measure === 'sum'} />
}

function CenteredNote({ children }: { children: React.ReactNode }) {
  return (
    <Empty className="h-full p-4">
      <EmptyDescription className="text-sm">{children}</EmptyDescription>
    </Empty>
  )
}

function MixedCurrencyBadge({ currencies }: { currencies: string[] }) {
  if (currencies.length <= 1) return null
  return (
    <Badge variant="outline" className="absolute top-0 right-0 z-10 bg-background/80">
      Mixed currencies: {currencies.join(', ')}
    </Badge>
  )
}

function WidgetSkeleton() {
  return (
    <div className="flex h-full flex-col justify-end gap-2 px-6 pt-2 pb-6">
      <div className="flex flex-1 items-end gap-2">
        {[40, 70, 55, 85, 60, 75].map((h, i) => (
          <Skeleton key={i} className="w-full" style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  )
}

function chartConfigFor(series: SeriesInfo[]): ChartConfig {
  return Object.fromEntries(
    series.map((s, i) => [s.key, { label: s.label, color: paletteColor(i) }])
  )
}

// ---------- time-series charts (line / bar / area) ----------

function TimeSeriesChart({
  widget,
  config,
  rows,
  currencies,
  resolved
}: {
  widget: ReportWidget
  config: WidgetConfig
  rows: QueryRow[]
  currencies: string[]
  resolved: ResolvedQuery
}) {
  const { blurAmounts } = usePrivacy()
  const grain = config.query.timeGrain as Exclude<TimeGrain, 'none'>
  const { data, series, tooManyBuckets } = useMemo(
    () =>
      pivotTimeSeries(
        rows,
        grain,
        resolved.filters.dateStart,
        resolved.filters.dateEnd,
        config.query.cumulative
      ),
    [rows, grain, resolved.filters.dateStart, resolved.filters.dateEnd, config.query.cumulative]
  )

  if (tooManyBuckets) {
    return <CenteredNote>Too many data points. Pick a coarser time grain.</CenteredNote>
  }
  if (rows.length === 0) {
    return <CenteredNote>No transactions match these filters.</CenteredNote>
  }

  const chartConfig = chartConfigFor(series)
  const stacked = config.display?.stacked ?? false
  const measure = config.query.measure
  const currency = currencies[0] ?? 'USD'
  const yTick = tickFormatter(measure, currency)
  const tooltip = (
    <ChartTooltip
      content={
        <ChartTooltipContent
          formatter={(value, name, item) => (
            <TooltipRow
              color={item.color}
              label={chartConfig[name as string]?.label ?? name}
              measure={measure}
              value={value as number}
              currency={series.find((s) => s.key === name)?.currency ?? currency}
            />
          )}
        />
      }
    />
  )
  const legend = config.display?.showLegend ? (
    <ChartLegend content={<ChartLegendContent />} />
  ) : null
  const axes = (
    <>
      <CartesianGrid vertical={false} />
      <XAxis dataKey="bucket" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
      <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={yTick} />
    </>
  )

  return (
    <div className="relative h-full px-4 pb-4">
      <MixedCurrencyBadge currencies={currencies} />
      <ChartContainer
        config={chartConfig}
        className={cn(
          'aspect-auto h-full w-full',
          blurAmounts && measure !== 'count' && BLUR_Y_TICK_LABELS
        )}
      >
        {widget.type === 'line' ? (
          <LineChart data={data} margin={{ top: 16, right: 8 }}>
            {axes}
            {tooltip}
            {legend}
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
        ) : widget.type === 'area' ? (
          <AreaChart data={data} margin={{ top: 16, right: 8 }}>
            {axes}
            {tooltip}
            {legend}
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
            {legend}
            {series.map((s) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                fill={`var(--color-${s.key})`}
                stackId={stacked ? 'stack' : undefined}
                radius={stacked ? 0 : [2, 2, 0, 0]}
              />
            ))}
          </BarChart>
        )}
      </ChartContainer>
    </div>
  )
}

// ---------- categorical bar (no time axis, grouped) ----------

function CategoricalBarChart({
  config,
  rows,
  currencies
}: {
  config: WidgetConfig
  rows: QueryRow[]
  currencies: string[]
}) {
  const { blurAmounts } = usePrivacy()
  const totals = useMemo(
    () => groupTotals(rows, config.query.sort ?? { by: 'value', dir: 'desc' }, config.query.limit),
    [rows, config.query.sort, config.query.limit]
  )
  if (totals.length === 0) {
    return <CenteredNote>No transactions match these filters.</CenteredNote>
  }
  const measure = config.query.measure
  const currency = currencies[0] ?? 'USD'
  const chartConfig: ChartConfig = { value: { label: 'Value' } }
  return (
    <div className="relative h-full px-4 pb-4">
      <MixedCurrencyBadge currencies={currencies} />
      <ChartContainer
        config={chartConfig}
        className={cn(
          'aspect-auto h-full w-full',
          blurAmounts && measure !== 'count' && BLUR_Y_TICK_LABELS
        )}
      >
        <BarChart data={totals} margin={{ top: 16, right: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={tickFormatter(measure, currency)}
          />
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
          <Bar dataKey="value" radius={[2, 2, 0, 0]}>
            {totals.map((t, i) => (
              <Cell key={`${t.groupId}-${t.currency}`} fill={paletteColor(i)} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  )
}

// ---------- pie / donut ----------

function PieChartWidget({
  config,
  rows,
  currencies
}: {
  config: WidgetConfig
  rows: QueryRow[]
  currencies: string[]
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
  const measure = config.query.measure
  // keyed by slice label: ChartLegendContent looks up entries by the datum's
  // nameKey value; no color field since cells set an explicit fill
  const chartConfig: ChartConfig = Object.fromEntries(
    totals.map((t) => [t.label, { label: t.label }])
  )
  const data = totals.map((t, i) => ({ ...t, fill: paletteColor(i) }))
  return (
    <div className="relative h-full px-4 pb-4">
      <MixedCurrencyBadge currencies={currencies} />
      <ChartContainer config={chartConfig} className="aspect-auto h-full w-full">
        <PieChart>
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
          {config.display?.showLegend ? (
            <ChartLegend content={<ChartLegendContent nameKey="label" />} />
          ) : null}
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius={config.display?.donut ? '55%' : 0}
            strokeWidth={2}
          />
        </PieChart>
      </ChartContainer>
    </div>
  )
}

// ---------- radar ----------

function RadarChartWidget({
  config,
  rows,
  currencies
}: {
  config: WidgetConfig
  rows: QueryRow[]
  currencies: string[]
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
  const measure = config.query.measure
  const currency = currencies[0] ?? 'USD'
  const chartConfig: ChartConfig = { value: { label: 'Value', color: 'var(--chart-1)' } }
  return (
    <div className="relative h-full px-4 pb-4">
      <MixedCurrencyBadge currencies={currencies} />
      <ChartContainer config={chartConfig} className="aspect-auto h-full w-full">
        <RadarChart data={totals}>
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
          <Radar dataKey="value" fill="var(--color-value)" fillOpacity={0.6} />
        </RadarChart>
      </ChartContainer>
    </div>
  )
}

// ---------- radial bar ----------

function RadialChartWidget({
  config,
  rows,
  currencies
}: {
  config: WidgetConfig
  rows: QueryRow[]
  currencies: string[]
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
  const measure = config.query.measure
  // keyed by arc label, mirroring the pie widget's legend lookup
  const chartConfig: ChartConfig = Object.fromEntries(
    totals.map((t) => [t.label, { label: t.label }])
  )
  const data = totals.map((t, i) => ({ ...t, fill: paletteColor(i) }))
  return (
    <div className="relative flex h-full flex-col px-4 pb-4">
      <MixedCurrencyBadge currencies={currencies} />
      <ChartContainer config={chartConfig} className="aspect-auto min-h-0 w-full flex-1">
        <RadialBarChart data={data} innerRadius="25%" outerRadius="100%">
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
          <RadialBar dataKey="value" background />
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

// ---------- stat card ----------

function StatCardWidget({
  config,
  rows,
  currencies
}: {
  config: WidgetConfig
  rows: QueryRow[]
  currencies: string[]
}) {
  const measure = config.query.measure
  // one row per currency when groupBy/timeGrain are 'none'
  const byCurrency = currencies.map((currency) => ({
    currency,
    value: rows.filter((r) => r.currency === currency).reduce((sum, r) => sum + r.value, 0)
  }))
  if (byCurrency.length === 0) {
    return <CenteredNote>No transactions match these filters.</CenteredNote>
  }
  return (
    // the padding also gives the privacy blur halo room inside the overflow-hidden clip box
    <div className="flex h-full flex-col items-start justify-center gap-1 overflow-hidden p-4">
      {byCurrency.map(({ currency, value }) => (
        <div key={currency} className="text-3xl font-semibold tracking-tight tabular-nums">
          <MeasureValue measure={measure} value={value} currency={currency} />
        </div>
      ))}
    </div>
  )
}

// ---------- summary table ----------

function SummaryTableWidget({
  config,
  rows,
  currencies
}: {
  config: WidgetConfig
  rows: QueryRow[]
  currencies: string[]
}) {
  const totals = useMemo(
    () => groupTotals(rows, config.query.sort ?? { by: 'value', dir: 'desc' }, config.query.limit),
    [rows, config.query.sort, config.query.limit]
  )
  const measure = config.query.measure
  const totalByCurrency = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of totals) map.set(t.currency, (map.get(t.currency) ?? 0) + Math.abs(t.value))
    return map
  }, [totals])

  if (totals.length === 0) {
    return <CenteredNote>No transactions match these filters.</CenteredNote>
  }
  return (
    // full-bleed: the table spans the card edges; the badge stays pinned outside
    // the scroll region so it doesn't scroll away with the rows
    <div className="relative h-full">
      <MixedCurrencyBadge currencies={currencies} />
      <ScrollArea className="h-full">
        {/* raw <table>, not the Table wrapper: its overflow-x container would
            become the sticky header's scroll context and break stickiness */}
        <table className="w-full caption-bottom text-xs">
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead>Group</TableHead>
              <TableHead className="w-32 text-right">Value</TableHead>
              <TableHead className="w-16 text-right">%</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {totals.map((t, i) => {
              const denominator = totalByCurrency.get(t.currency) ?? 0
              const pct = denominator > 0 ? (Math.abs(t.value) / denominator) * 100 : 0
              return (
                <TableRow key={`${t.groupId}-${t.currency}-${i}`}>
                  <TableCell className="truncate font-medium">{t.label}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <MeasureValue measure={measure} value={t.value} currency={t.currency} />
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {pct.toFixed(0)}%
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </table>
      </ScrollArea>
    </div>
  )
}

// ---------- transactions ----------

function TransactionsWidget({
  widget,
  config,
  reportFilters
}: {
  widget: ReportWidget
  config: WidgetConfig
  reportFilters: ReportFilters
}) {
  const resolved = useResolvedQuery(config, reportFilters)
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

// ---------- budget ----------

function BudgetWidget({
  config,
  reportFilters
}: {
  config: WidgetConfig
  reportFilters: ReportFilters
}) {
  const resolved = useResolvedQuery(config, reportFilters)
  // show the envelopes for the month the filtered range ends in, so "Last
  // month" reports budget-match their charts; unbounded ranges mean today
  const month = format(
    resolved.filters.dateEnd !== null ? new Date(resolved.filters.dateEnd * 1000) : new Date(),
    'yyyy-MM'
  )
  const query = useQuery({
    queryKey: ['budget-summary', month],
    queryFn: () => window.api.budgets.summary({ month }),
    placeholderData: (prev: BudgetSummary | undefined) => prev
  })

  if (query.isLoading) return <WidgetSkeleton />
  if (query.isError) {
    return <CenteredNote>Failed to load: {String(query.error)}</CenteredNote>
  }
  const summary = query.data!

  if (summary.envelopes.length === 0) {
    return (
      <Empty className="h-full">
        <EmptyDescription>
          No envelopes for {format(new Date(`${month}-01T00:00`), 'MMMM yyyy')}.{' '}
          <Link to="/budget" className="underline underline-offset-2">
            Set up your budget
          </Link>
        </EmptyDescription>
      </Empty>
    )
  }

  return (
    <ScrollArea className="h-full min-h-0">
      <div className="space-y-3 p-4 pt-1">
        <div className="flex items-baseline justify-between text-xs text-muted-foreground">
          <span>{format(new Date(`${month}-01T00:00`), 'MMMM yyyy')}</span>
          <span>
            <Amount value={summary.totals.balance} currency={summary.currency} colored={false} />{' '}
            available
          </span>
        </div>
        {summary.envelopes.map((envelope) => (
          <EnvelopeProgressRow
            key={envelope.categoryId}
            envelope={envelope}
            currency={summary.currency}
          />
        ))}
        {summary.unbudgetedSpent > 0 && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Unbudgeted spending</span>
            <Amount value={summary.unbudgetedSpent} currency={summary.currency} colored={false} />
          </div>
        )}
      </div>
    </ScrollArea>
  )
}

// ---------- dispatcher ----------

function AggregateWidget({
  widget,
  config,
  reportFilters
}: {
  widget: ReportWidget
  config: WidgetConfig
  reportFilters: ReportFilters
}) {
  const { resolved, query } = useWidgetData(widget.id, config, reportFilters)
  if (query.isLoading) return <WidgetSkeleton />
  if (query.isError) {
    return <CenteredNote>Failed to load: {String(query.error)}</CenteredNote>
  }
  const { rows, currencies } = query.data!

  switch (widget.type) {
    case 'line':
    case 'area':
      if (config.query.timeGrain === 'none') {
        return <CenteredNote>Line and area charts need a time grain.</CenteredNote>
      }
      return (
        <TimeSeriesChart
          widget={widget}
          config={config}
          rows={rows}
          currencies={currencies}
          resolved={resolved}
        />
      )
    case 'bar':
      if (config.query.timeGrain === 'none') {
        if (config.query.groupBy === 'none') {
          return <CenteredNote>Bar charts need a time grain or a group by.</CenteredNote>
        }
        return <CategoricalBarChart config={config} rows={rows} currencies={currencies} />
      }
      return (
        <TimeSeriesChart
          widget={widget}
          config={config}
          rows={rows}
          currencies={currencies}
          resolved={resolved}
        />
      )
    case 'pie':
      return <PieChartWidget config={config} rows={rows} currencies={currencies} />
    case 'radar':
      return <RadarChartWidget config={config} rows={rows} currencies={currencies} />
    case 'radial':
      return <RadialChartWidget config={config} rows={rows} currencies={currencies} />
    case 'stat':
      return <StatCardWidget config={config} rows={rows} currencies={currencies} />
    case 'summaryTable':
      return <SummaryTableWidget config={config} rows={rows} currencies={currencies} />
    default:
      return <CenteredNote>Unknown widget type.</CenteredNote>
  }
}

export function WidgetRenderer({
  widget,
  reportFilters
}: {
  widget: ReportWidget
  reportFilters: ReportFilters
}) {
  if (!widget.config) {
    return (
      <CenteredNote>
        This widget&apos;s configuration is from an incompatible version. Edit it to reconfigure.
      </CenteredNote>
    )
  }
  if (widget.type === 'transactions') {
    return (
      <TransactionsWidget widget={widget} config={widget.config} reportFilters={reportFilters} />
    )
  }
  if (widget.type === 'budget') {
    return <BudgetWidget config={widget.config} reportFilters={reportFilters} />
  }
  return <AggregateWidget widget={widget} config={widget.config} reportFilters={reportFilters} />
}
