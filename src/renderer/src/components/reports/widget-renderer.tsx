import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { format } from 'date-fns'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
import type { BudgetSummary, EnvelopeSummary } from '@shared/budgets'
import { cn, formatAmount } from '@/lib/utils'
import { formatBucketLabel, formatMonthLong } from '@/lib/format-date'
import { usePrivacy } from '@/lib/settings'
import { Amount } from '@/components/amount'
import { Chart, type FormatValue } from '@/components/charts/chart'
import { EnvelopeProgressRow } from '@/components/budget/envelope-progress'
import { TransactionsTable } from '@/components/transactions-table'
import { Badge } from '@/components/ui/badge'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
} from '@/components/ui/chart'
import { BLUR_Y_TICK_LABELS, paletteColor } from '@/components/charts/chart-style'
import { groupTotals, pivotTimeSeries } from './data'
import { useResolvedQuery, useWidgetData } from './use-widget-data'

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

function makeFormatValue(measure: Measure, fallbackCurrency: string): FormatValue {
  const compact = tickFormatter(measure, fallbackCurrency)
  return (value, opts) =>
    opts?.compact
      ? compact(value)
      : formatMeasureValue(measure, value, opts?.currency ?? fallbackCurrency)
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

  const currency = currencies[0] ?? 'USD'
  const measure = config.query.measure
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
        className="h-full"
      />
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
  const totals = useMemo(
    () => groupTotals(rows, config.query.sort ?? { by: 'value', dir: 'desc' }, config.query.limit),
    [rows, config.query.sort, config.query.limit]
  )
  if (totals.length === 0) {
    return <CenteredNote>No transactions match these filters.</CenteredNote>
  }
  const measure = config.query.measure
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
        className="h-full"
      />
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
        className="h-full"
      />
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
  const fv = makeFormatValue(measure, currencies[0] ?? 'USD')
  const items = byCurrency.map(({ currency, value }) => ({
    value,
    currency,
    colored: measure === 'sum',
    sensitive: measure !== 'count'
  }))
  return (
    <Chart
      kind="stat"
      items={items}
      formatValue={fv}
      className="h-full justify-center overflow-hidden p-4"
    />
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
          No envelopes for {formatMonthLong(month)}.{' '}
          <Link to="/budget" className="underline underline-offset-2">
            Set up your budget
          </Link>
        </EmptyDescription>
      </Empty>
    )
  }

  const view = config.display?.budgetView ?? 'list'
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-baseline justify-between px-4 pt-1 pb-2 text-xs text-muted-foreground">
        <span>{formatMonthLong(month)}</span>
        <span>
          <Amount value={summary.totals.balance} currency={summary.currency} colored={false} />{' '}
          available
        </span>
      </div>
      {view === 'list' ? (
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-3 px-4 pb-4">
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
                <Amount
                  value={summary.unbudgetedSpent}
                  currency={summary.currency}
                  colored={false}
                />
              </div>
            )}
          </div>
        </ScrollArea>
      ) : view === 'bars' ? (
        <BudgetBarsChart envelopes={summary.envelopes} currency={summary.currency} />
      ) : view === 'balances' ? (
        <BudgetBalancesChart envelopes={summary.envelopes} currency={summary.currency} />
      ) : view === 'donut' ? (
        <BudgetDonutChart
          envelopes={summary.envelopes}
          currency={summary.currency}
          showLegend={config.display?.showLegend ?? false}
        />
      ) : (
        <BudgetGaugeChart totals={summary.totals} currency={summary.currency} />
      )}
    </div>
  )
}

/** Spent vs budgeted, one bar pair per envelope. */
function BudgetBarsChart({
  envelopes,
  currency
}: {
  envelopes: EnvelopeSummary[]
  currency: string
}) {
  const { blurAmounts } = usePrivacy()
  const data = envelopes.map((e) => ({ label: e.categoryName, budgeted: e.fill, spent: e.spent }))
  const chartConfig: ChartConfig = {
    budgeted: { label: 'Budgeted', color: paletteColor(0) },
    spent: { label: 'Spent', color: paletteColor(1) }
  }
  return (
    <div className="min-h-0 flex-1 px-4 pb-4">
      <ChartContainer
        config={chartConfig}
        className={cn('aspect-auto h-full w-full', blurAmounts && BLUR_Y_TICK_LABELS)}
      >
        <BarChart data={data} margin={{ top: 8, right: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={tickFormatter('expense', currency)}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value, name, item) => (
                  <TooltipRow
                    color={item.color}
                    label={chartConfig[name as string]?.label ?? name}
                    measure="expense"
                    value={value as number}
                    currency={currency}
                  />
                )}
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar dataKey="budgeted" fill="var(--color-budgeted)" radius={[2, 2, 0, 0]} />
          <Bar dataKey="spent" fill="var(--color-spent)" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ChartContainer>
    </div>
  )
}

/** Rollover balance per envelope; negative balances render destructive. */
function BudgetBalancesChart({
  envelopes,
  currency
}: {
  envelopes: EnvelopeSummary[]
  currency: string
}) {
  const { blurAmounts } = usePrivacy()
  const data = envelopes.map((e) => ({ label: e.categoryName, balance: e.balance }))
  const chartConfig: ChartConfig = { balance: { label: 'Available' } }
  return (
    <div className="min-h-0 flex-1 px-4 pb-4">
      <ChartContainer
        config={chartConfig}
        className={cn('aspect-auto h-full w-full', blurAmounts && BLUR_Y_TICK_LABELS)}
      >
        <BarChart data={data} margin={{ top: 8, right: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={tickFormatter('sum', currency)}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                hideLabel
                formatter={(value, _name, item) => (
                  <TooltipRow
                    label={item.payload?.label}
                    measure="sum"
                    value={value as number}
                    currency={currency}
                  />
                )}
              />
            }
          />
          <Bar dataKey="balance" radius={[2, 2, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={d.label} fill={d.balance < 0 ? 'var(--destructive)' : paletteColor(i)} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  )
}

/** How this month's total budget is allocated across envelopes. */
function BudgetDonutChart({
  envelopes,
  currency,
  showLegend
}: {
  envelopes: EnvelopeSummary[]
  currency: string
  showLegend: boolean
}) {
  const slices = envelopes.filter((e) => e.fill > 0)
  if (slices.length === 0) {
    return <CenteredNote>No envelopes with a fill this month.</CenteredNote>
  }
  const chartConfig: ChartConfig = Object.fromEntries(
    slices.map((e) => [e.categoryName, { label: e.categoryName }])
  )
  const data = slices.map((e, i) => ({
    label: e.categoryName,
    value: e.fill,
    fill: paletteColor(i)
  }))
  return (
    <div className="min-h-0 flex-1 px-4 pb-4">
      <ChartContainer config={chartConfig} className="aspect-auto h-full w-full">
        <PieChart>
          <ChartTooltip
            content={
              <ChartTooltipContent
                hideLabel
                formatter={(value, _name, item) => (
                  <TooltipRow
                    label={item.payload?.label}
                    measure="expense"
                    value={value as number}
                    currency={currency}
                  />
                )}
              />
            }
          />
          {showLegend ? <ChartLegend content={<ChartLegendContent nameKey="label" />} /> : null}
          <Pie data={data} dataKey="value" nameKey="label" innerRadius="55%" strokeWidth={2} />
        </PieChart>
      </ChartContainer>
    </div>
  )
}

/** Overall utilization: total spent as a share of total budgeted. */
function BudgetGaugeChart({
  totals,
  currency
}: {
  totals: { fill: number; spent: number }
  currency: string
}) {
  const pct = totals.fill > 0 ? (totals.spent / totals.fill) * 100 : totals.spent > 0 ? 100 : 0
  const over = pct > 100
  const data = [{ value: Math.min(100, pct), fill: over ? 'var(--destructive)' : 'var(--chart-1)' }]
  return (
    <div className="relative min-h-0 flex-1 px-4 pb-4">
      <ChartContainer config={{ value: { label: 'Used' } }} className="aspect-auto h-full w-full">
        <RadialBarChart
          data={data}
          startAngle={90}
          endAngle={-270}
          innerRadius="72%"
          outerRadius="100%"
        >
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar dataKey="value" background cornerRadius={4} />
        </RadialBarChart>
      </ChartContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5 pb-4">
        <span className={cn('text-2xl font-semibold tracking-tight', over && 'text-destructive')}>
          {Math.round(pct)}%
        </span>
        <span className="text-xs text-muted-foreground">
          <Amount value={totals.spent} currency={currency} colored={false} /> of{' '}
          <Amount value={totals.fill} currency={currency} colored={false} />
        </span>
      </div>
    </div>
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
