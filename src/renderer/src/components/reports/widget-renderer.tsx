import { memo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type {
  QueryRow,
  ReportFilters,
  ReportWidget,
  ResolvedQuery,
  WidgetConfig
} from '@shared/reports'
import { useDrill, type OnDrill } from './use-drill'
import { useWidgetData } from './use-widget-data'
import { WidgetError, WidgetErrorBoundary } from './widget-error'
import { CategoricalBarChart } from './widgets/categorical-bar'
import { BudgetWidget } from './widgets/budget'
import { GoalsWidget, NoGoalsNote } from './widgets/goals'
import { PieChartWidget } from './widgets/pie'
import { RadarChartWidget } from './widgets/radar'
import { RadialChartWidget } from './widgets/radial'
import { CenteredNote, WidgetSkeleton } from './widgets/shared'
import { StatCardWidget } from './widgets/stat'
import { SummaryTableWidget } from './widgets/summary-table'
import { TimeSeriesChart } from './widgets/time-series'
import { TransactionsWidget } from './widgets/transactions'

// ---------- dispatcher ----------

function AggregateWidget({
  widget,
  config,
  reportFilters,
  drillable
}: {
  widget: ReportWidget
  config: WidgetConfig
  reportFilters: ReportFilters
  drillable: boolean
}) {
  const { resolved, query } = useWidgetData(widget.id, config, reportFilters)
  const onDrill = useDrill(config, reportFilters, drillable)
  const isGoals = config.query.source === 'goals'
  // the goal list is what tells the empty states apart
  const goalsQuery = useQuery({
    queryKey: ['goals'],
    queryFn: () => window.api.goals.list(),
    enabled: isGoals
  })

  if (query.isLoading || goalsQuery.isLoading) return <WidgetSkeleton />
  if (query.isError) {
    return <WidgetError error={query.error} onRetry={() => void query.refetch()} />
  }
  const { rows, currencies } = query.data!

  const body = (
    <AggregateBody
      widget={widget}
      config={config}
      rows={rows}
      currencies={currencies}
      resolved={resolved}
      reportFilters={reportFilters}
      onDrill={onDrill}
    />
  )
  if (!isGoals) return body

  const active = (goalsQuery.data ?? []).filter((goal) => goal.archivedAt === null)
  if (active.length === 0) return <NoGoalsNote />

  const ids = config.query.goalIds
  const chosen = ids === undefined ? active : active.filter((goal) => ids.includes(goal.id))
  if (chosen.length === 0) {
    return <CenteredNote>No goals selected. Edit this widget to pick some.</CenteredNote>
  }

  // an unlinked goal has nothing to derive from: its line would be a flat zero
  const unlinked = chosen.filter((goal) => goal.accounts.length === 0)
  const note = unlinked.map((goal) => `${goal.name} has no linked account.`).join(' ')
  const linked = new Set(chosen.filter((goal) => goal.accounts.length > 0).map((goal) => goal.id))
  if (linked.size === 0) return <CenteredNote>{note}</CenteredNote>

  const plotted = rows.filter((row) => row.groupId !== null && linked.has(row.groupId))
  if (plotted.length === 0) return <CenteredNote>No goal history in this range.</CenteredNote>

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <AggregateBody
          widget={widget}
          config={config}
          rows={plotted}
          currencies={currencies}
          resolved={resolved}
          reportFilters={reportFilters}
          onDrill={onDrill}
        />
      </div>
      {note && <p className="shrink-0 px-4 pb-2 text-xs text-muted-foreground">{note}</p>}
    </div>
  )
}

function AggregateBody({
  widget,
  config,
  rows,
  currencies,
  resolved,
  reportFilters,
  onDrill
}: {
  widget: ReportWidget
  config: WidgetConfig
  rows: QueryRow[]
  currencies: string[]
  resolved: ResolvedQuery
  reportFilters: ReportFilters
  onDrill?: OnDrill
}) {
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
          onDrill={onDrill}
        />
      )
    case 'bar':
      if (config.query.timeGrain === 'none') {
        if (config.query.groupBy === 'none') {
          return <CenteredNote>Bar charts need a time grain or a group by.</CenteredNote>
        }
        return (
          <CategoricalBarChart
            config={config}
            rows={rows}
            currencies={currencies}
            onDrill={onDrill}
          />
        )
      }
      return (
        <TimeSeriesChart
          widget={widget}
          config={config}
          rows={rows}
          currencies={currencies}
          resolved={resolved}
          onDrill={onDrill}
        />
      )
    case 'pie':
      return (
        <PieChartWidget config={config} rows={rows} currencies={currencies} onDrill={onDrill} />
      )
    case 'radar':
      return (
        <RadarChartWidget config={config} rows={rows} currencies={currencies} onDrill={onDrill} />
      )
    case 'radial':
      return (
        <RadialChartWidget config={config} rows={rows} currencies={currencies} onDrill={onDrill} />
      )
    case 'stat':
      return (
        <StatCardWidget
          widget={widget}
          config={config}
          rows={rows}
          currencies={currencies}
          resolved={resolved}
          reportFilters={reportFilters}
        />
      )
    case 'summaryTable':
      return (
        <SummaryTableWidget config={config} rows={rows} currencies={currencies} onDrill={onDrill} />
      )
    default:
      return <CenteredNote>Unknown widget type.</CenteredNote>
  }
}

interface WidgetRendererProps {
  widget: ReportWidget
  reportFilters: ReportFilters
  /** clicking a mark opens its transactions; off while editing and in previews */
  drillable: boolean
}

function WidgetBody({ widget, reportFilters, drillable }: WidgetRendererProps) {
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
  if (widget.type === 'goals') {
    return <GoalsWidget config={widget.config} />
  }
  return (
    <AggregateWidget
      widget={widget}
      config={widget.config}
      reportFilters={reportFilters}
      drillable={drillable}
    />
  )
}

export const WidgetRenderer = memo(
  function WidgetRenderer(props: WidgetRendererProps) {
    return (
      <WidgetErrorBoundary resetKey={props.widget.config}>
        <WidgetBody {...props} />
      </WidgetErrorBoundary>
    )
  },
  (a, b) =>
    // title and grid position never reach the body, so typing a title in the editor
    // preview (or dragging a card) leaves the chart and its queries alone
    a.reportFilters === b.reportFilters &&
    a.drillable === b.drillable &&
    a.widget.id === b.widget.id &&
    a.widget.type === b.widget.type &&
    a.widget.config === b.widget.config
)
