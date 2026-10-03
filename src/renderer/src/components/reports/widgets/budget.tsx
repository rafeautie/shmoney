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
import { usePrivacy } from '@/lib/settings'
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
import { BLUR_X_TICK_LABELS, paletteColor } from '@/components/charts/chart-style'
import { useResolvedQuery } from '../use-widget-data'
import { WidgetError } from '../widget-error'
import { CenteredNote, TooltipRow, WidgetSkeleton } from './shared'
import { tickFormatter } from './measure'

export function BudgetWidget({
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
        className={cn('aspect-auto h-full w-full', blurAmounts && BLUR_X_TICK_LABELS)}
      >
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 8 }}>
          <CartesianGrid horizontal={false} />
          <XAxis
            type="number"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={tickFormatter('expense', currency)}
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
          />
          <Bar
            dataKey="spent"
            fill="var(--color-spent)"
            radius={[0, 2, 2, 0]}
            isAnimationActive={false}
          />
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
        className={cn('aspect-auto h-full w-full', blurAmounts && BLUR_X_TICK_LABELS)}
      >
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 8 }}>
          <CartesianGrid horizontal={false} />
          <XAxis
            type="number"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={tickFormatter('sum', currency)}
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
          <Bar dataKey="balance" radius={[0, 2, 2, 0]} isAnimationActive={false}>
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
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius="55%"
            strokeWidth={2}
            isAnimationActive={false}
          />
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
          <RadialBar dataKey="value" background cornerRadius={4} isAnimationActive={false} />
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
