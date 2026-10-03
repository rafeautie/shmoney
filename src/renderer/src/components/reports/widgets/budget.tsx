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
  RadialBar,
  RadialBarChart,
  XAxis,
  YAxis
} from 'recharts'
import type { ReportFilters, WidgetConfig } from '@shared/reports'
import type { BudgetSummary, EnvelopeSummary } from '@shared/budgets'
import { cn } from '@/lib/utils'
import { formatMonthLong } from '@/lib/format-date'
import { Amount } from '@/components/amount'
import { EnvelopeProgressRow } from '@/components/budget/envelope-progress'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
} from '@/components/ui/chart'
import { paletteColor } from '@/components/charts/chart-style'
import { privateTick } from '@/components/charts/private-tick'
import { DRILL_LABEL, DRILL_TARGET, useBudgetDrill, type OnBudgetDrill } from '../use-drill'
import { useResolvedQuery } from '../use-widget-data'
import { WidgetError } from '../widget-error'
import { CenteredNote, TooltipRow, WidgetSkeleton } from './shared'
import { tickFormatter } from './measure'

/** Click/Enter/Space handlers that make a non-button element open a drill. */
function drillProps(onActivate: () => void) {
  return {
    role: 'button',
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      onActivate()
    }
  }
}

export function BudgetWidget({
  config,
  reportFilters,
  drillable
}: {
  config: WidgetConfig
  reportFilters: ReportFilters
  drillable: boolean
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
  const onDrill = useBudgetDrill(month, drillable)

  if (query.isLoading) return <WidgetSkeleton />
  if (query.isError) {
    return <WidgetError error={query.error} onRetry={() => void query.refetch()} />
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
            {summary.envelopes.map((envelope) =>
              onDrill ? (
                <div
                  key={envelope.categoryId}
                  className={DRILL_TARGET}
                  {...drillProps(() => onDrill([envelope.categoryId]))}
                >
                  <EnvelopeProgressRow
                    envelope={envelope}
                    currency={summary.currency}
                    nameClassName={DRILL_LABEL}
                  />
                </div>
              ) : (
                <EnvelopeProgressRow
                  key={envelope.categoryId}
                  envelope={envelope}
                  currency={summary.currency}
                />
              )
            )}
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
        <BudgetBarsChart
          envelopes={summary.envelopes}
          currency={summary.currency}
          onDrill={onDrill}
        />
      ) : view === 'balances' ? (
        <BudgetBalancesChart
          envelopes={summary.envelopes}
          currency={summary.currency}
          onDrill={onDrill}
        />
      ) : view === 'donut' ? (
        <BudgetDonutChart
          envelopes={summary.envelopes}
          currency={summary.currency}
          showLegend={config.display?.showLegend ?? false}
          onDrill={onDrill}
        />
      ) : (
        <BudgetGaugeChart
          totals={summary.totals}
          currency={summary.currency}
          onDrill={onDrill && (() => onDrill(summary.envelopes.map((e) => e.categoryId)))}
        />
      )}
    </div>
  )
}

/** Spent vs budgeted, one bar pair per envelope. */
function BudgetBarsChart({
  envelopes,
  currency,
  onDrill
}: {
  envelopes: EnvelopeSummary[]
  currency: string
  onDrill?: OnBudgetDrill
}) {
  const data = envelopes.map((e) => ({ label: e.categoryName, budgeted: e.fill, spent: e.spent }))
  const barClick =
    onDrill && ((_bar: unknown, index: number) => onDrill([envelopes[index].categoryId]))
  const chartConfig: ChartConfig = {
    budgeted: { label: 'Budgeted', color: paletteColor(0) },
    spent: { label: 'Spent', color: paletteColor(1) }
  }
  return (
    <div className="min-h-0 flex-1 px-4 pb-4">
      <ChartContainer
        config={chartConfig}
        className={cn(
          'aspect-auto h-full w-full',
          onDrill && '[&_.recharts-bar-rectangle]:cursor-pointer'
        )}
      >
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 8 }}>
          <CartesianGrid horizontal={false} />
          <XAxis
            type="number"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tick={privateTick(tickFormatter('expense', currency))}
          />
          <YAxis
            type="category"
            dataKey="label"
            tickLine={false}
            axisLine={false}
            width="auto"
            minTickGap={0}
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
          <Bar
            dataKey="budgeted"
            fill="var(--color-budgeted)"
            radius={[0, 2, 2, 0]}
            isAnimationActive={false}
            onClick={barClick}
          />
          <Bar
            dataKey="spent"
            fill="var(--color-spent)"
            radius={[0, 2, 2, 0]}
            isAnimationActive={false}
            onClick={barClick}
          />
        </BarChart>
      </ChartContainer>
    </div>
  )
}

/** Rollover balance per envelope; negative balances render destructive. */
function BudgetBalancesChart({
  envelopes,
  currency,
  onDrill
}: {
  envelopes: EnvelopeSummary[]
  currency: string
  onDrill?: OnBudgetDrill
}) {
  const data = envelopes.map((e) => ({ label: e.categoryName, balance: e.balance }))
  const chartConfig: ChartConfig = { balance: { label: 'Available' } }
  return (
    <div className="min-h-0 flex-1 px-4 pb-4">
      <ChartContainer
        config={chartConfig}
        className={cn(
          'aspect-auto h-full w-full',
          onDrill && '[&_.recharts-bar-rectangle]:cursor-pointer'
        )}
      >
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 8 }}>
          <CartesianGrid horizontal={false} />
          <XAxis
            type="number"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tick={privateTick(tickFormatter('sum', currency))}
          />
          <YAxis
            type="category"
            dataKey="label"
            tickLine={false}
            axisLine={false}
            width="auto"
            minTickGap={0}
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
          <Bar
            dataKey="balance"
            radius={[0, 2, 2, 0]}
            isAnimationActive={false}
            onClick={onDrill && ((_bar, index) => onDrill([envelopes[index].categoryId]))}
          >
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
  showLegend,
  onDrill
}: {
  envelopes: EnvelopeSummary[]
  currency: string
  showLegend: boolean
  onDrill?: OnBudgetDrill
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
      <ChartContainer
        config={chartConfig}
        className={cn(
          'aspect-auto h-full w-full',
          onDrill && '[&_.recharts-pie-sector]:cursor-pointer'
        )}
      >
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
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius="55%"
            strokeWidth={2}
            isAnimationActive={false}
            onClick={onDrill && ((_slice, index) => onDrill([slices[index].categoryId]))}
          />
        </PieChart>
      </ChartContainer>
    </div>
  )
}

/** Overall utilization: total spent as a share of total budgeted. */
function BudgetGaugeChart({
  totals,
  currency,
  onDrill
}: {
  totals: { fill: number; spent: number }
  currency: string
  /** opens the spending in every envelope */
  onDrill?: () => void
}) {
  const pct = totals.fill > 0 ? (totals.spent / totals.fill) * 100 : totals.spent > 0 ? 100 : 0
  const over = pct > 100
  const data = [{ value: Math.min(100, pct), fill: over ? 'var(--destructive)' : 'var(--chart-1)' }]
  return (
    <div
      className={cn(
        'relative min-h-0 flex-1 px-4 pb-4',
        onDrill && cn(DRILL_TARGET, 'rounded-md focus-visible:ring-2 focus-visible:ring-ring/50')
      )}
      {...(onDrill && drillProps(onDrill))}
    >
      <ChartContainer config={{ value: { label: 'Used' } }} className="aspect-auto h-full w-full">
        <RadialBarChart
          data={data}
          startAngle={90}
          endAngle={-270}
          innerRadius="72%"
          outerRadius="100%"
        >
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar dataKey="value" background cornerRadius={4} isAnimationActive={false} />
        </RadialBarChart>
      </ChartContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5 pb-4">
        <span
          className={cn(
            'text-2xl font-semibold tracking-tight',
            over && 'text-destructive',
            onDrill && DRILL_LABEL
          )}
        >
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
